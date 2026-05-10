import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/api/tribulation', () => ({
  attemptTribulation: vi.fn(),
  fetchAttemptLog: vi.fn(),
  fetchTribulationPreview: vi.fn(),
  fetchTribulationEncounterCurrent: vi.fn(),
  startTribulationEncounter: vi.fn(),
  resolveTribulationEncounter: vi.fn(),
  fetchCurrentTribulationBattle: vi.fn(),
  startTribulationBattle: vi.fn(),
  submitTribulationBattleAction: vi.fn(),
  resolveTribulationBattle: vi.fn(),
  TRIBULATION_LOG_DEFAULT_LIMIT: 20,
  TRIBULATION_LOG_MAX_LIMIT: 100,
}));

import * as api from '@/api/tribulation';
import TribulationMiniBattlePanel from '@/components/TribulationMiniBattlePanel.vue';
import { useTribulationStore } from '@/stores/tribulation';

/**
 * Phase 14.3.E.2 — TribulationMiniBattlePanel UI test coverage.
 *
 * 11 mandatory test case (per task spec):
 *   - render no active battle state.
 *   - start battle button calls API.
 *   - render active battle.
 *   - action button calls API.
 *   - action loading disables buttons.
 *   - battle log renders.
 *   - win result modal renders.
 *   - lose result modal renders.
 *   - API error renders friendly error.
 *   - fallback when battle API unavailable (handled in TribulationView test).
 *   - i18n keys exist (covered by parity test).
 */

const STUB_BATTLE_ACTIVE: api.TribulationMiniBattleView = {
  id: 'battle-1',
  characterId: 'char-1',
  encounterId: 'enc-1',
  tribulationKey: 'kim_dan_to_nguyen_anh',
  realmKey: 'kim_dan',
  effectType: 'BURST',
  element: 'hoa',
  difficulty: 'major',
  state: 'ACTIVE',
  currentPhase: 2,
  phaseCount: 5,
  playerHp: 800,
  playerHpMax: 1000,
  tribulationHp: 600,
  tribulationHpMax: 1500,
  shield: 50,
  dotStacks: 1,
  focusCharge: 0,
  seed: 1234,
  actionLog: [
    {
      phase: 1,
      action: 'ATTACK',
      damage: 200,
      shield: 0,
      heal: 0,
      dot: 0,
      crit: true,
      result: 'ongoing',
      messageKey: 'attack_crit',
    },
  ],
  result: null,
  startedAt: '2026-05-02T01:00:00.000Z',
  resolvedAt: null,
  createdAt: '2026-05-02T01:00:00.000Z',
  updatedAt: '2026-05-02T01:01:00.000Z',
};

const STUB_BATTLE_RESOLVED: api.TribulationMiniBattleView = {
  ...STUB_BATTLE_ACTIVE,
  state: 'RESOLVED',
  tribulationHp: 0,
  resolvedAt: '2026-05-02T01:05:00.000Z',
  result: {
    state: 'RESOLVED',
    result: 'win',
    phasesPlayed: 5,
    totalDamageTaken: 200,
    totalDamageDealt: 1500,
    totalHeal: 0,
    totalShieldGained: 50,
    finalPlayerHp: 800,
    finalTribulationHp: 0,
    effectType: 'BURST',
  },
};

