import { forwardRef, Module, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { EconomyModule } from '../economy/economy.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CULTIVATION_QUEUE } from '../cultivation/cultivation.queue';
import { BodyCultivationController } from './body-cultivation.controller';
import { BodyCultivationProcessor } from './body-cultivation.processor';
import { BodyCultivationService } from './body-cultivation.service';
import { BodyCultivationSchedulerService } from './body-cultivation-scheduler.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: CULTIVATION_QUEUE }),
    AuthModule,
    RealtimeModule,
    EconomyModule,
    forwardRef(() => CharacterModule),
    forwardRef(() => InventoryModule),
  ],
  controllers: [BodyCultivationController],
  providers: [
    PrismaService,
    BodyCultivationService,
    BodyCultivationProcessor,
    BodyCultivationSchedulerService,
  ],
  exports: [BodyCultivationService],
})
export class BodyCultivationModule implements OnModuleInit {
  constructor(private readonly scheduler: BodyCultivationSchedulerService) {}

  async onModuleInit(): Promise<void> {
    await this.scheduler.scheduleRecurring();
  }
}
