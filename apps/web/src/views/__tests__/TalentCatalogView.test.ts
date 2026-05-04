import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import { TALENTS } from '@xuantoi/shared';

/**
 * Phase 11.X.AR — Talent Catalog read-only view test suite.
 * Phase 11.X.AT — extends with learn button + Pinia talents store wiring +
 * status filter + budget bar + toast.
 *
 * Bao phủ:
 *  - Render đủ TALENTS từ shared catalog (no filter).
 *  - Filter theo type (passive/active).
 *  - Filter theo element (kim/moc/thuy/hoa/tho/neutral).
 *  - Filter status: learned / available / locked.
 *  - Empty state khi filter không khớp talent nào.
 *  - Effect summary format đúng cho passive (stat_mod / regen / damage_bonus)
 *    + active (damage / cc / heal / dot / utility).
 *  - Budget bar render spent + remaining + budget total.
 *  - Learn button label/disabled state đúng theo trạng thái (learned/lock/avail).
 *  - Click Học → store.learn called + toast success.
 *  - Click Học khi server reject → toast error i18n key đúng.
 */

const replaceMock = vi.fn();
const pushMock = vi.fn().mockResolvedValue(undefined);
const learnMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

const talentsState = {
  learned: new Map<string, string>(),
  cooldowns: new Map<string, number>(),
  spent: 0,
  remaining: 5,
  budget: 5,
  loaded: true,
  inFlight: new Set<string>(),
  isLearned: (k: string) => talentsState.learned.has(k),
  isLearning: (k: string) => talentsState.inFlight.has(k),
  cooldownOf: (k: string) => talentsState.cooldowns.get(k) ?? 0,
  fetchState: fetchStateMock,
  learn: learnMock,
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
    character: { realmKey: 'truc_co' },
  }),
}));
vi.mock('@/stores/talents', () => ({
  useTalentsStore: () => talentsState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({
    push: toastPushMock,
  }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import TalentCatalogView from '@/views/TalentCatalogView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      talents: {
        title: 'Ngộ Đạo',
        subtitle: 'Catalog {total} thần thông',
        counts: '{passive} bị động · {active} chủ động',
        empty: 'Không có thần thông',
        filter: {
          type: 'Loại',
          element: 'Hệ',
          all: 'Tất cả',
          passive: 'Bị động',
          active: 'Chủ động',
          shown: 'Hiển thị {shown}/{total}',
        },
        filterStatus: {
          label: 'Tình trạng',
          all: 'Tất cả',
          learned: 'Đã học',
          available: 'Có thể học',
          locked: 'Chưa đủ',
        },
        type: { passive: 'Bị động', active: 'Chủ động' },
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thuỷ',
          hoa: 'Hoả',
          tho: 'Thổ',
          neutral: 'Vô hệ',
        },
        stat: {
          atk: 'công',
          def: 'thủ',
          hpMax: 'sinh',
          mpMax: 'linh',
          spirit: 'thần',
        },
        field: { realm: 'Cảnh giới', cost: 'Cost', effect: 'Hiệu ứng' },
        effect: {
          statMod: '+{pct}% {stat}',
          regen: '+{flat} {stat}',
          dropBonus: '+{pct}% drop',
          expBonus: '+{pct}% exp',
          damageBonus: '+{pct}% vs {element}',
          aoe: 'AoE',
          single: 'đơn',
          activeDamage: '×{mul} ({aoe}) {mp}MP CD{cd}',
          activeCc: 'CC{turns} ({aoe}) {mp}MP CD{cd}',
          activeHeal: 'Heal×{mul} {mp}MP CD{cd}',
          activeDot: 'DoT{turns} ({aoe}) {mp}MP CD{cd}',
          activeUtility: 'Util {mp}MP CD{cd}',
        },
        budget: {
          title: 'Điểm',
          spent: 'Dùng {spent}',
          remaining: 'Còn {remaining}',
          of: '/{budget}',
          loading: 'Đang tải',
        },
        badge: {
          learned: 'Đã học',
          cooldown: 'CD {turns}',
          ready: 'Sẵn sàng',
        },
        cooldown: {
          tooltip: 'Số lượt chờ',
        },
        activeSection: {
          title: 'Loadout',
          subtitle: 'Vào trận để dùng',
          empty: 'Chưa có thần thông',
          count: '{count} đã học',
          cast: 'Vào trận',
          castOnCooldown: 'CD {turns}',
          castHint: 'Vào hầm dùng {name}',
          elementFilter: {
            label: 'Lọc hệ:',
            all: 'Tất cả',
            empty: 'Không khớp hệ — bỏ lọc để xem tất cả',
            reset: 'Bỏ lọc',
          },
        },
        button: {
          learn: 'Học',
          learning: 'Đang học',
          learned: 'Đã học',
          realmTooLow: 'Cảnh giới chưa đủ',
          insufficientPoints: 'Hết điểm',
        },
        learn: {
          success: 'Đã học {name}',
          errors: {
            ALREADY_LEARNED: 'Đã học rồi',
            REALM_TOO_LOW: 'Cảnh giới thấp',
            INSUFFICIENT_TALENT_POINTS: 'Hết điểm',
            UNKNOWN: 'Lỗi',
          },
        },
      },
    },
  },
});

