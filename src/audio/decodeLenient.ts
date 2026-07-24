import { ALL_FORMATS, AudioBufferSink, BufferSource, Input } from "mediabunny";

/**
 * decodeAudioData with a long-file fallback.
 *
 * Chromium's `decodeAudioData` has an undocumented ceiling on decoded length:
 * measured on this engine, a 90-minute MP3 decodes and a 120-minute one
 * rejects with the generic "Unable to decode audio data" (regardless of
 * bitrate or channel count — it is the decoded duration that matters). The
 * app promises ~2-hour mixes, so when the native path rejects we decode
 * incrementally with mediabunny (WebCodecs under the hood) into a manually
 * allocated AudioBuffer.
 *
 * The fallback buffer keeps the TRACK's native sample rate (WebAudio happily
 * plays buffers at any rate, resampling on the fly). That is exactly as
 * consistent as the native path for the WYSIWYG rule: preview and export both
 * read THIS buffer, whatever its rate.
 *
 * Memory honesty: the decoded PCM of a 2-hour stereo 44.1 kHz track is
 * ~2.4 GB of Float32 no matter who decodes it — the app keeps the whole
 * track in memory by design. The fallback changes what is POSSIBLE, not what
 * it costs.
 */
export async function decodeAudioLenient(
  ctx: AudioContext | OfflineAudioContext,
  data: ArrayBuffer,
): Promise<AudioBuffer> {
  // decodeAudioData detaches the buffer it is given — keep a copy for the
  // fallback (sliced lazily only on the failure path would detach too late,
  // so slice up front; for the common path this costs one transient copy).
  const backup = data.slice(0);
  try {
    return await ctx.decodeAudioData(data);
  } catch (nativeError) {
    try {
      return await decodeWithMediabunny(ctx, backup);
    } catch (fallbackError) {
      console.warn("[decode] mediabunny fallback also failed", fallbackError);
      throw nativeError; // the native message is the recognizable one
    }
  }
}

async function decodeWithMediabunny(
  ctx: AudioContext | OfflineAudioContext,
  data: ArrayBuffer,
): Promise<AudioBuffer> {
  const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(data) });
  const track = await input.getPrimaryAudioTrack();
  if (!track || !(await track.canDecode())) {
    throw new Error("no decodable audio track");
  }
  const rate = await track.getSampleRate();
  const channels = Math.max(1, Math.min(2, await track.getNumberOfChannels()));
  const duration = await input.computeDuration();
  if (!(duration > 0) || !(rate > 0)) throw new Error("no duration/sample rate");
  const totalFrames = Math.ceil(duration * rate);

  // One allocation per channel (Float32Array each) — the same footprint the
  // native decoder would need. Throws on genuinely impossible sizes.
  const out = ctx.createBuffer(channels, totalFrames, rate);
  const dest = Array.from({ length: channels }, (_, ch) => out.getChannelData(ch));

  const sink = new AudioBufferSink(track);
  for await (const { buffer, timestamp } of sink.buffers()) {
    const offset = Math.max(0, Math.round(timestamp * rate));
    const frames = Math.min(buffer.length, totalFrames - offset);
    if (frames <= 0) continue;
    for (let ch = 0; ch < channels; ch++) {
      // Mono sources fill both output channels from plane 0.
      const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      dest[ch].set(frames === src.length ? src : src.subarray(0, frames), offset);
    }
  }
  return out;
}
