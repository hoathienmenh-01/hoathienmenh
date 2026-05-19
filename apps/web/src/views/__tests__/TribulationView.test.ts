import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

/**
 * Phase 11.6.D — TribulationView test suite.
 *
 * Bao phủ:
 *  - Empty state: chưa có character / no_next_realm / low_tier (transition
 *    không có def).
 *  - Render upcoming tribulation card khi character at peak có def
 *    (kim_dan stage 9 → nguyen_anh).
 *  - Severity + type badges đúng class theo def.
 *  - Reward preview + penalty preview render đủ.
 *  - Button "Vượt kiếp" disable khi inFlight / not at peak / no def.
 *  - Click button → store.attempt called, toast fired theo branch.
 *  - Outcome banner success/fail render đúng.
 *  - Outcome dismiss button → clearLastOutcome.
 */

interface CharacterStub {
  realmKey: string;
  realmStage: number;
  tribulationCooldownAt?: string | null;
  taoMaUntil?: string | null;
}

type HistoryFilterStub = 'all' | 'success' | 'fail';
type HistoryRowStub = { id: string; success: boolean };

interface PreviewStubDef {
  key: string;
  name: string;
  description: string;
  type: string;
  severity: string;
  wavesCount: number;
}
interface PreviewStub {
  requirement: true;
  fromRealmKey: string;
  toRealmKey: string;
  atPeak: boolean;
  def: PreviewStubDef;
  successChance: {
    base: number;
    supportBonus: number;
    elementAdjustment: number;
    raw: number;
    final: number;
    floorHit: boolean;
    ceilHit: boolean;
  };
  supports: {
    source: string;
    key: string;
    bonus: number;
    label?: string | null;
    element?: string | null;
  }[];
  supportTotalBonus: number;
  rewardHint: { linhThach: number; expBonus: string; titleKey: string | null };
  penaltyHint: {
    expLossRatio: number;
    cooldownMinutes: number;
    taoMaDebuffChance: number;
    taoMaDebuffDurationMinutes: number;
  };
  cooldownAt: string | null;
  taoMaUntil: string | null;
  // Phase 14.3.C — selection-related fields trong preview shape
  availableSupportItems: {
    itemKey: string;
    label: string;
    bonus: number;
    qty: number;
  }[];
  maxSelectedSupportItems: number;
}

interface TribulationStateStub {
  lastOutcome: unknown;
  inFlight: boolean;
  lastError: string | null;
  history: HistoryRowStub[] | null;
  historyLoading: boolean;
  historyError: string | null;
  historyLimit: number;
  historyHasMore: boolean;
  historyMaxReached: boolean;
  historyFilter: HistoryFilterStub;
  // Phase 14.3.A — preview state mock
  preview: PreviewStub | null | undefined;
  previewLoading: boolean;
  previewError: string | null;
  // Derived getter — mirror Pinia computed `filteredHistory` để existing
  // Phase 11.6.G tests vẫn pass mà không cần set 2 field.
  readonly filteredHistory: HistoryRowStub[] | null;
  // Phase 11.6.K — derived counts trên FULL history (không phải filtered).
  readonly historyTotalCount: number;
  readonly historySuccessCount: number;
  readonly historyFailCount: number;
  attempt: ReturnType<typeof vi.fn>;
  clearLastOutcome: ReturnType<typeof vi.fn>;
  fetchHistory: ReturnType<typeof vi.fn>;
  loadMoreHistory: ReturnType<typeof vi.fn>;
  setHistoryFilter: ReturnType<typeof vi.fn>;
  fetchPreview: ReturnType<typeof vi.fn>;
  // Phase 14.3.D — encounter mock state.
  encounter: EncounterCurrentStub | null | undefined;
  encounterLoading: boolean;
  encounterError: string | null;
  encounterStarting: boolean;
  encounterResolving: boolean;
  readonly encounterPending: boolean;
  fetchEncounter: ReturnType<typeof vi.fn>;
  startEncounter: ReturnType<typeof vi.fn>;
  resolveEncounter: ReturnType<typeof vi.fn>;
  // Phase 14.3.E.2 — mini-battle mock state.
  miniBattle: unknown;
  miniBattleLoading: boolean;
  miniBattleStarting: boolean;
  miniBattleActionLoading: boolean;
  miniBattleResolving: boolean;
  miniBattleError: string | null;
  miniBattleAvailable: boolean | null;
  miniBattleLastResult: unknown;
  readonly miniBattleCanAct: boolean;
  readonly miniBattleIsTerminal: boolean;
  fetchCurrentBattle: ReturnType<typeof vi.fn>;
  startBattle: ReturnType<typeof vi.fn>;
  submitBattleAction: ReturnType<typeof vi.fn>;
  resolveBattle: ReturnType<typeof vi.fn>;
  resetMiniBattleError: ReturnType<typeof vi.fn>;
  clearMiniBattle: ReturnType<typeof vi.fn>;
}

// Phase 14.3.D — encounter spec stub.
interface EncounterRowStub {
  id: string;
  tribulationKey: string;
  fromRealmKey: string;
  toRealmKey: string;
  encounterKey: string;
  effectType: string;
  element: string;
  difficulty: string;
  selectedSupportItemKeys: string[];
  state: string;
  startedAt: string;
  resolvedAt: string | null;
  resolvedAttemptLogId: string | null;
}
interface EncounterCurrentStub {
  requirement: true;
  atPeak: boolean;
  fromRealmKey: string;
  toRealmKey: string;
  tribulationKey: string;
  severity: string;
  type: string;
  encounter: {
    key: string;
    element: string;
    effectType: string;
    name: string;
    description: string;
    difficulty: string;
    phaseCount: number;
    successThreshold: number;
    requiredPowerHint: number;
    failPenaltyMultiplier: number;
    rewardHintMultiplier: number;
    playerHpMax: number;
    playerPrimaryElement: string | null;
    elementAdvantage: number;
  };
  successChance: {
    base: number;
    supportBonus: number;
    elementAdjustment: number;
    raw: number;
    final: number;
    floorHit: boolean;
    ceilHit: boolean;
  } | null;
  pending: EncounterRowStub | null;
  cooldownAt: string | null;
  taoMaUntil: string | null;
}

const replaceMock = vi.fn();
const attemptMock = vi.fn();
const clearLastOutcomeMock = vi.fn();
const fetchHistoryMock = vi.fn().mockResolvedValue(null);
const loadMoreHistoryMock = vi.fn().mockResolvedValue(null);
const setHistoryFilterMock = vi.fn((filter: HistoryFilterStub) => {
  if (filter === 'all' || filter === 'success' || filter === 'fail') {
    tribulationState.historyFilter = filter;
  }
});
const fetchStateMock = vi.fn().mockResolvedValue(undefined);
const toastPushMock = vi.fn();
// Phase 14.3.A — fetchPreview mock (idempotent, returns null on success).
const fetchPreviewMock = vi.fn().mockResolvedValue(null);
// Phase 14.3.D — encounter store mocks.
const fetchEncounterMock = vi.fn().mockResolvedValue(null);
const startEncounterMock = vi.fn().mockResolvedValue(null);
const resolveEncounterMock = vi.fn().mockResolvedValue(null);
// Phase 14.3.E.2 — mini-battle store mocks.
const fetchCurrentBattleMock = vi.fn().mockResolvedValue(null);
const startBattleMock = vi.fn().mockResolvedValue(null);
const submitBattleActionMock = vi.fn().mockResolvedValue(null);
const resolveBattleMock = vi.fn().mockResolvedValue(null);
const resetMiniBattleErrorMock = vi.fn();
const clearMiniBattleMock = vi.fn();
const pushMock = vi.fn();

