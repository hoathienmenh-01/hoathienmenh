import { Module } from '@nestjs/common';
import { LiveOpsController } from './liveops.controller';
import { LiveOpsService } from './liveops.service';

@Module({
  controllers: [LiveOpsController],
  providers: [LiveOpsService],
  exports: [LiveOpsService],
})
export class LiveOpsModule {}
