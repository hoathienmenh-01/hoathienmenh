import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaService } from '../../common/prisma.service';
import { ShopPacksAdminController } from './shop-packs-admin.controller';
import { ShopPacksController } from './shop-packs.controller';
import { ShopPacksService } from './shop-packs.service';

@Module({
  imports: [AuthModule, CharacterModule, InventoryModule, AdminModule],
  controllers: [ShopPacksController, ShopPacksAdminController],
  providers: [PrismaService, ShopPacksService],
  exports: [ShopPacksService],
})
export class ShopPacksModule {}
