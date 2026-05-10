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
 */
import { computed, onMounted, onUnmounted } from 'vue';
import MToast from '@/components/ui/MToast.vue';
import MaintenanceOverlay from '@/components/MaintenanceOverlay.vue';
import { useMaintenanceStore } from '@/stores/maintenance';
import { useGameStore } from '@/stores/game';

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

onMounted(() => {
  maintenance.start();
});

onUnmounted(() => {
  maintenance.stop();
});
</script>

<template>
  <RouterView />
  <MToast />
  <MaintenanceOverlay v-if="showOverlay && maintenance.status" :status="maintenance.status" />
</template>
