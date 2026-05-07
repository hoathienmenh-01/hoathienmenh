import { afterEach, describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import StoryDungeonRewardModal from '@/components/StoryDungeonRewardModal.vue';
import type { StoryDungeonClaimResult } from '@/api/storyDungeon';

/**
 * Phase 12.8.D — StoryDungeonRewardModal UI test coverage.
 *
 * Cover §F mục "renders reward, close emit":
 *   - render khi có `result`, đóng khi `null`.
 *   - render `linhThach`, `tienNgoc`, `exp` chips chỉ khi > 0.
 *   - render items[] với tên item resolve qua `itemByKey` (fallback raw key).
 *   - emit `close` qua: nút Đóng / backdrop / Esc.
 */

const messages = {
  vi: {
    common: { close: 'Đóng' },
    storyDungeon: {
      reward: {
        modalTitle: 'Lĩnh thưởng bí cảnh cốt truyện',
        modalSubtitle: 'Đã hoàn tất bí cảnh {templateKey}.',
        linhThach: '+{n} Linh thạch',
        tienNgoc: '+{n} Tiên ngọc',
        exp: '+{n} EXP',
        item: '{name} ×{qty}',
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

function mountModal(result: StoryDungeonClaimResult | null) {
  return mount(StoryDungeonRewardModal, {
    attachTo: document.body,
    props: { result },
    global: { plugins: [makeI18n()] },
  });
}

function buildResult(
  partial: Partial<StoryDungeonClaimResult['granted']> & { templateKey?: string } = {},
): StoryDungeonClaimResult {
  return {
    runId: 'r1',
    templateKey: partial.templateKey ?? 'story_son_coc_intro',
    claimedAt: '2026-05-07T02:00:00.000Z',
    granted: {
      linhThach: partial.linhThach ?? 0,
      tienNgoc: partial.tienNgoc ?? 0,
      exp: partial.exp ?? 0,
      items: partial.items ?? [],
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('StoryDungeonRewardModal — open/close', () => {
  it('result=null → KHÔNG render modal', () => {
    const w = mountModal(null);
    expect(document.querySelector('[data-testid="story-dungeon-reward-modal"]')).toBeNull();
    w.unmount();
  });

  it('result set → render modal + subtitle templateKey', async () => {
    const w = mountModal(buildResult({ templateKey: 'story_son_coc_intro', linhThach: 100 }));
    await flushPromises();
    const modal = document.querySelector('[data-testid="story-dungeon-reward-modal"]');
    expect(modal).not.toBeNull();
    expect(modal?.textContent).toContain('story_son_coc_intro');
    w.unmount();
  });
});

describe('StoryDungeonRewardModal — render reward chips', () => {
  it('linhThach > 0 → render +N Linh thạch chip', async () => {
    const w = mountModal(buildResult({ linhThach: 250 }));
    await flushPromises();
    const chip = document.querySelector('[data-testid="story-dungeon-reward-linh-thach"]');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toContain('250');
    w.unmount();
  });

  it('linhThach = 0 → KHÔNG render chip linh-thach', async () => {
    const w = mountModal(buildResult({ linhThach: 0, exp: 100 }));
    await flushPromises();
    expect(document.querySelector('[data-testid="story-dungeon-reward-linh-thach"]')).toBeNull();
    w.unmount();
  });

  it('tienNgoc > 0 → render chip', async () => {
    const w = mountModal(buildResult({ tienNgoc: 5 }));
    await flushPromises();
    const chip = document.querySelector('[data-testid="story-dungeon-reward-tien-ngoc"]');
    expect(chip?.textContent).toContain('5');
    w.unmount();
  });

  it('exp > 0 → render chip', async () => {
    const w = mountModal(buildResult({ exp: 800 }));
    await flushPromises();
    const chip = document.querySelector('[data-testid="story-dungeon-reward-exp"]');
    expect(chip?.textContent).toContain('800');
    w.unmount();
  });

  it('items[] → render từng item theo index, qty hiển thị đúng', async () => {
    const w = mountModal(
      buildResult({
        items: [
          { itemKey: 'item_unknown_test_only', qty: 3 },
          { itemKey: 'item_other_unknown_test', qty: 1 },
        ],
      }),
    );
    await flushPromises();
    const it0 = document.querySelector('[data-testid="story-dungeon-reward-item-0"]');
    expect(it0).not.toBeNull();
    expect(it0?.textContent).toContain('3');
    // Fallback raw key khi `itemByKey` không tìm được — verify behavior: hiện thị raw key.
    expect(it0?.textContent).toContain('item_unknown_test_only');
    const it1 = document.querySelector('[data-testid="story-dungeon-reward-item-1"]');
    expect(it1).not.toBeNull();
    expect(it1?.textContent).toContain('1');
    w.unmount();
  });
});

describe('StoryDungeonRewardModal — close emit', () => {
  it('click nút Đóng → emit close', async () => {
    const w = mountModal(buildResult({ linhThach: 100 }));
    await flushPromises();
    const btn = document.querySelector(
      '[data-testid="story-dungeon-reward-close"]',
    ) as HTMLElement;
    btn.click();
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('click backdrop → emit close', async () => {
    const w = mountModal(buildResult({ linhThach: 100 }));
    await flushPromises();
    const modal = document.querySelector(
      '[data-testid="story-dungeon-reward-modal"]',
    ) as HTMLElement;
    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('press Esc khi modal mở → emit close', async () => {
    const w = mountModal(buildResult({ linhThach: 100 }));
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toBeTruthy();
    w.unmount();
  });

  it('press Esc khi modal đóng (result=null) → KHÔNG emit close', async () => {
    const w = mountModal(null);
    await flushPromises();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(w.emitted('close')).toBeFalsy();
    w.unmount();
  });
});
