import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/components/xianxia/XTLuxHero.vue', () => ({
  default: {
    name: 'XTLuxHeroStub',
    template: '<div data-testid="lux-hero"><slot /></div>',
    props: ['eyebrow', 'label', 'title', 'subtitle', 'tone', 'watermarkLetter', 'breadcrumb', 'testId'],
  },
}));

vi.mock('@/components/xianxia/XTPageEyebrow.vue', () => ({
  default: { name: 'XTPageEyebrowStub', template: '<div />' },
}));

vi.mock('@/components/SocialPanel.vue', () => ({
  default: { name: 'SocialPanelStub', template: '<div />' },
}));
vi.mock('@/components/PrivateChatPanel.vue', () => ({
  default: { name: 'PrivateChatPanelStub', template: '<div />' },
}));
vi.mock('@/components/GroupChatPanel.vue', () => ({
  default: { name: 'GroupChatPanelStub', template: '<div />' },
}));
vi.mock('@/components/PartyPanel.vue', () => ({
  default: { name: 'PartyPanelStub', template: '<div />' },
}));
vi.mock('@/components/PartyDungeonPanel.vue', () => ({
  default: { name: 'PartyDungeonPanelStub', template: '<div />' },
}));
vi.mock('@/components/CoopBossPanel.vue', () => ({
  default: { name: 'CoopBossPanelStub', template: '<div />' },
}));
vi.mock('@/components/CoopWeeklyLeaderboardPanel.vue', () => ({
  default: { name: 'CoopWeeklyLeaderboardPanelStub', template: '<div />' },
}));
vi.mock('@/components/CoCultivationPanel.vue', () => ({
  default: { name: 'CoCultivationPanelStub', template: '<div />' },
}));

import SocialView from '@/views/SocialView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      social: {
        viewTitle: 'Giang Hồ Giao Tế',
        viewSubtitle: 'Quản lý bạn bè.',
        title: 'Bạn Bè',
        tabs: { friends: 'Bạn Bè', private: 'Chat Riêng', group: 'Nhóm' },
        roleHint: 'Quản lý bạn bè, trò chuyện riêng/nhóm.',
        crossNav: {
          mail: 'Hộp Thư',
          mailDesc: 'Thiên Đạo Thư Các',
          party: 'Tổ Đội',
          partyDesc: 'Nhóm & Hoạt động',
        },
      },
      luxHero: { social: { eyebrow: 'XÃ GIAO', label: 'Xã Giao', breadcrumb: 'Trang chủ · Xã Giao' } },
    },
  },
});

function mountView() {
  return mount(SocialView, { global: { plugins: [i18n] } });
}

describe('SocialView — cross-navigation', () => {
  it('render role hint', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="social-role-hint"]').exists()).toBe(true);
    expect(w.find('[data-testid="social-role-hint"]').text()).toContain('Quản lý bạn bè');
  });

  it('render cross-navigation links', async () => {
    const w = mountView();
    await flushPromises();
    expect(w.find('[data-testid="social-cross-nav"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-mail"]').exists()).toBe(true);
    expect(w.find('[data-testid="cross-nav-party"]').exists()).toBe(true);
  });
});
