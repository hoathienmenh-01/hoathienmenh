import { Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationModule } from '../notification/notification.module';
import { AdminChatModerationController } from './admin-chat-moderation.controller';
import { ChatModerationController } from './chat-moderation.controller';
import { ChatModerationService } from './chat-moderation.service';

/**
 * Phase 19.2 — Chat Moderation & Report module.
 *
 * Cung cấp:
 *   - 1 user-facing controller (`POST /chat/reports`, `GET /chat/reports/mine`).
 *   - 1 admin controller (`/admin/chat/*` — reports, mutes, hide, group lock).
 *   - 1 service `ChatModerationService` (export để chat-private /
 *     chat-group / chat module import enforce mute).
 *
 * Dependencies:
 *   - `AuthModule` cho cookie decode trên user-facing controller.
 *   - `AdminModule` cho `AdminGuard` + `RequireAdmin` decorator metadata.
 *   - `PrismaService` standalone.
 *
 * KHÔNG nhập ngược vào `ChatPrivateModule` / `ChatGroupModule` / `ChatModule`
 * (tránh circular). Các module đó import ChatModerationModule và gọi
 * `ChatModerationService.assertNotMuted()` trước send path.
 */
@Module({
  // Phase 19.3 — NotificationModule import optional: cung cấp
  // NotificationHelpers cho ChatModerationService gọi
  // notifyChatReportResolved khi admin resolve/reject report.
  imports: [AuthModule, AdminModule, NotificationModule],
  controllers: [ChatModerationController, AdminChatModerationController],
  providers: [PrismaService, ChatModerationService],
  exports: [ChatModerationService],
})
export class ChatModerationModule {}
