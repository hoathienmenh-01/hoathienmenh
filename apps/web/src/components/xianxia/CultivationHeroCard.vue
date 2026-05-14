<script setup lang="ts">
import GameIcon from './GameIcon.vue';
import ProgressRuneBar from './ProgressRuneBar.vue';
import RealmBadge from './RealmBadge.vue';
import XianxiaButton from './XianxiaButton.vue';
import XianxiaCard from './XianxiaCard.vue';

defineProps<{
  name: string;
  realm: string;
  power: string | number;
  cultivationProgress: number;
  bodyProgress: number;
}>();
</script>

<template>
  <XianxiaCard accent="jade" class="relative overflow-hidden" data-testid="cultivation-hero-card">
    <div class="xt-rune-circle" aria-hidden="true" />
    <div class="relative grid gap-6 lg:grid-cols-[1fr_auto]">
      <div class="space-y-4">
        <div class="flex flex-wrap items-center gap-3">
          <GameIcon name="cultivation" size="lg" />
          <div>
            <p class="text-xs uppercase tracking-[0.28em] text-emerald-700/75">Thiên Cung Giao Diện · XT</p>
            <h1 class="mt-1 text-3xl font-black tracking-wide text-emerald-950 md:text-4xl">
              {{ name }}
            </h1>
          </div>
          <RealmBadge :label="realm" />
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <ProgressRuneBar label="Tiến độ tu luyện" :value="cultivationProgress" />
          <ProgressRuneBar label="Luyện thể" :value="bodyProgress" />
        </div>
      </div>
      <div class="flex min-w-48 flex-col justify-between gap-4 rounded-3xl border border-amber-300/35 bg-white/60 p-4 shadow-inner shadow-amber-100/50">
        <div>
          <p class="text-xs uppercase tracking-[0.24em] text-amber-700/75">Lực chiến</p>
          <p class="mt-2 text-3xl font-black text-amber-800">{{ power }}</p>
        </div>
        <div class="grid gap-2">
          <XianxiaButton to="/cultivation">Tu Luyện</XianxiaButton>
          <XianxiaButton to="/breakthrough" variant="secondary">Đột Phá</XianxiaButton>
          <XianxiaButton to="/secret-realms" variant="ghost">Đi Bí Cảnh</XianxiaButton>
        </div>
      </div>
    </div>
  </XianxiaCard>
</template>
