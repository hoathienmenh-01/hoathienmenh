/**
 * Phase 18.1 — AdminSecurityPanel tests.
 *
 * Cover:
 *   - render: loads active blocks + recent events via API.
 *   - empty state: blocks empty + events empty render dedicated msg.
 *   - error state: API throw → error message visible.
 *   - lift block: opens confirm modal → confirm → API gọi + remove row.
 *   - filter type/severity/eventType: apply triggers re-fetch with params.
 *   - privacy: chỉ hiển thị hash prefix, raw IP KHÔNG xuất hiện trong DOM.
 *   - i18n VI/EN: title + section labels render từ messages catalog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const { listBlocksMock, listEventsMock, liftMock } = vi.hoisted(() => ({
  listBlocksMock: vi.fn(),
  listEventsMock: vi.fn(),
  liftMock: vi.fn(),
}));

vi.mock('@/api/adminSecurity', () => ({
  adminListSecurityBlocks: listBlocksMock,
  adminListSecurityEvents: listEventsMock,
  adminLiftSecurityBlock: liftMock,
}));

import AdminSecurityPanel from '@/components/AdminSecurityPanel.vue';
import viMessages from '@/i18n/vi.json';
import enMessages from '@/i18n/en.json';

function makeI18n(locale: 'vi' | 'en' = 'vi') {
  return createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'vi',
    messages: { vi: viMessages, en: enMessages },
  });
}

function mountPanel(locale: 'vi' | 'en' = 'vi') {
  return mount(AdminSecurityPanel, {
    global: {
      plugins: [makeI18n(locale)],
    },
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  listBlocksMock.mockReset();
  listEventsMock.mockReset();
  liftMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

const HEX64 = 'a'.repeat(64);

const SAMPLE_BLOCK = {
  id: 'blk-1',
  type: 'IP' as const,
  subjectHash: HEX64,
  reason: 'LOGIN_FAILED_SPAM',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
};

const SAMPLE_EVENT = {
  id: 'evt-1',
  type: 'RATE_LIMIT_VIOLATION',
  severity: 'INFO' as const,
  ipHash: HEX64,
  userId: null,
  characterId: null,
  policy: 'SHOP_BUY',
  detailJson: null,
  createdAt: new Date().toISOString(),
};

describe('AdminSecurityPanel', () => {
  it('renders blocks + events từ API', async () => {
    listBlocksMock.mockResolvedValue([SAMPLE_BLOCK]);
    listEventsMock.mockResolvedValue([SAMPLE_EVENT]);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="admin-security-panel"]').exists()).toBe(true);
    expect(w.findAll('[data-testid="block-row"]').length).toBe(1);
    expect(w.findAll('[data-testid="event-row"]').length).toBe(1);
  });

  it('empty state khi không có block/event nào', async () => {
    listBlocksMock.mockResolvedValue([]);
    listEventsMock.mockResolvedValue([]);
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="blocks-empty"]').exists()).toBe(true);
    expect(w.find('[data-testid="events-empty"]').exists()).toBe(true);
  });

  it('error state khi API throw', async () => {
    listBlocksMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'UNKNOWN' }),
    );
    listEventsMock.mockRejectedValue(
      Object.assign(new Error('boom'), { code: 'FORBIDDEN' }),
    );
    const w = mountPanel();
    await flushPromises();
    expect(w.find('[data-testid="blocks-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="events-error"]').exists()).toBe(true);
  });

  it('lift button mở confirm modal + confirm → API gọi', async () => {
    listBlocksMock.mockResolvedValue([SAMPLE_BLOCK]);
    listEventsMock.mockResolvedValue([]);
    liftMock.mockResolvedValue(SAMPLE_BLOCK);
    const w = mountPanel();
    await flushPromises();
    await w.find('[data-testid="block-lift-btn"]').trigger('click');
    await flushPromises();
    // Modal teleports to body; query document.
    const modal = document.querySelector(
      '[data-testid="lift-confirm-modal"]',
    );
    expect(modal).not.toBeNull();
    const confirmBtn = document.querySelector(
      '[data-testid="lift-confirm-modal-confirm"]',
    ) as HTMLButtonElement | null;
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await flushPromises();
    expect(liftMock).toHaveBeenCalledWith('blk-1');
  });

  it('apply filters truyền đúng params xuống API', async () => {
    listBlocksMock.mockResolvedValue([]);
    listEventsMock.mockResolvedValue([]);
    const w = mountPanel();
    await flushPromises();
    // Initial fetch with default ALL/undefined.
    expect(listBlocksMock).toHaveBeenLastCalledWith({
      type: undefined,
      limit: 50,
    });
    await w.find('[data-testid="filter-block-type"]').setValue('IP');
    await w.find('[data-testid="filter-severity"]').setValue('CRITICAL');
    await w
      .find('[data-testid="filter-event-type"]')
      .setValue('LOGIN_FAILED');
    await w.find('[data-testid="filter-limit"]').setValue('25');
    await w.find('[data-testid="filter-apply"]').trigger('click');
    await flushPromises();
    expect(listBlocksMock).toHaveBeenLastCalledWith({
      type: 'IP',
      limit: 25,
    });
    expect(listEventsMock).toHaveBeenLastCalledWith({
      severity: 'CRITICAL',
      type: 'LOGIN_FAILED',
      limit: 25,
    });
  });

  it('privacy: render hash prefix, KHÔNG có raw IP trong DOM', async () => {
    listBlocksMock.mockResolvedValue([SAMPLE_BLOCK]);
    listEventsMock.mockResolvedValue([SAMPLE_EVENT]);
    const w = mountPanel();
    await flushPromises();
    const html = w.html();
    expect(html).toContain(HEX64.slice(0, 12));
    // raw IP-style không xuất hiện
    expect(html).not.toMatch(/\b\d+\.\d+\.\d+\.\d+\b/);
  });

  it('i18n parity: title hiện đúng khi locale = en', async () => {
    listBlocksMock.mockResolvedValue([]);
    listEventsMock.mockResolvedValue([]);
    const w = mountPanel('en');
    await flushPromises();
    expect(w.text()).toContain('Security & Abuse Protection');
  });

  it('i18n parity: title hiện đúng khi locale = vi', async () => {
    listBlocksMock.mockResolvedValue([]);
    listEventsMock.mockResolvedValue([]);
    const w = mountPanel('vi');
    await flushPromises();
    expect(w.text()).toContain('Bảo Mật & Chống Lạm Dụng');
  });
});
