/**
 * Cửu Thiên Mộng Phase 3 module C — particle field shared types + helpers.
 *
 * Tách rời khỏi `ParticleField.vue` để unit-testable không cần mount DOM /
 * canvas (jsdom không có canvas thực).
 */

export type ParticleVariant = 'qi-rising' | 'petal-fall' | 'ember-spark';
export type ParticleLevel = 'OFF' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Số hạt mục tiêu cho mỗi `visualEffectLevel`. Roadmap base = 60 ở MEDIUM,
 * LOW chia 3 (giữ visual nhẹ), HIGH gấp đôi MEDIUM.
 */
export function particleCountForLevel(level: ParticleLevel): number {
  switch (level) {
    case 'OFF':
      return 0;
    case 'LOW':
      return 20;
    case 'MEDIUM':
      return 60;
    case 'HIGH':
      return 120;
  }
}

/**
 * Map từ `data-scene` (mặt sinh hoạt của user) sang `ParticleVariant` mặc
 * định cho `<ParticleField>` mount. Caller có thể override.
 */
export function defaultVariantForScene(
  scene: string | null | undefined,
): ParticleVariant {
  if (!scene || typeof scene !== 'string') return 'qi-rising';
  switch (scene) {
    case 'tribulation':
    case 'cultivation':
      return 'qi-rising';
    case 'sect':
    case 'home':
      return 'petal-fall';
    case 'boss':
    case 'combat':
      return 'ember-spark';
    default:
      return 'qi-rising';
  }
}
