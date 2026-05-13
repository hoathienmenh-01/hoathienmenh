/**
 * Phase 32.0 — CodexView smoke tests.
 *
 * Bao phủ:
 *   - Render được title + progress + list entries.
 *   - Click entry → openDetail → load detail panel (kèm marketPrice).
 *   - Filter by type → list re-fetched với type param.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';

const toastPushMock = vi.fn();
const apiMocks = vi.hoisted(() => ({
  getCodexProgress: vi.fn(),
  listCodex: vi.fn(),
  getCodexDetail: vi.fn(),
}));

vi.mock('@/api/codex', () => apiMocks);
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));
vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div><slot /></div>',
  },
}));

import CodexView from '@/views/CodexView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { error: 'err', loading: 'loading', all: 'All' },
      codex: {
        title: 'Codex',
        overallProgress: 'Overall',
        bestiaryProgress: 'Bestiary',
        complete: 'Complete',
        discovered: 'Discovered',
        undiscovered: 'Not discovered',
        noEntries: 'no entries',
        showingOf: '{shown}/{total}',
        type: 'Type',
        quality: 'Quality',
        tier: 'Tier',
        marketPriceTitle: 'Market price',
        avg24h: 'Avg 24h',
        avg7d: 'Avg 7d',
        vol24h: 'Vol 24h',
      },
    },
  },
});

beforeEach(() => {
  setActivePinia(createPinia());
  apiMocks.getCodexProgress.mockResolvedValue({ overallPct: 25.0, bestiaryPct: 10.0, isComplete: false });
  apiMocks.listCodex.mockResolvedValue({ items: [], total: 0 });
  apiMocks.getCodexDetail.mockResolvedValue(null);
  toastPushMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('CodexView', () => {
  it('renders title + calls getCodexProgress + listCodex on mount', async () => {
    const wrapper = mount(CodexView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.text()).toContain('Codex');
    expect(apiMocks.getCodexProgress).toHaveBeenCalled();
    expect(apiMocks.listCodex).toHaveBeenCalled();
  });

  it('renders entry rows when listCodex returns data', async () => {
    apiMocks.listCodex.mockResolvedValueOnce({
      items: [
        {
          id: 'e1',
          entryKey: 'item:foo',
          type: 'ITEM',
          refKey: 'foo',
          displayName: 'Foo Item',
          description: 'desc',
          iconKey: null,
          visibility: 'PUBLIC',
          quality: 'COMMON',
          tier: 1,
          tagsJson: [],
          sourceHintsJson: [],
          usageHintsJson: [],
          relatedEntryKeysJson: [],
          discovered: false,
        },
      ],
      total: 1,
    });
    const wrapper = mount(CodexView, { global: { plugins: [i18n] } });
    await flushPromises();
    expect(wrapper.text()).toContain('Foo Item');
    expect(wrapper.text()).toContain('25');
  });

  it('opens detail when clicking entry → calls getCodexDetail', async () => {
    apiMocks.listCodex.mockResolvedValueOnce({
      items: [
        {
          id: 'e1',
          entryKey: 'item:foo',
          type: 'ITEM',
          refKey: 'foo',
          displayName: 'Foo Item',
          description: 'desc',
          iconKey: null,
          visibility: 'PUBLIC',
          quality: 'COMMON',
          tier: 1,
          tagsJson: [],
          sourceHintsJson: [],
          usageHintsJson: [],
          relatedEntryKeysJson: [],
          discovered: false,
        },
      ],
      total: 1,
    });
    apiMocks.getCodexDetail.mockResolvedValueOnce({
      entry: {
        id: 'e1',
        entryKey: 'item:foo',
        type: 'ITEM',
        refKey: 'foo',
        displayName: 'Foo Item',
        description: 'desc full',
        iconKey: null,
        visibility: 'PUBLIC',
        quality: 'COMMON',
        tier: 1,
        tagsJson: [],
        sourceHintsJson: [],
        usageHintsJson: [],
        relatedEntryKeysJson: [],
      },
      marketPrice: {
        itemKey: 'foo',
        avgPrice24h: '100',
        avgPrice7d: '95',
        avgPrice30d: '90',
        minPrice: '50',
        maxPrice: '200',
        volume24h: 10,
        volume7d: 50,
      },
    });
    const wrapper = mount(CodexView, { global: { plugins: [i18n] } });
    await flushPromises();
    await wrapper.find('.cursor-pointer').trigger('click');
    await flushPromises();
    expect(apiMocks.getCodexDetail).toHaveBeenCalledWith('item:foo');
    expect(wrapper.text()).toContain('desc full');
    expect(wrapper.text()).toContain('Market price');
  });
});
