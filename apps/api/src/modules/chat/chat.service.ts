import { Inject, Injectable, Optional } from '@nestjs/common';
import { ChatChannel } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';
import {
  ChatModerationError,
  ChatModerationService,
} from '../chat-moderation/chat-moderation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MissionService } from '../mission/mission.service';
import { AchievementService } from '../character/achievement.service';
import {
  InMemorySlidingWindowRateLimiter,
  RateLimiter,
} from '../../common/rate-limiter';

class ChatError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'NO_SECT'
      | 'EMPTY_TEXT'
      | 'TEXT_TOO_LONG'
      | 'RATE_LIMITED'
      | 'MUTED',
  ) {
    super(code);
  }
}

export interface ChatMessageView {
  id: string;
  channel: ChatChannel;
  scopeKey: string;
  senderId: string;
  senderName: string;
  text: string;
  createdAt: string;
}

const MAX_HISTORY = 100;
const MAX_TEXT_LEN = 200;
const HISTORY_RETENTION = 500;

/**
 * Giới hạn chat mỗi người: 8 tin trong 30 giây. Áp dụng chung cho cả
 * kênh WORLD lẫn SECT (spam 1 chỗ = rate-limit cả 2 chỗ, chặn chiến
 * thuật đổi kênh để spam tiếp).
 *
 * Cross-instance: limiter phải dùng Redis sliding window nếu scale > 1
 * replica; in-memory fallback chỉ dùng khi test/dev không có Redis.
 */
export const CHAT_RATE_LIMIT_WINDOW_MS = 30_000;
export const CHAT_RATE_LIMIT_MAX = 8;
export const CHAT_RATE_LIMITER = Symbol('CHAT_RATE_LIMITER');

@Injectable()
export class ChatService {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly missions: MissionService,
    @Optional() @Inject(CHAT_RATE_LIMITER) limiter?: RateLimiter,
    @Optional() private readonly achievements?: AchievementService,
    @Optional() private readonly moderation?: ChatModerationService,
  ) {
    this.limiter =
      limiter ??
      new InMemorySlidingWindowRateLimiter(
        CHAT_RATE_LIMIT_WINDOW_MS,
        CHAT_RATE_LIMIT_MAX,
      );
  }

  async historyWorld(): Promise<ChatMessageView[]> {
    return this.fetchHistory(ChatChannel.WORLD, 'world');
  }

  /**
   * Trả lịch sử SECT chat — chỉ cho user thuộc đúng sect đó. Không nhận
   * scopeKey từ client để tránh user A đọc lén chat sect B.
   */
  async historySect(userId: string): Promise<ChatMessageView[]> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { sectId: true },
    });
    if (!char) throw new ChatError('NO_CHARACTER');
    if (!char.sectId) throw new ChatError('NO_SECT');
    return this.fetchHistory(ChatChannel.SECT, char.sectId);
  }

  private async fetchHistory(
    channel: ChatChannel,
    scopeKey: string,
  ): Promise<ChatMessageView[]> {
    const rows = await this.prisma.chatMessage.findMany({
      where: { channel, scopeKey },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
    });
    return rows
      .reverse()
      .map((r) => ({
        id: r.id,
        channel: r.channel,
        scopeKey: r.scopeKey,
        senderId: r.senderId,
        senderName: r.senderName,
        text: r.text,
        createdAt: r.createdAt.toISOString(),
      }));
  }

  async sendWorld(userId: string, text: string): Promise<ChatMessageView> {
    return this.send(userId, ChatChannel.WORLD, 'world', text);
  }

  async sendSect(userId: string, text: string): Promise<ChatMessageView> {
    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, name: true, sectId: true },
    });
    if (!char) throw new ChatError('NO_CHARACTER');
    if (!char.sectId) throw new ChatError('NO_SECT');
    return this.send(userId, ChatChannel.SECT, char.sectId, text);
  }

  private async send(
    userId: string,
    channel: ChatChannel,
    scopeKey: string,
    rawText: string,
  ): Promise<ChatMessageView> {
    const text = rawText.trim();
    if (!text) throw new ChatError('EMPTY_TEXT');
    if (text.length > MAX_TEXT_LEN) throw new ChatError('TEXT_TOO_LONG');

    const char = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true, name: true },
    });
    if (!char) throw new ChatError('NO_CHARACTER');

    // Phase 19.2 — mute enforcement (WORLD_SECT_CHAT scope). Optional
    // service inject để giữ backward compat với test setup cũ (không
    // có ChatModerationModule wired). Khi service hiện diện và user
    // active mute → throw `MUTED`.
    if (this.moderation) {
      try {
        await this.moderation.assertNotMuted(userId, 'WORLD_SECT_CHAT');
      } catch (e) {
        if (e instanceof ChatModerationError && e.code === 'MUTED') {
          throw new ChatError('MUTED');
        }
        throw e;
      }
    }

    const rl = await this.limiter.check(char.id);
    if (!rl.allowed) throw new ChatError('RATE_LIMITED');

    const row = await this.prisma.chatMessage.create({
      data: {
        channel,
        scopeKey,
        senderId: char.id,
        senderName: char.name,
        text,
      },
    });

    // Cắt lịch sử để DB không phình.
    await this.pruneHistory(channel, scopeKey);

    const view: ChatMessageView = {
      id: row.id,
      channel: row.channel,
      scopeKey: row.scopeKey,
      senderId: row.senderId,
      senderName: row.senderName,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
    };

    if (channel === ChatChannel.WORLD) {
      this.realtime.broadcast('chat:msg', view);
    } else {
      this.realtime.emitToRoom(`sect:${scopeKey}`, 'chat:msg', view);
    }

    // Phase 11.10.C-2 wire trackEvent vào achievement bằng cùng goalKind
    // CHAT_MESSAGE. Fail-soft: không rollback chat nếu mission/achievement lỗi.
    try {
      await this.missions.track(char.id, 'CHAT_MESSAGE', 1);
      if (this.achievements) {
        await this.achievements.trackEvent(char.id, 'CHAT_MESSAGE', 1);
      }
    } catch {
      // bỏ qua — chat đã thành công, mission/achievement fail không rollback.
    }

    return view;
  }

  private async pruneHistory(channel: ChatChannel, scopeKey: string): Promise<void> {
    const total = await this.prisma.chatMessage.count({
      where: { channel, scopeKey },
    });
    if (total <= HISTORY_RETENTION) return;
    const oldest = await this.prisma.chatMessage.findMany({
      where: { channel, scopeKey },
      orderBy: { createdAt: 'asc' },
      take: total - HISTORY_RETENTION,
      select: { id: true },
    });
    if (oldest.length === 0) return;
    await this.prisma.chatMessage.deleteMany({
      where: { id: { in: oldest.map((o) => o.id) } },
    });
  }
}

export { ChatError };
