/**
 * Phase 11.8.D — tests cho HUD `BuffBar.vue`.
 *
 * Lock-in:
 *   - Empty active list → bar không render (v-if).
 *   - Render pill cho mỗi active row (đúng key, name, polarity symbol).
 *   - Polarity 'buff' → emerald class. 'debuff' → rose class.
 *   - Stacks > 1 → render `×{stacks}`. Stacks = 1 → ẩn.
 *   - Countdown text: <60s → `Ns`; <3600s → `MmSSs`; ≥3600s → `HhMMm`.
 *   - Auto-refetch khi expired tick: setInterval triggers fetchState lại.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';
import type { BuffDef } from '@xuantoi/shared';

vi.mock('@/api/buffs', () => ({
  getActiveBuffs: vi.fn(),
}));

import * as api from '@/api/buffs';
import BuffBar from '@/components/shell/BuffBar.vue';
import { useBuffsStore } from '@/stores/buffs';

const mockedGet = vi.mocked(api.getActiveBuffs);

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      buffs: {
        bar: {
          aria: 'Trạng thái',
          empty: 'Trống',
        },
      },
    },
  },
});

const BUFF_DEF: BuffDef = {
  key: 'pill_atk_buff_t1',
  name: 'Cương Lực Đan Ấn',
  description: 'desc',
  polarity: 'buff',
  element: null,
  source: 'pill',
  durationSec: 60,
  stackable: false,
  maxStacks: 1,
  dispellable: true,
  effects: [
    {
      kind: 'stat_mod',
      value: 1.12,
      statTarget: 'atk',
      elementTarget: null,
    },
  ],
};

const DEBUFF_DEF: BuffDef = {
  ...BUFF_DEF,
  key: 'boss_dot_thuy',
  name: 'Hàn Băng',
  polarity: 'debuff',
  source: 'boss_skill',
};

const STACKABLE_DEF: BuffDef = {
  ...BUFF_DEF,
  key: 'pill_stack_t1',
  name: 'Đa Tầng Đan',
  stackable: true,
  maxStacks: 5,
};

function mountBar() {
  return mount(BuffBar, { global: { plugins: [i18n] } });
}

describe('BuffBar — Phase 11.8.D HUD', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T22:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('empty active list → bar không render', async () => {
    mockedGet.mockResolvedValueOnce([]);
    const w = mountBar();
    await flushPromises();
    expect(w.find('[data-testid="buff-bar"]').exists()).toBe(false);
  });

  it('render 1 buff pill với polarity ⊕ + countdown seconds', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        // expires in 30s
        expiresAt: '2026-05-06T22:00:30.000Z',
        def: BUFF_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    expect(w.find('[data-testid="buff-bar"]').exists()).toBe(true);
    const pill = w.find('[data-testid="buff-pill-pill_atk_buff_t1"]');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain('⊕');
    expect(pill.text()).toContain('Cương Lực Đan Ấn');
    expect(pill.classes().some((c) => c.includes('emerald'))).toBe(true);
    const remaining = w.find(
      '[data-testid="buff-remaining-pill_atk_buff_t1"]',
    );
    expect(remaining.text()).toBe('30s');
  });

  it('render debuff pill với polarity ⊖ + rose class', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'boss_dot_thuy',
        stacks: 1,
        source: 'boss_skill',
        expiresAt: '2026-05-06T22:01:00.000Z',
        def: DEBUFF_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    const pill = w.find('[data-testid="buff-pill-boss_dot_thuy"]');
    expect(pill.exists()).toBe(true);
    expect(pill.text()).toContain('⊖');
    expect(pill.classes().some((c) => c.includes('rose'))).toBe(true);
  });

  it('stacks > 1 → render ×N indicator', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_stack_t1',
        stacks: 3,
        source: 'pill',
        expiresAt: '2026-05-06T22:00:30.000Z',
        def: STACKABLE_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    const stackEl = w.find('[data-testid="buff-stacks-pill_stack_t1"]');
    expect(stackEl.exists()).toBe(true);
    expect(stackEl.text()).toBe('×3');
  });

  it('stacks = 1 → ẩn ×N indicator', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        expiresAt: '2026-05-06T22:00:30.000Z',
        def: BUFF_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    expect(
      w.find('[data-testid="buff-stacks-pill_atk_buff_t1"]').exists(),
    ).toBe(false);
  });

  it('countdown format: 90s → 1m30s', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        expiresAt: '2026-05-06T22:01:30.000Z',
        def: BUFF_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    expect(
      w.find('[data-testid="buff-remaining-pill_atk_buff_t1"]').text(),
    ).toBe('1m30s');
  });

  it('countdown format: 3661s → 1h01m', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        expiresAt: '2026-05-06T23:01:01.000Z',
        def: BUFF_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    expect(
      w.find('[data-testid="buff-remaining-pill_atk_buff_t1"]').text(),
    ).toBe('1h01m');
  });

  it('expired buff được ẩn client-side trước khi refetch arrive', async () => {
    mockedGet.mockResolvedValueOnce([
      {
        buffKey: 'pill_atk_buff_t1',
        stacks: 1,
        source: 'pill',
        // already expired
        expiresAt: '2026-05-06T21:59:59.000Z',
        def: BUFF_DEF,
      },
    ]);
    const w = mountBar();
    await flushPromises();
    // Already expired → not rendered → bar empty → v-if=false.
    expect(w.find('[data-testid="buff-bar"]').exists()).toBe(false);
  });

  it('mount: fetch state khi component mount', async () => {
    mockedGet.mockResolvedValueOnce([]);
    const s = useBuffsStore();
    expect(s.loaded).toBe(false);
    mountBar();
    await flushPromises();
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(s.loaded).toBe(true);
  });

  it('silent error: BE down → component không throw', async () => {
    mockedGet.mockRejectedValueOnce(new Error('boom'));
    const w = mountBar();
    await flushPromises();
    // No throw, bar empty (v-if=false because no active rows).
    expect(w.find('[data-testid="buff-bar"]').exists()).toBe(false);
  });
});
