import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * BGM lib smoke tests (Cửu Thiên Mộng Phase 3 module A).
 *
 * Mock AudioContext globally (happy-dom does not implement WebAudio). Verify:
 *   - mute/volume persist sang localStorage.
 *   - playSceneBgm tạo oscillators + connects + start (resume context).
 *   - playSceneBgm trên scene đã active → no-op (không tạo track mới).
 *   - playSceneBgm khi muted → no-op (không tạo oscillator).
 *   - stopBgm fade-out + clear current.
 *   - crossfade: scene mới → có 2 lần createOscillator * 3 trong cùng tick
 *     (3 osc cho old + 3 osc cho new).
 */

interface MockGainParam {
  value: number;
  setValueAtTime: ReturnType<typeof vi.fn>;
  linearRampToValueAtTime: ReturnType<typeof vi.fn>;
  cancelScheduledValues: ReturnType<typeof vi.fn>;
}
interface MockGain {
  gain: MockGainParam;
  connect: ReturnType<typeof vi.fn>;
}
interface MockOsc {
  type: OscillatorType;
  frequency: { value: number };
  detune: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function makeGainParam(): MockGainParam {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

function makeMockAudioContext(state: AudioContextState = 'running') {
  const created = {
    gains: [] as MockGain[],
    oscs: [] as MockOsc[],
  };
  const ctx = {
    currentTime: 0,
    state,
    resume: vi.fn().mockResolvedValue(undefined),
    destination: {} as AudioDestinationNode,
    createGain(): MockGain {
      const g: MockGain = { gain: makeGainParam(), connect: vi.fn() };
      created.gains.push(g);
      return g;
    },
    createOscillator(): MockOsc {
      const o: MockOsc = {
        type: 'sine',
        frequency: { value: 0 },
        detune: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      created.oscs.push(o);
      return o;
    },
  };
  return { ctx, created };
}

async function importBgm() {
  // Re-import bgm module với module cache reset để giữ test isolation.
  vi.resetModules();
  const mod = await import('../bgm');
  return mod;
}

describe('bgm — localStorage settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('isBgmMuted → false mặc định (chưa set localStorage)', async () => {
    const { isBgmMuted } = await importBgm();
    expect(isBgmMuted()).toBe(false);
  });

  it('setBgmMuted(true) → isBgmMuted = true + persist key xt.bgm.muted=1', async () => {
    const { isBgmMuted, setBgmMuted } = await importBgm();
    setBgmMuted(true);
    expect(isBgmMuted()).toBe(true);
    expect(window.localStorage.getItem('xt.bgm.muted')).toBe('1');
  });

  it('setBgmMuted(false) → key xt.bgm.muted=0', async () => {
    const { setBgmMuted } = await importBgm();
    setBgmMuted(false);
    expect(window.localStorage.getItem('xt.bgm.muted')).toBe('0');
  });

  it('getBgmVolume → 0.35 mặc định', async () => {
    const { getBgmVolume } = await importBgm();
    expect(getBgmVolume()).toBeCloseTo(0.35, 2);
  });

  it('setBgmVolume(0.5) → getBgmVolume ≈ 0.5 + persist', async () => {
    const { getBgmVolume, setBgmVolume } = await importBgm();
    setBgmVolume(0.5);
    expect(getBgmVolume()).toBeCloseTo(0.5, 2);
    expect(window.localStorage.getItem('xt.bgm.volume')).toBe('0.50');
  });

  it('setBgmVolume clamps về [0, 1]', async () => {
    const { getBgmVolume, setBgmVolume } = await importBgm();
    setBgmVolume(1.5);
    expect(getBgmVolume()).toBe(1);
    setBgmVolume(-0.5);
    expect(getBgmVolume()).toBe(0);
  });

  it('localStorage corrupted (NaN) → fallback 0.35', async () => {
    window.localStorage.setItem('xt.bgm.volume', 'not-a-number');
    const { getBgmVolume } = await importBgm();
    expect(getBgmVolume()).toBeCloseTo(0.35, 2);
  });
});

