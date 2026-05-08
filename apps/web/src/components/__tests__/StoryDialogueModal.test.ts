import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import StoryDialogueModal from '@/components/StoryDialogueModal.vue';
import { useStoryDialogueStore } from '@/stores/storyDialogue';
import * as api from '@/api/storyDialogue';

vi.mock('@/api/storyDialogue', () => ({
  fetchStoryDialogue: vi.fn(),
  submitStoryDialogueChoice: vi.fn(),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: vi.fn() }),
}));

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: {
        close: 'Đóng',
        loading: 'Đang xử lý…',
        loadingData: 'Đang tải…',
      },
      storyDialogue: {
        title: 'Hội thoại cốt truyện',
        talk: 'Tâm sự',
        alreadyChosen: 'Đã chọn',
        locked: 'Chưa mở',
        lastChosen: 'Đã chọn lần trước',
        empty: 'Đạo hữu này chưa có chuyện gì để bàn.',
        linhThach: 'Linh thạch',
        tienNgoc: 'Tiên ngọc',
        errors: {
          UNKNOWN: 'Không thể tiếp tục đối thoại, thử lại.',
          INVALID_CHOICE: 'Lựa chọn không hợp lệ.',
        },
      },
    },
  },
});

function makeNode(): api.StoryDialogueNodeView {
  return {
    nodeId: 'story_dlg_test_intro',
    npcKey: 'npc_test',
    questKey: null,
    text: 'Lời chào của trưởng môn.',
    seen: false,
    previousChoiceKey: null,
    choices: [
      {
        key: 'respect',
        label: 'Đệ tử cung kính lắng nghe.',
        available: true,
        unavailableReason: null,
        nextNodeId: null,
        alreadyApplied: false,
        previouslyChosen: false,
      },
      {
        key: 'doubt',
        label: 'Đệ tử nghi ngờ con đường.',
        available: true,
        unavailableReason: null,
        nextNodeId: null,
        alreadyApplied: false,
        previouslyChosen: false,
      },
      {
        key: 'locked',
        label: 'Lựa chọn bị khoá.',
        available: false,
        unavailableReason: 'quest_status:foo=accepted',
        nextNodeId: null,
        alreadyApplied: false,
        previouslyChosen: false,
      },
      {
        key: 'already',
        label: 'Đã chọn rồi.',
        available: false,
        unavailableReason: 'already_applied',
        nextNodeId: null,
        alreadyApplied: true,
        previouslyChosen: false,
      },
    ],
  };
}

function mountModal(props: { npcKey?: string | null; npcName?: string } = {}) {
  // KHÔNG dùng `?? 'npc_test'` — `??` treat null là nullish nên test pass
  // explicit `npcKey: null` sẽ bị override → mượn `in` để phân biệt.
  const npcKey = 'npcKey' in props ? props.npcKey ?? null : 'npc_test';
  return mount(StoryDialogueModal, {
    attachTo: document.body,
    props: {
      npcKey,
      npcName: props.npcName ?? 'Lăng Vân Sinh',
    },
    global: { plugins: [i18n] },
  });
}

