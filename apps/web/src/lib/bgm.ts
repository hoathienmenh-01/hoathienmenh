/**
 * Cửu Thiên Mộng — Background music (BGM).
 *
 * Lightweight WebAudio-driven ambient drone synth — không phụ thuộc audio
 * assets bên ngoài (cùng pattern với `sfx.ts`). Mỗi scene có một drone tone
 * + harmonic + LFO breath pad, render bằng AudioContext nên không có
 * network overhead hay license issues.
 *
 * Public API:
 *   - `playSceneBgm(scene)` — fade-in scene track. Nếu đang chạy, crossfade
 *     sang track mới.
 *   - `stopBgm(fadeMs?)` — fade-out current track.
 *   - `isBgmMuted()` / `setBgmMuted(muted)` — persist `xt.bgm.muted`.
 *   - `getBgmVolume()` / `setBgmVolume(v)` — persist `xt.bgm.volume` (0..1).
 *
 * Tuân thủ:
 *   - Settings mute/volume riêng so với SFX (separate localStorage keys).
 *   - Khi mute=true → `playSceneBgm` no-op + stop nếu đang chạy.
 *   - SSR-safe: tất cả side-effect gate bằng `typeof window === 'undefined'`.
 *   - Browser autoplay policy: `AudioContext.resume()` được gọi trên mọi
 *     `playSceneBgm` để hỗ trợ kích hoạt sau user gesture.
 */

import type { SceneKey } from '@/composables/useSceneTheme';

export type BgmKey = SceneKey;

const MUTED_KEY = 'xt.bgm.muted';
const VOLUME_KEY = 'xt.bgm.volume';

const DEFAULT_FADE_MS = 1200;
const DEFAULT_VOLUME = 0.35;

/** Drone-pad config per scene. Root frequencies chọn theo mood:
 *  dashboard (G3, contemplative), cultivation (F#3, mystical),
 *  boss (C2, dark), secret (D3, mystery), sect (A3, peaceful),
 *  market (E4, lively), default (G3). */
const SCENE_PADS: Record<BgmKey, {
  root: number;
  fifth: number;
  lfoHz: number;
  type: OscillatorType;
}> = {
  dashboard: { root: 196.0, fifth: 293.66, lfoHz: 0.12, type: 'sine' },
  cultivation: { root: 185.0, fifth: 277.18, lfoHz: 0.08, type: 'triangle' },
  boss: { root: 65.41, fifth: 98.0, lfoHz: 0.18, type: 'sawtooth' },
  secret: { root: 146.83, fifth: 220.0, lfoHz: 0.1, type: 'triangle' },
  sect: { root: 220.0, fifth: 329.63, lfoHz: 0.09, type: 'sine' },
  market: { root: 329.63, fifth: 493.88, lfoHz: 0.14, type: 'triangle' },
  default: { root: 196.0, fifth: 293.66, lfoHz: 0.12, type: 'sine' },
};

interface ActiveTrack {
  scene: BgmKey;
  oscRoot: OscillatorNode;
  oscFifth: OscillatorNode;
  lfo: OscillatorNode;
  gain: GainNode;
}

let ctx: AudioContext | null = null;
let current: ActiveTrack | null = null;

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

export function isBgmMuted(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function setBgmMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // ignore
  }
  if (muted) stopBgm(400);
}

export function getBgmVolume(): number {
  if (typeof window === 'undefined') return DEFAULT_VOLUME;
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw === null) return DEFAULT_VOLUME;
    const v = Number(raw);
    if (!Number.isFinite(v)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(1, v));
  } catch {
    return DEFAULT_VOLUME;
  }
}

export function setBgmVolume(v: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(0, Math.min(1, v));
  try {
    window.localStorage.setItem(VOLUME_KEY, clamped.toFixed(2));
  } catch {
    // ignore
  }
  // Apply to currently-playing gain live.
  if (current) {
    const c = getCtx();
    if (c) {
      const now = c.currentTime;
      try {
        current.gain.gain.cancelScheduledValues(now);
        current.gain.gain.linearRampToValueAtTime(clamped, now + 0.2);
      } catch {
        // ignore — node may be torn down.
      }
    }
  }
}

/** Internal: create a pad track for the given scene at `vol`. Caller is
 *  responsible for starting nodes + assigning to `current`. */
function createTrack(scene: BgmKey, vol: number): ActiveTrack | null {
  const c = getCtx();
  if (!c) return null;
  const pad = SCENE_PADS[scene];
  const gain = c.createGain();
  gain.gain.value = 0;

  const oscRoot = c.createOscillator();
  oscRoot.type = pad.type;
  oscRoot.frequency.value = pad.root;

  const oscFifth = c.createOscillator();
  oscFifth.type = pad.type;
  oscFifth.frequency.value = pad.fifth;
  oscFifth.detune.value = 4;

  // LFO modulates the master gain for "breath" effect.
  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = pad.lfoHz;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = vol * 0.18;
  lfo.connect(lfoDepth);
  lfoDepth.connect(gain.gain);

  oscRoot.connect(gain);
  oscFifth.connect(gain);
  gain.connect(c.destination);

  return { scene, oscRoot, oscFifth, lfo, gain };
}

function fadeOutAndStop(track: ActiveTrack, fadeMs: number): void {
  const c = getCtx();
  if (!c) return;
  const now = c.currentTime;
  const sec = Math.max(0.05, fadeMs / 1000);
  try {
    track.gain.gain.cancelScheduledValues(now);
    track.gain.gain.setValueAtTime(track.gain.gain.value, now);
    track.gain.gain.linearRampToValueAtTime(0, now + sec);
    track.oscRoot.stop(now + sec + 0.05);
    track.oscFifth.stop(now + sec + 0.05);
    track.lfo.stop(now + sec + 0.05);
  } catch {
    // ignore — already stopped.
  }
}

/** Play the BGM for the given scene, crossfading from any current track. */
export function playSceneBgm(scene: BgmKey, fadeMs = DEFAULT_FADE_MS): void {
  if (isBgmMuted()) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === 'suspended') {
    c.resume().catch(() => undefined);
  }
  if (current && current.scene === scene) return;

  const vol = getBgmVolume();
  const next = createTrack(scene, vol);
  if (!next) return;

  const now = c.currentTime;
  const sec = Math.max(0.1, fadeMs / 1000);
  try {
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.linearRampToValueAtTime(vol, now + sec);
    next.oscRoot.start(now);
    next.oscFifth.start(now);
    next.lfo.start(now);
  } catch {
    return;
  }

  const prev = current;
  current = next;
  if (prev) fadeOutAndStop(prev, fadeMs);
}

/** Fade out and stop the current track. No-op when nothing is playing. */
export function stopBgm(fadeMs = DEFAULT_FADE_MS): void {
  if (!current) return;
  fadeOutAndStop(current, fadeMs);
  current = null;
}

/** Test-only: introspection of internal state. */
export const __test__ = {
  hasCurrent: (): boolean => current !== null,
  currentScene: (): BgmKey | null => (current ? current.scene : null),
  reset: (): void => {
    if (current) {
      try {
        current.oscRoot.stop();
        current.oscFifth.stop();
        current.lfo.stop();
      } catch {
        // ignore
      }
    }
    current = null;
    ctx = null;
  },
};
