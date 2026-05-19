<script setup lang="ts">
/**
 * Phase 42.0 — /dev/effects-preview view.
 *
 * Render `EffectPreviewPanel` với settings hiện tại của người chơi.
 * Người chơi có thể đổi visual level / reduce motion qua SettingsView để
 * thấy preview update.
 *
 * Phase 15.13 — Đây là dev / preview tool, không phải gameplay screen
 * thường, nên gate behind `auth.isAdmin` để tránh expose mock data /
 * effect lab cho player thường. Pattern theo `AdminFeedbackView` (UI
 * hide qua `v-if="!isAdmin"` empty state). Server-side không cần thêm
 * vì view này chỉ đọc `fetchPlayerSettings` (đã auth player của chính
 * họ); gate ở client đủ vì là dev tool.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import AppShell from '@/components/shell/AppShell.vue';
import XTLuxHero from '@/components/xianxia/XTLuxHero.vue';
import EffectPreviewPanel from '@/components/visual-effects/EffectPreviewPanel.vue';
import {
  DEFAULT_PLAYER_SETTINGS,
  type PlayerSettings,
} from '@xuantoi/shared';
import { fetchPlayerSettings } from '@/api/playerExperience';

const { t } = useI18n();
const auth = useAuthStore();
const router = useRouter();

const settings = ref<PlayerSettings>({ ...DEFAULT_PLAYER_SETTINGS });
const loading = ref(true);
const isAdmin = computed(() => auth.isAdmin);

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  // Phase 15.13 — Non-admin → redirect về /home thay vì render dev lab.
  if (!auth.isAdmin) {
    router.replace('/home');
    return;
  }
  try {
    const row = await fetchPlayerSettings();
    settings.value = row.settings;
  } catch {
    // ignore — fall back to default
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto px-4 py-6 space-y-4" data-testid="effects-preview-view">
      <XTLuxHero
        :eyebrow="t('effectsPreview.title')"
        :label="t('effectsPreview.title')"
        :title="t('effectsPreview.title')"
        :subtitle="t('effectsPreview.subtitle')"
        tone="seal"
        watermark-letter="V"
        test-id="effects-preview-hero"
      />

      <p class="text-sm text-gray-400 px-1" data-testid="effects-preview-role-hint">
        {{ t('effectsPreview.roleHint') }}
      </p>

      <nav class="flex gap-2 text-xs flex-wrap" data-testid="effects-preview-cross-nav">
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-admin-cc"
          @click="router.push('/admin/control-center')"
        >
          <span class="text-amber-400">&#9878;</span>
          <span>{{ t('effectsPreview.crossNav.adminCC') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('effectsPreview.crossNav.adminCCDesc') }}</span>
        </button>
        <button
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/60 hover:bg-gray-700/60 transition"
          data-testid="cross-nav-settings"
          @click="router.push('/settings')"
        >
          <span class="text-amber-400">&#9878;</span>
          <span>{{ t('effectsPreview.crossNav.settings') }}</span>
          <span class="text-gray-500 hidden sm:inline">{{ t('effectsPreview.crossNav.settingsDesc') }}</span>
        </button>
      </nav>

      <div
        v-if="!isAdmin"
        class="rounded-xl border border-ink-300/30 bg-ink-900/60 p-6 text-center text-ink-300"
        data-testid="effects-preview-forbidden"
      >
        {{ t('effectsPreview.forbidden') }}
      </div>
      <EffectPreviewPanel v-else :settings="settings" />
    </div>
  </AppShell>
</template>
