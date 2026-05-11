import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * Phase 19.3 — Presence module.
 *
 * Cung cấp:
 *   - `PresenceService` (export) cho `RealtimeGateway` gọi
 *     `markConnected` / `markDisconnected` trong connect/disconnect
 *     lifecycle, và cho future module (vd notification controller)
 *     check `isOnline`.
 *   - `PresenceController` (`GET /social/presence`) cho FE query batch.
 *
 * Re-use `RealtimeService` qua `RealtimeModule` cho in-memory
 * connection tracking (single-instance).
 */
@Module({
  imports: [AuthModule, forwardRef(() => RealtimeModule)],
  controllers: [PresenceController],
  providers: [PresenceService, PrismaService],
  exports: [PresenceService],
})
export class PresenceModule {}
