// Audio engine: everything is synthesised at runtime with Web Audio — no sample files.
// Motor (8 selectable voices), one-shot SFX, and the music sequencer (see music.ts).

import { Music } from './music';

export interface MotorVoice {
  name: string;
  base: number; // Hz at idle
  span: number; // × frequency at full rpm
  wave: OscillatorType;
  wave2: OscillatorType;
  ratio2: number; // second oscillator frequency ratio
  mix2: number;
  detune: number; // cents between the pair
  cutoff: number; // lowpass at idle
  cutoffSpan: number; // added at full rpm
  wobble: number; // Hz LFO depth (0 = none)
  wobbleRate: number;
  chug: number; // amplitude pulse depth (combustion-style voices)
}

export const MOTOR_VOICES: MotorVoice[] = [
  { name: 'Volt', base: 82, span: 3.6, wave: 'sawtooth', wave2: 'triangle', ratio2: 2, mix2: 0.5, detune: 7, cutoff: 500, cutoffSpan: 2600, wobble: 0, wobbleRate: 0, chug: 0 },
  { name: 'Turbine', base: 120, span: 4.4, wave: 'triangle', wave2: 'sawtooth', ratio2: 3, mix2: 0.28, detune: 4, cutoff: 900, cutoffSpan: 3800, wobble: 0, wobbleRate: 0, chug: 0 },
  { name: 'Warp', base: 64, span: 5.2, wave: 'sine', wave2: 'sawtooth', ratio2: 1.5, mix2: 0.4, detune: 14, cutoff: 700, cutoffSpan: 3000, wobble: 3, wobbleRate: 5, chug: 0 },
  { name: 'Podracer', base: 96, span: 3.2, wave: 'sawtooth', wave2: 'square', ratio2: 1.01, mix2: 0.6, detune: 22, cutoff: 600, cutoffSpan: 2200, wobble: 6, wobbleRate: 11, chug: 0.25 },
  { name: 'Arcade', base: 110, span: 4.0, wave: 'square', wave2: 'square', ratio2: 2, mix2: 0.35, detune: 3, cutoff: 800, cutoffSpan: 3200, wobble: 0, wobbleRate: 0, chug: 0 },
  { name: 'Maglev', base: 148, span: 3.0, wave: 'sine', wave2: 'triangle', ratio2: 2.5, mix2: 0.45, detune: 9, cutoff: 1400, cutoffSpan: 4200, wobble: 1.5, wobbleRate: 2.2, chug: 0 },
  { name: 'Growler', base: 55, span: 3.4, wave: 'sawtooth', wave2: 'sawtooth', ratio2: 0.5, mix2: 0.7, detune: 18, cutoff: 380, cutoffSpan: 1700, wobble: 0, wobbleRate: 0, chug: 0.35 },
  { name: 'Diesel', base: 46, span: 2.8, wave: 'square', wave2: 'sawtooth', ratio2: 1.5, mix2: 0.55, detune: 12, cutoff: 320, cutoffSpan: 1300, wobble: 0, wobbleRate: 0, chug: 0.6 },
];

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  readonly music = new Music();
  private sfxVol = 0.8;
  private musicVol = 0.6;
  // motor graph
  private mo: { o1: OscillatorNode; o2: OscillatorNode; g2: GainNode; lp: BiquadFilterNode; out: GainNode; lfo: OscillatorNode; lfoG: GainNode; chug: OscillatorNode; chugG: GainNode; amp: GainNode } | null = null;
  private voice = MOTOR_VOICES[0];
  private rpm = 0;
  private lastCoin = 0;
  private coinStep = 0;

  /** Must be called from a user gesture at least once (browsers gate audio on it). */
  unlock() {
    if (!this.ctx) {
      const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
      } catch {
        return;
      }
      const c = this.ctx;
      this.master = c.createGain();
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.sfxBus = c.createGain();
      this.musicBus = c.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus.connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate * 1.5, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.setVolumes(this.sfxVol, this.musicVol);
      this.music.attach(c, this.musicBus, this.noise);
      this.buildMotor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx;
    this.musicVol = music;
    if (!this.ctx) return;
    this.sfxBus.gain.value = sfx * 0.9;
    this.musicBus.gain.value = music * 0.5;
  }

  suspend(on: boolean) {
    if (!this.ctx) return;
    if (on) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  // ---- motor ---------------------------------------------------------------------------------
  private buildMotor() {
    const c = this.ctx!;
    const o1 = c.createOscillator();
    const o2 = c.createOscillator();
    const g2 = c.createGain();
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.2;
    const amp = c.createGain();
    const out = c.createGain();
    out.gain.value = 0;
    const lfo = c.createOscillator();
    const lfoG = c.createGain();
    const chug = c.createOscillator();
    chug.type = 'square';
    const chugG = c.createGain();
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    lp.connect(amp).connect(out).connect(this.sfxBus);
    lfo.connect(lfoG);
    lfoG.connect(o1.frequency);
    lfoG.connect(o2.frequency);
    chug.connect(chugG).connect(amp.gain);
    o1.start();
    o2.start();
    lfo.start();
    chug.start();
    this.mo = { o1, o2, g2, lp, out, lfo, lfoG, chug, chugG, amp };
    this.applyVoice();
  }

  private applyVoice() {
    if (!this.mo) return;
    const v = this.voice;
    const m = this.mo;
    m.o1.type = v.wave;
    m.o2.type = v.wave2;
    m.o2.detune.value = v.detune;
    m.g2.gain.value = v.mix2;
    m.lfo.frequency.value = v.wobbleRate || 1;
    m.lfoG.gain.value = v.wobble;
    m.chugG.gain.value = v.chug * 0.5;
    m.amp.gain.value = 1 - v.chug * 0.5;
  }

  setMotorVoice(i: number) {
    this.voice = MOTOR_VOICES[Math.max(0, Math.min(MOTOR_VOICES.length - 1, i))];
    this.applyVoice();
  }

  /** rpm 0…1.3, throttle 0…1. `on` false fades the motor out (menus, pause). */
  motor(rpm: number, throttle: number, on: boolean, pitchMul = 1) {
    if (!this.ctx || !this.mo) return;
    const t = this.ctx.currentTime;
    this.rpm += (rpm - this.rpm) * 0.25;
    const v = this.voice;
    const f = v.base * (1 + this.rpm * (v.span - 1)) * pitchMul;
    const m = this.mo;
    m.o1.frequency.setTargetAtTime(f, t, 0.03);
    m.o2.frequency.setTargetAtTime(f * v.ratio2, t, 0.03);
    m.chug.frequency.setTargetAtTime(Math.max(6, f * 0.25), t, 0.05);
    m.lp.frequency.setTargetAtTime(v.cutoff + v.cutoffSpan * (0.25 + throttle * 0.75) * (0.3 + this.rpm * 0.7), t, 0.05);
    // Audible coast floor so the voice never vanishes off-throttle.
    const g = on ? 0.05 + 0.13 * throttle + 0.05 * Math.min(1, this.rpm) : 0;
    m.out.gain.setTargetAtTime(g, t, on ? 0.06 : 0.15);
  }

  /** Short rev (Garage voice picker). */
  previewMotor() {
    if (!this.ctx || !this.mo) return;
    const t = this.ctx.currentTime;
    const v = this.voice;
    const m = this.mo;
    for (const [o, r] of [[m.o1, 1], [m.o2, v.ratio2]] as const) {
      o.frequency.cancelScheduledValues(t);
      o.frequency.setValueAtTime(v.base * r, t);
      o.frequency.linearRampToValueAtTime(v.base * v.span * 0.8 * r, t + 0.55);
      o.frequency.linearRampToValueAtTime(v.base * r, t + 1.1);
    }
    m.lp.frequency.cancelScheduledValues(t);
    m.lp.frequency.setValueAtTime(v.cutoff, t);
    m.lp.frequency.linearRampToValueAtTime(v.cutoff + v.cutoffSpan * 0.8, t + 0.55);
    m.lp.frequency.linearRampToValueAtTime(v.cutoff, t + 1.1);
    m.out.gain.cancelScheduledValues(t);
    m.out.gain.setValueAtTime(0.0001, t);
    m.out.gain.linearRampToValueAtTime(0.2, t + 0.08);
    m.out.gain.linearRampToValueAtTime(0.16, t + 0.7);
    m.out.gain.linearRampToValueAtTime(0, t + 1.2);
  }

  // ---- one-shots -----------------------------------------------------------------------------
  private tone(freq: number, dur: number, type: OscillatorType, gain: number, opts: { to?: number; delay?: number; attack?: number } = {}) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + (opts.delay ?? 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + (opts.attack ?? 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  private burst(dur: number, gain: number, type: BiquadFilterType, f0: number, f1 = f0, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfxBus);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }

  coin() {
    if (!this.ctx) return;
    // Rapid pickups climb a little scale; a pause resets it.
    const now = this.ctx.currentTime;
    this.coinStep = now - this.lastCoin < 0.35 ? Math.min(this.coinStep + 1, 9) : 0;
    this.lastCoin = now;
    const f = 988 * Math.pow(2, [0, 2, 4, 7, 9, 12, 14, 16, 19, 21][this.coinStep] / 12);
    this.tone(f, 0.09, 'square', 0.07);
    this.tone(f * 1.5, 0.16, 'triangle', 0.09, { delay: 0.05 });
  }
  energy() {
    this.tone(330, 0.32, 'sawtooth', 0.09, { to: 1320 });
    this.tone(660, 0.3, 'sine', 0.12, { to: 1980, delay: 0.03 });
  }
  powerup() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.13, { delay: i * 0.055 }));
    this.burst(0.3, 0.05, 'highpass', 3000);
  }
  powerdown() {
    this.tone(520, 0.3, 'triangle', 0.08, { to: 180 });
  }
  land(k: number) {
    this.tone(120, 0.16 + k * 0.1, 'sine', 0.25 + k * 0.3, { to: 38 });
    this.burst(0.12 + k * 0.1, 0.1 + k * 0.2, 'lowpass', 900, 200);
  }
  crash() {
    this.burst(0.5, 0.45, 'lowpass', 2400, 120);
    this.tone(90, 0.4, 'sawtooth', 0.25, { to: 30 });
  }
  smash() {
    this.burst(0.9, 0.6, 'lowpass', 3200, 90);
    this.tone(70, 0.7, 'sine', 0.5, { to: 24 });
    [1800, 2400, 3100].forEach((f, i) => this.tone(f, 0.25, 'square', 0.04, { delay: 0.04 * i, to: f * 0.5 }));
  }
  stunt() {
    [659, 880, 1175].forEach((f, i) => this.tone(f, 0.16, 'square', 0.07, { delay: i * 0.06 }));
  }
  jets() {
    this.burst(0.5, 0.35, 'bandpass', 500, 2600);
    this.tone(180, 0.4, 'sawtooth', 0.12, { to: 520 });
  }
  rescue() {
    this.tone(392, 0.4, 'triangle', 0.14, { to: 784 });
  }
  transform(grow: boolean) {
    this.tone(grow ? 220 : 440, 0.5, 'sawtooth', 0.16, { to: grow ? 55 : 880 });
    this.burst(0.4, 0.12, 'lowpass', 1200, 300);
  }
  lowBattery() {
    this.tone(880, 0.12, 'square', 0.08);
    this.tone(660, 0.16, 'square', 0.08, { delay: 0.16 });
  }
  ui() {
    this.tone(880, 0.05, 'triangle', 0.08);
  }
  buy() {
    [784, 988, 1319].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, { delay: i * 0.07 }));
    this.burst(0.2, 0.05, 'highpass', 5000);
  }
  deny() {
    this.tone(196, 0.14, 'square', 0.08);
    this.tone(165, 0.2, 'square', 0.08, { delay: 0.12 });
  }
  complete() {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.34, 'triangle', 0.14, { delay: i * 0.09 }));
  }
  star(i: number) {
    this.tone([988, 1175, 1480][i] ?? 988, 0.3, 'triangle', 0.15);
    this.burst(0.2, 0.04, 'highpass', 6000);
  }
  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.36, 'sawtooth', 0.09, { delay: i * 0.16 }));
  }
}
