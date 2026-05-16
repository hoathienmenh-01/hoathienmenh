<script setup lang="ts">
import { computed } from 'vue';

/**
 * Cửu Thiên Mộng — Realm badge.
 *
 * Hình thẻ ngọc nhỏ với viền vàng triều, chữ đậm, glow vàng mờ. Dùng cho
 * hiển thị "Luyện Khí · Tầng 3", "Trúc Cơ · Đỉnh", v.v.
 *
 * Phase 7: hỗ trợ `tier` (realm group) để chọn sigil + class theme phụ.
 * Caller có thể bỏ qua → fallback sigil mặc định ◈ + tone vàng.
 */
const props = withDefaults(
  defineProps<{
    label: string;
    /** Realm tier group: pham / nhan_tien / tien_gioi / hon_nguyen / ban_nguyen / vinh_hang. */
    tier?:
      | 'pham'
      | 'nhan_tien'
      | 'tien_gioi'
      | 'hon_nguyen'
      | 'ban_nguyen'
      | 'vinh_hang';
  }>(),
  {
    tier: 'pham',
  },
);

const SIGIL_MAP: Record<NonNullable<typeof props.tier>, string> = {
  pham: '◈',
  nhan_tien: '✦',
  tien_gioi: '✺',
  hon_nguyen: '☯',
  ban_nguyen: '✶',
  vinh_hang: '✷',
};

const sigil = computed(() => SIGIL_MAP[props.tier]);
const tierClass = computed(() => `xt-realm-badge--tier-${props.tier}`);
</script>

<template>
  <span
    class="xt-realm-badge"
    :class="tierClass"
    :data-tier="tier"
    data-testid="realm-badge"
  >
    <span class="xt-realm-badge__rune" aria-hidden="true">{{ sigil }}</span>
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

/* Realm tier — subtle border + glow accent theo nhóm cảnh giới. */
.xt-realm-badge--tier-nhan_tien {
  border-color: rgba(168, 132, 222, 0.6);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.18),
    0 4px 12px rgba(0, 0, 0, 0.4),
    0 0 14px rgba(168, 132, 222, 0.24);
}
.xt-realm-badge--tier-tien_gioi {
  border-color: rgba(98, 200, 220, 0.65);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.2),
    0 4px 14px rgba(0, 0, 0, 0.4),
    0 0 16px rgba(98, 200, 220, 0.28);
}
.xt-realm-badge--tier-hon_nguyen {
  border-color: rgba(74, 169, 143, 0.65);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.22),
    0 4px 14px rgba(0, 0, 0, 0.45),
    0 0 18px rgba(74, 169, 143, 0.3);
}
.xt-realm-badge--tier-ban_nguyen {
  border-color: rgba(238, 220, 160, 0.7);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.24),
    0 5px 16px rgba(0, 0, 0, 0.45),
    0 0 22px rgba(238, 220, 160, 0.34);
}
.xt-realm-badge--tier-vinh_hang {
  border-color: rgba(255, 240, 200, 0.85);
  box-shadow:
    inset 0 1px 0 rgba(255, 246, 224, 0.3),
    0 6px 20px rgba(0, 0, 0, 0.5),
    0 0 28px rgba(255, 240, 200, 0.42);
}
</style>
