/**
 * Phase 45.0 — RemoteConfig module.
 *
 * Mirror `FeatureFlagModule`:
 *   - Provides `RemoteConfigService` cho gameplay runtime + admin module.
 *   - Public controller `GET /config/public` + `GET /remote-config/public`.
 *   - Tách `RemoteConfigAdminModule` để tránh cycle với AdminModule.
 */
import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { RemoteConfigPublicController } from './remote-config-public.controller';
import { RemoteConfigService } from './remote-config.service';

@Module({
  imports: [FeatureFlagModule],
  controllers: [RemoteConfigPublicController],
  providers: [PrismaService, RemoteConfigService],
  exports: [RemoteConfigService],
})
export class RemoteConfigModule {}
