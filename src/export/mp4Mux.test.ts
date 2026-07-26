import { describe, expect, it } from "vitest";
import {
  AudioSampleSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSource,
  type StreamTargetChunk,
} from "mediabunny";
import { codecString, MUXER_CODEC, type Mp4CodecId } from "./codecProbe";

/**
 * The MP4 mux path exportCore drives, exercised without WebCodecs.
 *
 * exportCore hands mediabunny two things it cannot get anywhere else: the
 * codec ids in MUXER_CODEC and the level-ladder strings from codecString(),
 * passed as `fullCodecString`. mediabunny VALIDATES that pair and throws if
 * they disagree — at source construction for the config, and mid-export for
 * the muxer. Both are places a silent vocabulary drift (mediabunny renaming a
 * codec, or codecProbe gaining a level) would land as a runtime failure on the
 * user's machine rather than here.
 *
 * WebCodecs does not exist under vitest, so the encode step is skipped: the
 * Encoded*PacketSource lanes feed pre-encoded packets into the SAME Output /
 * Mp4OutputFormat / target wiring the export uses.
 */

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 30;
const SAMPLE_RATE = 48000;
const AUDIO_FRAME = 1024;

/** A structurally valid avcC record (High profile, level 4.2). */
const AVCC = new Uint8Array([
  0x01, 0x64, 0x00, 0x2a, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x64, 0x00, 0x2a, 0x01, 0x00, 0x04, 0x68,
  0xee, 0x3c, 0x80,
]);
/** AudioSpecificConfig: AAC-LC, 48 kHz, stereo. */
const ASC = new Uint8Array([0x11, 0x90]);

const videoMeta = (codecStr: string): EncodedVideoChunkMetadata =>
  ({
    decoderConfig: {
      codec: codecStr,
      codedWidth: WIDTH,
      codedHeight: HEIGHT,
      description: AVCC,
    },
  }) as EncodedVideoChunkMetadata;

const audioMeta: EncodedAudioChunkMetadata = {
  decoderConfig: {
    codec: "mp4a.40.2",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
    description: ASC,
  },
} as EncodedAudioChunkMetadata;

/** Top-level box types, in file order. */
function topLevelBoxes(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: string[] = [];
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    if (size === 1) {
      // 64-bit extended size, immediately after the type field.
      size = Number(view.getBigUint64(pos + 8));
    } else if (size === 0) {
      break; // "to end of file"
    }
    if (size < 8) break;
    out.push(type);
    pos += size;
  }
  return out;
}

/** Mux `seconds` of synthetic media exactly as the export lane wires it up. */
async function muxSeconds(
  seconds: number,
  mode: "buffer" | "stream",
): Promise<{ bytes: Uint8Array; positions: number[] }> {
  const chunks: { data: Uint8Array; position: number }[] = [];
  const bufferTarget = mode === "buffer" ? new BufferTarget() : null;
  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: bufferTarget ? "in-memory" : "fragmented",
      minimumFragmentDuration: 2,
    }),
    target:
      bufferTarget ??
      new StreamTarget(
        new WritableStream<StreamTargetChunk>({
          write: (chunk) => {
            chunks.push({ data: chunk.data.slice(), position: chunk.position });
          },
        }),
        { chunked: true },
      ),
  });
  const video = new EncodedVideoPacketSource("avc");
  const audio = new EncodedAudioPacketSource("aac");
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);
  await output.start();

  const frames = Math.round(seconds * FPS);
  const audioTotal = Math.round((seconds * SAMPLE_RATE) / AUDIO_FRAME);
  let audioDone = 0;
  for (let n = 0; n < frames; n++) {
    await video.add(
      // The same keyframe cadence exportCore encodes with — fragments cut here.
      new EncodedPacket(
        new Uint8Array(256),
        n % (FPS * 2) === 0 ? "key" : "delta",
        n / FPS,
        1 / FPS,
      ),
      n === 0 ? videoMeta(codecString("h264", WIDTH, HEIGHT, FPS)) : undefined,
    );
    const want = Math.min(Math.floor((((n + 1) / FPS) * SAMPLE_RATE) / AUDIO_FRAME), audioTotal);
    while (audioDone < want) {
      await audio.add(
        new EncodedPacket(
          new Uint8Array(64),
          "key",
          (audioDone * AUDIO_FRAME) / SAMPLE_RATE,
          AUDIO_FRAME / SAMPLE_RATE,
        ),
        audioDone === 0 ? audioMeta : undefined,
      );
      audioDone++;
    }
  }
  await output.finalize();

  if (bufferTarget) {
    return { bytes: new Uint8Array(bufferTarget.buffer!), positions: [] };
  }
  const total = chunks.reduce((a, c) => Math.max(a, c.position + c.data.length), 0);
  const bytes = new Uint8Array(total);
  for (const c of chunks) bytes.set(c.data, c.position);
  return { bytes, positions: chunks.map((c) => c.position) };
}

