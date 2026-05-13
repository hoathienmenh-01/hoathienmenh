<script setup lang="ts">
/**
 * Phase 42.0 — /dev/effects-preview view.
 *
 * Render `EffectPreviewPanel` với settings hiện tại của người chơi.
 * Người chơi có thể đổi visual level / reduce motion qua SettingsView để
 * thấy preview update.
 */
import { onMounted, ref } from 'vue';
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

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
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
      <EffectPreviewPanel :settings="settings" />
    </div>
  </AppShell>
</template>
