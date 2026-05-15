<script setup lang="ts">
/**
 * Phase 15.5 — root mount of `MaintenanceOverlay`.
 *
 * Overlay block toàn ứng dụng khi:
 *   - server đã từ chối request gần nhất với `MAINTENANCE_ACTIVE`, HOẶC
 *   - public maintenance status active=true VÀ user không phải admin.
 *
 * `MaintenanceBanner` (admin-only thông báo) được render trong
 * `AppShell` để chỉ hiển thị bên trong layout đăng nhập, không che màn
 * login.
 *
 * Phase 15.8 — subscribe WS `maintenance:status` để overlay
 * update tức thì khi status transition (không cần đợi 30s poll).
 */
import { computed, onMounted, onUnmounted } from 'vue';
import type {
  MaintenanceBroadcastPayload,
  WsFrame,
} from '@xuantoi/shared';
import MToast from '@/components/ui/MToast.vue';
import MaintenanceOverlay from '@/components/MaintenanceOverlay.vue';
import { useMaintenanceStore } from '@/stores/maintenance';
import { useGameStore } from '@/stores/game';
import { on as wsOn } from '@/ws/client';
import { silkTransitionName } from '@/lib/silkTransition';

const maintenance = useMaintenanceStore();
const game = useGameStore();

const isStaff = computed<boolean>(() => {
  const r = game.character?.role;
  return r === 'ADMIN' || r === 'MOD';
});

const showOverlay = computed<boolean>(() => {
  if (maintenance.blockedByApi) return true;
  if (!maintenance.active) return false;
  // Admin/MOD bypass — chỉ hiển thị banner thay overlay.
  return !isStaff.value;
});

const wsUnsubFns: Array<() => void> = [];

onMounted(() => {
  maintenance.start();
  // Phase 15.8 — listen WS broadcast. Store auto-handle ACTIVE/ENDED/DISABLED.
  wsUnsubFns.push(
    wsOn<MaintenanceBroadcastPayload>(
      'maintenance:status',
      (frame: WsFrame<MaintenanceBroadcastPayload>) => {
        maintenance.applyMaintenanceBroadcast(frame.payload);
      },
    ),
  );
});

onUnmounted(() => {
  maintenance.stop();
  for (const fn of wsUnsubFns) fn();
});
</script>

<template>
  <RouterView v-slot="{ Component, route }">
    <Transition :name="silkTransitionName(route)" mode="out-in">
      <component :is="Component" :key="route.fullPath" />
    </Transition>
  </RouterView>
  <MToast />
  <MaintenanceOverlay v-if="showOverlay && maintenance.status" :status="maintenance.status" />
</template>
