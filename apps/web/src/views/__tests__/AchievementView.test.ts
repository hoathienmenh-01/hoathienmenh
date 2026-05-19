import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { AchievementDef } from '@xuantoi/shared';

/**
 * Phase 11.10.E — AchievementView test suite.
 *
 * Bao phủ:
 *   - Loading khi store chưa loaded.
 *   - Render đầy đủ row từ store.
 *   - Filter category / tier / status.
 *   - Empty state khi filter không khớp.
 *   - Status badge (claimed/unclaimed/inProgress) đúng.
 *   - Progress bar % đúng.
 *   - Claim button 4 trạng thái: claim / claiming / claimed / locked.
 *   - Click claim → store.claim called + toast feedback.
 */

const replaceMock = vi.fn();
const claimMock = vi.fn();
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();

interface RowStub {
  achievementKey: string;
  progress: number;
  completedAt: string | null;
  claimedAt: string | null;
  def: AchievementDef;
}

const DEF_BRONZE_COMBAT: AchievementDef = {
  key: 'first_monster_kill',
  nameVi: 'Sơ Sát',
  nameEn: 'First Blood',
  description: 'desc',
  category: 'combat',
  tier: 'bronze',
  goalKind: 'KILL_MONSTER',
  goalAmount: 1,
  element: null,
  rewardTitleKey: 'achievement_first_kill',
  reward: { linhThach: 100, exp: 50 },
  hidden: false,
};

const DEF_SILVER_CULTIVATION: AchievementDef = {
  key: 'first_breakthrough',
  nameVi: 'Phá cảnh',
  nameEn: 'First BT',
  description: 'desc',
  category: 'cultivation',
  tier: 'silver',
  goalKind: 'BREAKTHROUGH',
  goalAmount: 1,
  element: null,
  rewardTitleKey: null,
  reward: { tienNgoc: 5 },
  hidden: false,
};

const DEF_GOLD_COMBAT_FIRE: AchievementDef = {
  key: 'kill_100_monsters',
  nameVi: 'Bách Sát',
  nameEn: 'Hundred',
  description: 'desc',
  category: 'combat',
  tier: 'gold',
  goalKind: 'KILL_MONSTER',
  goalAmount: 100,
  element: 'hoa',
  rewardTitleKey: null,
  reward: { linhThach: 500 },
  hidden: false,
};

const ROW_UNCLAIMED: RowStub = {
  achievementKey: 'first_monster_kill',
  progress: 1,
  completedAt: '2026-01-01T00:00:00.000Z',
  claimedAt: null,
  def: DEF_BRONZE_COMBAT,
};

const ROW_CLAIMED: RowStub = {
  achievementKey: 'first_breakthrough',
  progress: 1,
  completedAt: '2026-01-02T00:00:00.000Z',
  claimedAt: '2026-01-02T00:01:00.000Z',
  def: DEF_SILVER_CULTIVATION,
};

const ROW_IN_PROGRESS: RowStub = {
  achievementKey: 'kill_100_monsters',
  progress: 30,
  completedAt: null,
  claimedAt: null,
  def: DEF_GOLD_COMBAT_FIRE,
};

interface AchStoreStub {
  rows: RowStub[];
  loaded: boolean;
  inFlight: Set<string>;
  lastClaim: unknown;
  completedCount: number;
  claimableCount: number;
  // Phase 11.10.F — derived getters mirror Pinia computed.
  readonly totalCount: number;
  readonly claimedCount: number;
  readonly lockedCount: number;
  fetchState: typeof fetchStateMock;
  isClaiming: (k: string) => boolean;
  findRow: (k: string) => RowStub | undefined;
  claim: typeof claimMock;
  reset: () => void;
}