function mountView() {
  return mount(TalentCatalogView, { global: { plugins: [i18n] } });
}

function resetState() {
  talentsState.learned = new Map();
  talentsState.cooldowns = new Map();
  talentsState.spent = 0;
  talentsState.remaining = 5;
  talentsState.budget = 5;
  talentsState.inFlight = new Set();
  learnMock.mockReset();
  fetchStateMock.mockClear();
  toastPushMock.mockClear();
  pushMock.mockClear();
}

describe('TalentCatalogView — render & counts', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('mặc định no filter: render đủ TALENTS.length card', async () => {
    const w = mountView();
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    expect(cards).toHaveLength(TALENTS.length);
  });

  it('hiển thị counts passive vs active đúng từ catalog', async () => {
    const w = mountView();
    await flushPromises();
    const passiveCount = TALENTS.filter((t) => t.type === 'passive').length;
    const activeCount = TALENTS.filter((t) => t.type === 'active').length;
    const counts = w.find('[data-testid="talents-counts"]').text();
    expect(counts).toContain(String(passiveCount));
    expect(counts).toContain(String(activeCount));
  });

  it('result count text reflect filtered/total', async () => {
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="talents-result-count"]').text();
    expect(txt).toContain(`${TALENTS.length}/${TALENTS.length}`);
  });
});

describe('TalentCatalogView — filter type', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('filter type=passive → chỉ render talent passive', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="talents-filter-type"]').setValue('passive');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    const passiveCount = TALENTS.filter((t) => t.type === 'passive').length;
    expect(cards).toHaveLength(passiveCount);
    const activeKeys = TALENTS.filter((t) => t.type === 'active').map(
      (t) => t.key,
    );
    for (const key of activeKeys) {
      expect(w.find(`[data-testid="talent-card-${key}"]`).exists()).toBe(
        false,
      );
    }
  });

  it('filter type=active → chỉ render talent active', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="talents-filter-type"]').setValue('active');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    const activeCount = TALENTS.filter((t) => t.type === 'active').length;
    expect(cards).toHaveLength(activeCount);
  });
});

describe('TalentCatalogView — filter element', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('filter element=kim → chỉ render talent kim', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="talents-filter-element"]').setValue('kim');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    const kimCount = TALENTS.filter((t) => t.element === 'kim').length;
    expect(cards).toHaveLength(kimCount);
    expect(kimCount).toBeGreaterThan(0);
  });

  it('filter element=neutral → chỉ render talent có element null', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="talents-filter-element"]')
      .setValue('neutral');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    const neutralCount = TALENTS.filter((t) => t.element === null).length;
    expect(cards).toHaveLength(neutralCount);
  });

  it('filter element=tho → chỉ render talent tho', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="talents-filter-element"]').setValue('tho');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    const thoCount = TALENTS.filter((t) => t.element === 'tho').length;
    expect(cards).toHaveLength(thoCount);
    expect(thoCount).toBeGreaterThan(0);
  });
});

