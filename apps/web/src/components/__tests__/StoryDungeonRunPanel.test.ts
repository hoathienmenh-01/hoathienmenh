import { afterEach, describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import StoryDungeonRunPanel from '@/components/StoryDungeonRunPanel.vue';
import type {
  StoryDungeonRunStatus,
  StoryDungeonRunView,
  StoryDungeonView,
} from '@/api/storyDungeon';

/**
 * Phase 12.8.D — StoryDungeonRunPanel UI test coverage.
 *
 * Cover §F mục 3 + advance/clear/claim button states + emits:
 *   - title + status badge.
 *   - ACTIVE + cur < total → render advance button (clear ẩn).
 *   - ACTIVE + cur === total → render clear button (advance ẩn).
 *   - CLEARED + claimedAt=null → render claim button.
 *   - CLAIMED → ẩn claim button (chỉ còn dialogue button nếu template có).
 *   - submittingKey set → các action button disabled.
 *   - emit `advance` / `clear` / `claim` / `open-dialogue` đúng kind.
 *   - render boss hint, killed monsters, reward preview, recommendedRealm.
 *
 * Server-authoritative: panel chỉ render snapshot + emit; KHÔNG gọi API trực tiếp.
 */

const messages = {
  vi: {
    storyDungeon: {
      run: {
        activeBadge: 'Đang trong bí cảnh',
        progress: 'Bước {cur}/{total}',
        currentMonster: 'Quái sắp đối đầu',
        monsterStat: 'Lv {lv} · HP {hp} · Công {atk}',
        killedTitle: 'Đã hạ ({n})',
        bossHint: 'Đại ma cuối: {name}',
        rewardPreview: '+{linhThach} LT · +{tienNgoc} TN · +{exp} EXP',
        realmHint: 'Cảnh giới đề nghị: {realm}',
        advance: 'Tiến bước',
        clear: 'Kết thúc bí cảnh',
        claim: 'Lĩnh thưởng',
        entryDialogue: 'Lời thoại đầu',
        clearDialogue: 'Lời thoại kết',
      },
      runStatus: {
        ACTIVE: 'Đang vận hành',
        CLEARED: 'Đã thông',
        CLAIMED: 'Đã lĩnh',
        FAILED: 'Thất bại',
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

function buildTemplate(
  partial: Partial<StoryDungeonView> & { key: string } = { key: 'tpl_a' },
): StoryDungeonView {
  return {
    key: partial.key,
    titleI18nKey: partial.titleI18nKey ?? `story.${partial.key}.title`,
    descriptionI18nKey: partial.descriptionI18nKey ?? `story.${partial.key}.desc`,
    titleVi: partial.titleVi ?? `Bí cảnh ${partial.key}`,
    descriptionVi: partial.descriptionVi ?? 'desc',
    requiredQuestKey: partial.requiredQuestKey ?? 'q1',
    requiredQuestStep: partial.requiredQuestStep ?? null,
    regionKey: partial.regionKey ?? 'son_coc',
    recommendedRealm: partial.recommendedRealm ?? 'phamnhan',
    minRealmKey: partial.minRealmKey ?? null,
    npcKey: partial.npcKey ?? null,
    entryDialogueKey: partial.entryDialogueKey ?? null,
    clearDialogueKey: partial.clearDialogueKey ?? null,
    monsters: partial.monsters ?? [],
    boss: partial.boss ?? null,
    rewardHint: partial.rewardHint ?? null,
    oneTime: partial.oneTime ?? true,
    status: partial.status ?? 'available',
  };
}

function buildRun(
  partial: Partial<StoryDungeonRunView> & { id: string; status: StoryDungeonRunStatus },
): StoryDungeonRunView {
  return {
    id: partial.id,
    templateKey: partial.templateKey ?? 'tpl_a',
    status: partial.status,
    currentStep: partial.currentStep ?? 0,
    totalSteps: partial.totalSteps ?? 3,
    currentMonster: partial.currentMonster ?? null,
    killedMonsters: partial.killedMonsters ?? [],
    startedAt: partial.startedAt ?? '2026-05-07T00:00:00.000Z',
    clearedAt: partial.clearedAt ?? null,
    claimedAt: partial.claimedAt ?? null,
    rewardHint: partial.rewardHint ?? null,
  };
}

function mountPanel(props: {
  run: StoryDungeonRunView;
  template?: StoryDungeonView | null;
  submittingKey?: string | null;
}) {
  return mount(StoryDungeonRunPanel, {
    attachTo: document.body,
    props: {
      run: props.run,
      template: props.template ?? null,
      submittingKey: props.submittingKey ?? null,
    },
    global: { plugins: [makeI18n()] },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StoryDungeonRunPanel — render baseline', () => {
  it('render title từ template + status badge ACTIVE + progress {cur}/{total}', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 1, totalSteps: 4 }),
      template: buildTemplate({ key: 'tpl_a', titleVi: 'Bí Cảnh Sơn Cốc' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-run-title"]').text()).toBe('Bí Cảnh Sơn Cốc');
    expect(w.find('[data-testid="story-dungeon-run-status"]').text()).toBe('Đang vận hành');
    expect(w.find('[data-testid="story-dungeon-run-progress"]').text()).toContain('1/4');
    w.unmount();
  });

  it('template=null + templateKey không có trong shared catalog → fallback render templateKey raw', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', templateKey: 'tpl_unknown_xyz' }),
      template: null,
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-title"]').text()).toBe('tpl_unknown_xyz');
    w.unmount();
  });

  it('currentMonster set → render block + statline', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        currentStep: 1,
        currentMonster: {
          key: 'm1',
          name: 'Sơn Thú',
          level: 3,
          hp: 120,
          atk: 14,
          def: 8,
          speed: 6,
          expDrop: 30,
          linhThachDrop: 10,
        },
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    const block = w.find('[data-testid="story-dungeon-run-monster"]');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain('Sơn Thú');
    expect(block.text()).toContain('Lv 3');
    expect(block.text()).toContain('HP 120');
    expect(block.text()).toContain('Công 14');
    w.unmount();
  });

  it('killedMonsters[] set → render danh sách + count', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        killedMonsters: [
          { monsterKey: 'm_a', killedAt: '2026-05-07T01:00:00.000Z' },
          { monsterKey: 'm_b', killedAt: '2026-05-07T01:01:00.000Z' },
        ],
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    const block = w.find('[data-testid="story-dungeon-run-killed"]');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain('2');
    expect(w.find('[data-testid="story-dungeon-run-killed-0"]').text()).toBe('m_a');
    expect(w.find('[data-testid="story-dungeon-run-killed-1"]').text()).toBe('m_b');
    w.unmount();
  });

  it('boss có trong template → render boss hint', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE' }),
      template: buildTemplate({
        key: 'tpl_a',
        boss: {
          key: 'b_x',
          name: 'Lão Quái Sơn Cốc',
          recommendedRealm: 'phamnhan',
          regionKey: 'son_coc',
        },
      }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-boss"]').text()).toContain(
      'Lão Quái Sơn Cốc',
    );
    w.unmount();
  });

  it('rewardHint có trên run → render reward preview', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'ACTIVE',
        rewardHint: { linhThach: 100, tienNgoc: 1, exp: 200, items: [] },
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    const block = w.find('[data-testid="story-dungeon-run-reward-preview"]');
    expect(block.exists()).toBe(true);
    expect(block.text()).toContain('100');
    expect(block.text()).toContain('200');
    w.unmount();
  });

  it('recommendedRealm hợp lệ → render realm hint qua realmByKey', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE' }),
      template: buildTemplate({ key: 'tpl_a', recommendedRealm: 'phamnhan' }),
    });
    await flushPromises();
    const hint = w.find('[data-testid="story-dungeon-run-realm-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text().length).toBeGreaterThan(0);
    w.unmount();
  });
});

