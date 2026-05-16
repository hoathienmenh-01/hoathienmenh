/**
 * Phase 42.0 — RareDropPopup + RareDropQueueHost tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import RareDropPopup from '../RareDropPopup.vue';
import RareDropQueueHost from '../RareDropQueueHost.vue';
import viMessages from '@/i18n/vi.json';

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

describe('RareDropPopup', () => {
  it('renders legendary item with rarity color border', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'Hỏa Vân Đan', rarity: 'LEGENDARY', source: 'Tower 7' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.attributes('data-rarity')).toBe('LEGENDARY');
    expect(el.text()).toContain('Hỏa Vân Đan');
    expect(el.text()).toContain('Tower 7');
    // Cửu Thiên Mộng: LEGENDARY now uses the gold border token.
    expect(
      el.classes().some((c) => c.includes('xt-border-gold')),
    ).toBe(true);
  });

  it('reducedMotion → no pop animation', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'X', rarity: 'EPIC', reducedMotion: true },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.classes().some((c) => c.includes('ve-anim-rare-drop-pop'))).toBe(false);
  });

  it('quantity > 1 appended', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'X', rarity: 'RARE', quantity: 5 },
      global: { plugins: [makeI18n()] },
    });
    expect(w.text()).toContain('×5');
  });

  it('LEGENDARY drop renders cuộn lụa overlay', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'Hỏa Vân Đan', rarity: 'LEGENDARY' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.attributes('data-silk-scroll')).toBe('true');
    expect(el.classes().some((c) => c.includes('ve-anim-silk-unfurl'))).toBe(true);
    expect(w.find('[data-testid="rare-drop-silk-roller-top"]').exists()).toBe(true);
    expect(w.find('[data-testid="rare-drop-silk-roller-bottom"]').exists()).toBe(true);
    expect(w.find('[data-testid="rare-drop-silk-shimmer"]').exists()).toBe(true);
  });

  it('MYTHIC drop renders cuộn lụa overlay', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'X', rarity: 'MYTHIC' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.attributes('data-silk-scroll')).toBe('true');
    expect(w.find('[data-testid="rare-drop-silk-roller-top"]').exists()).toBe(true);
  });

  it('EPIC drop does NOT render cuộn lụa overlay', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'X', rarity: 'EPIC' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.attributes('data-silk-scroll')).toBe('false');
    expect(w.find('[data-testid="rare-drop-silk-roller-top"]').exists()).toBe(false);
    expect(el.classes().some((c) => c.includes('ve-anim-silk-unfurl'))).toBe(false);
  });

  it('reducedMotion → no cuộn lụa even on MYTHIC', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'X', rarity: 'MYTHIC', reducedMotion: true },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.attributes('data-silk-scroll')).toBe('false');
    expect(w.find('[data-testid="rare-drop-silk-roller-top"]').exists()).toBe(false);
  });

  it('visualEffectLevel=OFF → no cuộn lụa even on LEGENDARY', () => {
    const w = mount(RareDropPopup, {
      props: { itemName: 'X', rarity: 'LEGENDARY', visualEffectLevel: 'OFF' },
      global: { plugins: [makeI18n()] },
    });
    const el = w.get('[data-testid="rare-drop-popup"]');
    expect(el.attributes('data-silk-scroll')).toBe('false');
    expect(w.find('[data-testid="rare-drop-silk-roller-top"]').exists()).toBe(false);
  });
});

describe('RareDropQueueHost', () => {
  it('respects maxVisible', () => {
    const w = mount(RareDropQueueHost, {
      props: {
        entries: [
          { id: '1', itemName: 'A', rarity: 'RARE' },
          { id: '2', itemName: 'B', rarity: 'EPIC' },
          { id: '3', itemName: 'C', rarity: 'LEGENDARY' },
          { id: '4', itemName: 'D', rarity: 'MYTHIC' },
        ],
        maxVisible: 2,
      },
      global: { plugins: [makeI18n()] },
    });
    const host = w.get('[data-testid="rare-drop-queue-host"]');
    expect(host.attributes('data-visible')).toBe('2');
    expect(host.attributes('data-total')).toBe('4');
    const popups = w.findAll('[data-testid="rare-drop-popup"]');
    expect(popups.length).toBe(2);
  });
});