const achState: AchStoreStub = {
  rows: [ROW_UNCLAIMED, ROW_CLAIMED, ROW_IN_PROGRESS],
  loaded: true,
  inFlight: new Set<string>(),
  lastClaim: null,
  completedCount: 2,
  claimableCount: 1,
  get totalCount(): number {
    return this.rows.length;
  },
  get claimedCount(): number {
    return this.rows.filter((r) => r.claimedAt !== null).length;
  },
  get lockedCount(): number {
    return this.rows.filter((r) => r.completedAt === null).length;
  },
  fetchState: fetchStateMock,
  isClaiming: (k: string) => achState.inFlight.has(k),
  findRow: (k: string) => achState.rows.find((r) => r.achievementKey === k),
  claim: claimMock,
  reset: vi.fn(),
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
  }),
}));
vi.mock('@/stores/achievements', () => ({
  useAchievementsStore: () => achState,
}));
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({
    push: toastPushMock,
  }),
}));
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

import AchievementView from '@/views/AchievementView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      achievements: {
        title: 'Thành Tựu',
        subtitle: 'sub',
        loading: 'Đang tải',
        empty: 'Trống',
        summary: 'Hoàn thành: {completed} • Có thể nhận: {claimable}',
        stats: {
          label: 'Tổng kết:',
          total: 'Tổng {count}',
          locked: 'Chưa đạt {count}',
          claimable: 'Có thể nhận {count}',
          claimed: 'Đã nhận {count}',
        },
        filter: {
          category: 'Phân loại',
          tier: 'Bậc',
          status: 'Trạng thái',
          all: 'Tất cả',
          shown: '{shown}/{total} ({catalog})',
        },
        category: {
          combat: 'Chiến đấu',
          cultivation: 'Tu luyện',
          exploration: 'Thám hiểm',
          social: 'Xã giao',
          economy: 'Kinh tế',
          milestone: 'Cột mốc',
          collection: 'Sưu tầm',
        },
        tier: {
          bronze: 'Đồng',
          silver: 'Bạc',
          gold: 'Vàng',
          platinum: 'Bạch Kim',
          diamond: 'Kim Cương',
        },
        status: {
          completed: 'Hoàn thành',
          unclaimed: 'Có thể nhận',
          inProgress: 'Đang tiến hành',
          claimed: 'Đã nhận',
        },
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thuỷ',
          hoa: 'Hoả',
          tho: 'Thổ',
          loi: 'Lôi',
          phong: 'Phong',
          bang: 'Băng',
          doc: 'Độc',
          am: 'Âm',
          duong: 'Dương',
          hon_don: 'Hỗn Độn',
        },
        field: {
          reward: 'Thưởng',
        },
        reward: {
          linhThach: 'Linh Thạch',
          tienNgoc: 'Tiên Ngọc',
          exp: 'EXP',
          title: 'Danh hiệu',
          items: '{count} vật phẩm',
        },
        button: {
          claim: 'Nhận',
          claiming: 'Đang nhận…',
          claimed: 'Đã nhận',
          locked: 'Chưa hoàn thành',
        },
        claim: {
          success: 'Đã nhận {name}',
          errors: {
            ALREADY_CLAIMED: 'Đã nhận rồi',
            NOT_COMPLETED: 'Chưa hoàn thành',
            UNKNOWN: 'Lỗi',
          },
        },
        roleHint: 'Theo dõi và nhận thưởng thành tựu.',
        crossNav: {
          label: 'Đi nhanh',
          missions: 'Nhiệm vụ',
          leaderboard: 'Bảng xếp hạng',
        },
      },
    },
  },
});

function mountView() {
  return mount(AchievementView, { global: { plugins: [i18n] } });
}

function resetState() {
  achState.rows = [ROW_UNCLAIMED, ROW_CLAIMED, ROW_IN_PROGRESS];
  achState.loaded = true;
  achState.inFlight = new Set();
  achState.completedCount = 2;
  achState.claimableCount = 1;
  claimMock.mockReset();
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  toastPushMock.mockClear();
}

