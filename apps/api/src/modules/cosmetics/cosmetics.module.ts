import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminModule } from '../admin/admin.module';
import { PrismaService } from '../../common/prisma.service';
import { CosmeticsAdminController } from './cosmetics-admin.controller';
import { CosmeticsController } from './cosmetics.controller';
import { CosmeticsService } from './cosmetics.service';

@Module({
  imports: [AuthModule, AdminModule],
  controllers: [CosmeticsController, CosmeticsAdminController],
  providers: [PrismaService, CosmeticsService],
  exports: [CosmeticsService],
})
export class CosmeticsModule {}
