import type { PcmData } from "../types";

/**
 * Encode decoded PCM as a standard 16-bit WAV — the audio input for the
 * ProRes ffmpeg sidecar. Deliberately the ORIGINAL, un-normalized audio: a
 * ProRes 4444 file is an editorial mezzanine, and editors expect the source
 * levels, not a loudness-processed master.
 */
export function wavFromPcm(pcm: PcmData): Uint8Array {
  const channels = Math.min(2, pcm.channels.length);
  const frames = pcm.length;
  const bytesPerFrame = channels * 2;
  const dataBytes = frames * bytesPerFrame;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);

  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // PCM fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, pcm.sampleRate, true);
  v.setUint32(28, pcm.sampleRate * bytesPerFrame, true);
  v.setUint16(32, bytesPerFrame, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, dataBytes, true);

  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, pcm.channels[c][i]));
      // Symmetric scale, round-to-nearest — the standard float->s16 mapping
      v.setInt16(o, Math.round(s * 32767), true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
