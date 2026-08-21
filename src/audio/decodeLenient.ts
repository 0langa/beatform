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
 * DETERMINISM (audit A1): the native path resamples to the CONTEXT rate, and
 * the whole engine relies on that — the live analyzer taps the graph at
 * ctx.sampleRate while the offline analyzer reads the buffer's raw samples,
 * so they only agree when buffer rate === context rate. The first version of
 * this fallback kept the TRACK's native rate ("WebAudio resamples at
 * playback"), which was exactly the bug: playback resampled, analysis did
 * not, and a 44.1 kHz track on a 48 kHz context put every offline FFT bin
 * ~8 % off its live position. The fallback therefore now finishes with the
 * same one-time resample `decodeAudioData` performs (an OfflineAudioContext
 * render at the destination rate), restoring the invariant that a decoded
 * buffer's rate always equals the context rate.
 *
 * Memory honesty: the decoded PCM of a 2-hour stereo 44.1 kHz track is
 * ~2.4 GB of Float32 no matter who decodes it — the app keeps the whole
 * track in memory by design. The resample adds one transient copy at the
 * context rate while the native-rate assembly is dropped.
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
  // Dynamic import (R2-35): this module sits in the BOOT graph via
  // engine.ts/store.ts, but mediabunny is only ever needed on this rare
  // fallback path (native decode already rejected) — loading the ~511 kB
  // codec chunk here instead of statically keeps it out of app startup.
  const { ALL_FORMATS, AudioBufferSink, BufferSource, Input } = await import("mediabunny");
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
  const native = new AudioBuffer({
    numberOfChannels: channels,
    length: totalFrames,
    sampleRate: rate,
  });
  const dest = Array.from({ length: channels }, (_, ch) => native.getChannelData(ch));

  const sink = new AudioBufferSink(track);
  // Contiguity cursor (audit A4): decoder chunks are back-to-back, but
  // `round(timestamp * rate)` can land one sample early/late per chunk,
  // opening a 1-sample gap (audible click) or overwriting the previous
  // chunk's last sample. Chunks whose timestamp rounds to within a couple of
  // samples of the running cursor are treated as contiguous; a genuinely
  // discontinuous stream (gap in the container) still respects its timestamp.
  let cursor = -1;
  for await (const { buffer, timestamp } of sink.buffers()) {
    const expected = Math.max(0, Math.round(timestamp * rate));
    const offset = cursor >= 0 && Math.abs(expected - cursor) <= 2 ? cursor : expected;
    const frames = Math.min(buffer.length, totalFrames - offset);
    if (frames <= 0) continue;
    for (let ch = 0; ch < channels; ch++) {
      // Mono sources fill both output channels from plane 0.
      const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      dest[ch].set(frames === src.length ? src : src.subarray(0, frames), offset);
    }
    cursor = offset + frames;
  }
  return resampleToContextRate(native, ctx.sampleRate);
}

/**
 * One-time high-quality resample to the destination rate — the same thing
 * `decodeAudioData` does internally. Exported for tests. A buffer already at
 * the target rate passes through untouched.
 */
export async function resampleToContextRate(
  buffer: AudioBuffer,
  targetRate: number,
): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;
  const frames = Math.ceil(buffer.duration * targetRate);
  const oac = new OfflineAudioContext(buffer.numberOfChannels, frames, targetRate);
  const src = oac.createBufferSource();
  src.buffer = buffer;
  src.connect(oac.destination);
  src.start();
  return oac.startRendering();
}