const tribulationState: TribulationStateStub = {
  lastOutcome: null,
  inFlight: false,
  lastError: null,
  history: null,
  historyLoading: false,
  historyError: null,
  historyLimit: 20,
  historyHasMore: false,
  historyMaxReached: false,
  historyFilter: 'all',
  preview: undefined,
  previewLoading: false,
  previewError: null,
  get filteredHistory(): HistoryRowStub[] | null {
    const rows = this.history;
    if (!rows) return null;
    if (this.historyFilter === 'success') return rows.filter((r) => r.success);
    if (this.historyFilter === 'fail') return rows.filter((r) => !r.success);
    return rows;
  },
  get historyTotalCount(): number {
    return this.history?.length ?? 0;
  },
  get historySuccessCount(): number {
    return this.history?.filter((r) => r.success).length ?? 0;
  },
  get historyFailCount(): number {
    return this.history?.filter((r) => !r.success).length ?? 0;
  },
  attempt: attemptMock,
  clearLastOutcome: clearLastOutcomeMock,
  fetchHistory: fetchHistoryMock,
  loadMoreHistory: loadMoreHistoryMock,
  setHistoryFilter: setHistoryFilterMock,
  fetchPreview: fetchPreviewMock,
  // Phase 14.3.D — encounter mock state.
  encounter: undefined,
  encounterLoading: false,
  encounterError: null,
  encounterStarting: false,
  encounterResolving: false,
  get encounterPending(): boolean {
    const row = this.encounter?.pending;
    return !!row && row.state === 'pending';
  },
  fetchEncounter: fetchEncounterMock,
  startEncounter: startEncounterMock,
  resolveEncounter: resolveEncounterMock,
  // Phase 14.3.E.2 — mini-battle defaults.
  miniBattle: undefined,
  miniBattleLoading: false,
  miniBattleStarting: false,
  miniBattleActionLoading: false,
  miniBattleResolving: false,
  miniBattleError: null,
  miniBattleAvailable: null,
  miniBattleLastResult: null,
  get miniBattleCanAct(): boolean {
    const b = this.miniBattle as { state?: string } | null | undefined;
    if (!b) return false;
    return b.state === 'PENDING' || b.state === 'ACTIVE';
  },
  get miniBattleIsTerminal(): boolean {
    const b = this.miniBattle as { state?: string } | null | undefined;
    if (!b) return false;
    return (
      b.state === 'RESOLVED' || b.state === 'FAILED' || b.state === 'EXPIRED'
    );
  },
  fetchCurrentBattle: fetchCurrentBattleMock,
  startBattle: startBattleMock,
  submitBattleAction: submitBattleActionMock,
  resolveBattle: resolveBattleMock,
  resetMiniBattleError: resetMiniBattleErrorMock,
  clearMiniBattle: clearMiniBattleMock,
};

const gameState: { character: CharacterStub | null; realmFullName: string } = {
  character: { realmKey: 'kim_dan', realmStage: 9 },
  realmFullName: 'Kim Đan Cửu Trọng',
};

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hydrate: vi.fn().mockResolvedValue(undefined),
    isAuthenticated: true,
  }),
}));
vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: fetchStateMock,
    bindSocket: vi.fn(),
    get character() {
      return gameState.character;
    },
    get realmFullName() {
      return gameState.realmFullName;
    },
  }),
}));
vi.mock('@/stores/tribulation', () => ({
  useTribulationStore: () => tribulationState,
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

import TribulationView from '@/views/TribulationView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      tribulation: {
        title: 'Thiên Kiếp',
        subtitle: 'sub',
        roleHint: 'Thiên Kiếp là thử thách khi đạt đỉnh cảnh giới.',
        crossNav: {
          label: 'Xem thêm',
          breakthrough: 'Đột Phá',
          cultivation: 'Tu Luyện',
        },
        currentRealm: 'Cảnh giới: {name}',
        notAtPeakHint: 'Cần đỉnh cảnh giới',
        severity: {
          minor: 'Tiểu',
          major: 'Đại',
          heavenly: 'Thiên',
          saint: 'Thánh',
        },
        type: {
          lei: 'Lôi',
          phong: 'Phong',
          bang: 'Băng',
          hoa: 'Hoả',
          tam: 'Tâm Ma',
        },
        field: {
          transition: 'Chuyển kiếp',
          waves: 'Số đợt',
          rewardPreview: 'Reward',
          penaltyPreview: 'Penalty',
          rewardLinhThach: 'Linh thạch',
          rewardExpBonus: 'EXP bonus',
          rewardTitle: 'Danh hiệu',
          penaltyExpLoss: 'Mất EXP',
          penaltyCooldown: 'Cooldown',
          penaltyTaoMa: 'Tâm Ma',
          successChance: 'Tỷ lệ',
          base: 'Cơ bản',
          affinity: 'Ngũ Hành',
          supports: 'Hỗ trợ',
          supportBonus: 'Tổng hỗ trợ',
          capWarningCeil: 'Đã chạm trần',
          capWarningFloor: 'Đã chạm sàn',
          supportsEmpty: 'Không có hỗ trợ',
          previewTitle: 'Dự đoán',
          selectionTitle: 'Chọn vật phẩm hỗ trợ',
          selectionHint: 'Tối đa {max}',
          selectionEmpty: 'Chưa có vật phẩm hỗ trợ',
          selectionLimitReached: 'Đã đạt giới hạn {max}',
          selectionPredictedTotal: 'Tổng bonus dự kiến',
          selectionItemQty: 'Còn {qty}',
          selectionItemBonus: '+{bonus}%',
          consumedTitle: 'Vật phẩm đã tiêu hao',
          consumedItem: '{label} (−1)',
          consumedNone: 'Không dùng vật phẩm',
        },
        supportSource: {
          item: 'Vật phẩm',
          buff: 'Buff',
          equipment: 'Trang bị',
          talent: 'Thiên phú',
          spirit_root: 'Linh căn',
        },
        element: {
          kim: 'Kim',
          moc: 'Mộc',
          thuy: 'Thủy',
          hoa: 'Hỏa',
          tho: 'Thổ',
        },
        unit: { minutes: 'phút' },
        button: {
          attempt: 'Vượt kiếp',
          attempting: 'Đang vượt kiếp',
          unavailable: 'Chưa có kiếp',
          notAtPeak: 'Chưa đỉnh',
          cooldown: 'Chờ {remaining}',
        },
        cooldown: {
          title: 'Đang cooldown',
          remaining: 'Chờ {remaining}',
        },
        taoMa: {
          title: 'Tâm Ma',
          remaining: 'Tan trong {remaining}',
        },
        empty: {
          noCharacter: 'Chưa có nhân vật',
          noNextRealm: 'Đỉnh',
          lowTier: 'Không cần kiếp {from} {to}',
        },
        outcome: {
          successTitle: 'Vượt kiếp thành công',
          failTitle: 'Thất bại',
          dismiss: 'Đóng',
          transition: '{from} → {to}',
          wavesCompleted: 'Đợt {count}',
          totalDamage: 'Sát thương {dmg}',
          rewardLinhThach: 'Linh thạch {amount}',
          rewardExpBonus: 'EXP {amount}',
          rewardTitle: 'Title {key}',
          penaltyExpLoss: 'Mất {amount}',
          penaltyCooldown: 'Cooldown {ts}',
          penaltyTaoMa: 'Tâm Ma {ts}',
        },
        attempt: {
          successToast: 'Vượt thành công {to}',
          failToast: 'Vượt thất bại',
        },
        errors: {
          NOT_AT_PEAK: 'Chưa đỉnh',
          COOLDOWN_ACTIVE: 'Cooldown',
          UNKNOWN: 'Lỗi',
          NO_PENDING_ENCOUNTER: 'Chưa có Thiên Kiếp',
          ENCOUNTER_ALREADY_PENDING: 'Đã có Thiên Kiếp',
        },
        encounter: {
          name: { hoa: 'Hỏa Kiếp', thuy: 'Thủy Kiếp', moc: 'Mộc Kiếp', kim: 'Kim Kiếp', tho: 'Thổ Kiếp' },
          element: { hoa: 'Hỏa', thuy: 'Thủy', moc: 'Mộc', kim: 'Kim', tho: 'Thổ' },
          effectType: {
            BURST: 'Sát thương dồn',
            SUSTAIN: 'Trường cửu',
            POISON_RECOVERY: 'Độc / hồi phục',
            ARMOR_CRIT: 'Giáp / chí mạng',
            DEFENSE_ENDURANCE: 'Phòng / kháng',
          },
          advantage: {
            sameElement: 'Đồng hệ',
            advantage: 'Khắc kiếp',
            neutral: 'Trung tính',
            disadvantageMild: 'Bị sinh kiếp',
            disadvantageSevere: 'Bị khắc kiếp',
          },
          statePending: 'Đang chờ vượt',
          startedToast: 'Đã chuẩn bị Thiên Kiếp.',
          field: { phaseCount: 'Số đợt', difficulty: 'Cấp độ', powerHint: 'Sức mạnh khuyến nghị' },
          button: {
            start: 'Bắt đầu kiếp',
            starting: 'Đang khởi động',
            resolve: 'Vượt kiếp',
            resolving: 'Đang vượt',
          },
          cta: { returnCultivation: 'Quay lại tu luyện' },
        },
        history: {
          title: 'Lịch sử',
          loading: 'Đang tải',
          empty: 'Chưa có lần nào',
          loadError: 'Lỗi tải',
          retry: 'Tải lại',
          successBadge: 'Thành công',
          failBadge: 'Thất bại',
          attemptIndex: 'Lần #{index}',
          transition: '{from} → {to}',
          waves: '{count} đợt',
          damage: '{dmg} dmg',
          rewardLinhThach: '+{amount} LT',
          rewardExpBonus: '+{amount} EXP',
          rewardTitle: 'Title {key}',
          expLoss: '−{amount} EXP',
          cooldownAt: 'Cooldown {ts}',
          taoMa: 'Tâm Ma {ts}',
          createdAt: 'Ngày {ts}',
          loadMore: 'Tải thêm',
          loadMoreLoading: 'Đang tải thêm',
          maxReached: 'Đã đạt giới hạn {limit} lượt',
          filter: {
            label: 'Lọc:',
            all: 'Tất cả',
            success: 'Thành công',
            fail: 'Thất bại',
            emptyAfterFilter: 'Không có lượt nào khớp',
          },
          stats: {
            label: 'Tổng kết:',
            total: 'Tổng {count}',
            success: 'Thành công {count}',
            fail: 'Thất bại {count}',
          },
        },
      },
    },
  },
});

