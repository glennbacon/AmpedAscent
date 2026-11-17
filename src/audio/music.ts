// The soundtrack: one synthwave piece, sequenced live (no audio files). 16 bars in an A/A/B/A form,
// A dorian, 104 BPM. Soft-saw bass, detuned pad stack, a lead hook with dotted-eighth delay, and an
// enveloped kit that ducks the pad. Menus play the bed only; driving brings in drums, bass drive and arp.

const BPM = 104;
const BEAT = 60 / BPM;
const BARS = 16;
const SCALE = [0, 2, 3, 5, 7, 9, 10]; // dorian
const ROOT = 110; // A2
const PROG_A = [0, 0, 3, 6];
const PROG_B = [3, 4, 6, 4];

// Lead hook, one 4-bar phrase: [beat, scale degree, beats held]. Degree 7 = octave.
const HOOK_A: [number, number, number][] = [
  [0, 4, 1], [1, 7, 0.5], [1.5, 6, 0.5], [2, 4, 1.5], [3.5, 2, 0.5],
  [4, 4, 1], [5, 7, 0.5], [5.5, 8, 0.5], [6, 9, 2],
  [8, 7, 1], [9, 6, 0.5], [9.5, 4, 0.5], [10, 3, 1.5], [11.5, 4, 0.5],
  [12, 6, 1], [13, 4, 1], [14, 2, 1.5], [15.5, 1, 0.5],
];
const HOOK_B: [number, number, number][] = [
  [0, 9, 1.5], [1.5, 8, 0.5], [2, 7, 1], [3, 5, 1],
  [4, 8, 1.5], [5.5, 7, 0.5], [6, 6, 2],
  [8, 9, 0.5], [8.5, 10, 0.5], [9, 11, 1], [10, 9, 1], [11, 8, 1],
  [12, 8, 1], [13, 6, 1], [14, 4, 2],
];

const deg = (d: number) => {
  const oct = Math.floor(d / 7);
  return SCALE[((d % 7) + 7) % 7] + 12 * oct;
};
const hz = (semi: number, root = ROOT) => root * Math.pow(2, semi / 12);