describe('StoryDialogueModal — render & interaction', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    document.body.innerHTML = '';
    vi.mocked(api.fetchStoryDialogue).mockReset();
    vi.mocked(api.submitStoryDialogueChoice).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('không render modal khi npcKey null + không có node', () => {
    mountModal({ npcKey: null });
    expect(document.querySelector('[data-testid="story-dialogue-modal"]')).toBeNull();
  });

  it('render text + tất cả choices từ store node', async () => {
    const store = useStoryDialogueStore();
    store.node = makeNode();
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    const modal = document.querySelector('[data-testid="story-dialogue-modal"]');
    expect(modal).not.toBeNull();
    expect(
      document.querySelector('[data-testid="story-dialogue-text"]')?.textContent,
    ).toContain('Lời chào của trưởng môn.');
    // Render 4 choice (kể cả disabled).
    expect(
      document.querySelector('[data-testid="story-dialogue-choice-respect"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="story-dialogue-choice-doubt"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="story-dialogue-choice-locked"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="story-dialogue-choice-already"]'),
    ).not.toBeNull();
  });

  it('available=false hoặc alreadyApplied=true → button disabled', async () => {
    const store = useStoryDialogueStore();
    store.node = makeNode();
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    const respectBtn = document.querySelector(
      '[data-testid="story-dialogue-choice-respect"]',
    ) as HTMLButtonElement;
    const lockedBtn = document.querySelector(
      '[data-testid="story-dialogue-choice-locked"]',
    ) as HTMLButtonElement;
    const alreadyBtn = document.querySelector(
      '[data-testid="story-dialogue-choice-already"]',
    ) as HTMLButtonElement;
    expect(respectBtn.disabled).toBe(false);
    expect(lockedBtn.disabled).toBe(true);
    expect(alreadyBtn.disabled).toBe(true);
    // Đã chọn shows "Đã chọn" hint.
    expect(alreadyBtn.textContent).toContain('Đã chọn');
    // Locked shows "Chưa mở" hint.
    expect(lockedBtn.textContent).toContain('Chưa mở');
  });

  it('click choice available → gọi store.pickChoice + dispatch effectsApplied', async () => {
    const store = useStoryDialogueStore();
    store.node = makeNode();
    store.activeNpcKey = 'npc_test';
    vi.mocked(api.submitStoryDialogueChoice).mockResolvedValue({
      effectsApplied: [
        { kind: 'set_flag', flagKey: 'attitude', value: 'respect' },
        { kind: 'give_reward', linhThach: 20 },
        { kind: 'mark_seen' },
      ],
      granted: { linhThach: 20, tienNgoc: 0, exp: 0 },
      flags: { attitude: 'respect' },
      seen: ['story_dlg_test_intro'],
      choices: { story_dlg_test_intro: 'respect' },
      affinityChanges: [],
      nextNode: null,
    });
    const w = mountModal();
    await w.vm.$nextTick();
    const respectBtn = document.querySelector(
      '[data-testid="story-dialogue-choice-respect"]',
    ) as HTMLButtonElement;
    respectBtn.click();
    await new Promise((r) => setTimeout(r, 0));
    await w.vm.$nextTick();
    expect(api.submitStoryDialogueChoice).toHaveBeenCalledWith(
      'npc_test',
      'story_dlg_test_intro',
      'respect',
    );
    expect(w.emitted('effectsApplied')).toHaveLength(1);
  });

  it('error state — render error message khi store.error có value', async () => {
    const store = useStoryDialogueStore();
    store.error = 'INVALID_CHOICE';
    store.node = makeNode();
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    const errEl = document.querySelector('[data-testid="story-dialogue-error"]');
    expect(errEl).not.toBeNull();
    expect(errEl?.textContent).toContain('Lựa chọn không hợp lệ.');
  });

  it('Esc key → đóng modal (emit close)', async () => {
    const store = useStoryDialogueStore();
    store.node = makeNode();
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await w.vm.$nextTick();
    expect(w.emitted('close')).toHaveLength(1);
  });

  it('loading state — render loading text', async () => {
    const store = useStoryDialogueStore();
    store.loading = true;
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    expect(
      document.querySelector('[data-testid="story-dialogue-loading"]')?.textContent,
    ).toContain('Đang tải…');
  });

  // Phase 12.9 — "Đã chọn lần trước" badge khi previouslyChosen=true.
  it('previouslyChosen=true → render last-chosen badge + giữ button enable', async () => {
    const store = useStoryDialogueStore();
    const node = makeNode();
    // Mark `respect` as previously chosen (player từng pick — giờ revisit node).
    node.previousChoiceKey = 'respect';
    node.choices = node.choices.map((c) =>
      c.key === 'respect' ? { ...c, previouslyChosen: true } : c,
    );
    store.node = node;
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    const respectBtn = document.querySelector(
      '[data-testid="story-dialogue-choice-respect"]',
    ) as HTMLButtonElement;
    // Badge node được render (dedicated data-testid).
    const badge = document.querySelector('[data-testid="story-dialogue-last-respect"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('Đã chọn lần trước');
    // Button vẫn enable — previouslyChosen KHÔNG block re-pick.
    expect(respectBtn.disabled).toBe(false);
    // Choice khác không có badge.
    const doubtBadge = document.querySelector('[data-testid="story-dialogue-last-doubt"]');
    expect(doubtBadge).toBeNull();
  });

  it('alreadyApplied có precedence trên previouslyChosen — chỉ render "Đã chọn" hint', async () => {
    const store = useStoryDialogueStore();
    const node = makeNode();
    node.previousChoiceKey = 'already';
    node.choices = node.choices.map((c) =>
      c.key === 'already' ? { ...c, previouslyChosen: true } : c,
    );
    store.node = node;
    store.activeNpcKey = 'npc_test';
    const w = mountModal();
    await w.vm.$nextTick();
    const alreadyBtn = document.querySelector(
      '[data-testid="story-dialogue-choice-already"]',
    ) as HTMLButtonElement;
    // alreadyApplied disabled + render "Đã chọn" hint, KHÔNG render last-chosen badge
    // (alreadyChosen v-else-if chain win trước previouslyChosen).
    expect(alreadyBtn.disabled).toBe(true);
    expect(alreadyBtn.textContent).toContain('Đã chọn');
    expect(alreadyBtn.textContent).not.toContain('Đã chọn lần trước');
    const lastBadge = document.querySelector('[data-testid="story-dialogue-last-already"]');
    expect(lastBadge).toBeNull();
  });
});