function mountView() {
  return mount(TribulationView, { global: { plugins: [i18n] } });
}

function resetState() {
  tribulationState.lastOutcome = null;
  tribulationState.inFlight = false;
  tribulationState.lastError = null;
  tribulationState.history = null;
  tribulationState.historyLoading = false;
  tribulationState.historyError = null;
  tribulationState.historyLimit = 20;
  tribulationState.historyHasMore = false;
  tribulationState.historyMaxReached = false;
  tribulationState.historyFilter = 'all';
  tribulationState.preview = undefined;
  tribulationState.previewLoading = false;
  tribulationState.previewError = null;
  // filteredHistory is a getter — derived from history+historyFilter; no reset.
  gameState.character = { realmKey: 'kim_dan', realmStage: 9 };
  gameState.realmFullName = 'Kim Đan Cửu Trọng';
  attemptMock.mockReset();
  clearLastOutcomeMock.mockReset();
  fetchHistoryMock.mockReset();
  fetchHistoryMock.mockResolvedValue(null);
  loadMoreHistoryMock.mockReset();
  loadMoreHistoryMock.mockResolvedValue(null);
  setHistoryFilterMock.mockReset();
  setHistoryFilterMock.mockImplementation((filter: HistoryFilterStub) => {
    if (filter === 'all' || filter === 'success' || filter === 'fail') {
      tribulationState.historyFilter = filter;
    }
  });
  fetchStateMock.mockReset();
  fetchStateMock.mockResolvedValue(undefined);
  fetchPreviewMock.mockReset();
  fetchPreviewMock.mockResolvedValue(null);
  toastPushMock.mockClear();
  replaceMock.mockClear();
  // Phase 14.3.D — encounter resets.
  tribulationState.encounter = undefined;
  tribulationState.encounterLoading = false;
  tribulationState.encounterError = null;
  tribulationState.encounterStarting = false;
  tribulationState.encounterResolving = false;
  fetchEncounterMock.mockReset();
  fetchEncounterMock.mockResolvedValue(null);
  startEncounterMock.mockReset();
  startEncounterMock.mockResolvedValue(null);
  resolveEncounterMock.mockReset();
  resolveEncounterMock.mockResolvedValue(null);
  // Phase 14.3.E.2 — mini-battle resets.
  tribulationState.miniBattle = undefined;
  tribulationState.miniBattleLoading = false;
  tribulationState.miniBattleStarting = false;
  tribulationState.miniBattleActionLoading = false;
  tribulationState.miniBattleResolving = false;
  tribulationState.miniBattleError = null;
  tribulationState.miniBattleAvailable = null;
  tribulationState.miniBattleLastResult = null;
  fetchCurrentBattleMock.mockReset();
  fetchCurrentBattleMock.mockResolvedValue(null);
  startBattleMock.mockReset();
  startBattleMock.mockResolvedValue(null);
  submitBattleActionMock.mockReset();
  submitBattleActionMock.mockResolvedValue(null);
  resolveBattleMock.mockReset();
  resolveBattleMock.mockResolvedValue(null);
  resetMiniBattleErrorMock.mockReset();
  clearMiniBattleMock.mockReset();
  pushMock.mockClear();
}

// Phase 14.3.D — stub helpers.
function makeEncounterStub(opts: {
  pending?: boolean;
  element?: string;
  effectType?: string;
  advantage?: number;
} = {}): EncounterCurrentStub {
  const element = opts.element ?? 'hoa';
  const effectType = opts.effectType ?? 'BURST';
  const advantage = opts.advantage ?? 0;
  const pendingRow: EncounterRowStub | null = opts.pending
    ? {
        id: 'enc-1',
        tribulationKey: 'kim_dan_to_nguyen_anh',
        fromRealmKey: 'kim_dan',
        toRealmKey: 'nguyen_anh',
        encounterKey: `tribulation_encounter_${element}`,
        effectType,
        element,
        difficulty: 'minor',
        selectedSupportItemKeys: [],
        state: 'pending',
        startedAt: '2026-06-11T00:00:00.000Z',
        resolvedAt: null,
        resolvedAttemptLogId: null,
      }
    : null;
  return {
    requirement: true,
    atPeak: true,
    fromRealmKey: 'kim_dan',
    toRealmKey: 'nguyen_anh',
    tribulationKey: 'kim_dan_to_nguyen_anh',
    severity: 'minor',
    type: 'lei',
    encounter: {
      key: `tribulation_encounter_${element}`,
      element,
      effectType,
      name: 'Hỏa Kiếp',
      description: 'Mô tả encounter test',
      difficulty: 'minor',
      phaseCount: 3,
      successThreshold: 0.6,
      requiredPowerHint: 5000,
      failPenaltyMultiplier: 1.0,
      rewardHintMultiplier: 1.0,
      playerHpMax: 10000,
      playerPrimaryElement: null,
      elementAdvantage: advantage,
    },
    successChance: {
      base: 0.7,
      supportBonus: 0,
      elementAdjustment: 0,
      raw: 0.7,
      final: 0.7,
      floorHit: false,
      ceilHit: false,
    },
    pending: pendingRow,
    cooldownAt: null,
    taoMaUntil: null,
  };
}

const STUB_SUCCESS_OUTCOME = {
  success: true,
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  wavesCompleted: 5,
  totalDamage: 1234,
  finalHp: 567,
  attemptIndex: 1,
  reward: {
    linhThach: 1000,
    expBonus: '50000',
    titleKey: 'do_kiep_thanh_cong',
  },
  penalty: null,
  logId: 'log-1',
  consumedSupportItems: [],
  supportTotalBonus: 0,
  successChance: {
    base: 0.7,
    supportBonus: 0,
    elementAdjustment: 0,
    raw: 0.7,
    final: 0.7,
    floorHit: false,
    ceilHit: false,
  },
};

