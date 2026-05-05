import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const acceptQuestMock = vi.fn();
const fetchNpcsMock = vi.fn();
const fetchNpcDialogueMock = vi.fn();

vi.mock('@/api/quest', () => ({
  acceptQuest: (...a: unknown[]) => acceptQuestMock(...a),
}));

vi.mock('@/api/npc', () => ({
  fetchNpcs: (...a: unknown[]) => fetchNpcsMock(...a),
  fetchNpcDialogue: (...a: unknown[]) => fetchNpcDialogueMock(...a),
}));

import NpcDialogueModal from '@/components/NpcDialogueModal.vue';
import { useNpcStore } from '@/stores/npc';
import { useToastStore } from '@/stores/toast';
import type { NpcDialogueView } from '@/api/npc';

const STUB_DIALOGUE: NpcDialogueView = {
  dialogueId: 'dlg_lang_van_sinh_default',
  speakerNpcKey: 'npc_lang_van_sinh',
  text: 'Chào con, hôm nay đến đây có việc gì?',
  choices: [
    {
      key: 'accept_quest',
      label: 'Đệ tử xin nhận Hoa Thiên Tuyển Đồ.',
      nextDialogueId: null,
      acceptQuestKey: 'phamnhan_main_01',
      acceptQuestStatus: 'NOT_STARTED',
      closeDialogue: true,
    },
    {
      key: 'leave',
      label: 'Đệ tử xin cáo lui.',
      nextDialogueId: null,
      acceptQuestKey: null,
      acceptQuestStatus: null,
      closeDialogue: true,
    },
  ],
};

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { close: 'Đóng', loading: 'Đang xử lý…', loadingData: 'Đang tải dữ liệu…' },
      npc: {
        dialogue: {
          empty: 'Trống.',
          acceptOk: 'Đã nhận {quest}.',
          questStatus: {
            ACCEPTED: 'Đã nhận',
            COMPLETED: 'Đã hoàn thành',
            CLAIMED: 'Đã lĩnh thưởng',
            LOCKED: 'Chưa mở',
          },
          errors: {
            UNKNOWN: 'Lỗi.',
            QUEST_LOCKED_REALM: 'Cảnh giới chưa đủ.',
          },
        },
      },
    },
  },
});

function mountModal(props: Record<string, unknown> = {}) {
  return mount(NpcDialogueModal, {
    attachTo: document.body,
    props: {
      npcKey: 'npc_lang_van_sinh',
      npcName: 'Lăng Vân Sinh',
      description: 'Chưởng môn Hoa Thiên Môn.',
      ...props,
    },
    global: { plugins: [i18n] },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  acceptQuestMock.mockReset();
  fetchNpcsMock.mockReset();
  fetchNpcDialogueMock.mockReset();
  document.body.innerHTML = '';
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('NpcDialogueModal — render', () => {
  it('không render khi npcKey=null', () => {
    mountModal({ npcKey: null });
    expect(document.querySelector('[data-testid="npc-dialogue-modal"]')).toBeNull();
  });

  it('render text + choices khi store có dialogue', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = STUB_DIALOGUE;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    mountModal();
    await flushPromises();
    const modal = document.querySelector('[data-testid="npc-dialogue-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('Lăng Vân Sinh');
    expect(modal?.textContent).toContain('Chào con');
    expect(
      document.querySelector('[data-testid="npc-dialogue-choice-accept_quest"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="npc-dialogue-choice-leave"]'),
    ).not.toBeNull();
  });

  it('loading state khi store dialogueLoading=true', async () => {
    const npcStore = useNpcStore();
    npcStore.dialogueLoading = true;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    mountModal();
    await flushPromises();
    expect(
      document.querySelector('[data-testid="npc-dialogue-loading"]'),
    ).not.toBeNull();
  });

  it('error state khi store dialogueError set + render empty state khi không có dialogue', async () => {
    const npcStore = useNpcStore();
    npcStore.dialogueError = 'QUEST_LOCKED_REALM';
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    mountModal();
    await flushPromises();
    const errEl = document.querySelector('[data-testid="npc-dialogue-error"]');
    expect(errEl).not.toBeNull();
    expect(errEl?.textContent).toContain('Cảnh giới chưa đủ');
  });
});

describe('NpcDialogueModal — interactions', () => {
  it('click choice không có acceptQuest → emit close', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = STUB_DIALOGUE;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    const wrapper = mountModal();
    await flushPromises();
    const leaveBtn = document.querySelector(
      '[data-testid="npc-dialogue-choice-leave"]',
    ) as HTMLButtonElement;
    leaveBtn.click();
    await flushPromises();
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('click choice acceptQuest → call acceptQuest + reload + emit questAccepted + toast success', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = STUB_DIALOGUE;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    acceptQuestMock.mockResolvedValueOnce(undefined);
    fetchNpcsMock.mockResolvedValueOnce([]);
    fetchNpcDialogueMock.mockResolvedValueOnce(STUB_DIALOGUE);
    const wrapper = mountModal();
    await flushPromises();
    const acceptBtn = document.querySelector(
      '[data-testid="npc-dialogue-choice-accept_quest"]',
    ) as HTMLButtonElement;
    acceptBtn.click();
    await flushPromises();
    expect(acceptQuestMock).toHaveBeenCalledWith('phamnhan_main_01');
    expect(fetchNpcsMock).toHaveBeenCalledTimes(1);
    expect(fetchNpcDialogueMock).toHaveBeenCalledWith('npc_lang_van_sinh');
    expect(wrapper.emitted('questAccepted')).toEqual([['phamnhan_main_01']]);
    const toast = useToastStore();
    expect(toast.toasts[0]?.type).toBe('success');
  });

  it('acceptQuest fail (envelope code) → toast error theo i18n', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = STUB_DIALOGUE;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    acceptQuestMock.mockRejectedValueOnce({ code: 'QUEST_LOCKED_REALM', message: 'x' });
    mountModal();
    await flushPromises();
    const acceptBtn = document.querySelector(
      '[data-testid="npc-dialogue-choice-accept_quest"]',
    ) as HTMLButtonElement;
    acceptBtn.click();
    await flushPromises();
    const toast = useToastStore();
    expect(toast.toasts[0]?.type).toBe('error');
    expect(toast.toasts[0]?.text).toBe('Cảnh giới chưa đủ.');
  });

  it('choice acceptQuestStatus=ACCEPTED → button disabled + hint hiển thị "Đã nhận"', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = {
      ...STUB_DIALOGUE,
      choices: [
        {
          ...STUB_DIALOGUE.choices[0],
          acceptQuestStatus: 'ACCEPTED',
        },
        STUB_DIALOGUE.choices[1],
      ],
    };
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    mountModal();
    await flushPromises();
    const acceptBtn = document.querySelector(
      '[data-testid="npc-dialogue-choice-accept_quest"]',
    ) as HTMLButtonElement;
    expect(acceptBtn.disabled).toBe(true);
    expect(acceptBtn.textContent).toContain('Đã nhận');
  });

  it('click backdrop → emit close', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = STUB_DIALOGUE;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    const wrapper = mountModal();
    await flushPromises();
    const backdrop = document.querySelector(
      '[data-testid="npc-dialogue-modal"]',
    ) as HTMLDivElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushPromises();
    // Self-click only — manual dispatch sets target=backdrop.
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('Escape khi không submit → emit close', async () => {
    const npcStore = useNpcStore();
    npcStore.activeDialogue = STUB_DIALOGUE;
    npcStore.activeNpcKey = 'npc_lang_van_sinh';
    const wrapper = mountModal();
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
