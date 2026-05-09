import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { TerritoryModule } from '../territory/territory.module';
import { SectSeasonModule } from '../sect-season/sect-season.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminLiveOpsCronController } from './admin-liveops-cron.controller';
import { LiveOpsCronLease } from './liveops-cron.lease';
import { LiveOpsCronScheduler } from './liveops-cron.scheduler';
import { LiveOpsCronService } from './liveops-cron.service';
import {
  SECT_SEASON_CRON_QUEUE,
  TERRITORY_CRON_QUEUE,
} from './liveops-cron.queue';
import { SectSeasonCronProcessor } from './sect-season-cron.processor';
import { TerritoryCronProcessor } from './territory-cron.processor';

/**
 * Phase 13.2.D + 14.0.F — Live Ops cron module.
 *
 * Đặt ở module riêng (KHÔNG gộp vào territory/sect-season/admin) vì:
 *   - Cần inject services từ Territory + SectSeason → import 2 module.
 *   - Admin endpoints cần `AdminGuard` từ AdminModule, nhưng AdminModule
 *     KHÔNG được phép import Territory/SectSeason (sẽ tạo circular vì
 *     cả 2 module đó đã import AdminModule cho guard).
 *   - Tách biệt cron orchestration khỏi business logic core.
 *
 * Lifecycle:
 *   - `onModuleInit` đọc env config + register repeat (xem
 *     `LiveOpsCronScheduler.scheduleRecurring`).
 *   - Default `*_ENABLED=false` → cron KHÔNG register, admin vẫn
 *     force-run được qua endpoint.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue(
      { name: TERRITORY_CRON_QUEUE },
      { name: SECT_SEASON_CRON_QUEUE },
    ),
    AuthModule,
    AdminModule,
    TerritoryModule,
    SectSeasonModule,
  ],
  controllers: [AdminLiveOpsCronController],
  providers: [
    LiveOpsCronService,
    LiveOpsCronLease,
    LiveOpsCronScheduler,
    TerritoryCronProcessor,
    SectSeasonCronProcessor,
    PrismaService,
  ],
  exports: [LiveOpsCronService],
})
export class LiveOpsCronModule implements OnModuleInit {
  constructor(private readonly scheduler: LiveOpsCronScheduler) {}

  async onModuleInit(): Promise<void> {
    await this.scheduler.scheduleRecurring();
  }
}