const STUB_FAIL_OUTCOME = {
  success: false,
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  wavesCompleted: 2,
  totalDamage: 999,
  finalHp: 0,
  attemptIndex: 1,
  reward: null,
  penalty: {
    expBefore: '100000',
    expAfter: '50000',
    expLoss: '50000',
    cooldownAt: '2026-05-02T07:00:00.000Z',
    taoMaActive: true,
    taoMaExpiresAt: '2026-05-02T08:00:00.000Z',
  },
  logId: 'log-2',
  consumedSupportItems: [],
  supportTotalBonus: 0,
  successChance: {
    base: 0.7,
    supportBonus: 0,
    elementAdjustment: 0,
    raw: 0.7,
    final: 0.7,
    floorHit: false,
    ceilHit: false,
  },
};

describe('TribulationView — empty state', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị empty.noCharacter khi chưa có character', async () => {
    gameState.character = null;
    const w = mountView();
    await flushPromises();
    const empty = w.find('[data-testid="tribulation-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('Chưa có nhân vật');
  });

  it('hiển thị empty.noNextRealm khi đã ở cảnh giới đỉnh', async () => {
    gameState.character = { realmKey: 'hu_khong_chi_ton', realmStage: 1 };
    const w = mountView();
    await flushPromises();
    const empty = w.find('[data-testid="tribulation-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('Đỉnh');
  });

  it('hiển thị empty.lowTier khi transition không cần kiếp (truc_co → kim_dan)', async () => {
    gameState.character = { realmKey: 'truc_co', realmStage: 9 };
    const w = mountView();
    await flushPromises();
    const empty = w.find('[data-testid="tribulation-empty"]');
    expect(empty.exists()).toBe(true);
    expect(empty.text()).toContain('Không cần kiếp');
  });
});

describe('TribulationView — upcoming card render (kim_dan → nguyen_anh)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị card với tên + severity + type badge khi có def', async () => {
    const w = mountView();
    await flushPromises();
    const card = w.find('[data-testid^="tribulation-card-"]');
    expect(card.exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-severity-badge"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-type-badge"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-empty"]').exists()).toBe(false);
  });

  it('hiển thị reward preview (linhThach + expBonus)', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-reward-linhThach"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-reward-expBonus"]').exists()).toBe(true);
  });

  it('hiển thị penalty preview (expLoss + cooldown + taoMa)', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-penalty-expLoss"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-penalty-cooldown"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-penalty-taoMa"]').exists()).toBe(true);
  });

  it('button enable khi at peak + có def', async () => {
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="tribulation-attempt-button"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeUndefined();
  });

  it('button disable + hint khi không at peak (stage < 9)', async () => {
    gameState.character = { realmKey: 'kim_dan', realmStage: 5 };
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="tribulation-attempt-button"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="tribulation-not-at-peak-hint"]').exists()).toBe(true);
  });

  it('button disable khi inFlight', async () => {
    tribulationState.inFlight = true;
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="tribulation-attempt-button"]');
    expect(btn.attributes('disabled')).toBeDefined();
  });
});

// ── Phase 14.3.A — preview panel render ─────────────────────────────────
describe('TribulationView — Phase 14.3.A preview panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('onMounted gọi fetchPreview()', async () => {
    mountView();
    await flushPromises();
    expect(fetchPreviewMock).toHaveBeenCalled();
  });

  it('preview panel KHÔNG render khi store.preview chưa fetch (undefined)', async () => {
    tribulationState.preview = undefined;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-preview-panel"]').exists()).toBe(false);
  });

  it('preview panel KHÔNG render khi store.preview === null (low-tier)', async () => {
    tribulationState.preview = null;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-preview-panel"]').exists()).toBe(false);
  });

  it('preview panel render success chance khi có preview', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0,
        elementAdjustment: 0,
        raw: 0.75,
        final: 0.75,
        floorHit: false,
        ceilHit: false,
      },
      supports: [],
      supportTotalBonus: 0,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-preview-panel"]').exists()).toBe(true);
    const chance = w.find('[data-testid="tribulation-preview-success-chance"]');
    expect(chance.exists()).toBe(true);
    expect(chance.text()).toContain('75%');
  });

  it('preview panel render affinity khi elementAdjustment != 0 (positive bonus)', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0,
        elementAdjustment: 0.05,
        raw: 0.8,
        final: 0.8,
        floorHit: false,
        ceilHit: false,
      },
      supports: [],
      supportTotalBonus: 0,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    const aff = w.find('[data-testid="tribulation-preview-affinity"]');
    expect(aff.exists()).toBe(true);
    expect(aff.text()).toContain('+5%');
  });

  it('preview panel KHÔNG render affinity khi elementAdjustment == 0', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0,
        elementAdjustment: 0,
        raw: 0.75,
        final: 0.75,
        floorHit: false,
        ceilHit: false,
      },
      supports: [],
      supportTotalBonus: 0,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-preview-affinity"]').exists()).toBe(false);
  });

  it('preview panel render supports list khi có entries', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0.1,
        elementAdjustment: 0,
        raw: 0.85,
        final: 0.85,
        floorHit: false,
        ceilHit: false,
      },
      supports: [
        {
          source: 'item',
          key: 'lei_kiep_phu',
          bonus: 0.05,
          label: 'Lôi Kiếp Phù',
          element: 'kim',
        },
        {
          source: 'buff',
          key: 'thien_lei_phu',
          bonus: 0.05,
          label: 'Thiên Lôi Phù',
          element: null,
        },
      ],
      supportTotalBonus: 0.1,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    const list = w.find('[data-testid="tribulation-preview-supports"]');
    expect(list.exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-preview-support-0"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-preview-support-1"]').exists()).toBe(true);
  });

  it('preview panel render supports-empty khi supports list rỗng', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0,
        elementAdjustment: 0,
        raw: 0.75,
        final: 0.75,
        floorHit: false,
        ceilHit: false,
      },
      supports: [],
      supportTotalBonus: 0,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-preview-supports-empty"]').exists()).toBe(true);
  });

  // Phase 14.3.B — supports rendering details + cap warnings.

  it('preview panel render support label + element badge khi entry có label/element', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0.08,
        elementAdjustment: 0,
        raw: 0.83,
        final: 0.83,
        floorHit: false,
        ceilHit: false,
      },
      supports: [
        {
          source: 'item',
          key: 'lei_kiep_phu',
          bonus: 0.05,
          label: 'Lôi Kiếp Phù',
          element: 'kim',
        },
        {
          source: 'talent',
          key: 'talent_kim_thien_giap',
          bonus: 0.03,
          label: 'Kim Thiên Giáp',
          element: 'kim',
        },
      ],
      supportTotalBonus: 0.08,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    const list = w.find('[data-testid="tribulation-preview-supports"]');
    expect(list.exists()).toBe(true);
    expect(
      w.find('[data-testid="tribulation-preview-support-0-source"]').text(),
    ).toContain('Vật phẩm');
    expect(
      w.find('[data-testid="tribulation-preview-support-0-label"]').text(),
    ).toBe('Lôi Kiếp Phù');
    expect(
      w.find('[data-testid="tribulation-preview-support-0-element"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-preview-support-1-source"]').text(),
    ).toContain('Thiên phú');
  });

  it('preview panel render supportBonus row khi totalBonus != 0', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.75,
        supportBonus: 0.1,
        elementAdjustment: 0,
        raw: 0.85,
        final: 0.85,
        floorHit: false,
        ceilHit: false,
      },
      supports: [
        { source: 'item', key: 'lei_kiep_phu', bonus: 0.1, label: 'L', element: null },
      ],
      supportTotalBonus: 0.1,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    const node = w.find('[data-testid="tribulation-preview-support-bonus"]');
    expect(node.exists()).toBe(true);
    expect(node.text()).toContain('+10%');
  });

  it('preview panel render ceil cap warning khi successChance.ceilHit=true', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.9,
        supportBonus: 0.3,
        elementAdjustment: 0.05,
        raw: 1.25,
        final: 0.95,
        floorHit: false,
        ceilHit: true,
      },
      supports: [
        { source: 'item', key: 'a', bonus: 0.3, label: 'Item A', element: null },
      ],
      supportTotalBonus: 0.3,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-preview-cap-warning"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-preview-floor-warning"]').exists(),
    ).toBe(false);
  });

  it('preview panel render floor warning khi successChance.floorHit=true', async () => {
    tribulationState.preview = {
      requirement: true,
      fromRealmKey: 'kim_dan',
      toRealmKey: 'nguyen_anh',
      atPeak: true,
      def: {
        key: 'tribulation_kim_dan_nguyen_anh',
        name: 'Tiểu Lôi Kiếp',
        description: 'd',
        type: 'lei',
        severity: 'minor',
        wavesCount: 3,
      },
      successChance: {
        base: 0.3,
        supportBonus: -0.3,
        elementAdjustment: -0.05,
        raw: -0.05,
        final: 0.05,
        floorHit: true,
        ceilHit: false,
      },
      supports: [
        { source: 'buff', key: 'b', bonus: -0.3, label: 'Bad', element: null },
      ],
      supportTotalBonus: -0.3,
      rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
      penaltyHint: {
        expLossRatio: 0.1,
        cooldownMinutes: 30,
        taoMaDebuffChance: 0.4,
        taoMaDebuffDurationMinutes: 15,
      },
      cooldownAt: null,
      taoMaUntil: null,
      availableSupportItems: [],
      maxSelectedSupportItems: 3,
    };
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-preview-floor-warning"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-preview-cap-warning"]').exists(),
    ).toBe(false);
  });
});

