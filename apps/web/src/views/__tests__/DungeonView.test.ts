import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { EncounterView } from '@/api/combat';

/**
 * DungeonView smoke tests (session 9j task H / K3.6): cover auth/unauth
 * routing, dungeon list render, start encounter flow (success + error map +
 * submitting guard), action flow (WON reward toast + LOST warning toast +
 * error submitting guard), abandon flow (success toast + error map), unknown
 * error fallback UNKNOWN.
 *
 * DungeonView đụng **currency reward** (exp + linhThach) qua `performAction`
 * status=WON — regression có thể làm mất reward của người chơi. Thêm test
 * để lock flow xuống.
 */

const listDungeonsMock = vi.fn();
const getActiveEncounterMock = vi.fn();
const startEncounterMock = vi.fn();
const performActionMock = vi.fn();
const abandonEncounterMock = vi.fn();

vi.mock('@/api/combat', async () => {
  const actual = await vi.importActual<typeof import('@/api/combat')>('@/api/combat');
  return {
    ...actual,
    listDungeons: (...a: unknown[]) => listDungeonsMock(...a),
    getActiveEncounter: (...a: unknown[]) => getActiveEncounterMock(...a),
    startEncounter: (...a: unknown[]) => startEncounterMock(...a),
    performAction: (...a: unknown[]) => performActionMock(...a),
    abandonEncounter: (...a: unknown[]) => abandonEncounterMock(...a),
  };
});

const routerReplaceMock = vi.fn();
const routerPushMock = vi.fn().mockResolvedValue(undefined);
const routeQueryMock: { value: Record<string, string | string[] | undefined> } = {
  value: {},
};
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
  useRoute: () => ({
    get query() {
      return routeQueryMock.value;
    },
  }),
  RouterLink: {
    name: 'RouterLinkStub',
    props: ['to'],
    template: '<a :href="to"><slot /></a>',
  },
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

const gameState: { character: { sectKey: string; stamina: number } | null } = {
  character: { sectKey: 'thanh_van', stamina: 100 },
};
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    get character() {
      return gameState.character;
    },
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: { name: 'AppShell', template: '<div><slot /></div>' },
}));

// Phase 11.7.F — Mock talents store. `learned` Map<key, learnedAt> +
// `cooldowns` Map<key, turnsRemaining>. Test có thể set state trước khi mount
// để verify buttons render + cooldown badge + preselect highlight.
const talentsState: {
  learned: Map<string, string>;
  cooldowns: Map<string, number>;
} = {
  learned: new Map(),
  cooldowns: new Map(),
};
const talentsFetchStateMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/stores/talents', () => ({
  useTalentsStore: () => ({
    isLearned: (key: string) => talentsState.learned.has(key),
    cooldownOf: (key: string) => talentsState.cooldowns.get(key) ?? 0,
    fetchState: (...a: unknown[]) => talentsFetchStateMock(...a),
  }),
}));

import DungeonViewComponent from '@/views/DungeonView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { reload: 'Tải lại' },
      dungeon: {
        title: 'Bí cảnh',
        enter: 'Vào',
        inFight: 'Đang chiến',
        monsterCount: '{n} quái',
        staminaEntry: 'Thể lực {stam}',
        startToast: 'Vào {name}',
        rewardToast: 'Thắng: +{exp} EXP, +{linh} linh thạch',
        lostToast: 'Đã bại trận',
        abandonToast: 'Bỏ chạy thành công',
        retreat: 'Bỏ chạy',
        ended: 'Trận đã kết thúc',
        noFight: 'Chưa có trận',
        counter: '{cur} / {total}',
        errors: {
          NO_STAMINA: 'Không đủ thể lực',
          IN_FIGHT: 'Đang trong trận',
          UNKNOWN: 'Lỗi không rõ',
        },
        talents: {
          title: 'Thần thông chủ động',
          cooldownLabel: 'CD {turns}',
          preselected: 'Loadout',
        },
      },
    },
  },
});

function makeDungeon(overrides: Partial<{ key: string; name: string; staminaEntry: number }> = {}) {
  return {
    key: overrides.key ?? 'linh_nguyen',
    name: overrides.name ?? 'Linh Nguyên Đạo Tràng',
    description: 'Nơi tu luyện của tân thủ',
    recommendedRealm: 'luyen_khi_1',
    monsters: [
      { key: 'yeu_thu', name: 'Yêu Thú', hp: 100, atk: 10, def: 5 },
      { key: 'yeu_thu_2', name: 'Yêu Thú 2', hp: 120, atk: 12, def: 6 },
    ],
    staminaEntry: overrides.staminaEntry ?? 10,
  };
}

