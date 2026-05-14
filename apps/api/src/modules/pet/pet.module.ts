/**
 * Phase 35.0 — Pet / Linh Thú module.
 *
 * Wire 7 service + 2 controller. PetSnapshotService được export để Combat /
 * PvP / Boss / Dungeon / SecretRealm có thể import qua module re-export.
 */
import { Module } from '@nestjs/common';

import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AdminControlCenterModule } from '../admin-control-center/admin-control-center.module';
import { InventoryModule } from '../inventory/inventory.module';
import { CharacterModule } from '../character/character.module';
import { FeatureFlagModule } from '../feature-flag/feature-flag.module';
import { PetCatalogService } from './pet-catalog.service';
import { PetCollectionService } from './pet-collection.service';
import { PetSnapshotService } from './pet-snapshot.service';
import { PetShardService } from './pet-shard.service';
import { PetBoxService } from './pet-box.service';
import { PetUpgradeService } from './pet-upgrade.service';
import { PetSourceService } from './pet-source.service';
import { PetPlayerController } from './pet.player.controller';
import { PetAdminController } from './pet.admin.controller';

@Module({
  imports: [AuthModule, AdminControlCenterModule, InventoryModule, CharacterModule, FeatureFlagModule],
  controllers: [PetPlayerController, PetAdminController],
  providers: [
    PrismaService,
    PetCatalogService,
    PetCollectionService,
    PetSnapshotService,
    PetShardService,
    PetBoxService,
    PetUpgradeService,
    PetSourceService,
  ],
  exports: [PetCatalogService, PetCollectionService, PetSnapshotService, PetShardService],
})
export class PetModule {}