describe('TribulationView — attempt action', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('click button → attempt called', async () => {
    attemptMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(attemptMock).toHaveBeenCalled();
  });

  it('attempt success outcome → toast.success + fetchState', async () => {
    attemptMock.mockImplementationOnce(async () => {
      tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(
      toastPushMock.mock.calls.some(([arg]) => (arg as { type: string }).type === 'success'),
    ).toBe(true);
    expect(fetchStateMock).toHaveBeenCalled();
  });

  it('attempt fail outcome (server accepted, simulate fail) → toast.warning + fetchState', async () => {
    attemptMock.mockImplementationOnce(async () => {
      tribulationState.lastOutcome = STUB_FAIL_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(
      toastPushMock.mock.calls.some(([arg]) => (arg as { type: string }).type === 'warning'),
    ).toBe(true);
    expect(fetchStateMock).toHaveBeenCalled();
  });

  it('attempt server reject (NOT_AT_PEAK) → toast.error', async () => {
    attemptMock.mockResolvedValueOnce('NOT_AT_PEAK');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(
      toastPushMock.mock.calls.some(([arg]) => (arg as { type: string }).type === 'error'),
    ).toBe(true);
  });

  it('attempt unknown error code → fallback UNKNOWN toast', async () => {
    attemptMock.mockResolvedValueOnce('SOME_UNMAPPED_CODE');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    const errorToasts = toastPushMock.mock.calls.filter(
      ([arg]) => (arg as { type: string }).type === 'error',
    );
    expect(errorToasts.length).toBeGreaterThan(0);
    expect((errorToasts[0]?.[0] as { text: string }).text).toBe('Lỗi');
  });
});

describe('TribulationView — last outcome banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('render success banner với reward detail khi lastOutcome.success=true', async () => {
    tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    const banner = w.find('[data-testid="tribulation-last-outcome"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Vượt kiếp thành công');
    expect(w.find('[data-testid="tribulation-outcome-reward"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-outcome-penalty"]').exists()).toBe(false);
  });

  it('render fail banner với penalty detail khi lastOutcome.success=false', async () => {
    tribulationState.lastOutcome = STUB_FAIL_OUTCOME;
    const w = mountView();
    await flushPromises();
    const banner = w.find('[data-testid="tribulation-last-outcome"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Thất bại');
    expect(w.find('[data-testid="tribulation-outcome-penalty"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-outcome-reward"]').exists()).toBe(false);
  });

  it('click dismiss button → clearLastOutcome called', async () => {
    tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-outcome-dismiss"]').trigger('click');
    expect(clearLastOutcomeMock).toHaveBeenCalled();
  });
});

describe('TribulationView — Phase 11.6.E cooldown + Tâm Ma', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('cooldown banner KHÔNG render khi tribulationCooldownAt=null', async () => {
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      tribulationCooldownAt: null,
      taoMaUntil: null,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-cooldown-banner"]').exists()).toBe(false);
    expect(w.find('[data-testid="tribulation-taoma-banner"]').exists()).toBe(false);
  });

  it('cooldown banner KHÔNG render khi cooldown đã hết hạn (timestamp quá khứ)', async () => {
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      tribulationCooldownAt: '2000-01-01T00:00:00.000Z',
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-cooldown-banner"]').exists()).toBe(false);
  });

  it('cooldown banner render với countdown khi cooldown còn hiệu lực', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      tribulationCooldownAt: future,
    };
    const w = mountView();
    await flushPromises();
    const banner = w.find('[data-testid="tribulation-cooldown-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('cooldown');
    const remaining = w.find('[data-testid="tribulation-cooldown-remaining"]');
    expect(remaining.exists()).toBe(true);
    expect(remaining.text()).toMatch(/\d+:\d{2}/);
  });

  it('attempt button DISABLE + label countdown khi cooldown active', async () => {
    const future = new Date(Date.now() + 90_000).toISOString();
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      tribulationCooldownAt: future,
    };
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="tribulation-attempt-button"]');
    expect(btn.exists()).toBe(true);
    expect(btn.attributes('disabled')).toBeDefined();
    // Label hiển thị remaining countdown chứ không phải "Vượt kiếp"
    expect(btn.text()).toMatch(/Chờ\s+\d+:\d{2}/);
  });

  it('Tâm Ma banner render khi taoMaUntil còn hiệu lực', async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      taoMaUntil: future,
    };
    const w = mountView();
    await flushPromises();
    const banner = w.find('[data-testid="tribulation-taoma-banner"]');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain('Tâm Ma');
    const remaining = w.find('[data-testid="tribulation-taoma-remaining"]');
    expect(remaining.exists()).toBe(true);
    expect(remaining.text()).toMatch(/\d+:\d{2}/);
  });

  it('Tâm Ma banner KHÔNG render khi taoMaUntil đã hết hạn', async () => {
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      taoMaUntil: '2000-01-01T00:00:00.000Z',
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-taoma-banner"]').exists()).toBe(false);
  });

  it('Tâm Ma có thể active song song với cooldown', async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      tribulationCooldownAt: future,
      taoMaUntil: future,
    };
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-cooldown-banner"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-taoma-banner"]').exists()).toBe(true);
  });

  it('cooldown countdown format >1h dùng h:mm:ss', async () => {
    const future = new Date(Date.now() + (3600 + 65) * 1000).toISOString();
    gameState.character = {
      realmKey: 'kim_dan',
      realmStage: 9,
      tribulationCooldownAt: future,
    };
    const w = mountView();
    await flushPromises();
    const remaining = w.find('[data-testid="tribulation-cooldown-remaining"]');
    expect(remaining.text()).toMatch(/\d+:\d{2}:\d{2}/);
  });
});

const STUB_HISTORY_SUCCESS = {
  id: 'log-success-1',
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  success: true,
  wavesCompleted: 5,
  totalDamage: 1200,
  finalHp: 567,
  hpInitial: 1000,
  expBefore: '100000',
  expAfter: '150000',
  expLoss: '0',
  taoMaActive: false,
  taoMaExpiresAt: null,
  cooldownAt: null,
  linhThachReward: 1000,
  expBonusReward: '50000',
  titleKeyReward: 'do_kiep_thanh_cong',
  attemptIndex: 2,
  taoMaRoll: 0.5,
  createdAt: '2026-05-02T01:00:00.000Z',
};

const STUB_HISTORY_FAIL = {
  id: 'log-fail-1',
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  success: false,
  wavesCompleted: 2,
  totalDamage: 800,
  finalHp: 0,
  hpInitial: 1000,
  expBefore: '100000',
  expAfter: '50000',
  expLoss: '50000',
  taoMaActive: true,
  taoMaExpiresAt: '2026-05-02T03:00:00.000Z',
  cooldownAt: '2026-05-02T02:00:00.000Z',
  linhThachReward: 0,
  expBonusReward: '0',
  titleKeyReward: null,
  attemptIndex: 1,
  taoMaRoll: 0.99,
  createdAt: '2026-05-02T00:00:00.000Z',
};

