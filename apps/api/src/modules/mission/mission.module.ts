import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MissionController } from './mission.controller';
import { MISSION_WS_EMITTER, MissionService } from './mission.service';
import { MissionWsEmitter } from './mission-ws.emitter';
import { MissionProcessor } from './mission.processor';
import { MissionScheduler } from './mission.scheduler';
import { MISSION_QUEUE } from './mission.queue';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RealtimeService } from '../realtime/realtime.service';
import { EconomyModule } from '../economy/economy.module';

const missionWsEmitterProvider = {
  provide: MISSION_WS_EMITTER,
  inject: [RealtimeService],
  useFactory: (realtime: RealtimeService) => new MissionWsEmitter(realtime),
};

@Module({
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    RealtimeModule,
    EconomyModule,
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          url: process.env.REDIS_URL ?? 'redis://localhost:6379',
        },
      }),
    }),
    BullModule.registerQueue({ name: MISSION_QUEUE }),
  ],
  controllers: [MissionController],
  providers: [
    MissionService,
    MissionProcessor,
    MissionScheduler,
    PrismaService,
    missionWsEmitterProvider,
  ],
  exports: [MissionService],
})
export class MissionModule {}