describe('AchievementView — render & loading', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị loading khi store.loaded=false', async () => {
    achState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="achievements-loading"]').exists()).toBe(true);
    expect(w.find('[data-testid="achievements-list"]').exists()).toBe(false);
  });

  it('render đủ achievement sau khi loaded', async () => {
    const w = mountView();
    await flushPromises();
    const cards = w.findAll('[data-testid^="achievements-card-"]');
    expect(cards).toHaveLength(3);
  });

  it('summary header reflect completedCount + claimableCount', async () => {
    const w = mountView();
    await flushPromises();
    const txt = w.find('[data-testid="achievements-summary"]').text();
    expect(txt).toContain('Hoàn thành: 2');
    expect(txt).toContain('Có thể nhận: 1');
  });

  it('tier badge và category badge render', async () => {
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="achievements-tier-first_monster_kill"]').text(),
    ).toBe('Đồng');
    expect(
      w.find('[data-testid="achievements-category-first_monster_kill"]').text(),
    ).toBe('Chiến đấu');
  });

  it('element badge chỉ render khi def.element không null', async () => {
    const w = mountView();
    await flushPromises();
    // first_monster_kill: element=null → no element badge
    expect(
      w.find('[data-testid="achievements-element-first_monster_kill"]').exists(),
    ).toBe(false);
    // kill_100_monsters: element=hoa → element badge
    expect(
      w.find('[data-testid="achievements-element-kill_100_monsters"]').text(),
    ).toBe('Hoả');
  });

  it('progress bar text reflect progress/goalAmount', async () => {
    const w = mountView();
    await flushPromises();
    expect(
      w
        .find('[data-testid="achievements-progress-text-kill_100_monsters"]')
        .text(),
    ).toBe('30/100');
    expect(
      w
        .find('[data-testid="achievements-progress-text-first_monster_kill"]')
        .text(),
    ).toBe('1/1');
  });
});

describe('AchievementView — filter', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('filter category=cultivation → chỉ render cultivation', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="achievements-filter-category"]')
      .setValue('cultivation');
    await flushPromises();
    const cards = w.findAll('[data-testid^="achievements-card-"]');
    expect(cards).toHaveLength(1);
    expect(
      w.find('[data-testid="achievements-card-first_breakthrough"]').exists(),
    ).toBe(true);
  });

  it('filter tier=gold → chỉ render gold', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="achievements-filter-tier"]').setValue('gold');
    await flushPromises();
    expect(
      w.find('[data-testid="achievements-card-kill_100_monsters"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="achievements-card-first_monster_kill"]').exists(),
    ).toBe(false);
  });

  it('filter status=unclaimed → chỉ render row có completedAt + claimedAt=null', async () => {
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="achievements-filter-status"]')
      .setValue('unclaimed');
    await flushPromises();
    const cards = w.findAll('[data-testid^="achievements-card-"]');
    expect(cards).toHaveLength(1);
    expect(
      w.find('[data-testid="achievements-card-first_monster_kill"]').exists(),
    ).toBe(true);
  });

  it('filter status=claimed kèm category=cultivation → chỉ ROW_CLAIMED', async () => {
    const w = mountView();
    await flushPromises();
    // status=completed (gồm cả claimed)
    await w
      .find('[data-testid="achievements-filter-status"]')
      .setValue('completed');
    await w
      .find('[data-testid="achievements-filter-category"]')
      .setValue('cultivation');
    await flushPromises();
    const cards = w.findAll('[data-testid^="achievements-card-"]');
    expect(cards).toHaveLength(1);
    expect(
      w.find('[data-testid="achievements-card-first_breakthrough"]').exists(),
    ).toBe(true);
  });

  it('filter rỗng kết quả → empty state', async () => {
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="achievements-filter-tier"]').setValue('diamond');
    await flushPromises();
    expect(w.find('[data-testid="achievements-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="achievements-list"]').exists()).toBe(false);
  });
});

