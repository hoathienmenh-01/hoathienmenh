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
            <p class="xt-eyebrow !text-[10px]">Cửu Thiên Mộng · XT</p>
            <h1 class="xt-heading-co mt-1 text-3xl md:text-4xl">
              {{ name }}
            </h1>
          </div>
          <RealmBadge :label="realm" />
        </div>
        <div class="grid gap-3 md:grid-cols-2">
          <ProgressRuneBar label="Tiến độ tu luyện" :value="cultivationProgress" tone="jade" />
          <ProgressRuneBar label="Luyện thể" :value="bodyProgress" tone="gold" />
        </div>
      </div>
      <div class="xt-hero-stat flex min-w-48 flex-col justify-between gap-4 rounded-3xl p-4">
        <div>
          <p class="xt-eyebrow !text-[10px]">Lực chiến</p>
          <p class="xt-heading-co mt-2 text-3xl text-[var(--xt-gold-bright)]">{{ power }}</p>
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

<style scoped>
.xt-hero-stat {
  border: 1px solid var(--xt-border-gold);
  background:
    linear-gradient(180deg, rgba(58, 46, 24, 0.72) 0%, rgba(28, 22, 12, 0.86) 100%),
    radial-gradient(circle at 50% 0%, rgba(242, 215, 137, 0.18), transparent 55%);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.16),
    0 12px 28px rgba(0, 0, 0, 0.5),
    var(--xt-shadow-gold-glow);
}
</style>