describe('TalentCatalogView — combined filter empty', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('filter type+element không khớp talent nào → hiện empty state', async () => {
    const w = mountView();
    await flushPromises();
    const allCombos: Array<{ type: 'passive' | 'active'; element: string }> = [];
    for (const type of ['passive', 'active'] as const) {
      for (const el of ['kim', 'moc', 'thuy', 'hoa', 'tho', 'neutral']) {
        const matches = TALENTS.filter((t) => {
          if (t.type !== type) return false;
          if (el === 'neutral') return t.element === null;
          return t.element === el;
        });
        if (matches.length === 0) allCombos.push({ type, element: el });
      }
    }
    if (allCombos.length === 0) {
      return;
    }
    const combo = allCombos[0];
    await w.find('[data-testid="talents-filter-type"]').setValue(combo.type);
    await w
      .find('[data-testid="talents-filter-element"]')
      .setValue(combo.element);
    await flushPromises();
    expect(w.find('[data-testid="talents-empty"]').exists()).toBe(true);
    expect(w.findAll('[data-testid^="talent-card-"]')).toHaveLength(0);
  });
});

describe('TalentCatalogView — effect summary format', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('passive stat_mod hiện format "+pct% stat"', async () => {
    const w = mountView();
    await flushPromises();
    const sample = TALENTS.find(
      (t) => t.passiveEffect?.kind === 'stat_mod' && t.passiveEffect.value > 1,
    );
    if (!sample) throw new Error('no stat_mod talent in catalog');
    const card = w.find(`[data-testid="talent-card-${sample.key}"]`);
    expect(card.exists()).toBe(true);
    const pct = Math.round((sample.passiveEffect!.value - 1) * 100);
    expect(card.text()).toContain(`+${pct}%`);
  });

  it('passive regen hiện format "+flat stat"', async () => {
    const w = mountView();
    await flushPromises();
    const sample = TALENTS.find((t) => t.passiveEffect?.kind === 'regen');
    if (!sample) throw new Error('no regen talent in catalog');
    const card = w.find(`[data-testid="talent-card-${sample.key}"]`);
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain(`+${sample.passiveEffect!.value}`);
  });

  it('passive damage_bonus hiện format "+pct% vs element"', async () => {
    const w = mountView();
    await flushPromises();
    const sample = TALENTS.find(
      (t) => t.passiveEffect?.kind === 'damage_bonus',
    );
    if (!sample) throw new Error('no damage_bonus talent in catalog');
    const card = w.find(`[data-testid="talent-card-${sample.key}"]`);
    expect(card.exists()).toBe(true);
    const pct = Math.round((sample.passiveEffect!.value - 1) * 100);
    expect(card.text()).toContain(`+${pct}%`);
  });

  it('active damage hiện cooldown + mp cost', async () => {
    const w = mountView();
    await flushPromises();
    const sample = TALENTS.find((t) => t.activeEffect?.kind === 'damage');
    if (!sample) throw new Error('no active damage talent in catalog');
    const card = w.find(`[data-testid="talent-card-${sample.key}"]`);
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain(`${sample.activeEffect!.mpCost}MP`);
    expect(card.text()).toContain(`CD${sample.activeEffect!.cooldownTurns}`);
  });
});

describe('TalentCatalogView — auth redirect', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('mỗi talent card có realm requirement + cost hiển thị', async () => {
    const w = mountView();
    await flushPromises();
    const sample = TALENTS[0];
    const card = w.find(`[data-testid="talent-card-${sample.key}"]`);
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain(String(sample.talentPointCost));
  });
});