describe('useStoryDialogueStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(api.fetchStoryDialogue).mockReset();
    vi.mocked(api.submitStoryDialogueChoice).mockReset();
  });

  it('open() loads node + sets activeNpcKey', async () => {
    const store = useStoryDialogueStore();
    vi.mocked(api.fetchStoryDialogue).mockResolvedValue(makeNode());
    await store.open('npc_test');
    expect(store.activeNpcKey).toBe('npc_test');
    expect(store.node?.nodeId).toBe('story_dlg_test_intro');
    expect(store.error).toBeNull();
  });

  it('open() with API error sets error code', async () => {
    const store = useStoryDialogueStore();
    vi.mocked(api.fetchStoryDialogue).mockRejectedValue({ code: 'NPC_LOCKED_REALM' });
    await store.open('npc_test');
    expect(store.error).toBe('NPC_LOCKED_REALM');
    expect(store.node).toBeNull();
  });

  it('pickChoice() navigates to nextNode if returned', async () => {
    const store = useStoryDialogueStore();
    vi.mocked(api.fetchStoryDialogue).mockResolvedValue(makeNode());
    await store.open('npc_test');
    const next: api.StoryDialogueNodeView = {
      ...makeNode(),
      nodeId: 'story_dlg_test_next',
      text: 'Tiếp theo.',
    };
    vi.mocked(api.submitStoryDialogueChoice).mockResolvedValue({
      effectsApplied: [],
      granted: { linhThach: 0, tienNgoc: 0, exp: 0 },
      flags: {},
      seen: ['story_dlg_test_intro'],
      choices: { story_dlg_test_intro: 'respect' },
      affinityChanges: [],
      nextNode: next,
    });
    const result = await store.pickChoice('respect');
    expect(result?.nextNode?.nodeId).toBe('story_dlg_test_next');
    expect(store.node?.nodeId).toBe('story_dlg_test_next');
  });

  it('pickChoice() with null nextNode clears node (close intent)', async () => {
    const store = useStoryDialogueStore();
    vi.mocked(api.fetchStoryDialogue).mockResolvedValue(makeNode());
    await store.open('npc_test');
    vi.mocked(api.submitStoryDialogueChoice).mockResolvedValue({
      effectsApplied: [],
      granted: { linhThach: 20, tienNgoc: 0, exp: 0 },
      flags: {},
      seen: ['story_dlg_test_intro'],
      choices: { story_dlg_test_intro: 'respect' },
      affinityChanges: [],
      nextNode: null,
    });
    await store.pickChoice('respect');
    expect(store.node).toBeNull();
  });

  it('close() resets state', async () => {
    const store = useStoryDialogueStore();
    vi.mocked(api.fetchStoryDialogue).mockResolvedValue(makeNode());
    await store.open('npc_test');
    store.close();
    expect(store.activeNpcKey).toBeNull();
    expect(store.node).toBeNull();
    expect(store.error).toBeNull();
  });
});
