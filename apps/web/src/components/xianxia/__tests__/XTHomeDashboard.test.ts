import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import XTHomeDashboard from '@/components/xianxia/XTHomeDashboard.vue';

/**
 * Cửu Thiên Mộng UI-3.2 — `XTHomeDashboard` composer.
 *
 * Cover:
 *   - render được khi nhúng vào AppShell (`chrome="embedded"`).
 *   - render đủ 4 vùng test-id chính (hero / stat / feature / panels).
 *   - desktop (>= 1024px): hiện feature card "Tu luyện", "Boss & Phụ bản",
 *     "PvP & Đấu trường", "Tông môn", "Nhiệm vụ", "Cửa hàng".
 *   - mobile (< 768px) khi `chrome="standalone"`: hiện bottom-nav + mobile
 *     header và icon grid.
 *   - không có ký tự Hán nào trong DOM output.
 */
function buildRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/cultivation', component: { template: '<div/>' } },
      { path: '/missions', component: { template: '<div/>' } },
      { path: '/inventory', component: { template: '<div/>' } },
      { path: '/world', component: { template: '<div/>' } },
      { path: '/wallet', component: { template: '<div/>' } },
      { path: '/mail', component: { template: '<div/>' } },
      { path: '/settings', component: { template: '<div/>' } },
    ],
  });
}

function setViewport(width: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  // jsdom matchMedia stub — only `(min-width: 1024px)` query is used.
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const minMatch = query.match(/min-width:\s*(\d+)px/);
    const matches = minMatch ? width >= Number(minMatch[1]) : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  });
}

describe('XTHomeDashboard', () => {
  let router: Router;

  beforeEach(() => {
    router = buildRouter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('embedded + desktop: render hero / stat tiles / feature grid / panels', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    expect(w.find('[data-testid="home-dashboard"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-hero"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-stat-tiles"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-feature-grid"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-quest-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-inventory-panel"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-sect-chat-panel"]').exists()).toBe(true);
  });

  it('embedded + desktop: hiển thị các chức năng game chính', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const text = w.text();
    expect(text).toContain('Xuân Tôi');
    expect(text).toContain('Cửu Thiên Mộng');
    expect(text).toContain('Tu luyện');
    expect(text).toContain('Boss & Phụ bản');
    expect(text).toContain('PvP & Đấu trường');
    expect(text).toContain('Tông môn');
    expect(text).toContain('Nhiệm vụ');
    expect(text).toContain('Cửa hàng');
  });

  it('embedded + desktop: không có ký tự Hán nào trong DOM', async () => {
    setViewport(1280);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'embedded' },
      global: { plugins: [router] },
    });
    await router.isReady();
    const html = w.html();
    expect(html).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('standalone + mobile: render mobile header + bottom nav + icon grid', async () => {
    setViewport(420);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router] },
    });
    await router.isReady();
    expect(w.find('[data-testid="home-dashboard"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-bottom-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-hero-mobile"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-feature-grid"]').exists()).toBe(true);
  });

  it('standalone + desktop: render sidebar chrome', async () => {
    setViewport(1440);
    const w = mount(XTHomeDashboard, {
      props: { chrome: 'standalone' },
      global: { plugins: [router] },
    });
    await router.isReady();
    expect(w.find('[data-testid="home-sidebar"]').exists()).toBe(true);
    expect(w.find('[data-testid="home-bottom-nav"]').exists()).toBe(false);
  });
});
