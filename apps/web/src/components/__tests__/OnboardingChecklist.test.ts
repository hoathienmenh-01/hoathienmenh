import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const routerPushMock = vi.fn();

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPushMock }),
}));

import OnboardingChecklist from '@/components/OnboardingChecklist.vue';
import { useGameStore } from '@/stores/game';
import { clearAllVisits, markVisited } from '@/lib/onboardingVisits';
import type { CharacterStatePayload } from '@xuantoi/shared';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  messages: {
    vi: {
      home: {
        onboarding: {
          title: 'Tân Thủ Chỉ Nam',
          go: 'Đi',
          steps: {
            character: 'Khai lập đạo hiệu',
            sect: 'Bái nhập tông môn',
            cultivate: 'Bắt đầu Nhập Định',
            breakthrough: 'Hoàn thành đột phá đầu tiên',
            leaderboard: 'Xem bảng xếp hạng',
            mail: 'Kiểm tra hòm thư',
          },
        },
      },
    },
  },
});

function makeChar(overrides: Partial<CharacterStatePayload> = {}): CharacterStatePayload {
  return {
    id: 'c1',
    name: 'Đạo Hữu',
    realmKey: 'phamnhan',
    realmStage: 0,
    level: 1,
    exp: '0',
    expNext: '100',
    hp: 100,
    hpMax: 100,
    mp: 50,
    mpMax: 50,
    stamina: 100,
    staminaMax: 100,
    power: 10,
    spirit: 10,
    speed: 10,
    luck: 10,
    linhThach: '0',
    tienNgoc: 0,
    cultivating: false,
    sectId: null,
    sectKey: null,
    role: 'PLAYER',
    banned: false,
    tribulationCooldownAt: null,
    taoMaUntil: null,
    spiritualRootGrade: null,
    primaryElement: null,
    secondaryElements: [],
    rootPurity: 100,
    title: null,
  bodyRealmKey: 'pham_than',
  bodyRealmName: 'Phàm Thân',
  bodyStage: 1,
  bodyExp: '0',
  bodyExpNext: '120',
  bodyRate: 2.5,
  bodyCultivating: false,
  bodyInjuryUntil: null,
  physiqueKey: null,
  bodyStatBonus: {
    hpMax: 0,
    power: 0,
    def: 0,
    staminaMax: 0,
    bossDamageReduction: 0,
  },
    ...overrides,
  };
}

function mountChecklist() {
  return mount(OnboardingChecklist, {
    global: { plugins: [i18n] },
  });
}

