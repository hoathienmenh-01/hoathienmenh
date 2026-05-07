import { afterEach, describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import StoryDungeonDialoguePanel from '@/components/StoryDungeonDialoguePanel.vue';

/**
 * Phase 12.8.D — StoryDungeonDialoguePanel UI test coverage.
 *
 * Cover §F mục 1 (open/close + render dialogue) cho `StoryDungeonDialoguePanel.vue`:
 *   - open khi `nodeId` set, đóng khi `null` (Teleport-to-body bypass).
 *   - render NPC name từ `NPCS` catalog + dialogue text từ `STORY_DIALOGUES`.
 *   - emit `close` khi: Esc / backdrop click / nút ✕ / nút "Đóng".
 *   - locale=`en` → render `textEn` nếu node có.
 *   - fallback `narratorFallback` khi node không tồn tại trong catalog.
 *
 * Server-authoritative: panel chỉ render snapshot từ shared catalog, không gọi API.
 */

const messages = {
  vi: {
    common: { close: 'Đóng' },
    storyDungeon: {
      dialogue: {
        narratorFallback: 'Người dẫn chuyện',
        empty: 'Chưa có nội dung lời thoại.',
      },
    },
  },
  en: {
    common: { close: 'Close' },
    storyDungeon: {
      dialogue: {
        narratorFallback: 'Narrator',
        empty: 'No dialogue available.',
      },
    },
  },
};

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    missingWarn: false,
    fallbackWarn: false,
    messages,
  });
}

function mountPanel(props: {
  nodeId: string | null;
  fallbackNpcName?: string | null;
  locale?: 'vi' | 'en';
}) {
  return mount(StoryDungeonDialoguePanel, {
    attachTo: document.body,
    props: {
      nodeId: props.nodeId,
      fallbackNpcName: props.fallbackNpcName ?? null,
    },
    global: { plugins: [makeI18n(props.locale ?? 'vi')] },
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StoryDungeonDialoguePanel — open/close', () => {
  it('nodeId=null → KHÔNG render panel (đóng)', () => {
    const w = mountPanel({ nodeId: null });
    expect(document.querySelector('[data-testid="story-dungeon-dialogue-panel"]')).toBeNull();
    w.unmount();
  });

  it('nodeId hợp lệ → render panel + render NPC name + dialogue text', async () => {
    const w = mountPanel({ nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' });
    await flushPromises();
    const panel = document.querySelector('[data-testid="story-dungeon-dialogue-panel"]');
    expect(panel).not.toBeNull();
    const npc = document.querySelector('[data-testid="story-dungeon-dialogue-npc"]');
    expect(npc?.textContent).toContain('Lăng Vân Sinh');
    const text = document.querySelector('[data-testid="story-dungeon-dialogue-text"]');
    expect(text?.textContent).toContain('Đệ tử mới');
    expect(text?.textContent).toContain('Hoa Thiên Môn');
    w.unmount();
  });

  it('nodeId không tồn tại trong catalog → render fallback narrator + empty placeholder', async () => {
    const w = mountPanel({ nodeId: 'orphan_node_not_in_catalog' });
    await flushPromises();
    const npc = document.querySelector('[data-testid="story-dungeon-dialogue-npc"]');
    expect(npc?.textContent).toContain('Người dẫn chuyện');
    expect(document.querySelector('[data-testid="story-dungeon-dialogue-text"]')).toBeNull();
    expect(document.querySelector('[data-testid="story-dungeon-dialogue-empty"]')).not.toBeNull();
    w.unmount();
  });

  it('nodeId orphan + fallbackNpcName set → render fallback name', async () => {
    const w = mountPanel({
      nodeId: 'orphan_node_not_in_catalog',
      fallbackNpcName: 'Bí cảnh Sơn Cốc',
    });
    await flushPromises();
    const npc = document.querySelector('[data-testid="story-dungeon-dialogue-npc"]');
    expect(npc?.textContent).toContain('Bí cảnh Sơn Cốc');
    w.unmount();
  });

  it('locale=en + node có textEn → render English text', async () => {
    const w = mountPanel({
      nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro',
      locale: 'en',
    });
    await flushPromises();
    const text = document.querySelector('[data-testid="story-dungeon-dialogue-text"]');
    expect(text?.textContent).toContain('New disciple');
    w.unmount();
  });
});

describe('StoryDungeonDialoguePanel — close emit', () => {
  it('click backdrop → emit close', async () => {
    const w = mountPanel({ nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' });
    await flushPromises();
    const panel = document.querySelector(
      '[data-testid="story-dungeon-dialogue-panel"]',
    ) as HTMLElement;
    panel.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('click nút ✕ → emit close', async () => {
    const w = mountPanel({ nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' });
    await flushPromises();
    const btn = document.querySelector(
      '[data-testid="story-dungeon-dialogue-close"]',
    ) as HTMLElement;
    btn.click();
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('click nút Đóng (confirm) → emit close', async () => {
    const w = mountPanel({ nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' });
    await flushPromises();
    const btn = document.querySelector(
      '[data-testid="story-dungeon-dialogue-confirm"]',
    ) as HTMLElement;
    btn.click();
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('press Esc khi panel mở → emit close', async () => {
    const w = mountPanel({ nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' });
    await flushPromises();
    const evt = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(evt);
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('press Esc khi panel đóng → KHÔNG emit close', async () => {
    const w = mountPanel({ nodeId: null });
    await flushPromises();
    const evt = new KeyboardEvent('keydown', { key: 'Escape' });
    window.dispatchEvent(evt);
    expect(w.emitted('close')).toBeFalsy();
    w.unmount();
  });

  it('press khác Esc khi panel mở → KHÔNG emit close', async () => {
    const w = mountPanel({ nodeId: 'story_dlg_lang_van_sinh_chapter_1_intro' });
    await flushPromises();
    const evt = new KeyboardEvent('keydown', { key: 'Enter' });
    window.dispatchEvent(evt);
    expect(w.emitted('close')).toBeFalsy();
    w.unmount();
  });
});
