import { SetMetadata } from '@nestjs/common';
import type { RateLimitPolicyKey } from '@xuantoi/shared';

/**
 * Phase 18.1 — gắn rate-limit policy lên controller method.
 *
 * Sử dụng:
 *   ```
 *   @Post('buy')
 *   @RateLimitPolicy('SHOP_BUY')
 *   async buy(...) { ... }
 *   ```
 *
 * `RateLimitGuard` đọc metadata này qua `Reflector`. Nếu method KHÔNG
 * có decorator → guard skip enforcement (giữ behavior cũ — opt-in).
 */
export const RATE_LIMIT_POLICY_KEY = 'rateLimitPolicy';

export const RateLimitPolicy = (
  key: RateLimitPolicyKey,
): MethodDecorator & ClassDecorator => SetMetadata(RATE_LIMIT_POLICY_KEY, key);

/**
 * `@SkipRateLimit()` đánh dấu route bỏ qua guard hoàn toàn — dùng cho
 * healthcheck / readyz / metrics / version để monitoring không bao
 * giờ bị 429.
 */
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT_KEY, true);
