import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RemoteConfigModule } from '../remote-config/remote-config.module';
import { WorldContentModule } from '../world-content/world-content.module';
import { HomesteadController } from './homestead.controller';
import { HomesteadService } from './homestead.service';

@Module({
  imports: [AuthModule, CharacterModule, InventoryModule, WorldContentModule, RemoteConfigModule],
  controllers: [HomesteadController],
  providers: [HomesteadService, PrismaService],
  exports: [HomesteadService],
})
export class HomesteadModule {}
