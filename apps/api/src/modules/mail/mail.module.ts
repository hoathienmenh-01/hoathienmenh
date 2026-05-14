import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailService } from './mail.service';
import { PrismaService } from '../../common/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { CharacterModule } from '../character/character.module';
import { InventoryModule } from '../inventory/inventory.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebPushModule } from '../web-push/web-push.module';

@Module({
  // Phase 44.1 — wire `WebPushModule` để MailService Optional-inject
  // `WebPushTriggerService` gổi push "mail mới" theo opt-in.
  imports: [
    AuthModule,
    CharacterModule,
    InventoryModule,
    RealtimeModule,
    WebPushModule,
  ],
  controllers: [MailController],
  providers: [MailService, PrismaService],
  exports: [MailService],
})
export class MailModule {}