describe('bgm — playSceneBgm / stopBgm', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('khi muted=true → playSceneBgm no-op (không tạo AudioContext)', async () => {
    const ACMock = vi.fn();
    vi.stubGlobal('AudioContext', ACMock);
    const { playSceneBgm, setBgmMuted, __test__ } = await importBgm();
    setBgmMuted(true);
    playSceneBgm('cultivation');
    expect(__test__.hasCurrent()).toBe(false);
    expect(ACMock).not.toHaveBeenCalled();
  });

  it('khi không muted → tạo 3 oscillators (root + fifth + lfo) + start', async () => {
    const { ctx, created } = makeMockAudioContext();
    const ACMock = vi.fn(() => ctx);
    vi.stubGlobal('AudioContext', ACMock);
    const { playSceneBgm, __test__ } = await importBgm();
    playSceneBgm('cultivation');
    expect(created.oscs.length).toBe(3);
    for (const o of created.oscs) expect(o.start).toHaveBeenCalledTimes(1);
    expect(__test__.currentScene()).toBe('cultivation');
  });

  it('AudioContext.state=suspended → resume() được gọi', async () => {
    const { ctx } = makeMockAudioContext('suspended');
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    const { playSceneBgm } = await importBgm();
    playSceneBgm('dashboard');
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('playSceneBgm cùng scene 2 lần → chỉ tạo 1 track', async () => {
    const { ctx, created } = makeMockAudioContext();
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    const { playSceneBgm } = await importBgm();
    playSceneBgm('boss');
    playSceneBgm('boss');
    expect(created.oscs.length).toBe(3); // 1 track × 3 osc, không double
  });

  it('crossfade scene: cultivation → boss → tạo 6 osc tổng (3 cũ + 3 mới)', async () => {
    const { ctx, created } = makeMockAudioContext();
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    const { playSceneBgm, __test__ } = await importBgm();
    playSceneBgm('cultivation');
    expect(created.oscs.length).toBe(3);
    playSceneBgm('boss');
    expect(created.oscs.length).toBe(6);
    expect(__test__.currentScene()).toBe('boss');
    // Cả 6 oscillator phải đã start.
    for (const o of created.oscs) expect(o.start).toHaveBeenCalled();
    // Track cũ (3 osc đầu) phải được lên schedule stop.
    expect(created.oscs[0].stop).toHaveBeenCalled();
    expect(created.oscs[1].stop).toHaveBeenCalled();
    expect(created.oscs[2].stop).toHaveBeenCalled();
  });

  it('stopBgm → fade-out current + clear', async () => {
    const { ctx, created } = makeMockAudioContext();
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    const { playSceneBgm, stopBgm, __test__ } = await importBgm();
    playSceneBgm('sect');
    expect(__test__.hasCurrent()).toBe(true);
    stopBgm();
    expect(__test__.hasCurrent()).toBe(false);
    // Tất cả oscillator phải có .stop được schedule.
    for (const o of created.oscs) expect(o.stop).toHaveBeenCalled();
  });

  it('stopBgm khi không có current → no-op (no throw)', async () => {
    vi.stubGlobal('AudioContext', vi.fn(() => makeMockAudioContext().ctx));
    const { stopBgm } = await importBgm();
    expect(() => stopBgm()).not.toThrow();
  });

  it('setBgmMuted(true) khi đang play → schedule fade-out + clear current', async () => {
    const { ctx } = makeMockAudioContext();
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    const { playSceneBgm, setBgmMuted, __test__ } = await importBgm();
    playSceneBgm('dashboard');
    expect(__test__.hasCurrent()).toBe(true);
    setBgmMuted(true);
    expect(__test__.hasCurrent()).toBe(false);
  });

  it('setBgmVolume khi đang play → ramp gain.gain trên current track', async () => {
    const { ctx, created } = makeMockAudioContext();
    vi.stubGlobal('AudioContext', vi.fn(() => ctx));
    const { playSceneBgm, setBgmVolume } = await importBgm();
    playSceneBgm('market');
    // Master gain là gain đầu tiên được tạo.
    const masterGain = created.gains[0];
    masterGain.gain.linearRampToValueAtTime.mockClear();
    setBgmVolume(0.8);
    expect(masterGain.gain.linearRampToValueAtTime).toHaveBeenCalled();
  });

  it('AudioContext không tồn tại (env thiếu) → playSceneBgm no-op', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    const { playSceneBgm, __test__ } = await importBgm();
    playSceneBgm('default');
    expect(__test__.hasCurrent()).toBe(false);
  });
});
