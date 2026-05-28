import { Module } from '@nestjs/common';
import { SectWarService } from './sect-war.service';
import { SectWarController } from './sect-war.controller';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';

@Module({
  imports: [AuthModule, CharacterModule, FeatureFlagModule],
  controllers: [SectWarController],
  providers: [SectWarService, PrismaService],
  exports: [SectWarService],
})
export class SectWarModule {}
