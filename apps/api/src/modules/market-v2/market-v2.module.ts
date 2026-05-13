/**
 * Phase 30.0 — Market V2 module. Bao gồm auction, claim box service,
 * player/admin controller. Phụ thuộc: CharacterModule (CurrencyService),
 * AdminControlCenterModule (guard + audit), AuthModule.
 */
import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { AdminControlCenterModule } from '../admin-control-center/admin-control-center.module';
import { ClaimBoxService } from './claim-box.service';
import { AuctionService } from './auction.service';
import { MarketV2PlayerController } from './market-v2.player.controller';
import { MarketV2AdminController } from './market-v2.admin.controller';

@Module({
  imports: [AuthModule, CharacterModule, AdminControlCenterModule],
  controllers: [MarketV2PlayerController, MarketV2AdminController],
  providers: [PrismaService, ClaimBoxService, AuctionService],
  exports: [ClaimBoxService, AuctionService],
})
export class MarketV2Module {}
