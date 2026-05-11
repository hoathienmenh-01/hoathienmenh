import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceController } from './presence.controller';
import { PresenceCoreModule } from './presence-core.module';

/**
 * Phase 19.3 — Presence module (REST surface).
 *
 * `PresenceService` provider/export sống ở `PresenceCoreModule`
 * (không kéo `AuthModule`) để `RealtimeModule` reference được mà
 * không phải gánh ConfigService cho test. `PresenceModule` chỉ
 * thêm tầng REST controller cho FE (`GET /social/presence`) và
 * re-export `PresenceCoreModule`.
 */
@Module({
  imports: [AuthModule, PresenceCoreModule],
  controllers: [PresenceController],
  exports: [PresenceCoreModule],
})
export class PresenceModule {}
