import { Module, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { PresenceService } from './presence.service';

/**
 * Phase 19.3 — Presence core module (service-only).
 *
 * Tách `PresenceService` thành module riêng không phụ thuộc
 * `AuthModule` để `RealtimeModule` có thể tham chiếu (forwardRef)
 * mà không kéo theo `JwtModule.registerAsync({ inject: [ConfigService] })`
 * của AuthModule. Điều này quan trọng cho các test compile
 * `RealtimeModule` standalone (vd `realtime.gateway.test.ts`) —
 * không cần `ConfigModule.forRoot()` trong test bootstrap.
 *
 * `PresenceModule` (controller-level) import lại module này
 * cùng `AuthModule` để expose REST `/social/presence`.
 */
@Module({
  imports: [forwardRef(() => RealtimeModule)],
  providers: [PresenceService, PrismaService],
  exports: [PresenceService],
})
export class PresenceCoreModule {}