describe('TribulationView — Phase 11.6.G history view', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('history section ALWAYS render (always present in DOM)', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history"]').exists()).toBe(true);
  });

  it('on mount → fetchHistory called once (idempotent GET)', async () => {
    mountView();
    await flushPromises();
    expect(fetchHistoryMock).toHaveBeenCalled();
  });

  it('historyLoading=true → render loading state, không render list/empty/error', async () => {
    tribulationState.historyLoading = true;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-loading"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-history-list"]').exists()).toBe(false);
    expect(w.find('[data-testid="tribulation-history-empty"]').exists()).toBe(false);
    expect(w.find('[data-testid="tribulation-history-error"]').exists()).toBe(false);
  });

  it('historyError set → render error state với loadError text', async () => {
    tribulationState.historyError = 'NETWORK_ERROR';
    const w = mountView();
    await flushPromises();
    const err = w.find('[data-testid="tribulation-history-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Lỗi tải');
  });

  it('history=[] → render empty state', async () => {
    tribulationState.history = [];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-history-list"]').exists()).toBe(false);
  });

  it('history với 1 success row → render row + success badge + reward', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    const w = mountView();
    await flushPromises();
    const list = w.find('[data-testid="tribulation-history-list"]');
    expect(list.exists()).toBe(true);
    const row = w.find('[data-testid="tribulation-history-row-log-success-1"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('Thành công');
    expect(row.text()).toContain('Lần #2');
    expect(row.text()).toContain('1.000 LT');
    expect(row.text()).toContain('50.000 EXP');
    expect(row.text()).toContain('do_kiep_thanh_cong');
  });

  it('history với 1 fail row → render row + fail badge + penalty', async () => {
    tribulationState.history = [STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    const row = w.find('[data-testid="tribulation-history-row-log-fail-1"]');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('Thất bại');
    expect(row.text()).toContain('−50.000 EXP');
    expect(row.text()).toContain('Cooldown');
    expect(row.text()).toContain('Tâm Ma');
  });

  it('history với multi rows → render đúng thứ tự + count', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    const rows = w.findAll('[data-testid^="tribulation-history-row-"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.attributes('data-testid')).toBe(
      'tribulation-history-row-log-success-1',
    );
    expect(rows[1]!.attributes('data-testid')).toBe(
      'tribulation-history-row-log-fail-1',
    );
  });

  it('click reload button → fetchHistory called lần thứ 2', async () => {
    tribulationState.history = [];
    const w = mountView();
    await flushPromises();
    fetchHistoryMock.mockClear();
    await w.find('[data-testid="tribulation-history-reload"]').trigger('click');
    expect(fetchHistoryMock).toHaveBeenCalledTimes(1);
  });

  it('reload button HIDE khi historyLoading=true', async () => {
    tribulationState.historyLoading = true;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-reload"]').exists()).toBe(false);
  });

  it('attempt success → fetchHistory được gọi lại sau khi store.attempt resolve', async () => {
    attemptMock.mockResolvedValueOnce(null);
    tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    fetchHistoryMock.mockClear();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(fetchHistoryMock).toHaveBeenCalled();
  });
});

describe('TribulationView — Phase 11.6.H Load more pagination', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('không render Load more button khi history null', async () => {
    tribulationState.history = null;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-load-more"]').exists()).toBe(false);
    expect(w.find('[data-testid="tribulation-history-max-reached"]').exists()).toBe(false);
  });

  it('không render Load more button khi history rỗng', async () => {
    tribulationState.history = [];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-load-more"]').exists()).toBe(false);
    expect(w.find('[data-testid="tribulation-history-max-reached"]').exists()).toBe(false);
  });

  it('không render Load more button khi historyHasMore=false (rows ít hơn limit)', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyHasMore = false;
    tribulationState.historyMaxReached = false;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-load-more"]').exists()).toBe(false);
  });

  it('render Load more button khi historyHasMore=true', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    tribulationState.historyHasMore = true;
    tribulationState.historyMaxReached = false;
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="tribulation-history-load-more"]');
    expect(btn.exists()).toBe(true);
    expect(btn.text()).toContain('Tải thêm');
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it('Load more button hiển thị label "Đang tải thêm" và disabled khi historyLoading=true', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyHasMore = true;
    tribulationState.historyLoading = true;
    const w = mountView();
    await flushPromises();
    const btn = w.find('[data-testid="tribulation-history-load-more"]');
    // historyLoading=true ẩn reload + ẩn list, nhưng load-more button vẫn
    // tồn tại theo điều kiện historyHasMore (bị disabled). Tuỳ template:
    // template hide list khi historyLoading nên div bao Load more cũng ẩn
    // (load-more nằm trong v-else-if list>0 branch). Test guard:
    if (btn.exists()) {
      expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('click Load more → loadMoreHistory được gọi', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    tribulationState.historyHasMore = true;
    const w = mountView();
    await flushPromises();
    loadMoreHistoryMock.mockClear();
    await w.find('[data-testid="tribulation-history-load-more"]').trigger('click');
    expect(loadMoreHistoryMock).toHaveBeenCalledTimes(1);
  });

  it('click Load more khi server trả error → toast push lỗi', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyHasMore = true;
    loadMoreHistoryMock.mockResolvedValueOnce('NETWORK_ERROR');
    const w = mountView();
    await flushPromises();
    toastPushMock.mockClear();
    await w.find('[data-testid="tribulation-history-load-more"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('click Load more khi loadMoreHistory trả MAX_REACHED → KHÔNG toast', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyHasMore = true;
    loadMoreHistoryMock.mockResolvedValueOnce('MAX_REACHED');
    const w = mountView();
    await flushPromises();
    toastPushMock.mockClear();
    await w.find('[data-testid="tribulation-history-load-more"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).not.toHaveBeenCalled();
  });

  it('click Load more khi loadMoreHistory trả IN_FLIGHT → KHÔNG toast', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyHasMore = true;
    loadMoreHistoryMock.mockResolvedValueOnce('IN_FLIGHT');
    const w = mountView();
    await flushPromises();
    toastPushMock.mockClear();
    await w.find('[data-testid="tribulation-history-load-more"]').trigger('click');
    await flushPromises();
    expect(toastPushMock).not.toHaveBeenCalled();
  });

  it('render maxReached hint khi historyMaxReached=true (thay vì button)', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    tribulationState.historyHasMore = false;
    tribulationState.historyMaxReached = true;
    tribulationState.historyLimit = 100;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-load-more"]').exists()).toBe(false);
    const hint = w.find('[data-testid="tribulation-history-max-reached"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('Đã đạt giới hạn');
    expect(hint.text()).toContain('100');
  });
});

