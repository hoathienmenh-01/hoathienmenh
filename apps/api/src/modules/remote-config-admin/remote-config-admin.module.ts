/**
 * Phase 45.0 — RemoteConfig admin module.
 *
 * Tách khỏi `RemoteConfigModule` để tránh cycle với AdminModule (mirror
 * pattern `FeatureFlagAdminModule` Phase 15.4).
 */
import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { RemoteConfigModule } from '../remote-config/remote-config.module';
import { PrismaService } from '../../common/prisma.service';
import { AdminRemoteConfigController } from './admin-remote-config.controller';

@Module({
  imports: [AdminModule, AuthModule, RemoteConfigModule],
  controllers: [AdminRemoteConfigController],
  providers: [PrismaService],
})
export class RemoteConfigAdminModule {}
