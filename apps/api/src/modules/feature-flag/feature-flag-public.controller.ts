/**
 * Phase 15.4 — Public endpoint cho Feature Flag (frontend gate UI).
 *
 * `GET /feature-flags/public`:
 *   - Trả whitelist `PUBLIC_FEATURE_FLAG_KEYS` (xem `feature-flags.ts`).
 *   - Public-safe payload: chỉ `key` + `enabled` — KHÔNG expose
 *     `updatedByAdminId` / `module` / `description` / `category`.
 *   - Không yêu cầu auth — frontend (kể cả viewer chưa login) cần biết
 *     để gate UI (vd ẩn nút Arena nếu disabled).
 *   - Cache TTL 30s qua service — admin tắt flag → tất cả pod nhận trong
 *     ≤ 30s.
 */
import { Controller, Get } from '@nestjs/common';
import type { FeatureFlagPublicView } from '@xuantoi/shared';
import { FeatureFlagService } from './feature-flag.service';

@Controller()
export class FeatureFlagPublicController {
  constructor(private readonly service: FeatureFlagService) {}

  @Get('feature-flags/public')
  async list(): Promise<{ ok: true; data: { flags: FeatureFlagPublicView[] } }> {
    const flags = await this.service.getPublicFlags();
    return { ok: true, data: { flags } };
  }
}