describe('TalentCatalogView — Phase 11.X.AT learn flow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('budget bar hiển thị spent/budget + remaining khi loaded', async () => {
    talentsState.spent = 2;
    talentsState.remaining = 3;
    talentsState.budget = 5;
    const w = mountView();
    await flushPromises();
    const spentEl = w.find('[data-testid="talents-budget-spent"]');
    expect(spentEl.exists()).toBe(true);
    expect(spentEl.text()).toContain('2');
    expect(spentEl.text()).toContain('5');
    const remainingEl = w.find('[data-testid="talents-budget-remaining"]');
    expect(remainingEl.text()).toContain('3');
  });

  it('budget bar hiển thị loading khi store chưa loaded', async () => {
    talentsState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="talents-budget-spent"]').exists()).toBe(false);
    expect(w.find('[data-testid="talents-budget"]').text()).toContain('Đang tải');
    talentsState.loaded = true;
  });

  it('talent đã học → button disabled + label "Đã học" + badge learned', async () => {
    const sample = TALENTS[0];
    talentsState.learned = new Map([[sample.key, '2024-01-01T00:00:00Z']]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="talent-learn-${sample.key}"]`);
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('Đã học');
    expect(
      w.find(`[data-testid="talent-badge-learned-${sample.key}"]`).exists(),
    ).toBe(true);
  });

  it('talent realm cao hơn nhân vật → button disabled + label "Cảnh giới chưa đủ"', async () => {
    // Mock character realm = truc_co (idx 1). Find talent với realmRequirement > truc_co.
    const high = TALENTS.find((t) => t.realmRequirement === 'kim_dan');
    if (!high) throw new Error('no kim_dan talent in catalog');
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="talent-learn-${high.key}"]`);
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('Cảnh giới chưa đủ');
  });

  it('hết điểm ngộ đạo → button disabled + label "Hết điểm"', async () => {
    talentsState.remaining = 0;
    const w = mountView();
    await flushPromises();
    // Find a talent the character can otherwise reach (truc_co or below).
    const sample = TALENTS.find(
      (t) =>
        t.realmRequirement === 'truc_co' || t.realmRequirement === 'luyen_khi',
    );
    if (!sample) throw new Error('no early talent in catalog');
    const btn = w.find(`[data-testid="talent-learn-${sample.key}"]`);
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('Hết điểm');
  });

  it('click Học khi available → store.learn called + toast success', async () => {
    learnMock.mockResolvedValueOnce(null);
    const sample = TALENTS.find(
      (t) => t.realmRequirement === 'truc_co' && t.talentPointCost <= 5,
    );
    if (!sample) throw new Error('no truc_co talent in catalog');
    const w = mountView();
    await flushPromises();
    await w.find(`[data-testid="talent-learn-${sample.key}"]`).trigger('click');
    await flushPromises();
    expect(learnMock).toHaveBeenCalledWith(sample.key);
    expect(toastPushMock).toHaveBeenCalledTimes(1);
    const call = toastPushMock.mock.calls[0][0];
    expect(call.type).toBe('success');
    expect(call.text).toContain(sample.name);
  });

  it('click Học khi server reject ALREADY_LEARNED → toast error i18n', async () => {
    learnMock.mockResolvedValueOnce('ALREADY_LEARNED');
    const sample = TALENTS.find(
      (t) => t.realmRequirement === 'truc_co' && t.talentPointCost <= 5,
    );
    if (!sample) throw new Error('no truc_co talent in catalog');
    const w = mountView();
    await flushPromises();
    await w.find(`[data-testid="talent-learn-${sample.key}"]`).trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledTimes(1);
    const call = toastPushMock.mock.calls[0][0];
    expect(call.type).toBe('error');
    expect(call.text).toContain('Đã học rồi');
  });

  it('click Học khi server reject UNKNOWN code → toast error fallback UNKNOWN', async () => {
    learnMock.mockResolvedValueOnce('SOME_UNHANDLED_CODE');
    const sample = TALENTS.find(
      (t) => t.realmRequirement === 'truc_co' && t.talentPointCost <= 5,
    );
    if (!sample) throw new Error('no truc_co talent in catalog');
    const w = mountView();
    await flushPromises();
    await w.find(`[data-testid="talent-learn-${sample.key}"]`).trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledTimes(1);
    const call = toastPushMock.mock.calls[0][0];
    expect(call.type).toBe('error');
    expect(call.text).toBe('Lỗi');
  });

  it('filter status=learned → chỉ render talent đã học', async () => {
    const learnedKey = TALENTS[0].key;
    talentsState.learned = new Map([[learnedKey, '2024-01-01T00:00:00Z']]);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="talents-filter-status"]').setValue('learned');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    expect(cards).toHaveLength(1);
    expect(w.find(`[data-testid="talent-card-${learnedKey}"]`).exists()).toBe(
      true,
    );
  });

  it('filter status=available → loại trừ learned + locked', async () => {
    const learnedKey = TALENTS[0].key;
    talentsState.learned = new Map([[learnedKey, '2024-01-01T00:00:00Z']]);
    talentsState.remaining = 5;
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="talents-filter-status"]')
      .setValue('available');
    await flushPromises();
    expect(
      w.find(`[data-testid="talent-card-${learnedKey}"]`).exists(),
    ).toBe(false);
    // Tất cả card hiển thị phải có status="available".
    const cards = w.findAll('[data-testid^="talent-card-"]');
    for (const card of cards) {
      expect(card.attributes('data-status')).toBe('available');
    }
  });

  it('filter status=locked → chỉ render talent realm hoặc points lock', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="talents-filter-status"]').setValue('locked');
    await flushPromises();
    const cards = w.findAll('[data-testid^="talent-card-"]');
    for (const card of cards) {
      expect(card.attributes('data-status')).toBe('locked');
    }
    // Phải có ít nhất 1 talent realm cao hơn truc_co.
    expect(cards.length).toBeGreaterThan(0);
  });
});

