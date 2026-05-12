import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AdminModule } from '../admin/admin.module';
import { MonetizationAdminController } from './monetization-admin.controller';
import { MonetizationController } from './monetization.controller';
import { MonetizationService } from './monetization.service';

@Module({
  imports: [AuthModule, CharacterModule, InventoryModule, AdminModule],
  controllers: [MonetizationController, MonetizationAdminController],
  providers: [MonetizationService],
  exports: [MonetizationService],
})
export class MonetizationModule {}
