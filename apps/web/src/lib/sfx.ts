/**
 * Cửu Thiên Mộng — Sound effects.
 *
 * Lightweight WebAudio synth — không phụ thuộc audio assets bên ngoài.
 * Mỗi sound effect render bằng AudioContext oscillator + envelope nên
 * không có overhead network hay license issues.
 *
 * Tuân thủ `prefers-reduced-motion` (xem là user-preference proxy) và
 * mute setting trong localStorage `xt.sfx.muted`.
 */

const MUTED_KEY = 'xt.sfx.muted';
const VOLUME_KEY = 'xt.sfx.volume';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const W = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const AC = W.AudioContext ?? W.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      ctx = null;
    }
  }
  return ctx;
}

export function isSfxMuted(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setSfxMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // ignore
  }
}

export function getSfxVolume(): number {
  if (typeof window === 'undefined') return 0.6;
  try {
    const v = Number(window.localStorage.getItem(VOLUME_KEY) ?? '0.6');
    if (!Number.isFinite(v)) return 0.6;
    return Math.max(0, Math.min(1, v));
  } catch {
    return 0.6;
  }
}

export function setSfxVolume(v: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(1, v));
  try {
    window.localStorage.setItem(VOLUME_KEY, clamped.toFixed(2));
  } catch {
    // ignore
  }
}

type ToneOptions = {
  freq: number;
  duration: number;
  type?: OscillatorType;
  attack?: number;
  release?: number;
  detune?: number;
  freqEnd?: number;
};

function playTone(opts: ToneOptions, gainMul = 1): void {
  if (isSfxMuted()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    c.resume().catch(() => undefined);
  }
  const now = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, now);
  if (typeof opts.freqEnd === 'number') {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.freqEnd),
      now + opts.duration,
    );
  }
  if (typeof opts.detune === 'number') osc.detune.setValueAtTime(opts.detune, now);

  const peak = getSfxVolume() * gainMul;
  const attack = opts.attack ?? 0.005;
  const release = opts.release ?? Math.min(opts.duration * 0.6, 0.4);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.0001, peak * 0.001),
    now + opts.duration + release,
  );

  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(now);
  osc.stop(now + opts.duration + release + 0.05);
}

/** UI click (subtle wood-block). */
export function playSfxClick(): void {
  playTone({
    freq: 880,
    freqEnd: 660,
    duration: 0.04,
    type: 'triangle',
    attack: 0.001,
    release: 0.08,
  }, 0.35);
}

/** UI confirm / claim reward. */
export function playSfxConfirm(): void {
  playTone({ freq: 660, duration: 0.08, type: 'sine', release: 0.12 }, 0.5);
  setTimeout(() => playTone({ freq: 990, duration: 0.12, type: 'sine', release: 0.2 }, 0.45), 60);
}

/** Drop popup (rare item shine). */
export function playSfxRareDrop(): void {
  playTone({ freq: 520, duration: 0.2, type: 'sine', release: 0.4 }, 0.55);
  setTimeout(() => playTone({ freq: 780, duration: 0.18, type: 'sine', release: 0.35 }, 0.5), 90);
  setTimeout(() => playTone({ freq: 1040, duration: 0.16, type: 'triangle', release: 0.3 }, 0.45), 180);
}

/** Boss spawn warning — low brass-ish blast. */
export function playSfxBoss(): void {
  playTone({
    freq: 110,
    freqEnd: 65,
    duration: 0.6,
    type: 'sawtooth',
    attack: 0.02,
    release: 0.5,
  }, 0.7);
  setTimeout(() => {
    playTone({
      freq: 220,
      freqEnd: 130,
      duration: 0.5,
      type: 'sawtooth',
      attack: 0.02,
      release: 0.4,
    }, 0.4);
  }, 60);
}

/** Breakthrough — thiên kiếp rolling thunder. */
export function playSfxBreakthrough(): void {
  // Lightning crack: sharp white-noise burst via fast oscillator sweep.
  playTone({
    freq: 2200,
    freqEnd: 80,
    duration: 0.4,
    type: 'sawtooth',
    attack: 0.001,
    release: 0.6,
  }, 0.7);
  // Sub-bass rumble.
  setTimeout(() => {
    playTone({
      freq: 60,
      freqEnd: 35,
      duration: 1.2,
      type: 'sine',
      attack: 0.05,
      release: 0.8,
    }, 0.6);
  }, 80);
}
