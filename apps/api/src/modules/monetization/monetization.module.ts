import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaService } from '../../common/prisma.service';
import { MonetizationAdminController } from './monetization-admin.controller';
import { MonetizationController } from './monetization.controller';
import { MonetizationService } from './monetization.service';
import { WalletService } from './wallet.service';
import { EntitlementService } from './entitlement.service';
import { MonetizationShopService } from './monetization-shop.service';
import {
  ExtraAttemptService,
  SweepTicketService,
} from './sweep-attempt.service';
import { GrowthFundService } from './growth-fund.service';
import { BattlePassV2Service } from './battle-pass-v2.service';
import { LimitedShopService } from './limited-shop.service';
import { MonetizationOverviewService } from './monetization-overview.service';

@Module({
  imports: [AuthModule, CharacterModule, InventoryModule, AdminModule],
  controllers: [MonetizationController, MonetizationAdminController],
  providers: [
    PrismaService,
    MonetizationService,
    WalletService,
    EntitlementService,
    MonetizationShopService,
    SweepTicketService,
    ExtraAttemptService,
    GrowthFundService,
    BattlePassV2Service,
    LimitedShopService,
    MonetizationOverviewService,
  ],
  exports: [
    MonetizationService,
    WalletService,
    EntitlementService,
    MonetizationShopService,
    SweepTicketService,
    ExtraAttemptService,
    GrowthFundService,
    BattlePassV2Service,
    LimitedShopService,
    MonetizationOverviewService,
  ],
})
export class MonetizationModule {}
