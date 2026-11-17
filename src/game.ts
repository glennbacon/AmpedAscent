// Game: phases, run lifecycle, banking, and the frame loop. The glue between the headless sim,
// the three.js view, audio, input and the DOM menus.

import { AudioEngine } from './audio/audio';
import { haptic, Input } from './core/input';
import { Save } from './core/save';
import { Gfx } from './render/gfx';
import { WorldView } from './render/world';
import { AutoDriver, DriverProfile } from './sim/autodriver';
import { earnedStars, generateLevel, nextLevelId, parseLevelId, starPayout, STAR_CLEAR } from './sim/campaign';
import { CFG } from './sim/config';
import { isPowerupKind, PowerupKind } from './sim/powerups';
import { RunSim, SimEvent } from './sim/run';
import { EndlessTrack, FnTrack, LevelData, LevelTrack, PropKind, Track } from './sim/track';
import { WorldId, WORLD_ORDER, WORLDS } from './sim/worlds';
import { LevelEditor } from './ui/editor';
import { Hud } from './ui/hud';
import { GameApi, GarageTab, Menus } from './ui/menus';

type RunKind =
  | { kind: 'endless' }
  | { kind: 'campaign'; id: string }
  | { kind: 'custom'; index: number | null; level: LevelData; fromEditor: boolean };

type Phase = 'title' | 'ready' | 'playing' | 'paused' | 'ended' | 'completed' | 'garage' | 'editor';

const STEP = 1 / CFG.stepHz;

export class Game implements GameApi {
  readonly save = new Save();
  readonly audio = new AudioEngine();
  readonly input = new Input();
  readonly gfx: Gfx;
  readonly view: WorldView;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly editor: LevelEditor;
  sim!: RunSim;
  phase: Phase = 'title';
  private run: RunKind = { kind: 'endless' };
  private acc = 0;
  private last = 0;
  private bankedSoFar = 0;
  private endTimer = 0; // counts down to showing an end card
  private pausedFrom: Phase = 'playing';
  private garageReturn: 'title' = 'title';
  private qa: URLSearchParams;
  private driver: AutoDriver | null = null;
  private teachT = 0;
  private airHintT = 0;
  private hintTimer = 0;
  private frozen = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.qa = new URLSearchParams(location.search);
    const qa = this.qa;
    if (qa.has('reset')) this.save.reset();
    if (qa.has('coins')) {
      this.save.data.coins = Math.max(0, Number(qa.get('coins')) || 0);
      this.save.commit();
    }
    if (qa.has('devunlock')) {
      this.save.data.devUnlock = qa.get('devunlock') !== 'off';
      this.save.commit();
    }
    if (qa.has('autodrive') || qa.has('driver')) this.driver = new AutoDriver((qa.get('driver') as DriverProfile) || 'pro');

    this.gfx = new Gfx(canvas);
    this.gfx.width = window.innerWidth;
    this.gfx.height = window.innerHeight;
    this.applyQuality();
    this.view = new WorldView(this.gfx);
    this.hud = new Hud(this.input);
    this.hud.onPause = () => this.togglePause();
    uiRoot.append(this.hud.root);
    this.menus = new Menus(uiRoot, this);
    this.editor = new LevelEditor(uiRoot, this, this.view, canvas);

