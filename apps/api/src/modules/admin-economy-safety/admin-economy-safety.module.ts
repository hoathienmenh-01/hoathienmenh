import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { EconomyModule } from '../economy/economy.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminEconomySafetyController } from './admin-economy-safety.controller';
import {
  ANOMALY_SCANNER_QUEUE,
  LEDGER_CHECKER_QUEUE,
} from './economy-anticheat-cron.config';
import { EconomyAnticheatCronScheduler } from './economy-anticheat-cron.scheduler';
import { LedgerCheckerCronProcessor } from './ledger-checker-cron.processor';
import { AnomalyScannerCronProcessor } from './anomaly-scanner-cron.processor';

/**
 * Phase 16.6 — Admin Economy Safety module.
 *
 * Tách module riêng (KHÔNG gộp vào AdminModule / EconomyModule) vì:
 *   - Cần BullModule.registerQueue cho 2 queue mới (cron processors).
 *   - Cần inject services từ EconomyModule (LedgerCheckerService,
 *     EconomyAnomalyScannerService).
 *   - AdminModule cần guard, không nên xài cron worker.
 *
 * Lifecycle:
 *   - `onModuleInit` đọc env config + register repeat.
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
      { name: LEDGER_CHECKER_QUEUE },
      { name: ANOMALY_SCANNER_QUEUE },
    ),
    AdminModule,
    AuthModule,
    EconomyModule,
  ],
  controllers: [AdminEconomySafetyController],
  providers: [
    PrismaService,
    EconomyAnticheatCronScheduler,
    LedgerCheckerCronProcessor,
    AnomalyScannerCronProcessor,
  ],
})
export class AdminEconomySafetyModule implements OnModuleInit {
  constructor(private readonly scheduler: EconomyAnticheatCronScheduler) {}

  async onModuleInit(): Promise<void> {
    await this.scheduler.scheduleRecurring();
  }
}
