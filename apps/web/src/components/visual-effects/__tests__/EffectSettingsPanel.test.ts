/**
 * Phase 42.0 — EffectSettingsPanel + EffectPreviewPanel render tests.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import EffectSettingsPanel from '../EffectSettingsPanel.vue';
import EffectPreviewPanel from '../EffectPreviewPanel.vue';
import {
  DEFAULT_PLAYER_SETTINGS,
  type PlayerSettings,
} from '@xuantoi/shared';
import viMessages from '@/i18n/vi.json';

function makeI18n() {
  return createI18n({
    legacy: false,
    locale: 'vi',
    fallbackLocale: 'vi',
    messages: { vi: viMessages },
  });
}

function makeSettings(overrides: Partial<PlayerSettings> = {}): PlayerSettings {
  return { ...DEFAULT_PLAYER_SETTINGS, ...overrides };
}

describe('EffectSettingsPanel', () => {
  it('renders all toggles', () => {
    const w = mount(EffectSettingsPanel, {
      props: { settings: makeSettings() },
      global: { plugins: [makeI18n()] },
    });
    expect(w.find('[data-testid="effect-settings-level"]').exists()).toBe(true);
    expect(w.find('[data-testid="effect-settings-floating-text"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="effect-settings-rare-drop"]').exists()).toBe(true);
    expect(w.find('[data-testid="effect-settings-boss-warning"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="effect-settings-breakthrough"]').exists()).toBe(
      true,
    );
    expect(w.find('[data-testid="effect-settings-crafting"]').exists()).toBe(true);
    expect(w.find('[data-testid="effect-settings-item-aura"]').exists()).toBe(true);
    expect(w.find('[data-testid="effect-settings-status-bar"]').exists()).toBe(true);
  });

  it('emits patch event on level change', async () => {
    const w = mount(EffectSettingsPanel, {
      props: { settings: makeSettings() },
      global: { plugins: [makeI18n()] },
    });
    const sel = w.get('[data-testid="effect-settings-level"]');
    await sel.setValue('HIGH');
    const emits = w.emitted('patch') ?? [];
    expect(emits.length).toBeGreaterThan(0);
    expect(emits[0][0]).toEqual({ visualEffectLevel: 'HIGH' });
  });

  it('shows reducedMotion hint when reduceMotion=true', () => {
    const w = mount(EffectSettingsPanel, {
      props: { settings: makeSettings({ reduceMotion: true }) },
      global: { plugins: [makeI18n()] },
    });
    expect(w.text()).toContain('Giảm chuyển động');
  });

  it('disables all toggles when level=OFF', () => {
    const w = mount(EffectSettingsPanel, {
      props: { settings: makeSettings({ visualEffectLevel: 'OFF' }) },
      global: { plugins: [makeI18n()] },
    });
    const cb = w.get('[data-testid="effect-settings-floating-text"]')
      .element as HTMLInputElement;
    expect(cb.disabled).toBe(true);
  });
});

describe('EffectPreviewPanel', () => {
  it('renders all preview sections', () => {
    const w = mount(EffectPreviewPanel, {
      props: { settings: makeSettings() },
      global: { plugins: [makeI18n()] },
    });
    expect(w.find('[data-testid="preview-floating-text"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-status-effects"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-item-aura"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-rare-drop"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-boss"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-breakthrough"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-crafting"]').exists()).toBe(true);
    expect(w.find('[data-testid="preview-queue"]').exists()).toBe(true);
  });

  it('respects reduceMotion → motion level downgraded', () => {
    const w = mount(EffectPreviewPanel, {
      props: {
        settings: makeSettings({ reduceMotion: true, visualEffectLevel: 'HIGH' }),
      },
      global: { plugins: [makeI18n()] },
    });
    const root = w.get('[data-testid="effect-preview-panel"]');
    expect(root.attributes('data-reduced-motion')).toBe('true');
    expect(root.attributes('data-level')).toBe('LOW');
  });
});