export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private padBus!: GainNode;
  private drumBus!: GainNode;
  private leadBus!: GainNode;
  private bassBus!: GainNode;
  private noise!: AudioBuffer;
  private timer: number | null = null;
  private nextStep = 0; // sixteenth index
  private nextTime = 0;
  private drive = 0; // 0 = menu bed, 1 = driving
  playing = false;

  attach(ctx: AudioContext, bus: GainNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.noise = noise;
    this.out = ctx.createGain();
    this.out.connect(bus);
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.drumBus = ctx.createGain();
    this.drumBus.gain.value = 0;
    this.bassBus = ctx.createGain();
    this.bassBus.gain.value = 0.5;
    this.leadBus = ctx.createGain();
    this.leadBus.gain.value = 0.55;
    // Dotted-eighth feedback delay on the lead.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = BEAT * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.36;
    const wet = ctx.createGain();
    wet.gain.value = 0.4;
    this.leadBus.connect(this.out);
    this.leadBus.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(wet).connect(this.out);
    this.padBus.connect(this.out);
    this.drumBus.connect(this.out);
    this.bassBus.connect(this.out);
    if (this.playing) this.start();
  }

  start() {
    this.playing = true;
    if (!this.ctx || this.timer != null) return;
    this.nextStep = 0;
    this.nextTime = this.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.pump(), 30);
  }
  stop() {
    this.playing = false;
    if (this.timer != null) clearInterval(this.timer);
    this.timer = null;
  }
  /** 0 = menu (bed only, darker), 1 = driving (full kit). Cross-fades over ~a second. */
  setDrive(on: boolean) {
    this.drive = on ? 1 : 0;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.drumBus.gain.setTargetAtTime(on ? 0.9 : 0, t, 0.5);
    this.bassBus.gain.setTargetAtTime(on ? 0.7 : 0.42, t, 0.5);
  }

  private pump() {
    const c = this.ctx!;
    if (c.state !== 'running') {
      this.nextTime = c.currentTime + 0.08;
      return;
    }
    const six = BEAT / 4;
    while (this.nextTime < c.currentTime + 0.14) {
      this.step(this.nextStep, this.nextTime);
      this.nextStep = (this.nextStep + 1) % (BARS * 16);
      this.nextTime += six;
    }
  }

  private chordAt(bar: number): number {
    const phrase = Math.floor(bar / 4);
    return (phrase === 2 ? PROG_B : PROG_A)[bar % 4];
  }

  private step(s: number, t: number) {
    const bar = Math.floor(s / 16);
    const inBar = s % 16;
    const phrase = Math.floor(bar / 4);
    const root = this.chordAt(bar);
    const driving = this.drive > 0.5;

    // Pad: new chord on each bar line (root, third, fifth, seventh).
    if (inBar === 0) {
      const notes = [root, root + 2, root + 4, root + 6].map((d) => hz(deg(d), ROOT * 2));
      this.pad(notes, t, BEAT * 4);
    }
    // Bass: eighth-note pulse, octave on the off-beats while driving.
    if (inBar % 2 === 0) {
      const up = driving && inBar % 4 === 2;
      this.bass(hz(deg(root) + (up ? 12 : 0), ROOT / 2), t, BEAT * 0.46);
    }
    // Arp: sixteenths over the chord during the B phrase and the last A (driving only).
    if (driving && (phrase === 2 || phrase === 3)) {
      const arp = [0, 2, 4, 7, 4, 2][s % 6];
      this.pluck(hz(deg(root + arp), ROOT * 4), t, 0.11, 0.05, (s % 2 ? 1 : -1) * 0.5);
    }
    // Lead hook.
    const hook = phrase === 2 ? HOOK_B : HOOK_A;
    const posBeats = ((bar % 4) * 16 + inBar) / 4;
    for (const [b, d, len] of hook) {
      if (Math.abs(b - posBeats) < 1e-6 && (phrase !== 0 || driving || b % 4 < 2)) this.lead(hz(deg(d), ROOT * 2), t, len * BEAT);
    }
    // Kit.
    if (inBar % 4 === 0) {
      this.kick(t);
      // Sidechain: the pad ducks under every kick.
      this.padBus.gain.cancelScheduledValues(t);
      this.padBus.gain.setValueAtTime(driving ? 0.2 : 0.42, t);
      this.padBus.gain.linearRampToValueAtTime(0.5, t + BEAT * 0.8);
    }
    if (inBar === 4 || inBar === 12) this.snare(t);
    if (inBar % 2 === 0) this.hat(t, inBar % 4 === 2 ? 0.5 : 0.28, (inBar / 2) % 2 ? 0.6 : -0.6);
    if (bar % 4 === 3 && inBar >= 12) this.hat(t, 0.4, 0); // phrase-end roll
  }

  private pan(v: number): AudioNode {
    const c = this.ctx!;
    if (typeof c.createStereoPanner !== 'function') return c.createGain();
    const p = c.createStereoPanner();
    p.pan.value = v;
    return p;
  }

  private pad(freqs: number[], t: number, dur: number) {
    const c = this.ctx!;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.linearRampToValueAtTime(1500, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(800, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.085, t + 0.35);
    g.gain.setValueAtTime(0.085, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.25);
    lp.connect(g).connect(this.padBus);
    freqs.forEach((f, i) => {
      for (const det of [-9, 8]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const p = this.pan(det < 0 ? -0.6 + i * 0.1 : 0.6 - i * 0.1);
        o.connect(p).connect(lp);
        o.start(t);
        o.stop(t + dur + 0.3);
      }
    });
  }

  private bass(f: number, t: number, dur: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    sub.connect(lp);
    lp.connect(g).connect(this.bassBus);
    o.start(t);
    sub.start(t);
    o.stop(t + dur + 0.02);
    sub.stop(t + dur + 0.02);
  }

  private lead(f: number, t: number, dur: number) {
    const c = this.ctx!;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(1100, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.02);
    g.gain.setValueAtTime(0.07, t + Math.max(0.03, dur - 0.08));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.1);
    lp.connect(g).connect(this.leadBus);
    // Detuned unison pair, panned apart: the stereo width of the track.
    for (const [det, pan] of [[-11, -0.7], [11, 0.7]] as const) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(this.pan(pan)).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.12);
    }
  }

  private pluck(f: number, t: number, dur: number, gain: number, pan: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.pan(pan)).connect(this.leadBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.32);
  }
  private noiseHit(t: number, dur: number, gain: number, type: BiquadFilterType, f: number, pan = 0) {
    const c = this.ctx!;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(this.pan(pan)).connect(this.drumBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }
  private snare(t: number) {
    this.noiseHit(t, 0.2, 0.26, 'bandpass', 1900);
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const g = c.createGain();
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.drumBus);
    o.start(t);
    o.stop(t + 0.16);
  }
  private hat(t: number, gain: number, pan: number) {
    this.noiseHit(t, 0.045, gain * 0.22, 'highpass', 7500, pan);
  }
}