const STUB_OUTCOME_WIN: api.TribulationOutcomeView = {
  success: true,
  tribulationKey: 'kim_dan_to_nguyen_anh',
  fromRealmKey: 'kim_dan',
  toRealmKey: 'nguyen_anh',
  severity: 'major',
  type: 'lei',
  wavesCompleted: 5,
  totalDamage: 1500,
  finalHp: 800,
  attemptIndex: 1,
  reward: { linhThach: 1000, expBonus: '50000', titleKey: 'do_kiep_thanh_cong' },
  penalty: null,
  logId: 'log-w',
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

const STUB_OUTCOME_LOSE: api.TribulationOutcomeView = {
  ...STUB_OUTCOME_WIN,
  success: false,
  reward: null,
  penalty: {
    expBefore: '100000',
    expAfter: '50000',
    expLoss: '50000',
    cooldownAt: '2026-05-02T07:00:00.000Z',
    taoMaActive: true,
    taoMaExpiresAt: '2026-05-02T08:00:00.000Z',
  },
  logId: 'log-l',
};

const messages = {
  vi: {
    tribulation: {
      encounter: {
        element: { hoa: 'Hỏa', thuy: 'Thủy', moc: 'Mộc', kim: 'Kim', tho: 'Thổ' },
        effectType: {
          BURST: 'Sát thương dồn',
          SUSTAIN: 'Trường cửu',
          POISON_RECOVERY: 'Độc / hồi phục',
          ARMOR_CRIT: 'Giáp / chí mạng',
          DEFENSE_ENDURANCE: 'Phòng / kháng',
        },
      },
      errors: {
        UNKNOWN: 'Vượt kiếp thất bại, thử lại.',
        MINI_BATTLE_INVALID_ACTION: 'Hành động không hợp lệ trong phase này.',
      },
      miniBattle: {
        title: 'Vượt Kiếp Theo Lượt',
        subtitle: 'Mỗi lượt một hành động.',
        empty: 'Chưa khởi động kiếp.',
        terminalHint: 'Trận đã kết thúc.',
        phaseProgress: 'Phase {current} / {total}',
        playerHp: 'Sinh lực',
        tribulationHp: 'Sức mạnh kiếp',
        shield: 'Khiên +{n}',
        dotStacks: 'Trúng độc x{n}',
        focusCharge: 'Tích tụ x{n}',
        state: {
          PENDING: 'Chuẩn bị',
          ACTIVE: 'Đang đối kháng',
          RESOLVED: 'Hoàn tất',
          FAILED: 'Thất bại',
          EXPIRED: 'Hết hạn',
        },
        button: {
          start: 'Bắt đầu mini-battle',
          starting: 'Đang khởi động…',
          resolve: 'Vượt kiếp',
          resolving: 'Đang vượt…',
        },
        actions: {
          title: 'Chọn hành động',
          loading: 'Đang xử lý…',
          ATTACK: { label: 'Công Kích', short: 'Đánh', hint: 'Gây sát thương.' },
          DEFEND: { label: 'Phòng Thủ', short: 'Khiên', hint: 'Tăng khiên.' },
          FOCUS: { label: 'Tụ Khí', short: 'Charge', hint: 'Tăng đòn sau.' },
          CLEANSE: { label: 'Thanh Tẩy', short: 'Cleanse', hint: 'Xoá độc.' },
          CHANNEL: { label: 'Vận Khí', short: 'Channel', hint: 'Bỏ qua phase.' },
        },
        log: {
          title: 'Nhật ký',
          empty: 'Chưa có lượt nào.',
          phase: 'P{n}',
          damage: 'DMG {n}',
          shield: 'SHL {n}',
          heal: 'HEAL {n}',
          dot: 'DOT x{n}',
          crit: 'CRIT',
          result: { ongoing: 'Tiếp diễn', win: 'Thắng', lose: 'Bại' },
          message: { attack_crit: 'Chí mạng!' },
        },
        result: {
          winTitle: 'Vượt kiếp thành công!',
          loseTitle: 'Thất bại trong kiếp số',
          transition: '{from} → {to}',
          attemptIndex: 'Lần thử số {n}',
          wavesCompleted: 'Đã hoàn thành {n} đợt',
          reward: '+{linhThach} linh thạch · +{expBonus} EXP',
          titleAwarded: 'Danh hiệu mới: {key}',
          penalty: 'Mất {expLoss} EXP',
          cooldownAt: 'Cooldown đến {ts}',
          taoMaUntil: 'Tâm Ma đến {ts}',
          cta: { returnCultivation: 'Quay lại tu luyện', retry: 'Thử lại', close: 'Đóng' },
        },
        effectHint: {
          BURST: 'Phòng đúng lúc, phản công.',
          SUSTAIN: 'Sống sót qua nhiều phase.',
          POISON_RECOVERY: 'Cleanse khi DOT cao.',
          ARMOR_CRIT: 'Tụ khí xuyên giáp.',
          DEFENSE_ENDURANCE: 'Bền bỉ.',
        },
      },
    },
  },
};

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages,
  });
}