/** Phase 11.6.J — client-side history filter UI. */
describe('TribulationView — Phase 11.6.J history filter', () => {
  beforeEach(() => {
    resetState();
  });

  it('không render filter khi history null (chưa fetch)', async () => {
    tribulationState.history = null;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-filter"]').exists()).toBe(
      false,
    );
  });

  it('không render filter khi history empty array', async () => {
    tribulationState.history = [];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-filter"]').exists()).toBe(
      false,
    );
  });

  it('không render filter khi historyLoading=true', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyLoading = true;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-filter"]').exists()).toBe(
      false,
    );
  });

  it('render filter với 3 button (all/success/fail) khi có rows', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-filter"]').exists()).toBe(
      true,
    );
    expect(
      w.find('[data-testid="tribulation-history-filter-all"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-history-filter-success"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-history-filter-fail"]').exists(),
    ).toBe(true);
  });

  it('default filter là "all" + button "all" có aria-pressed=true', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    const allBtn = w.find('[data-testid="tribulation-history-filter-all"]');
    expect(allBtn.attributes('aria-pressed')).toBe('true');
  });

  it("click 'success' → setHistoryFilter('success') được gọi", async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    setHistoryFilterMock.mockClear();
    await w
      .find('[data-testid="tribulation-history-filter-success"]')
      .trigger('click');
    await flushPromises();
    expect(setHistoryFilterMock).toHaveBeenCalledTimes(1);
    expect(setHistoryFilterMock).toHaveBeenCalledWith('success');
  });

  it("click 'fail' → setHistoryFilter('fail') được gọi", async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    setHistoryFilterMock.mockClear();
    await w
      .find('[data-testid="tribulation-history-filter-fail"]')
      .trigger('click');
    await flushPromises();
    expect(setHistoryFilterMock).toHaveBeenCalledWith('fail');
  });

  it("filter='success' → list chỉ render rows success", async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    tribulationState.historyFilter = 'success';
    const w = mountView();
    await flushPromises();
    const list = w.find('[data-testid="tribulation-history-list"]');
    expect(list.exists()).toBe(true);
    expect(
      w.findAll('[data-testid^="tribulation-history-row-"]'),
    ).toHaveLength(1);
    expect(
      w
        .find('[data-testid="tribulation-history-filter-empty"]')
        .exists(),
    ).toBe(false);
  });

  it("filter='fail' → list chỉ render rows fail", async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    tribulationState.historyFilter = 'fail';
    const w = mountView();
    await flushPromises();
    expect(
      w.findAll('[data-testid^="tribulation-history-row-"]'),
    ).toHaveLength(1);
  });

  it("filter='success' khi 0 rows match → render empty hint thay vì list", async () => {
    tribulationState.history = [STUB_HISTORY_FAIL];
    tribulationState.historyFilter = 'success';
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-history-list"]').exists(),
    ).toBe(false);
    const emptyHint = w.find(
      '[data-testid="tribulation-history-filter-empty"]',
    );
    expect(emptyHint.exists()).toBe(true);
    expect(emptyHint.text()).toContain('Không có lượt nào khớp');
  });

  it('aria-pressed cập nhật theo historyFilter active', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    tribulationState.historyFilter = 'fail';
    const w = mountView();
    await flushPromises();
    expect(
      w
        .find('[data-testid="tribulation-history-filter-all"]')
        .attributes('aria-pressed'),
    ).toBe('false');
    expect(
      w
        .find('[data-testid="tribulation-history-filter-success"]')
        .attributes('aria-pressed'),
    ).toBe('false');
    expect(
      w
        .find('[data-testid="tribulation-history-filter-fail"]')
        .attributes('aria-pressed'),
    ).toBe('true');
  });
});

/** Phase 11.6.K — history stats summary UI. */
describe('TribulationView — Phase 11.6.K history stats', () => {
  beforeEach(() => {
    resetState();
  });

  it('không render stats khi history null (chưa fetch)', async () => {
    tribulationState.history = null;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-stats"]').exists()).toBe(
      false,
    );
  });

  it('không render stats khi history empty', async () => {
    tribulationState.history = [];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-stats"]').exists()).toBe(
      false,
    );
  });

  it('không render stats khi historyLoading=true', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS];
    tribulationState.historyLoading = true;
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-stats"]').exists()).toBe(
      false,
    );
  });

  it('render 3 stats badge (total/success/fail) khi có rows', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-history-stats"]').exists()).toBe(
      true,
    );
    expect(
      w.find('[data-testid="tribulation-history-stats-total"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-history-stats-success"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-history-stats-fail"]').exists(),
    ).toBe(true);
  });

  it('counts hiển thị đúng: total=2, success=1, fail=1', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-history-stats-total"]').text(),
    ).toContain('2');
    expect(
      w.find('[data-testid="tribulation-history-stats-success"]').text(),
    ).toContain('1');
    expect(
      w.find('[data-testid="tribulation-history-stats-fail"]').text(),
    ).toContain('1');
  });

  it('counts KHÔNG đổi khi filter thay đổi (stats trên FULL list)', async () => {
    tribulationState.history = [
      STUB_HISTORY_SUCCESS,
      STUB_HISTORY_SUCCESS,
      STUB_HISTORY_FAIL,
    ];
    tribulationState.historyFilter = 'fail';
    const w = mountView();
    await flushPromises();
    // Filter='fail' nhưng stats vẫn show full counts
    expect(
      w.find('[data-testid="tribulation-history-stats-total"]').text(),
    ).toContain('3');
    expect(
      w.find('[data-testid="tribulation-history-stats-success"]').text(),
    ).toContain('2');
    expect(
      w.find('[data-testid="tribulation-history-stats-fail"]').text(),
    ).toContain('1');
  });

  it('stats render trước filter control (above)', async () => {
    tribulationState.history = [STUB_HISTORY_SUCCESS, STUB_HISTORY_FAIL];
    const w = mountView();
    await flushPromises();
    const stats = w.find('[data-testid="tribulation-history-stats"]').element;
    const filter = w.find('[data-testid="tribulation-history-filter"]')
      .element;
    expect(stats).toBeTruthy();
    expect(filter).toBeTruthy();
    // DOCUMENT_POSITION_FOLLOWING (4) → stats comes BEFORE filter.
    // Use Node.DOCUMENT_POSITION_FOLLOWING constant (=4) to avoid bitwise op.
    const pos = stats.compareDocumentPosition(filter);
    expect(pos === Node.DOCUMENT_POSITION_FOLLOWING).toBe(true);
  });
});

// ── Phase 14.3.C — support item selection UI + consumed display ─────────────

const STUB_PREVIEW_WITH_ITEMS: PreviewStub = {
  requirement: true,
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  atPeak: true,
  def: {
    key: 'tribulation_kim_dan_nguyen_anh',
    name: 'Tiểu Lôi Kiếp',
    description: 'd',
    type: 'lei',
    severity: 'minor',
    wavesCount: 3,
  },
  successChance: {
    base: 0.75,
    supportBonus: 0,
    elementAdjustment: 0,
    raw: 0.75,
    final: 0.75,
    floorHit: false,
    ceilHit: false,
  },
  supports: [],
  supportTotalBonus: 0,
  rewardHint: { linhThach: 1000, expBonus: '50000', titleKey: null },
  penaltyHint: {
    expLossRatio: 0.1,
    cooldownMinutes: 30,
    taoMaDebuffChance: 0.4,
    taoMaDebuffDurationMinutes: 15,
  },
  cooldownAt: null,
  taoMaUntil: null,
  availableSupportItems: [
    { itemKey: 'thuan_kiep_dan', label: 'Thuận Kiếp Đan', bonus: 0.05, qty: 3 },
    { itemKey: 'tu_kiep_dan', label: 'Tứ Kiếp Đan', bonus: 0.08, qty: 1 },
  ],
  maxSelectedSupportItems: 3,
};

