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
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import AppShell from '@/components/shell/AppShell.vue';
import EffectPreviewPanel from '@/components/visual-effects/EffectPreviewPanel.vue';
import {
  DEFAULT_PLAYER_SETTINGS,
  type PlayerSettings,
} from '@xuantoi/shared';
import { fetchPlayerSettings } from '@/api/playerExperience';

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
    <div class="max-w-5xl mx-auto px-4 py-6" data-testid="effects-preview-view">
      <div
        v-if="!isAdmin"
        class="rounded-xl border border-ink-300/30 bg-ink-900/60 p-6 text-center text-ink-300"
        data-testid="effects-preview-forbidden"
      >
        Khu vực dành cho quản trị viên.
      </div>
      <EffectPreviewPanel v-else :settings="settings" />
    </div>
  </AppShell>
</template>