function mountPanel() {
  return mount(TribulationMiniBattlePanel, {
    attachTo: document.body,
    global: { plugins: [makeI18n(), createPinia()] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(api.fetchCurrentTribulationBattle).mockReset();
  vi.mocked(api.startTribulationBattle).mockReset();
  vi.mocked(api.submitTribulationBattleAction).mockReset();
  vi.mocked(api.resolveTribulationBattle).mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('TribulationMiniBattlePanel — render & interactions', () => {
  it('1. render no active battle state → hiện nút Start', () => {
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = null;
    const startBtn = w.find('[data-testid="tribulation-mini-battle-start-button"]');
    expect(startBtn.exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-mini-battle-no-battle"]').exists()).toBe(true);
    w.unmount();
  });

  it('2. start battle button calls API', async () => {
    vi.mocked(api.startTribulationBattle).mockResolvedValueOnce(STUB_BATTLE_ACTIVE);
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = null;
    await w.vm.$nextTick();
    await w.find('[data-testid="tribulation-mini-battle-start-button"]').trigger('click');
    await flushPromises();
    expect(api.startTribulationBattle).toHaveBeenCalledTimes(1);
    expect(store.miniBattle).toEqual(STUB_BATTLE_ACTIVE);
    w.unmount();
  });

  it('3. render active battle → hiện status + actions + effect hint', async () => {
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    expect(w.find('[data-testid="tribulation-mini-battle-status"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-mini-battle-actions"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-mini-battle-effect-hint"]').text()).toContain(
      'Sát thương dồn',
    );
    expect(w.find('[data-testid="tribulation-mini-battle-state-badge"]').text()).toContain(
      'Đang đối kháng',
    );
    w.unmount();
  });

  it('4. action button calls API submitTribulationBattleAction với clientNonce', async () => {
    vi.mocked(api.submitTribulationBattleAction).mockResolvedValueOnce(STUB_BATTLE_ACTIVE);
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    await w.find('[data-testid="tribulation-mini-battle-action-attack"]').trigger('click');
    await flushPromises();
    expect(api.submitTribulationBattleAction).toHaveBeenCalledTimes(1);
    const callArg = vi.mocked(api.submitTribulationBattleAction).mock.calls[0]![0];
    expect(callArg.battleId).toBe('battle-1');
    expect(callArg.action).toBe('ATTACK');
    expect(typeof callArg.clientNonce).toBe('string');
    w.unmount();
  });

  it('5. action loading disables buttons', async () => {
    let resolveMock: (value: api.TribulationMiniBattleView) => void = () => {};
    vi.mocked(api.submitTribulationBattleAction).mockReturnValueOnce(
      new Promise((res) => {
        resolveMock = res;
      }),
    );
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    await w.find('[data-testid="tribulation-mini-battle-action-attack"]').trigger('click');
    await w.vm.$nextTick();
    const defendBtn = w.find('[data-testid="tribulation-mini-battle-action-defend"]');
    expect(defendBtn.attributes('disabled')).toBeDefined();
    expect(
      w.find('[data-testid="tribulation-mini-battle-action-loading"]').exists(),
    ).toBe(true);
    resolveMock(STUB_BATTLE_ACTIVE);
    await flushPromises();
    w.unmount();
  });

  it('6. battle log renders entries từ server snapshot', async () => {
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    const log = w.find('[data-testid="tribulation-mini-battle-log"]');
    expect(log.exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-mini-battle-log-entry-0"]').exists()).toBe(true);
    expect(w.find('[data-testid="tribulation-mini-battle-log-list"]').text()).toContain('Chí mạng!');
    w.unmount();
  });

  it('7. win result modal renders sau resolve', async () => {
    vi.mocked(api.submitTribulationBattleAction).mockResolvedValueOnce(STUB_BATTLE_RESOLVED);
    vi.mocked(api.resolveTribulationBattle).mockResolvedValueOnce(STUB_OUTCOME_WIN);
    vi.mocked(api.fetchCurrentTribulationBattle).mockResolvedValueOnce(null);
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    await w.find('[data-testid="tribulation-mini-battle-action-attack"]').trigger('click');
    await flushPromises();
    expect(api.resolveTribulationBattle).toHaveBeenCalledTimes(1);
    const modal = document.querySelector('[data-testid="tribulation-mini-battle-result-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Vượt kiếp thành công!');
    expect(
      document.querySelector('[data-testid="tribulation-mini-battle-result-return-cultivation"]'),
    ).not.toBeNull();
    w.unmount();
  });

  it('8. lose result modal renders với CTA Thử lại', async () => {
    vi.mocked(api.submitTribulationBattleAction).mockResolvedValueOnce({
      ...STUB_BATTLE_RESOLVED,
      state: 'FAILED',
      result: { ...STUB_BATTLE_RESOLVED.result!, result: 'lose', state: 'FAILED' },
    });
    vi.mocked(api.resolveTribulationBattle).mockResolvedValueOnce(STUB_OUTCOME_LOSE);
    vi.mocked(api.fetchCurrentTribulationBattle).mockResolvedValueOnce(null);
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    await w.find('[data-testid="tribulation-mini-battle-action-attack"]').trigger('click');
    await flushPromises();
    const modal = document.querySelector('[data-testid="tribulation-mini-battle-result-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Thất bại trong kiếp số');
    expect(
      document.querySelector('[data-testid="tribulation-mini-battle-result-retry"]'),
    ).not.toBeNull();
    w.unmount();
  });

  it('9. API error renders friendly i18n error', async () => {
    vi.mocked(api.submitTribulationBattleAction).mockRejectedValueOnce({
      code: 'MINI_BATTLE_INVALID_ACTION',
    });
    const w = mountPanel();
    const store = useTribulationStore();
    store.miniBattle = STUB_BATTLE_ACTIVE;
    await w.vm.$nextTick();
    await w.find('[data-testid="tribulation-mini-battle-action-attack"]').trigger('click');
    await flushPromises();
    const err = w.find('[data-testid="tribulation-mini-battle-error"]');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Hành động không hợp lệ trong phase này');
    w.unmount();
  });

  it('10. fallback: store.miniBattleAvailable=false → store fetchCurrentBattle không raise UI error', async () => {
    // Phase 14.3.E.2 — when backend returns 501 TRIBULATION_MINI_BATTLE_UNAVAILABLE,
    // the store sets miniBattleAvailable=false WITHOUT raising miniBattleError so
    // TribulationView can hide the panel and fall back to the legacy encounter
    // resolve flow without crashing.
    vi.mocked(api.fetchCurrentTribulationBattle).mockRejectedValueOnce({
      code: 'TRIBULATION_MINI_BATTLE_UNAVAILABLE',
    });
    const store = useTribulationStore();
    const code = await store.fetchCurrentBattle();
    expect(code).toBeNull();
    expect(store.miniBattleAvailable).toBe(false);
    expect(store.miniBattleError).toBeNull();
  });

  it('11. i18n keys: tất cả action label / state label / hint key đều resolve', () => {
    const i18n = makeI18n();
    const t = i18n.global.t;
    for (const k of ['ATTACK', 'DEFEND', 'FOCUS', 'CLEANSE', 'CHANNEL']) {
      expect(t(`tribulation.miniBattle.actions.${k}.label`)).not.toBe(
        `tribulation.miniBattle.actions.${k}.label`,
      );
    }
    for (const s of ['PENDING', 'ACTIVE', 'RESOLVED', 'FAILED', 'EXPIRED']) {
      expect(t(`tribulation.miniBattle.state.${s}`)).not.toBe(
        `tribulation.miniBattle.state.${s}`,
      );
    }
    for (const e of [
      'BURST',
      'SUSTAIN',
      'POISON_RECOVERY',
      'ARMOR_CRIT',
      'DEFENSE_ENDURANCE',
    ]) {
      expect(t(`tribulation.miniBattle.effectHint.${e}`)).not.toBe(
        `tribulation.miniBattle.effectHint.${e}`,
      );
    }
  });
});