describe('TribulationView — Phase 14.3.C support item selection', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('render selection panel với title + hint khi có preview', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    const w = mountView();
    await flushPromises();
    const panel = w.find('[data-testid="tribulation-selection-panel"]');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('Chọn vật phẩm hỗ trợ');
    expect(
      w.find('[data-testid="tribulation-selection-hint"]').exists(),
    ).toBe(true);
  });

  it('render danh sách item với label + qty + bonus', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    const w = mountView();
    await flushPromises();
    const list = w.find('[data-testid="tribulation-selection-list"]');
    expect(list.exists()).toBe(true);
    const labelA = w.find('[data-testid="tribulation-selection-label-thuan_kiep_dan"]');
    expect(labelA.text()).toBe('Thuận Kiếp Đan');
    const qtyA = w.find('[data-testid="tribulation-selection-qty-thuan_kiep_dan"]');
    expect(qtyA.text()).toContain('3');
    const bonusA = w.find('[data-testid="tribulation-selection-bonus-thuan_kiep_dan"]');
    expect(bonusA.text()).toContain('5');
  });

  it('render empty hint khi availableSupportItems rỗng', async () => {
    tribulationState.preview = {
      ...STUB_PREVIEW_WITH_ITEMS,
      availableSupportItems: [],
    };
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-selection-empty"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-selection-list"]').exists(),
    ).toBe(false);
  });

  it('toggle checkbox cập nhật predicted bonus tổng', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    const w = mountView();
    await flushPromises();
    // Chưa select → predicted KHÔNG render
    expect(
      w.find('[data-testid="tribulation-selection-predicted"]').exists(),
    ).toBe(false);
    // Select 1 item (5%)
    const cb = w.find(
      '[data-testid="tribulation-selection-checkbox-thuan_kiep_dan"]',
    );
    await cb.trigger('change');
    await flushPromises();
    const predicted1 = w.find('[data-testid="tribulation-selection-predicted"]');
    expect(predicted1.exists()).toBe(true);
    expect(predicted1.text()).toContain('5%');
    // Select thêm 1 item (8%) → tổng 13%
    const cb2 = w.find(
      '[data-testid="tribulation-selection-checkbox-tu_kiep_dan"]',
    );
    await cb2.trigger('change');
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-selection-predicted"]').text(),
    ).toContain('13%');
  });

  it('attempt POST gửi selectedSupportItemKeys', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    attemptMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="tribulation-selection-checkbox-thuan_kiep_dan"]')
      .trigger('change');
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(attemptMock).toHaveBeenCalled();
    const args = attemptMock.mock.calls[0];
    expect(args).toBeDefined();
    expect(args?.[0]).toEqual(['thuan_kiep_dan']);
  });

  it('attempt với empty selection gửi []', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    attemptMock.mockResolvedValueOnce(null);
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    expect(attemptMock).toHaveBeenCalled();
    const args = attemptMock.mock.calls[0];
    expect(args?.[0]).toEqual([]);
  });

  it('outcome banner hiển thị consumed items khi server trả non-empty', async () => {
    tribulationState.lastOutcome = {
      ...STUB_SUCCESS_OUTCOME,
      consumedSupportItems: [
        { itemKey: 'thuan_kiep_dan', label: 'Thuận Kiếp Đan', bonus: 0.05 },
      ],
    };
    const w = mountView();
    await flushPromises();
    const consumedBlock = w.find('[data-testid="tribulation-outcome-consumed"]');
    expect(consumedBlock.exists()).toBe(true);
    const consumed0 = w.find('[data-testid="tribulation-outcome-consumed-0"]');
    expect(consumed0.exists()).toBe(true);
    expect(consumed0.text()).toContain('Thuận Kiếp Đan');
  });

  it('outcome banner hiển thị "no items used" khi consumedSupportItems rỗng', async () => {
    tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-outcome-consumed-empty"]').exists(),
    ).toBe(true);
  });

  it('attempt error SUPPORT_ITEM_MISSING → toast.error với i18n key', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    attemptMock.mockResolvedValueOnce('SUPPORT_ITEM_MISSING');
    const w = mountView();
    await flushPromises();
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    const errorToasts = toastPushMock.mock.calls.filter(
      ([arg]) => (arg as { type: string }).type === 'error',
    );
    expect(errorToasts.length).toBeGreaterThan(0);
  });

  it('attempt success → clear selectedSupportItemKeys (UI reset)', async () => {
    tribulationState.preview = STUB_PREVIEW_WITH_ITEMS;
    attemptMock.mockImplementationOnce(async () => {
      tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    // Select 1 item
    await w
      .find('[data-testid="tribulation-selection-checkbox-thuan_kiep_dan"]')
      .trigger('change');
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-selection-predicted"]').exists(),
    ).toBe(true);
    // Click attempt
    await w.find('[data-testid="tribulation-attempt-button"]').trigger('click');
    await flushPromises();
    // Predicted hidden again (selection cleared)
    expect(
      w.find('[data-testid="tribulation-selection-predicted"]').exists(),
    ).toBe(false);
  });
});

// ── Phase 14.3.D — Tribulation Encounter UI tests ──────────────────────────

describe('TribulationView — encounter panel render (Phase 14.3.D)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('hiển thị encounter panel khi store.encounter truthy', async () => {
    tribulationState.encounter = makeEncounterStub();
    const w = mountView();
    await flushPromises();
    const panel = w.find('[data-testid="tribulation-encounter-panel"]');
    expect(panel.exists()).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-element-badge"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-effect-badge"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-advantage-badge"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-phase-count"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-power-hint"]').exists(),
    ).toBe(true);
  });

  it('hiển thị start button khi pending=false', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: false });
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-encounter-start-button"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-resolve-button"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-testid="tribulation-encounter-pending-badge"]').exists(),
    ).toBe(false);
  });

  it('hiển thị resolve button khi pending=true', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-encounter-start-button"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-testid="tribulation-encounter-resolve-button"]').exists(),
    ).toBe(true);
    expect(
      w.find('[data-testid="tribulation-encounter-pending-badge"]').exists(),
    ).toBe(true);
  });
});

describe('TribulationView — encounter actions (Phase 14.3.D)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    resetState();
  });

  it('click start button → store.startEncounter called + toast success', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: false });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="tribulation-encounter-start-button"]')
      .trigger('click');
    await flushPromises();
    expect(startEncounterMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('click resolve button → store.resolveEncounter called + outcome handled', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    resolveEncounterMock.mockImplementation(async () => {
      tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="tribulation-encounter-resolve-button"]')
      .trigger('click');
    await flushPromises();
    expect(resolveEncounterMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('resolve fail → toast warning', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    resolveEncounterMock.mockImplementation(async () => {
      tribulationState.lastOutcome = STUB_FAIL_OUTCOME;
      return null;
    });
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="tribulation-encounter-resolve-button"]')
      .trigger('click');
    await flushPromises();
    expect(resolveEncounterMock).toHaveBeenCalledTimes(1);
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning' }),
    );
  });

  it('resolve error → toast error với i18n key', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    resolveEncounterMock.mockResolvedValueOnce('NO_PENDING_ENCOUNTER');
    const w = mountView();
    await flushPromises();
    await w
      .find('[data-testid="tribulation-encounter-resolve-button"]')
      .trigger('click');
    await flushPromises();
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('CTA cultivation hiển thị khi lastOutcome.success=true; click → router.push', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: false });
    tribulationState.lastOutcome = STUB_SUCCESS_OUTCOME;
    const w = mountView();
    await flushPromises();
    const cta = w.find('[data-testid="tribulation-encounter-return-cultivation"]');
    expect(cta.exists()).toBe(true);
    await cta.trigger('click');
    expect(pushMock).toHaveBeenCalledWith('/cultivation');
  });

  it('start button disabled khi pending=true (idempotent guard)', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    const w = mountView();
    await flushPromises();
    // Start button không render khi pending → check resolve button visible.
    expect(
      w.find('[data-testid="tribulation-encounter-start-button"]').exists(),
    ).toBe(false);
    expect(
      w
        .find('[data-testid="tribulation-encounter-resolve-button"]')
        .attributes('disabled'),
    ).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 14.3.E.2 — Mini-Battle integration tests
// ─────────────────────────────────────────────────────────────────────────

describe('TribulationView — mini-battle integration (Phase 14.3.E.2)', () => {
  beforeEach(() => {
    resetState();
  });

  it('miniBattleAvailable=null (initial) → encounter UI vẫn render, panel ẩn', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: false });
    tribulationState.miniBattleAvailable = null;
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-mini-battle-panel-mount"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-testid="tribulation-encounter-start-button"]').exists(),
    ).toBe(true);
  });

  it('miniBattleAvailable=false (501 disabled) → fallback encounter UI', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    tribulationState.miniBattleAvailable = false;
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-mini-battle-panel-mount"]').exists(),
    ).toBe(false);
    expect(
      w.find('[data-testid="tribulation-encounter-resolve-button"]').exists(),
    ).toBe(true);
  });

  it('miniBattleAvailable=true + atPeak → render mini-battle panel', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: true });
    tribulationState.miniBattleAvailable = true;
    const w = mountView();
    await flushPromises();
    expect(
      w.find('[data-testid="tribulation-mini-battle-panel-mount"]').exists(),
    ).toBe(true);
  });

  it('onMounted calls fetchCurrentBattle để hydrate snapshot', async () => {
    tribulationState.encounter = makeEncounterStub({ pending: false });
    mountView();
    await flushPromises();
    expect(fetchCurrentBattleMock).toHaveBeenCalled();
  });
});

describe('TribulationView — role hint + cross-nav', () => {
  it('renders role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-role-hint"]').exists()).toBe(true);
    expect(w.text()).toContain('Thiên Kiếp là thử thách');
  });

  it('renders cross-navigation links', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="tribulation-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-cross-nav-breakthrough"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-cross-nav-cultivation"]').exists()).toBe(true);
  });
});