    this.input.onPause = () => this.togglePause();
    this.input.onAnyDrive = () => this.onDriveInput();
    window.addEventListener('resize', () => this.gfx.resize(window.innerWidth, window.innerHeight));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.phase === 'playing' || this.phase === 'ready')) this.pause();
      this.audio.suspend(document.hidden);
    });
    // Browsers only allow audio after a gesture.
    const unlock = () => {
      this.audio.unlock();
      this.applyAudio();
      if (!qa.has('mute')) this.audio.music.start();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    this.applyAudio();
    this.bootFromQa();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- settings
  private applyQuality() {
    const q = (this.qa.get('q') as any) || this.save.data.settings.quality;
    this.gfx.setQuality(q === 'auto' || !['low', 'medium', 'high'].includes(q) ? Gfx.autoQuality() : q);
  }
  private applyAudio() {
    const st = this.save.data.settings;
    const mute = this.qa.has('mute');
    this.audio.setVolumes(mute ? 0 : st.sfx, mute ? 0 : st.music);
    this.audio.setMotorVoice(st.motorVoice);
  }
  settingsChanged() {
    const before = this.gfx.quality;
    this.applyQuality();
    this.applyAudio();
    if (before !== this.gfx.quality && this.sim) this.view.setSim(this.sim);
  }
  loadoutChanged() {
    // The parked car behind the Garage/title picks up the new loadout immediately.
    if (this.phase === 'garage' || this.phase === 'title') this.stageParked(this.phase === 'garage' ? 'garage' : 'title');
  }

  // ---------------------------------------------------------------- world staging
  private newSeed() {
    return this.qa.has('seed') ? Number(this.qa.get('seed')) : (Math.random() * 0x7fffffff) | 0;
  }

  private setSim(track: Track) {
    this.sim = new RunSim(track, this.save.loadout);
    this.view.setSim(this.sim);
    this.acc = 0;
    this.bankedSoFar = 0;
    this.endTimer = 0;
    this.teachT = 0;
    this.airHintT = 0;
    (window as any).__sim = this.sim;
  }

  /** A quiet world with the car parked in it: the backdrop for the title and the Garage. */
  private stageParked(cam: 'title' | 'garage') {
    const world = (this.qa.get('world') as WorldId) || WORLD_ORDER[Math.floor(Math.random() * 3)];
    const base = new EndlessTrack(this.newSeed(), WORLDS[world] ? world : 'sylvan');
    // Park on a gentle rise so the hero shot always has a little shape under the wheels.
    const track = new FnTrack((x) => Math.sin(x / 16) * 1.1 + Math.sin(x / 41 + 1) * 1.6 - Math.sin(1) * 1.6, base.biomeAt(0).a);
    this.setSim(track);
    this.view.camMode = cam;
    this.hud.hide();
  }

  /** Editor preview world: the level as it stands, nothing simulated, every pickup visible. */
  stageEditor(level: LevelData, range?: [number, number]): LevelTrack {
    const track = new LevelTrack(level);
    this.sim = new RunSim(track, this.save.loadout);
    this.sim.revealAll();
    this.view.camMode = 'editor';
    this.view.editorStage(this.sim, range);
    (window as any).__sim = this.sim;
    return track;
  }

  private startRun(run: RunKind) {
    this.run = run;
    let track: Track;
    if (run.kind === 'endless') {
      const et = new EndlessTrack(this.newSeed(), (this.qa.get('world') as WorldId) || 'sylvan', this.qa.has('flat'), Number(this.qa.get('seam') ?? 0));
      const prop = this.qa.get('prop') as PropKind | null;
      if (prop) et.forceProp({ kind: prop, x: Number(this.qa.get('propx') ?? 70), size: Number(this.qa.get('size') ?? 0) });
      track = et;
    } else if (run.kind === 'campaign') {
      track = new LevelTrack(generateLevel(run.id)!);
    } else track = new LevelTrack(run.level);
    this.setSim(track);
    this.view.camMode = 'drive';
    this.menus.close();
    this.editor.hide();
    this.hud.show({ best: this.save.data.best, levelLength: track.length });
    this.hud.setDim(false);
    this.phase = 'ready';
    this.input.releaseAll();
    this.audio.music.setDrive(true);
    const pu = this.qa.get('powerup');
    if (pu && isPowerupKind(pu)) this.sim.grant(pu as PowerupKind);
    if (!this.save.data.teach.pedals || this.driver == null) {
      this.hud.setHint(
        this.hud.root.classList.contains('no-touch')
          ? 'Hold <kbd>→</kbd> or <kbd>D</kbd> to drive &nbsp;·&nbsp; <kbd>←</kbd> / <kbd>A</kbd> brakes and reverses'
          : 'Hold the <b>right side</b> to drive &nbsp;·&nbsp; the <b>left side</b> brakes and reverses',
      );
    }
    if (this.driver) this.beginPlaying();
  }

  private beginPlaying() {
    if (this.phase !== 'ready') return;
    this.phase = 'playing';
    this.sim.live = true;
    this.hud.setHint(null);
    if (!this.save.data.teach.pedals) {
      this.save.data.teach.pedals = true;
      this.save.commit();
    }
  }

  private onDriveInput() {
    if (this.phase === 'ready') this.beginPlaying();
  }

  // ---------------------------------------------------------------- GameApi
  playEndless() {
    this.startRun({ kind: 'endless' });
  }
  playCampaign(id: string) {
    if (!generateLevel(id)) return;
    this.startRun({ kind: 'campaign', id });
  }
  playCustom(index: number) {
    const level = this.save.data.levels[index];
    if (level) this.startRun({ kind: 'custom', index, level, fromEditor: false });
  }
  /** Test-drive the level currently open in the editor. */
  testLevel(level: LevelData, index: number | null) {
    this.startRun({ kind: 'custom', index, level, fromEditor: true });
  }
  editLevel(index: number | null) {
    this.menus.close();
    this.hud.hide();
    this.phase = 'editor';
    this.audio.music.setDrive(false);
    this.editor.open(index);
  }
  backToEditor() {
    if (this.run.kind !== 'custom') return;
    this.menus.close();
    this.hud.hide();
    this.phase = 'editor';
    this.audio.music.setDrive(false);
    this.editor.reopen();
  }
  toTitle() {
    this.editor.hide();
    this.stageParked('title');
    this.phase = 'title';
    this.audio.music.setDrive(false);
    this.menus.showTitle();
  }
  openGarage(tab?: GarageTab) {
    this.stageParked('garage');
    this.phase = 'garage';
    this.audio.music.setDrive(false);
    this.menus.showGarage(tab);
  }
  closeGarage() {
    void this.garageReturn;
    this.toTitle();
  }
  pause() {
    if (this.phase !== 'playing' && this.phase !== 'ready') return;
    this.pausedFrom = this.phase;
    this.phase = 'paused';
    this.hud.releasePedals();
    this.input.releaseAll();
    this.menus.showPause({ title: this.runTitle(), canEdit: this.run.kind === 'custom' && this.run.fromEditor });
  }
  resume() {
    if (this.phase !== 'paused') return;
    this.menus.close();
    this.phase = this.pausedFrom;
    this.acc = 0;
  }
  private togglePause() {
    if (this.phase === 'paused') {
      if (this.menus.current === 'pause') this.resume();
    } else if (this.phase === 'playing' || this.phase === 'ready') this.pause();
    else if (this.phase === 'editor') this.editor.onEscape();
  }
  restart() {
    this.startRun(this.run);
  }
  revive() {
    if (this.phase !== 'ended' || this.sim.reviveUsed || this.save.data.coins < CFG.reviveCost) return;
    this.save.addCoins(-CFG.reviveCost);
    this.save.commit();
    this.sim.revive();
    this.menus.close();
    this.hud.setDim(false);
    this.phase = 'playing';
    this.audio.rescue();
  }
  nextLevel() {
    if (this.run.kind !== 'campaign') return;
    const next = nextLevelId(this.run.id);
    if (next) this.playCampaign(next);
  }

  private runTitle(): string {
    if (this.run.kind === 'endless') return 'Endless Drive';
    if (this.run.kind === 'campaign') return generateLevel(this.run.id)!.name;
    return this.run.level.name;
  }

  // ---------------------------------------------------------------- run end
  private bank(): { banked: number; distanceCoins: number } {
    const sim = this.sim;
    const distanceCoins = Math.floor(sim.stats.distance * CFG.coinsPerMeter);
    // Player-built levels never bank coins (a level full of coins would be a mint).
    const total = this.run.kind === 'custom' ? 0 : sim.bankCoins;
    const banked = Math.max(0, total - this.bankedSoFar);
    this.bankedSoFar = total;
    this.save.addCoins(banked);
    return { banked, distanceCoins };
  }

  private showGameOver() {
    const sim = this.sim;
    const d = this.save.data;
    const dist = Math.floor(sim.stats.distance);
    const endless = this.run.kind === 'endless';
    const newBest = endless && dist > d.best && dist > 0;
    const prevBest = d.best;
    if (newBest) d.best = dist;
    const { banked, distanceCoins } = this.bank();
    d.totals.runs++;
    d.totals.distance += dist;
    d.totals.flips += sim.stats.flips;
    d.totals.coins += banked;
    this.save.commit();
    this.hud.setDim(true);
    this.menus.showGameOver({
      cause: sim.endCause ?? 'drained',
      endless,
      distance: dist,
      best: newBest ? dist : prevBest,
      newBest,
      pickupCoins: sim.stats.pickupCoins,
      stuntCoins: sim.stats.stuntCoins,
      distanceCoins,
      banked,
      flips: sim.stats.flips,
      stunts: sim.stats.stunts,
      bestMultiplier: sim.stats.bestComboLevel + 1,
      topSpeed: sim.stats.topSpeed,
      canRevive: !sim.reviveUsed && this.run.kind !== 'custom',
      canEdit: this.run.kind === 'custom' && this.run.fromEditor,
    });
  }

  private showComplete() {
    const sim = this.sim;
    const d = this.save.data;
    const { banked, distanceCoins } = this.bank();
    let prior = 0;
    let earned = 0;
    let bonus = 0;
    let level: number | null = null;
    let hasNext = false;
    if (this.run.kind === 'campaign') {
      const id = this.run.id;
      const p = parseLevelId(id)!;
      level = p.level;
      prior = (d.stars[id] ?? 0) | (d.completed.includes(id) ? STAR_CLEAR : 0);
      earned = earnedStars(sim.stats.bestComboLevel + 1, sim.finishBattery);
      bonus = starPayout(p.level, prior, earned);
      if (!d.completed.includes(id)) d.completed.push(id);
      d.stars[id] = prior | earned;
      this.save.addCoins(bonus);
      hasNext = nextLevelId(id) != null;
    }
    d.totals.runs++;
    d.totals.distance += sim.stats.distance;
    d.totals.flips += sim.stats.flips;
    d.totals.coins += banked + bonus;
    this.save.commit();
    this.hud.setDim(true);
    this.menus.showComplete({
      title: this.runTitle(),
      campaignLevel: level,
      priorStars: prior,
      earnedStars: earned,
      starBonus: bonus,
      runCoins: this.run.kind === 'custom' ? 0 : sim.stats.coins,
      distanceCoins: this.run.kind === 'custom' ? 0 : distanceCoins,
      banked: banked + bonus,
      time: sim.time,
      hasNext,
      canEdit: this.run.kind === 'custom' && this.run.fromEditor,
      bestMultiplier: sim.stats.bestComboLevel + 1,
      batteryPct: Math.round(sim.finishBattery * 100),
    });
  }

  // ---------------------------------------------------------------- events
  private onEvent(e: SimEvent) {
    this.view.handleEvent(e);
    const hap = this.save.data.settings.haptics;
    switch (e.t) {
      case 'pickup':
        if (e.kind === 'coin') this.audio.coin();
        else if (e.kind === 'energy') this.audio.energy();
        else this.audio.powerup();
        break;
      case 'popup':
        this.hud.popup(e.text, e.tone, e.coins);
        if (e.tone === 'stunt') this.audio.stunt();
        break;
      case 'powerup':
        this.hud.flash();
        if (e.kind === 'jumpjets' && !this.save.data.teach.jump) {
          this.save.data.teach.jump = true;
          this.save.commit();
          this.showHint(this.hud.root.classList.contains('no-touch') ? 'Jump Jets! Press <kbd>Space</kbd> on the ground to blast off' : 'Jump Jets! Tap <b>JUMP</b> on the ground to blast off', 4.5);
        }
        break;
      case 'powerupEnd':
        this.audio.powerdown();
        break;
      case 'land': {
        const k = Math.min(1, e.impact / 16);
        if (e.impact > 2.5) this.audio.land(k);
        if (e.impact > 6) haptic(k > 0.6 ? 40 : 15, hap);
        break;
      }
      case 'jets':
        this.audio.jets();
        break;
      case 'rescue':
        this.audio.rescue();
        break;
      case 'transform':
        this.audio.transform(e.grow);
        break;
      case 'loopSmash':
        this.audio.smash();
        haptic([60, 40, 80], hap);
        break;
      case 'roofHit':
        if (e.speed > 4) {
          this.audio.crash();
          haptic(50, hap);
        }
        break;
      case 'lowBattery':
        this.audio.lowBattery();
        this.hud.popup('LOW CHARGE', 'warn');
        break;
      case 'combo':
        this.hud.bumpCombo();
        break;
      case 'ended':
        this.phase = 'ended';
        this.endTimer = 1.0;
        this.hud.releasePedals();
        this.hud.setHint(null);
        this.audio.gameOver();
        break;
      case 'completed':
        this.phase = 'completed';
        this.endTimer = 1.5;
        this.hud.releasePedals();
        this.hud.setHint(null);
        this.audio.complete();
        break;
    }
  }

  private showHint(html: string, seconds: number) {
    this.hud.setHint(html);
    this.hintTimer = seconds;
  }

  // ---------------------------------------------------------------- loop
  private stepSim() {
    const sim = this.sim;
    const inp = this.driver && this.phase === 'playing' ? this.driver.input(sim, STEP) : this.phase === 'playing' ? this.input.sample() : { gas: 0, brake: 0, jump: false };
    sim.step(STEP, inp);
    if (sim.events.length) {
      for (const e of sim.events) this.onEvent(e);
      sim.events.length = 0;
    }
  }

  private teach(dt: number) {
    const sim = this.sim;
    const t = this.save.data.teach;
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hud.setHint(null);
    }
    if (this.phase !== 'playing' || this.run.kind !== 'endless' || this.driver) return;
    this.teachT += dt;
    if (!t.battery && this.teachT > 2.5 && this.hintTimer <= 0) {
      t.battery = true;
      this.save.commit();
      this.showHint('Driving drains the battery — grab the <b style="color:var(--good)">green cells</b> to recharge', 4.5);
    }
    if (!t.air && t.battery && this.hintTimer <= 0 && sim.vehicle.airborne && sim.vehicle.airTime > 0.3) {
      this.airHintT += dt;
      if (this.airHintT > 0.1) {
        t.air = true;
        this.save.commit();
        this.showHint('In the air: <b>gas</b> tips the nose up, <b>brake</b> tips it down. Land on your wheels!', 5);
      }
    }
  }

  private frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    const el = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.frozen) return;
    const ph = this.phase;
    const stepping = ph !== 'paused' && ph !== 'editor';
    if (stepping) {
      this.acc += el;
      let n = 0;
      while (this.acc >= STEP && n < 14) {
        this.stepSim();
        this.acc -= STEP;
        n++;
      }
      if (n >= 14) this.acc = 0;
      if (this.endTimer > 0) {
        this.endTimer -= el;
        if (this.endTimer <= 0) {
          if (this.phase === 'ended') this.showGameOver();
          else if (this.phase === 'completed') this.showComplete();
        }
      }
      this.teach(el);
    }
    const sim = this.sim;
    if (ph === 'editor') this.editor.update(el);
    this.view.update(ph === 'paused' ? 0 : el, stepping ? this.acc / STEP : 1);
    if (!this.hud.root.hidden) this.hud.update(sim);
    // Motor: pitch from wheel speed, loudness from throttle.
    const v = sim.vehicle;
    const driving = (ph === 'playing' || ph === 'completed') && sim.live;
    const rpm = Math.min(1.3, (Math.abs(v.speed) + Math.max(0, v.slip) * 0.6) / Math.max(1, v.topSpeedNow));
    this.audio.motor(rpm, v.throttle, driving && sim.status !== 'ended', v.scale > 1.01 ? 0.5 : 1);
    this.gfx.render();
    (window as any).__frames = ((window as any).__frames ?? 0) + 1;
  }

  // ---------------------------------------------------------------- QA boot
  private bootFromQa() {
    const qa = this.qa;
    const level = qa.get('level');
    const screen = qa.get('screen');
    if (level && generateLevel(level)) this.playCampaign(level);
    else if (qa.has('autodrive') || qa.has('driver') || qa.has('play') || qa.has('prop') || qa.has('powerup')) this.playEndless();
    else this.toTitle();
    // Fast-forward the sim (headless-style) so a screenshot can land mid-run.
    const warp = Number(qa.get('warp') ?? 0);
    if (warp > 0 && this.phase !== 'title') {
      this.beginPlaying();
      for (let i = 0; i < warp * CFG.stepHz && this.sim.status === 'playing'; i++) {
        const inp = this.driver ? this.driver.input(this.sim, STEP) : { gas: 1, brake: 0, jump: false };
        this.sim.step(STEP, inp);
        if (qa.has('charge')) this.sim.battery = CFG.batteryCapacity;
        for (const e of this.sim.events) this.onEvent(e);
        this.sim.events.length = 0;
      }
      this.view.setSim(this.sim);
    }
    if (screen === 'garage') this.openGarage((qa.get('tab') as GarageTab) || 'upgrades');
    else if (screen === 'adventure') this.menus.showAdventure(Number(qa.get('w') ?? 1));
    else if (screen === 'settings') this.menus.showSettings(() => this.menus.showTitle());
    else if (screen === 'levels') this.menus.showLevels();
    else if (screen === 'pause') this.pause();
    else if (screen === 'editor') this.editLevel(null);
    else if (screen === 'gameover') {
      this.phase = 'ended';
      this.sim.endCause = (qa.get('cause') as any) || 'drained';
      this.sim.status = 'ended';
      this.showGameOver();
    } else if (screen === 'complete') {
      this.phase = 'completed';
      this.sim.status = 'completed';
      this.sim.finishBattery = 0.72;
      this.sim.stats.bestComboLevel = 8;
      this.showComplete();
    }
    if (qa.has('freeze')) setTimeout(() => (this.frozen = true), Number(qa.get('freeze')) || 1500);
  }
}
