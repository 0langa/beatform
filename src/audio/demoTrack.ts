/**
 * Synthesizes a short demo loop (kick, hats, bass, arp) via OfflineAudioContext
 * so the visualizer can be tried with zero local files. Also exercises beat
 * detection with a known-good 120 BPM signal.
 */
export async function renderDemoTrack(sampleRate: number): Promise<AudioBuffer> {
  const bpm = 120;
  const beat = 60 / bpm;
  const bars = 8;
  const duration = bars * 4 * beat;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);

  const master = ctx.createGain();
  master.gain.value = 0.8;
  master.connect(ctx.destination);

  const noiseBuf = ctx.createBuffer(1, sampleRate, sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const kick = (t: number) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + 0.3);
  };

  const hat = (t: number, open: boolean) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    const len = open ? 0.18 : 0.05;
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    src.connect(hp).connect(g).connect(master);
    src.start(t);
    src.stop(t + len + 0.01);
  };

  const bassNote = (t: number, freq: number, len: number) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.setValueAtTime(0.32, t + len - 0.03);
    g.gain.linearRampToValueAtTime(0, t + len);
    osc.connect(lp).connect(g).connect(master);
    osc.start(t);
    osc.stop(t + len);
  };

  const arpNote = (t: number, freq: number) => {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.07, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.sin(t * 2.1) * 0.6;
    osc.connect(g).connect(pan).connect(master);
    osc.start(t);
    osc.stop(t + 0.2);
  };

  // A minor progression: Am F C G, one chord per bar
  const roots = [55.0, 43.65, 65.41, 49.0]; // A1 F1 C2 G1
  const arpSets = [
    [220.0, 261.63, 329.63, 440.0],
    [174.61, 220.0, 261.63, 349.23],
    [261.63, 329.63, 392.0, 523.25],
    [196.0, 246.94, 293.66, 392.0],
  ];

  for (let bar = 0; bar < bars; bar++) {
    const barT = bar * 4 * beat;
    const chord = bar % 4;
    for (let b = 0; b < 4; b++) {
      const t = barT + b * beat;
      kick(t);
      hat(t + beat / 2, b === 3);
      if (b === 1 || b === 3) hat(t, false);
      bassNote(t, roots[chord] * (b === 2 ? 1.5 : 1), beat * 0.9);
    }
    if (bar >= 2) {
      for (let s = 0; s < 8; s++) {
        arpNote(barT + s * (beat / 2), arpSets[chord][s % 4] * (s >= 4 ? 2 : 1));
      }
    }
  }

  return ctx.startRendering();
}