function makeEncounter(overrides: Partial<EncounterView> = {}): EncounterView {
  const base: EncounterView = {
    id: 'enc1',
    dungeon: makeDungeon() as unknown as EncounterView['dungeon'],
    status: 'ACTIVE',
    monster: {
      key: 'yeu_thu',
      name: 'Yêu Thú',
      hp: 100,
      atk: 10,
      def: 5,
    } as unknown as EncounterView['monster'],
    monsterHp: 100,
    monsterIndex: 0,
    log: [],
    reward: null,
  };
  return { ...base, ...overrides } as EncounterView;
}

function mountView() {
  return mount(DungeonViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listDungeonsMock.mockReset();
  getActiveEncounterMock.mockReset();
  startEncounterMock.mockReset();
  performActionMock.mockReset();
  abandonEncounterMock.mockReset();
  routerReplaceMock.mockReset();
  routerPushMock.mockReset();
  routerPushMock.mockResolvedValue(undefined);
  routeQueryMock.value = {};
  toastPushMock.mockReset();
  talentsState.learned = new Map();
  talentsState.cooldowns = new Map();
  talentsFetchStateMock.mockReset();
  talentsFetchStateMock.mockResolvedValue(undefined);
  gameState.character = { sectKey: 'thanh_van', stamina: 100 };
  authState.isAuthenticated = true;
  authState.hydrate.mockReset();
  authState.hydrate.mockResolvedValue(undefined);
});

describe('DungeonView — onMounted routing', () => {
  it('unauth → replace /auth + không gọi listDungeons', async () => {
    authState.isAuthenticated = false;
    mountView();
    await flushPromises();
    expect(routerReplaceMock).toHaveBeenCalledWith('/auth');
    expect(listDungeonsMock).not.toHaveBeenCalled();
  });

  it('auth → listDungeons + getActiveEncounter được gọi', async () => {
    listDungeonsMock.mockResolvedValue([makeDungeon()]);
    getActiveEncounterMock.mockResolvedValue(null);
    mountView();
    await flushPromises();
    expect(listDungeonsMock).toHaveBeenCalled();
    expect(getActiveEncounterMock).toHaveBeenCalled();
  });

  it('render dungeon list: hiện name + stamina cost', async () => {
    listDungeonsMock.mockResolvedValue([makeDungeon({ name: 'Test Dungeon', staminaEntry: 15 })]);
    getActiveEncounterMock.mockResolvedValue(null);
    const w = mountView();
    await flushPromises();
    expect(w.text()).toContain('Test Dungeon');
    expect(w.text()).toContain('Thể lực 15');
  });
});

describe('DungeonView — start encounter flow', () => {
  beforeEach(() => {
    listDungeonsMock.mockResolvedValue([makeDungeon()]);
    getActiveEncounterMock.mockResolvedValue(null);
  });

  it('success: startEncounter(key) + toast success', async () => {
    startEncounterMock.mockResolvedValue(makeEncounter());
    const w = mountView();
    await flushPromises();
    const enterBtn = w.findAll('button').find((b) => b.text() === 'Vào')!;
    await enterBtn.trigger('click');
    await flushPromises();

    expect(startEncounterMock).toHaveBeenCalledWith('linh_nguyen');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'success',
      text: 'Vào Linh Nguyên Đạo Tràng',
    });
  });

  it('stamina thấp < staminaEntry → button disabled', async () => {
    gameState.character = { sectKey: 'thanh_van', stamina: 5 };
    const w = mountView();
    await flushPromises();
    const enterBtn = w.findAll('button').find((b) => b.text() === 'Vào')!;
    expect(enterBtn.attributes('disabled')).toBeDefined();
  });

  it('error NO_STAMINA → toast dungeon.errors.NO_STAMINA', async () => {
    startEncounterMock.mockRejectedValue(
      Object.assign(new Error('no stamina'), { code: 'NO_STAMINA' }),
    );
    const w = mountView();
    await flushPromises();
    await (w.findAll('button').find((b) => b.text() === 'Vào')!).trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Không đủ thể lực',
    });
  });

  it('error code lạ → fallback dungeon.errors.UNKNOWN', async () => {
    startEncounterMock.mockRejectedValue(
      Object.assign(new Error('weird'), { code: 'MONSTER_RAGE' }),
    );
    const w = mountView();
    await flushPromises();
    await (w.findAll('button').find((b) => b.text() === 'Vào')!).trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Lỗi không rõ',
    });
  });

  it('submitting guard: click lần 2 trong khi pending → chỉ 1 call', async () => {
    const resolveHolder: {
      current: ((v: EncounterView) => void) | null;
    } = { current: null };
    startEncounterMock.mockImplementation(
      () =>
        new Promise<EncounterView>((resolve) => {
          resolveHolder.current = resolve;
        }),
    );
    const w = mountView();
    await flushPromises();
    const enterBtn = w.findAll('button').find((b) => b.text() === 'Vào')!;
    await enterBtn.trigger('click');
    await flushPromises();
    await enterBtn.trigger('click');
    await flushPromises();

    expect(startEncounterMock).toHaveBeenCalledTimes(1);
    resolveHolder.current?.(makeEncounter());
  });
});

