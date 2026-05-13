import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PlayerNavigationController } from './player-navigation.controller';

@Module({
  imports: [AuthModule],
  controllers: [PlayerNavigationController],
  providers: [PrismaService],
})
export class PlayerNavigationModule {}