describe('TalentCatalogView — Phase 11.7.E++ cooldown badge', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  function findActiveTalentLearnable() {
    // Active talent với realmRequirement <= truc_co (mock character ở truc_co).
    return TALENTS.find(
      (t) =>
        t.type === 'active' &&
        (t.realmRequirement === 'truc_co' ||
          t.realmRequirement === 'luyen_khi'),
    );
  }

  it('active talent đã học, cooldown > 0 → render cooldown badge với CD {turns}', async () => {
    const sample = findActiveTalentLearnable();
    if (!sample) throw new Error('no early active talent in catalog');
    talentsState.learned = new Map([[sample.key, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[sample.key, 4]]);
    const w = mountView();
    await flushPromises();
    const badge = w.find(`[data-testid="talent-badge-cooldown-${sample.key}"]`);
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain('CD');
    expect(badge.text()).toContain('4');
    // Ready badge KHÔNG hiển thị khi cooldown > 0.
    expect(
      w.find(`[data-testid="talent-badge-ready-${sample.key}"]`).exists(),
    ).toBe(false);
  });

  it('active talent đã học, cooldown = 0 → render ready badge thay vì cooldown', async () => {
    const sample = findActiveTalentLearnable();
    if (!sample) throw new Error('no early active talent in catalog');
    talentsState.learned = new Map([[sample.key, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[sample.key, 0]]);
    const w = mountView();
    await flushPromises();
    expect(
      w.find(`[data-testid="talent-badge-cooldown-${sample.key}"]`).exists(),
    ).toBe(false);
    const ready = w.find(`[data-testid="talent-badge-ready-${sample.key}"]`);
    expect(ready.exists()).toBe(true);
    expect(ready.text()).toContain('Sẵn sàng');
  });

  it('passive talent đã học → KHÔNG render cooldown/ready badge dù có cooldown trong store', async () => {
    const passive = TALENTS.find(
      (t) =>
        t.type === 'passive' &&
        (t.realmRequirement === 'truc_co' ||
          t.realmRequirement === 'luyen_khi'),
    );
    if (!passive) throw new Error('no early passive talent in catalog');
    talentsState.learned = new Map([[passive.key, '2024-01-01T00:00:00Z']]);
    // Defensive: kể cả nếu store có cooldown bất thường cho passive (server
    // không bao giờ set), UI cũng không hiển thị badge cooldown/ready.
    talentsState.cooldowns = new Map([[passive.key, 5]]);
    const w = mountView();
    await flushPromises();
    expect(
      w.find(`[data-testid="talent-badge-cooldown-${passive.key}"]`).exists(),
    ).toBe(false);
    expect(
      w.find(`[data-testid="talent-badge-ready-${passive.key}"]`).exists(),
    ).toBe(false);
  });

  it('active talent CHƯA học → KHÔNG render cooldown/ready badge', async () => {
    const sample = findActiveTalentLearnable();
    if (!sample) throw new Error('no early active talent in catalog');
    // Không set learned. Even if cooldowns map populated.
    talentsState.cooldowns = new Map([[sample.key, 3]]);
    const w = mountView();
    await flushPromises();
    expect(
      w.find(`[data-testid="talent-badge-cooldown-${sample.key}"]`).exists(),
    ).toBe(false);
    expect(
      w.find(`[data-testid="talent-badge-ready-${sample.key}"]`).exists(),
    ).toBe(false);
  });
});

describe('TalentCatalogView — Phase 11.7.E+++ active section + cast button', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  function activeTalents() {
    return TALENTS.filter((t) => t.type === 'active');
  }

  it('section luôn render dù chưa học (empty state)', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="talents-active-section"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="talents-active-empty"]').exists()).toBe(true);
    // List KHÔNG render khi empty.
    expect(w.find('[data-testid="talents-active-list"]').exists()).toBe(false);
    // Count = 0.
    expect(w.find('[data-testid="talents-active-count"]').text()).toContain(
      '0',
    );
  });

  it('chỉ render active talent đã học (passive đã học vẫn ẩn)', async () => {
    const passive = TALENTS.find((t) => t.type === 'passive');
    const active = activeTalents()[0];
    if (!passive || !active) throw new Error('catalog missing fixtures');
    talentsState.learned = new Map([
      [passive.key, '2024-01-01T00:00:00Z'],
      [active.key, '2024-01-01T00:00:00Z'],
    ]);
    const w = mountView();
    await flushPromises();
    // Active talent có row.
    expect(
      w.find(`[data-testid="talent-active-row-${active.key}"]`).exists(),
    ).toBe(true);
    // Passive đã học KHÔNG xuất hiện trong active section.
    expect(
      w.find(`[data-testid="talent-active-row-${passive.key}"]`).exists(),
    ).toBe(false);
    // Count = 1 (chỉ active).
    expect(w.find('[data-testid="talents-active-count"]').text()).toContain(
      '1',
    );
  });

  it('cast button disabled + label "CD {turns}" khi cooldownOf > 0', async () => {
    const active = activeTalents()[0];
    if (!active) throw new Error('catalog missing active talent');
    talentsState.learned = new Map([[active.key, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[active.key, 3]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(
      `[data-testid="talent-active-cast-${active.key}"]`,
    );
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeDefined();
    expect(btn.text()).toContain('3');
    // Cooldown badge cũng render trong section.
    expect(
      w.find(`[data-testid="talent-active-cooldown-${active.key}"]`).exists(),
    ).toBe(true);
    // Ready badge ẨN khi cooldown > 0.
    expect(
      w.find(`[data-testid="talent-active-ready-${active.key}"]`).exists(),
    ).toBe(false);
  });

  it('cast button enabled + ready badge khi cooldownOf=0', async () => {
    const active = activeTalents()[0];
    if (!active) throw new Error('catalog missing active talent');
    talentsState.learned = new Map([[active.key, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[active.key, 0]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(
      `[data-testid="talent-active-cast-${active.key}"]`,
    );
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeUndefined();
    // Label = cast (không phải castOnCooldown).
    expect(btn.text()).toContain('Vào trận');
    // Ready badge render, cooldown badge ẨN.
    expect(
      w.find(`[data-testid="talent-active-ready-${active.key}"]`).exists(),
    ).toBe(true);
    expect(
      w.find(`[data-testid="talent-active-cooldown-${active.key}"]`).exists(),
    ).toBe(false);
  });

  it('click cast button khi sẵn sàng → toast hint + router.push({ path: "/dungeon", query: { talent } })', async () => {
    // Phase 11.7.F — push với query.talent để DungeonView pre-select +
    // highlight button trong action panel (UX continuity Loadout → combat).
    const active = activeTalents()[0];
    if (!active) throw new Error('catalog missing active talent');
    talentsState.learned = new Map([[active.key, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[active.key, 0]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(
      `[data-testid="talent-active-cast-${active.key}"]`,
    );
    await btn.trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text: expect.stringContaining(active.name),
      }),
    );
    expect(pushMock).toHaveBeenCalledWith({
      path: '/dungeon',
      query: { talent: active.key },
    });
  });

  it('click cast button KHI cooldown > 0 → KHÔNG toast, KHÔNG push (gate)', async () => {
    const active = activeTalents()[0];
    if (!active) throw new Error('catalog missing active talent');
    talentsState.learned = new Map([[active.key, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[active.key, 5]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(
      `[data-testid="talent-active-cast-${active.key}"]`,
    );
    // Disabled button — Vue test utils trigger vẫn fire onClick handler nhưng
    // handler tự early-return. Verify không toast và không navigate.
    await btn.trigger('click');
    await flushPromises();
    expect(toastPushMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('sort: ready (cd=0) trước, sau đó cooldown nhỏ → lớn, rồi key ascending', async () => {
    const active = activeTalents().slice(0, 3);
    if (active.length < 3) throw new Error('catalog cần ≥3 active');
    talentsState.learned = new Map(
      active.map((t) => [t.key, '2024-01-01T00:00:00Z']),
    );
    // Setup: t0 cd=5, t1 cd=0 ready, t2 cd=2.
    // Expected order: t1 (cd=0), t2 (cd=2), t0 (cd=5).
    talentsState.cooldowns = new Map([
      [active[0].key, 5],
      [active[1].key, 0],
      [active[2].key, 2],
    ]);
    const w = mountView();
    await flushPromises();
    const rows = w.findAll('[data-testid^="talent-active-row-"]');
    expect(rows).toHaveLength(3);
    expect(rows[0].attributes('data-testid')).toBe(
      `talent-active-row-${active[1].key}`,
    );
    expect(rows[1].attributes('data-testid')).toBe(
      `talent-active-row-${active[2].key}`,
    );
    expect(rows[2].attributes('data-testid')).toBe(
      `talent-active-row-${active[0].key}`,
    );
  });
});

describe('TalentCatalogView — Phase 11.7.G Loadout sticky + element filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  function activeTalents() {
    return TALENTS.filter((t) => t.type === 'active');
  }

  it('Loadout section có sticky CSS class (md:sticky md:top-0 md:z-10) cho desktop', async () => {
    const w = mountView();
    await flushPromises();
    const section = w.find('[data-testid="talents-active-section"]');
    expect(section.exists()).toBe(true);
    const cls = section.attributes('class') ?? '';
    expect(cls).toContain('md:sticky');
    expect(cls).toContain('md:top-0');
    expect(cls).toContain('md:z-10');
  });

  it('filter row chỉ render khi đã học ≥ 1 active talent (ẩn ở empty state)', async () => {
    // Empty state: chưa học → filter row KHÔNG render.
    const w1 = mountView();
    await flushPromises();
    expect(w1.find('[data-testid="talents-active-filter-row"]').exists()).toBe(
      false,
    );

    // Học 1 active → filter row render.
    const active = activeTalents()[0];
    if (!active) throw new Error('catalog missing active talent');
    talentsState.learned = new Map([[active.key, '2024-01-01T00:00:00Z']]);
    const w2 = mountView();
    await flushPromises();
    expect(w2.find('[data-testid="talents-active-filter-row"]').exists()).toBe(
      true,
    );
    expect(
      w2.find('[data-testid="talents-active-filter-element"]').exists(),
    ).toBe(true);
  });

  it('default filter=all → render đủ active talent đã học', async () => {
    const learned = activeTalents().slice(0, 3);
    if (learned.length < 3) throw new Error('catalog cần ≥3 active');
    talentsState.learned = new Map(
      learned.map((t) => [t.key, '2024-01-01T00:00:00Z']),
    );
    const w = mountView();
    await flushPromises();
    const rows = w.findAll('[data-testid^="talent-active-row-"]');
    expect(rows).toHaveLength(3);
    // Count reflects filtered length = 3.
    expect(w.find('[data-testid="talents-active-count"]').text()).toContain(
      '3',
    );
  });

  it('filter=kim → chỉ render active learned hệ kim, count update', async () => {
    const kimActive = activeTalents().find((t) => t.element === 'kim');
    const mocActive = activeTalents().find((t) => t.element === 'moc');
    if (!kimActive || !mocActive) {
      throw new Error('catalog cần ít nhất 1 active kim + 1 active moc');
    }
    talentsState.learned = new Map([
      [kimActive.key, '2024-01-01T00:00:00Z'],
      [mocActive.key, '2024-01-01T00:00:00Z'],
    ]);
    const w = mountView();
    await flushPromises();

    // Trước filter: 2 row, count = 2.
    expect(w.findAll('[data-testid^="talent-active-row-"]')).toHaveLength(2);

    await w
      .find('[data-testid="talents-active-filter-element"]')
      .setValue('kim');
    await flushPromises();

    const rows = w.findAll('[data-testid^="talent-active-row-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes('data-testid')).toBe(
      `talent-active-row-${kimActive.key}`,
    );
    expect(w.find('[data-testid="talents-active-count"]').text()).toContain(
      '1',
    );
  });

  it('filter=neutral → chỉ render active learned có element null', async () => {
    const neutralActive = activeTalents().find((t) => t.element === null);
    const elementalActive = activeTalents().find((t) => t.element !== null);
    if (!neutralActive || !elementalActive) {
      throw new Error('catalog cần ít nhất 1 active neutral + 1 elemental');
    }
    talentsState.learned = new Map([
      [neutralActive.key, '2024-01-01T00:00:00Z'],
      [elementalActive.key, '2024-01-01T00:00:00Z'],
    ]);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="talents-active-filter-element"]')
      .setValue('neutral');
    await flushPromises();
    const rows = w.findAll('[data-testid^="talent-active-row-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes('data-testid')).toBe(
      `talent-active-row-${neutralActive.key}`,
    );
  });

  it('filter loại trừ tất cả → render filter-empty message thay vì list', async () => {
    // Học chỉ 1 active hệ kim, lọc theo hệ moc → 0 match.
    const kimActive = activeTalents().find((t) => t.element === 'kim');
    if (!kimActive) throw new Error('catalog cần active kim');
    talentsState.learned = new Map([[kimActive.key, '2024-01-01T00:00:00Z']]);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="talents-active-filter-element"]')
      .setValue('moc');
    await flushPromises();

    // List ẨN, filter-empty render.
    expect(w.find('[data-testid="talents-active-list"]').exists()).toBe(false);
    expect(
      w.find('[data-testid="talents-active-filter-empty"]').exists(),
    ).toBe(true);
    // Empty (no learned) message KHÔNG render — đã có 1 learned.
    expect(w.find('[data-testid="talents-active-empty"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-testid="talents-active-count"]').text()).toContain(
      '0',
    );
  });

  it('reset button hidden khi filter=all, hiện khi filter≠all, click reset → filter=all', async () => {
    const kimActive = activeTalents().find((t) => t.element === 'kim');
    if (!kimActive) throw new Error('catalog cần active kim');
    talentsState.learned = new Map([[kimActive.key, '2024-01-01T00:00:00Z']]);
    const w = mountView();
    await flushPromises();

    // Default filter=all → reset button ẨN.
    expect(
      w.find('[data-testid="talents-active-filter-reset"]').exists(),
    ).toBe(false);

    // Set filter=hoa → reset button HIỆN.
    await w
      .find('[data-testid="talents-active-filter-element"]')
      .setValue('hoa');
    await flushPromises();
    const resetBtn = w.find('[data-testid="talents-active-filter-reset"]');
    expect(resetBtn.exists()).toBe(true);

    // Click reset → filter=all, list về full lại + reset button ẨN.
    await resetBtn.trigger('click');
    await flushPromises();
    expect(
      w.find('[data-testid="talents-active-filter-reset"]').exists(),
    ).toBe(false);
    const select = w.find('[data-testid="talents-active-filter-element"]')
      .element as HTMLSelectElement;
    expect(select.value).toBe('all');
  });

  it('filter giữ sort order ready trước, cooldown asc giữa active cùng hệ', async () => {
    const kimActives = activeTalents().filter((t) => t.element === 'kim');
    if (kimActives.length < 2) {
      // Catalog có thể chỉ có 1 active kim — fall back: skip-style assert.
      return;
    }
    const [a, b] = kimActives;
    // a cd=3, b cd=0 → expect b trước a.
    talentsState.learned = new Map([
      [a.key, '2024-01-01T00:00:00Z'],
      [b.key, '2024-01-01T00:00:00Z'],
    ]);
    talentsState.cooldowns = new Map([
      [a.key, 3],
      [b.key, 0],
    ]);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="talents-active-filter-element"]')
      .setValue('kim');
    await flushPromises();
    const rows = w.findAll('[data-testid^="talent-active-row-"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].attributes('data-testid')).toBe(
      `talent-active-row-${b.key}`,
    );
    expect(rows[1].attributes('data-testid')).toBe(
      `talent-active-row-${a.key}`,
    );
  });
});
