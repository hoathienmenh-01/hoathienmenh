/**
 * Phase 45.0 — Public endpoints cho Remote Config + combined `/config/public`.
 *
 * Endpoints (no auth):
 *   - `GET /config/public` — combined snapshot { flags, configs } cho FE
 *     đọc 1 lần lúc boot (tiết kiệm round-trip vs gọi 2 endpoint riêng).
 *   - `GET /remote-config/public` — chỉ remote config (alternative entry).
 *
 * Public-safe: chỉ trả key thuộc `PUBLIC_REMOTE_CONFIG_KEYS` (whitelist
 * shared catalog). Admin-only key (vd `reward_safety_mode`, `pet_box_enabled`)
 * tuyệt đối không expose.
 */
import { Controller, Get } from '@nestjs/common';
import type {
  FeatureFlagPublicView,
  RemoteConfigPublicView,
} from '@xuantoi/shared';
import { FeatureFlagService } from '../feature-flag/feature-flag.service';
import { RemoteConfigService } from './remote-config.service';

@Controller()
export class RemoteConfigPublicController {
  constructor(
    private readonly remoteConfig: RemoteConfigService,
    private readonly featureFlags: FeatureFlagService,
  ) {}

  @Get('config/public')
  async combinedPublic(): Promise<{
    ok: true;
    data: {
      flags: FeatureFlagPublicView[];
      configs: RemoteConfigPublicView[];
    };
  }> {
    const [flags, configs] = await Promise.all([
      this.featureFlags.getPublicFlags(),
      this.remoteConfig.getPublicConfigs(),
    ]);
    return { ok: true, data: { flags, configs } };
  }

  @Get('remote-config/public')
  async publicConfigs(): Promise<{
    ok: true;
    data: { configs: RemoteConfigPublicView[] };
  }> {
    const configs = await this.remoteConfig.getPublicConfigs();
    return { ok: true, data: { configs } };
  }
}