describe('OnboardingChecklist', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    routerPushMock.mockReset();
    clearAllVisits();
  });

  it('hiện đầy đủ 6 step khi character mới (chưa hoàn thành gì)', () => {
    const game = useGameStore();
    game.character = makeChar();
    const w = mountChecklist();
    expect(w.find('[data-testid="onboarding-checklist"]').exists()).toBe(true);
    const items = w.findAll('li');
    expect(items).toHaveLength(6);
    expect(w.text()).toContain('1/6'); // chỉ character đã done
    expect(items[0].text()).toContain('✓');
    expect(items[1].text()).toContain('○');
    expect(items[2].text()).toContain('○');
    expect(items[3].text()).toContain('○');
    expect(items[4].text()).toContain('○'); // leaderboard
    expect(items[5].text()).toContain('○'); // mail
  });

  it('panel ẩn khi không có character (không thể render khi parent v-if)', () => {
    const game = useGameStore();
    game.character = null;
    const w = mountChecklist();
    // Khi character=null, mọi step done=false (character: c !== null = false)
    // → counter 0/4, panel HIỂN nhưng test parent guard separately.
    // Component này chỉ ẩn khi allDone, nên với null sẽ hiển 0/4.
    expect(w.find('[data-testid="onboarding-checklist"]').exists()).toBe(true);
    expect(w.text()).toContain('0/6');
  });

  it('counter tăng khi sectKey gán', () => {
    const game = useGameStore();
    game.character = makeChar({ sectKey: 'thanh_van', sectId: 's1' });
    const w = mountChecklist();
    expect(w.text()).toContain('2/6'); // character + sect
  });

  it('counter tăng khi cultivating=true', () => {
    const game = useGameStore();
    game.character = makeChar({
      sectKey: 'huyen_thuy',
      sectId: 's2',
      cultivating: true,
    });
    const w = mountChecklist();
    expect(w.text()).toContain('3/6'); // character + sect + cultivate
  });

  it('breakthrough: realmKey != phamnhan → done; bảng xếp hạng + thư chưa visit → panel hiển', () => {
    const game = useGameStore();
    game.character = makeChar({
      realmKey: 'luyenkhi',
      realmStage: 1,
      sectKey: 'tu_la',
      sectId: 's3',
      cultivating: true,
    });
    const w = mountChecklist();
    // 4/6 — panel vẫn hiển vì leaderboard + mail chưa visit
    expect(w.find('[data-testid="onboarding-checklist"]').exists()).toBe(true);
    expect(w.text()).toContain('4/6');
  });

  it('all 4 character step done + leaderboard visited + mail visited → panel ẩn (6/6)', () => {
    markVisited('leaderboard');
    markVisited('mail');
    const game = useGameStore();
    game.character = makeChar({
      realmKey: 'luyenkhi',
      realmStage: 1,
      sectKey: 'tu_la',
      sectId: 's3',
      cultivating: true,
    });
    const w = mountChecklist();
    expect(w.find('[data-testid="onboarding-checklist"]').exists()).toBe(false);
  });

  it('leaderboard visited → step 5 done (counter tăng)', () => {
    markVisited('leaderboard');
    const game = useGameStore();
    game.character = makeChar();
    const w = mountChecklist();
    expect(w.text()).toContain('2/6'); // character + leaderboard
  });

  it('mail visited → step 6 done (counter tăng)', () => {
    markVisited('mail');
    const game = useGameStore();
    game.character = makeChar();
    const w = mountChecklist();
    expect(w.text()).toContain('2/6'); // character + mail
  });

  it('breakthrough: realmKey=phamnhan + realmStage>0 → done (edge case); panel hiển vì leaderboard/mail chưa visit', () => {
    const game = useGameStore();
    game.character = makeChar({
      realmKey: 'phamnhan',
      realmStage: 1,
      sectKey: 'thanh_van',
      sectId: 's1',
      cultivating: true,
    });
    const w = mountChecklist();
    // 4/6 — panel hiển vì leaderboard + mail chưa visit
    expect(w.find('[data-testid="onboarding-checklist"]').exists()).toBe(true);
  });

  it('click button "Đi" trên step chưa done gọi router.push với route đúng', async () => {
    const game = useGameStore();
    game.character = makeChar();
    const w = mountChecklist();
    // Step 1 (sect) chưa done → có button.
    const buttons = w.findAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    await buttons[0].trigger('click'); // sect button (character đã done)
    expect(routerPushMock).toHaveBeenCalled();
    // Route có thể là /sect, /, /onboarding tùy step đầu tiên chưa done.
    expect(routerPushMock.mock.calls[0][0]).toMatch(/^\/(sect|onboarding|)$/);
  });

  it('step done không hiển button "Đi"', () => {
    const game = useGameStore();
    game.character = makeChar({
      sectKey: 'thanh_van',
      sectId: 's1',
    });
    const w = mountChecklist();
    const items = w.findAll('li');
    // Item 0 (character) done → no button.
    expect(items[0].find('button').exists()).toBe(false);
    // Item 1 (sect) done → no button.
    expect(items[1].find('button').exists()).toBe(false);
    // Item 2 (cultivate) chưa done → có button.
    expect(items[2].find('button').exists()).toBe(true);
  });
});