describe('StoryDungeonRunPanel — action button states', () => {
  it('ACTIVE + cur < total → render advance, ẨN clear/claim', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 1, totalSteps: 3 }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-advance"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-run-clear"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-claim"]').exists()).toBe(false);
    w.unmount();
  });

  it('ACTIVE + cur === total → render clear, ẨN advance/claim', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 3, totalSteps: 3 }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-advance"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-clear"]').exists()).toBe(true);
    expect(w.find('[data-testid="story-dungeon-run-claim"]').exists()).toBe(false);
    w.unmount();
  });

  it('CLEARED + claimedAt=null → render claim, ẨN advance/clear', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLEARED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-advance"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-clear"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-claim"]').exists()).toBe(true);
    w.unmount();
  });

  it('CLEARED + claimedAt set → ẨN claim button', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLEARED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
        claimedAt: '2026-05-07T02:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-claim"]').exists()).toBe(false);
    w.unmount();
  });

  it('CLAIMED → ẨN cả advance/clear/claim', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLAIMED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
        claimedAt: '2026-05-07T02:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-advance"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-clear"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-claim"]').exists()).toBe(false);
    expect(w.find('[data-testid="story-dungeon-run-status"]').text()).toBe('Đã lĩnh');
    w.unmount();
  });

  it('submittingKey set → advance button disabled', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 1, totalSteps: 3 }),
      template: buildTemplate({ key: 'tpl_a' }),
      submittingKey: 'advance',
    });
    await flushPromises();
    const btn = w.find('[data-testid="story-dungeon-run-advance"]');
    expect(btn.exists()).toBe(true);
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
    w.unmount();
  });

  it('submittingKey set → clear button disabled', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 3, totalSteps: 3 }),
      template: buildTemplate({ key: 'tpl_a' }),
      submittingKey: 'clear',
    });
    await flushPromises();
    expect(
      (w.find('[data-testid="story-dungeon-run-clear"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
    w.unmount();
  });

  it('submittingKey set → claim button disabled', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLEARED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a' }),
      submittingKey: 'claim',
    });
    await flushPromises();
    expect(
      (w.find('[data-testid="story-dungeon-run-claim"]').element as HTMLButtonElement).disabled,
    ).toBe(true);
    w.unmount();
  });
});