describe('AchievementView — claim button', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('button cho row đã claimed → disabled + label "Đã nhận"', async () => {
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="achievements-claim-first_breakthrough"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    expect(btn.text()).toContain('Đã nhận');
  });

  it('button cho row inProgress → disabled + label "Chưa hoàn thành"', async () => {
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="achievements-claim-kill_100_monsters"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    expect(btn.text()).toContain('Chưa hoàn thành');
  });

  it('button cho row unclaimed → enabled + label "Nhận"', async () => {
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="achievements-claim-first_monster_kill"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
    expect(btn.text()).toContain('Nhận');
  });

  it('click claim → store.claim called với key + toast success khi err=null', async () => {
    claimMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="achievements-claim-first_monster_kill"]')
      .trigger('click');
    await flushPromises();
    expect(claimMock).toHaveBeenCalledWith('first_monster_kill');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('click claim → toast error khi server reject với code', async () => {
    claimMock.mockResolvedValueOnce('ALREADY_CLAIMED');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="achievements-claim-first_monster_kill"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Đã nhận rồi' }),
    );
  });

  it('click claim → toast UNKNOWN fallback khi code không có i18n key', async () => {
    claimMock.mockResolvedValueOnce('SOMETHING_NEW');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="achievements-claim-first_monster_kill"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', text: 'Lỗi' }),
    );
  });

  it('button khi claim đang in-flight → disabled', async () => {
    achState.inFlight = new Set(['first_monster_kill']);
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="achievements-claim-first_monster_kill"]');
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    expect(btn.text()).toContain('Đang nhận');
  });
});

/** Phase 11.10.F — stats summary 4-badge UI. */
describe('AchievementView — Phase 11.10.F stats summary', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('không render stats khi loaded=false', async () => {
    achState.loaded = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="achievements-stats"]').exists()).toBe(false);
  });

  it('không render stats khi rows empty (totalCount=0)', async () => {
    achState.rows = [];
    achState.loaded = true;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="achievements-stats"]').exists()).toBe(false);
  });

  it('render 4 stats badge (total/locked/claimable/claimed) khi có rows', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="achievements-stats"]').exists()).toBe(true);
    expect(
      w.find('[data-testid="achievements-stats-total"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="achievements-stats-locked"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="achievements-stats-claimable"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="achievements-stats-claimed"]').exists(),
    ).toBe(true);
  });

  it('counts đúng cho mix rows: total=3, locked=1, claimable=1, claimed=1', async () => {
    // resetState rows = [ROW_UNCLAIMED, ROW_CLAIMED, ROW_IN_PROGRESS]
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="achievements-stats-total"]').text(),
    ).toContain('3');
    expect(
      w.find('[data-testid="achievements-stats-locked"]').text(),
    ).toContain('1');
    expect(
      w.find('[data-testid="achievements-stats-claimable"]').text(),
    ).toContain('1');
    expect(
      w.find('[data-testid="achievements-stats-claimed"]').text(),
    ).toContain('1');
  });

  it('counts cập nhật khi rows thay đổi', async () => {
    achState.rows = [ROW_UNCLAIMED];
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="achievements-stats-total"]').text(),
    ).toContain('1');
    expect(
      w.find('[data-testid="achievements-stats-claimable"]').text(),
    ).toContain('1');
    expect(
      w.find('[data-testid="achievements-stats-locked"]').text(),
    ).toContain('0');
  });

  it('stats render trên filter section (DOM order)', async () => {
    const w = mountView();
    await flushPromises();
    const stats = w.find('[data-testid="achievements-stats"]').element;
    const filterCat = w.find('[data-testid="achievements-filter-category"]')
      .element;
    expect(stats).toBeTruthy();
    expect(filterCat).toBeTruthy();
    const pos = stats.compareDocumentPosition(filterCat);
    // Filter is descendant-and-following, so result includes
    // DOCUMENT_POSITION_FOLLOWING (4). Use simple ordering check.
    expect(pos === Node.DOCUMENT_POSITION_FOLLOWING).toBe(true);
  });
});

describe('AchievementView — role hint + cross-nav', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="achievement-role-section"]').exists()).toBe(true);
    expect(w.find('[data-testid="achievement-role-hint"]').text()).toBeTruthy();
  });

  it('render cross-nav với link đúng', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="achievement-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="achievement-cross-nav-missions"]').exists()).toBe(true);
    expect(w.find('[data-testid="achievement-cross-nav-leaderboard"]').exists()).toBe(true);
  });
});
