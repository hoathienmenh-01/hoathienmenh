<script setup lang="ts">
/**
 * Cửu Thiên Mộng — Realm badge.
 *
 * Hình thẻ ngọc nhỏ với viền vàng triều, chữ đậm, glow vàng mờ. Dùng cho
 * hiển thị "Luyện Khí · Tầng 3", "Trúc Cơ · Đỉnh", v.v.
 */
defineProps<{
  label: string;
}>();
</script>

<template>
  <span class="xt-realm-badge" data-testid="realm-badge">
    <span class="xt-realm-badge__rune" aria-hidden="true">道</span>
    {{ label }}
  </span>
</template>

<style scoped>
.xt-realm-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.8rem 0.3rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--xt-border-gold);
  background: linear-gradient(135deg, rgba(74, 59, 24, 0.85), rgba(28, 22, 12, 0.92));
  color: var(--xt-gold-bright);
  font-family: var(--xt-font-display);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.18),
    0 4px 12px rgba(0, 0, 0, 0.4),
    var(--xt-shadow-gold-glow);
  text-shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
}

.xt-realm-badge__rune {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  font-family: var(--xt-font-decorative);
  font-size: 0.7rem;
  color: var(--xt-scroll-paper-bright);
  background: linear-gradient(135deg, var(--xt-seal-bright) 0%, var(--xt-seal-base) 100%);
  border-radius: 3px;
  box-shadow: inset 0 0 4px rgba(0, 0, 0, 0.4);
}
</style>