describe('DungeonView — action flow (reward safety)', () => {
  beforeEach(() => {
    listDungeonsMock.mockResolvedValue([makeDungeon()]);
    getActiveEncounterMock.mockResolvedValue(makeEncounter({ status: 'ACTIVE' }));
  });

  it('WON → toast system với exp + linhThach (reward safety)', async () => {
    performActionMock.mockResolvedValue(
      makeEncounter({
        status: 'WON',
        reward: { exp: '100', linhThach: '50' },
      }),
    );
    const w = mountView();
    await flushPromises();
    // Click basic attack (first skill button in encounter panel)
    const skillBtns = w.findAll('button').filter((b) =>
      b.text() !== 'Vào' &&
      b.text() !== 'Đang chiến' &&
      b.text() !== 'Tải lại' &&
      b.attributes('disabled') === undefined,
    );
    // Find a skill button (not start/reload button)
    const skillBtn = skillBtns.find((b) => b.text().length > 0 && !b.text().includes('Đang chiến'));
    expect(skillBtn).toBeDefined();
    await skillBtn!.trigger('click');
    await flushPromises();

    expect(performActionMock).toHaveBeenCalled();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Thắng: +100 EXP, +50 linh thạch',
    });
  });

  it('LOST → toast warning', async () => {
    performActionMock.mockResolvedValue(
      makeEncounter({ status: 'LOST', reward: null }),
    );
    const w = mountView();
    await flushPromises();
    const skillBtns = w.findAll('button').filter((b) =>
      b.text() !== 'Vào' &&
      b.text() !== 'Đang chiến' &&
      b.text() !== 'Tải lại' &&
      b.attributes('disabled') === undefined,
    );
    const skillBtn = skillBtns.find((b) => b.text().length > 0);
    await skillBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'warning',
      text: 'Đã bại trận',
    });
  });

  it('action error → toast error map', async () => {
    performActionMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'IN_FIGHT' }),
    );
    const w = mountView();
    await flushPromises();
    const skillBtns = w.findAll('button').filter((b) =>
      b.text() !== 'Vào' &&
      b.text() !== 'Đang chiến' &&
      b.text() !== 'Tải lại' &&
      b.attributes('disabled') === undefined,
    );
    const skillBtn = skillBtns.find((b) => b.text().length > 0);
    await skillBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Đang trong trận',
    });
  });
});

describe('DungeonView — abandon flow', () => {
  beforeEach(() => {
    listDungeonsMock.mockResolvedValue([makeDungeon()]);
    getActiveEncounterMock.mockResolvedValue(makeEncounter({ status: 'ACTIVE' }));
  });

  it('success: abandonEncounter + toast warning', async () => {
    abandonEncounterMock.mockResolvedValue(
      makeEncounter({ status: 'ABANDONED' }),
    );
    const w = mountView();
    await flushPromises();
    const retreatBtn = w.findAll('button').find((b) => b.text() === 'Bỏ chạy')!;
    expect(retreatBtn).toBeDefined();
    await retreatBtn.trigger('click');
    await flushPromises();

    expect(abandonEncounterMock).toHaveBeenCalledWith('enc1');
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'warning',
      text: 'Bỏ chạy thành công',
    });
  });

  it('error → toast error map (abandon flow)', async () => {
    abandonEncounterMock.mockRejectedValue(
      Object.assign(new Error('cant'), { code: 'UNKNOWN' }),
    );
    const w = mountView();
    await flushPromises();
    const retreatBtn = w.findAll('button').find((b) => b.text() === 'Bỏ chạy')!;
    await retreatBtn.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'error',
      text: 'Lỗi không rõ',
    });
  });
});

/**
 * Phase 11.7.F — DungeonView active talent cast buttons + pre-select highlight.
 *
 * Bao phủ:
 * - Talents section CHỈ render khi player có ít nhất 1 active talent đã học.
 * - Talent button click → performAction(encId, talent.key) (treat talentKey
 *   như skillKey; backend Phase 11.7.D phân nhánh skill vs talent path).
 * - Cooldown > 0 → button disabled, click no-op (FE gate; server vẫn re-validate).
 * - Pre-select qua route query.talent → highlight ring amber + badge "Loadout"
 *   chỉ khi talent đã học VÀ cooldown=0.
 * - Pre-select reset sau khi cast thành công (nhằm tránh stale highlight cho
 *   talent đã consume cooldown).
 */