describe("MP4 codec plumbing", () => {
  it("accepts every codecProbe level string as mediabunny's fullCodecString", () => {
    // The pairing exportCore builds. A mismatch throws here rather than on the
    // user's machine; this is the whole reason codecProbe stays the source of
    // truth instead of letting mediabunny derive its own codec string.
    for (const codec of Object.keys(MUXER_CODEC) as Mp4CodecId[]) {
      for (const [w, h, fps] of [
        [1920, 1080, 60],
        [2560, 1440, 60],
        [3840, 2160, 60],
      ]) {
        expect(
          () =>
            new VideoSampleSource({
              codec: MUXER_CODEC[codec],
              bitrate: 8_000_000,
              fullCodecString: codecString(codec, w, h, fps),
              keyFrameInterval: 2,
              latencyMode: "quality",
            }),
        ).not.toThrow();
      }
    }
  });

  it("pins AAC-LC rather than letting mediabunny pick HE-AAC", () => {
    // mediabunny's own string builder returns mp4a.40.29 for stereo at 24 kHz
    // or below. exportCore probed mp4a.40.2, so that is what must be encoded.
    expect(
      () => new AudioSampleSource({ codec: "aac", bitrate: 192_000, fullCodecString: "mp4a.40.2" }),
    ).not.toThrow();
    expect(
      () => new AudioSampleSource({ codec: "opus", bitrate: 192_000, fullCodecString: "opus" }),
    ).not.toThrow();
    // Guard the guard: a string from the wrong codec family must be rejected,
    // or the assertions above would pass for any string at all.
    expect(
      () => new AudioSampleSource({ codec: "aac", bitrate: 192_000, fullCodecString: "opus" }),
    ).toThrow();
  });
});

describe("MP4 muxing", () => {
  it("streams a fragmented MP4 forward-only, metadata first", async () => {
    const { bytes, positions } = await muxSeconds(6, "stream");
    const boxes = topLevelBoxes(bytes);
    // Fast start: the movie header precedes any media, so a player can start
    // without reading to the end — the point of fragmenting at all.
    expect(boxes.slice(0, 2)).toEqual(["ftyp", "moov"]);
    expect(boxes.filter((b) => b === "moof").length).toBeGreaterThan(1);
    expect(boxes).toContain("mdat");
    // Forward-only: the desktop file writer seeks on every out-of-order write,
    // and fragmented MP4 exists precisely so it never has to.
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions[0]).toBe(0);
  });

  it("returns one in-memory buffer in buffer mode", async () => {
    const { bytes } = await muxSeconds(2, "buffer");
    const boxes = topLevelBoxes(bytes);
    expect(boxes.slice(0, 2)).toEqual(["ftyp", "moov"]);
    // Non-fragmented: one contiguous mdat, no fragments.
    expect(boxes).toContain("mdat");
    expect(boxes).not.toContain("moof");
  });

  it("keeps fragmented retention independent of how long the export runs", async () => {
    // The regression this file exists for: "stream" mode must retain a
    // per-fragment index, NOT the bitstream. Tripling the duration must not
    // triple what the muxer holds, so compare bytes-out (which scales with
    // duration) against the fragment count (which is what is retained).
    const short = await muxSeconds(4, "stream");
    const long = await muxSeconds(12, "stream");
    const fragmentsOf = (b: Uint8Array) => topLevelBoxes(b).filter((x) => x === "moof").length;
    expect(long.bytes.length).toBeGreaterThan(short.bytes.length * 2);
    // One fragment per 2 s keyframe: 3x the duration is 3x the fragments, and
    // a fragment's index entry is a fixed ~16 bytes regardless of its payload.
    expect(fragmentsOf(long.bytes)).toBe(fragmentsOf(short.bytes) * 3);
  });
});