describe('StoryDungeonRunPanel — emit', () => {
  it('click advance → emit advance', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 1, totalSteps: 3 }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    await w.find('[data-testid="story-dungeon-run-advance"]').trigger('click');
    expect(w.emitted('advance')).toBeTruthy();
    w.unmount();
  });

  it('click clear → emit clear', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE', currentStep: 3, totalSteps: 3 }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    await w.find('[data-testid="story-dungeon-run-clear"]').trigger('click');
    expect(w.emitted('clear')).toBeTruthy();
    w.unmount();
  });

  it('click claim → emit claim', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLEARED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a' }),
    });
    await flushPromises();
    await w.find('[data-testid="story-dungeon-run-claim"]').trigger('click');
    expect(w.emitted('claim')).toBeTruthy();
    w.unmount();
  });
});

describe('StoryDungeonRunPanel — dialogue trigger', () => {
  it('template có entryDialogueKey → render entry dialogue button + emit open-dialogue/entry', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE' }),
      template: buildTemplate({ key: 'tpl_a', entryDialogueKey: 'dlg_entry' }),
    });
    await flushPromises();
    const btn = w.find('[data-testid="story-dungeon-run-entry-dialogue"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    const events = w.emitted('open-dialogue');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(['entry']);
    w.unmount();
  });

  it('template KHÔNG có entryDialogueKey → ẩn entry dialogue button', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE' }),
      template: buildTemplate({ key: 'tpl_a', entryDialogueKey: null }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-entry-dialogue"]').exists()).toBe(false);
    w.unmount();
  });

  it('CLEARED + clearDialogueKey → render clear dialogue button + emit open-dialogue/clear', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLEARED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a', clearDialogueKey: 'dlg_clear' }),
    });
    await flushPromises();
    const btn = w.find('[data-testid="story-dungeon-run-clear-dialogue"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger('click');
    const events = w.emitted('open-dialogue');
    expect(events).toBeTruthy();
    expect(events![0]).toEqual(['clear']);
    w.unmount();
  });

  it('ACTIVE + clearDialogueKey → ẨN clear dialogue button (chưa cleared)', async () => {
    const w = mountPanel({
      run: buildRun({ id: 'r1', status: 'ACTIVE' }),
      template: buildTemplate({ key: 'tpl_a', clearDialogueKey: 'dlg_clear' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-clear-dialogue"]').exists()).toBe(false);
    w.unmount();
  });

  it('CLAIMED + clearDialogueKey → vẫn render clear dialogue button (re-read sau claim)', async () => {
    const w = mountPanel({
      run: buildRun({
        id: 'r1',
        status: 'CLAIMED',
        currentStep: 3,
        totalSteps: 3,
        clearedAt: '2026-05-07T01:00:00.000Z',
        claimedAt: '2026-05-07T02:00:00.000Z',
      }),
      template: buildTemplate({ key: 'tpl_a', clearDialogueKey: 'dlg_clear' }),
    });
    await flushPromises();
    expect(w.find('[data-testid="story-dungeon-run-clear-dialogue"]').exists()).toBe(true);
    w.unmount();
  });
});
