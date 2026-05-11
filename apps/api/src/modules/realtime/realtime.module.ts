import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { PrismaService } from '../../common/prisma.service';
import { PresenceCoreModule } from '../presence/presence-core.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
      }),
    }),
    forwardRef(() => PresenceCoreModule),
  ],
  providers: [RealtimeGateway, RealtimeService, PrismaService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
