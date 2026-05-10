import { Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CultivationProcessor } from './cultivation.processor';
import { CultivationService } from './cultivation.service';
import { PrismaService } from '../../common/prisma.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { MissionModule } from '../mission/mission.module';
import { CharacterModule } from '../character/character.module';
import { EconomyModule } from '../economy/economy.module';
import { LiveOpsEventSchedulerModule } from '../liveops-event-scheduler/liveops-event-scheduler.module';
import { CULTIVATION_QUEUE } from './cultivation.queue';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: CULTIVATION_QUEUE }),
    RealtimeModule,
    MissionModule,
    CharacterModule,
    EconomyModule,
    LiveOpsEventSchedulerModule,
  ],
  providers: [CultivationProcessor, CultivationService, PrismaService],
  exports: [CultivationService],
})
export class CultivationModule implements OnModuleInit {
  constructor(private readonly cultivation: CultivationService) {}

  async onModuleInit(): Promise<void> {
    await this.cultivation.scheduleRecurring();
  }
}