describe('DungeonView — Phase 11.7.F active talent cast + pre-select', () => {
  // Sử dụng `talent_kim_quang_tram` (active, kim, mp 30, cd 3) làm fixture vì
  // talent đầu tiên trong catalog active block + có activeEffect.mpCost rõ.
  const TALENT_KEY = 'talent_kim_quang_tram';
  const TALENT_NAME = 'Kim Quang Trảm';

  beforeEach(() => {
    listDungeonsMock.mockResolvedValue([makeDungeon()]);
    getActiveEncounterMock.mockResolvedValue(makeEncounter({ status: 'ACTIVE' }));
  });

  it('chưa học active talent nào → talents section KHÔNG render', async () => {
    talentsState.learned = new Map();
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-talents-section"]').exists()).toBe(false);
  });

  it('đã học 1 active talent → talents section render + button + label', async () => {
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 0]]);
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="dungeon-talents-section"]').exists()).toBe(true);
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    expect(btn.exists()).toBe(true);
    // Label: name (cd=0) + mp cost.
    expect(btn.text()).toContain(TALENT_NAME);
    expect(btn.text()).toContain('-30 MP');
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('cooldown > 0 → button disabled, label "CD {turns}", click no-op', async () => {
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 2]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    expect(btn.attributes('disabled')).toBeDefined();
    // Label = "CD 2" thay vì name.
    expect(btn.text()).toContain('CD 2');
    expect(btn.text()).not.toContain(TALENT_NAME);
    await btn.trigger('click');
    await flushPromises();
    expect(performActionMock).not.toHaveBeenCalled();
  });

  it('click talent button khi cd=0 → performAction(encId, talentKey) + sync talents store', async () => {
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 0]]);
    performActionMock.mockResolvedValue(
      makeEncounter({ status: 'ACTIVE' }),
    );
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    await btn.trigger('click');
    await flushPromises();
    expect(performActionMock).toHaveBeenCalledWith('enc1', TALENT_KEY);
    // Sync cooldown state sau cast.
    expect(talentsFetchStateMock).toHaveBeenCalled();
  });

  it('cast WON → toast reward (cùng path với skill cast)', async () => {
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 0]]);
    performActionMock.mockResolvedValue(
      makeEncounter({
        status: 'WON',
        reward: { exp: '200', linhThach: '100' },
      }),
    );
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    await btn.trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith({
      type: 'system',
      text: 'Thắng: +200 EXP, +100 linh thạch',
    });
  });

  it('route query.talent + cd=0 → highlight ring + badge "Loadout"', async () => {
    routeQueryMock.value = { talent: TALENT_KEY };
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 0]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    expect(btn.classes()).toContain('ring-amber-300');
    expect(
      w.find('[data-testid="dungeon-talent-preselect-badge"]').exists(),
    ).toBe(true);
    // Refresh talents store khi mount với query.talent (pre-select path).
    expect(talentsFetchStateMock).toHaveBeenCalled();
  });

  it('route query.talent + cd > 0 → KHÔNG highlight (gate cooldown)', async () => {
    routeQueryMock.value = { talent: TALENT_KEY };
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 3]]);
    const w = mountView();
    await flushPromises();
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    expect(btn.classes()).not.toContain('ring-amber-300');
    expect(
      w.find('[data-testid="dungeon-talent-preselect-badge"]').exists(),
    ).toBe(false);
  });

  it('không có route query.talent → KHÔNG fetchState talents (skip preload)', async () => {
    routeQueryMock.value = {};
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 0]]);
    mountView();
    await flushPromises();
    expect(talentsFetchStateMock).not.toHaveBeenCalled();
  });

  it('cast pre-selected talent → reset preselectedTalentKey (badge biến mất)', async () => {
    routeQueryMock.value = { talent: TALENT_KEY };
    talentsState.learned = new Map([[TALENT_KEY, '2024-01-01T00:00:00Z']]);
    talentsState.cooldowns = new Map([[TALENT_KEY, 0]]);
    performActionMock.mockResolvedValue(
      makeEncounter({ status: 'ACTIVE' }),
    );
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="dungeon-talent-preselect-badge"]').exists(),
    ).toBe(true);
    const btn = w.find(`[data-testid="dungeon-talent-cast-${TALENT_KEY}"]`);
    await btn.trigger('click');
    await flushPromises();
    // Badge biến mất sau khi consume preselect (cast thành công).
    expect(
      w.find('[data-testid="dungeon-talent-preselect-badge"]').exists(),
    ).toBe(false);
  });
});
