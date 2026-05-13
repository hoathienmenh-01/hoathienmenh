import { Injectable, Logger } from '@nestjs/common';
import {
  CHECKLIST_KEYS,
  type ChecklistKey,
  type DashboardCharacterSummary,
  type DashboardCounters,
  type DashboardProgressionSummary,
  type DashboardResponse,
  type DashboardQuickLink,
  type DashboardWarning,
  type TodayChecklistItem,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 41.0 — Dashboard aggregation service.
 *
 * Read-only aggregation từ nhiều bảng đã có (Character, Mail,
 * Notification, PlayerFeedback, PlayerReport). KHÔNG ghi DB. KHÔNG mint
 * reward. KHÔNG đụng story/quest content.
 *
 * Mỗi sub-query bọc trong try/catch để dashboard không crash khi 1 module
 * phụ thiếu (vd: chưa tới phase event/quest tương ứng).
 */
export class DashboardError extends Error {
  constructor(public code: 'NO_CHARACTER' | 'DASHBOARD_UNAVAILABLE') {
    super(code);
  }
}

@Injectable()
export class PlayerDashboardService {
  private readonly logger = new Logger(PlayerDashboardService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(userId: string): Promise<DashboardResponse> {
    const character = await this.prisma.character.findUnique({
      where: { userId },
    });
    if (!character) throw new DashboardError('NO_CHARACTER');

    const [unreadMail, unreadNotification, activeFeedbackCount, activeReportCount] =
      await Promise.all([
        this.safeCount(() =>
          this.prisma.mail.count({
            where: {
              recipientId: character.id,
              readAt: null,
              deletedAt: null,
            },
          }),
        ),
        this.safeCount(() =>
          this.prisma.notification.count({
            where: { userId, readAt: null },
          }),
        ),
        this.safeCount(() =>
          this.prisma.playerFeedback.count({
            where: {
              reporterCharacterId: character.id,
              status: { in: ['NEW', 'TRIAGE', 'IN_PROGRESS'] },
            },
          }),
        ),
        this.safeCount(() =>
          this.prisma.playerReport.count({
            where: {
              reporterCharacterId: character.id,
              status: { in: ['NEW', 'REVIEWING'] },
            },
          }),
        ),
      ]);

    const characterSummary: DashboardCharacterSummary = {
      characterId: character.id,
      displayName: character.name,
      realmKey: character.realmKey,
      realmStage: character.realmStage,
      level: character.level,
      cultivating: character.cultivating,
      bodyRealmKey: character.bodyRealmKey,
      bodyStage: character.bodyStage,
      bodyCultivating: character.bodyCultivating,
      power: character.power,
      spirit: character.spirit,
      speed: character.speed,
      luck: character.luck,
    };
    const progression: DashboardProgressionSummary = {
      exp: character.exp.toString(),
      bodyExp: character.bodyExp.toString(),
      linhThach: character.linhThach.toString(),
      tienNgoc: character.tienNgoc,
    };
    const counters: DashboardCounters = {
      unreadMail,
      unreadNotification,
      activeFeedbackCount,
      activeReportCount,
    };
    const todayChecklist = this.buildTodayChecklist(character, {
      unreadMail,
      cultivating: character.cultivating,
    });
    const warnings = this.buildWarnings({ unreadMail, unreadNotification });
    const quickLinks = this.buildQuickLinks({
      unreadMail,
      unreadNotification,
      activeFeedbackCount,
    });

    return {
      character: characterSummary,
      progression,
      counters,
      todayChecklist,
      warnings,
      quickLinks,
      lastUpdatedAt: new Date().toISOString(),
    };
  }

  private buildTodayChecklist(
    character: { cultivating: boolean; bodyCultivating: boolean },
    ctx: { unreadMail: number; cultivating: boolean },
  ): TodayChecklistItem[] {
    const items: TodayChecklistItem[] = [];
    const push = (
      key: ChecklistKey,
      partial: Omit<TodayChecklistItem, 'key' | 'titleKey' | 'descriptionKey'>,
    ): void => {
      items.push({
        key,
        titleKey: `dashboard.checklist.${key}.title`,
        descriptionKey: `dashboard.checklist.${key}.description`,
        ...partial,
      });
    };
    push('START_CULTIVATION', {
      status: ctx.cultivating ? 'DONE' : 'TODO',
      priority: ctx.cultivating ? 'LOW' : 'HIGH',
      route: '/breakthrough',
      reasonKey: null,
      progressText: null,
    });
    push('CLAIM_MAIL', {
      status: ctx.unreadMail > 0 ? 'TODO' : 'DONE',
      priority: ctx.unreadMail > 0 ? 'HIGH' : 'LOW',
      route: '/mail',
      reasonKey: null,
      progressText: ctx.unreadMail > 0 ? String(ctx.unreadMail) : null,
    });
    push('RUN_FARM', {
      status: 'TODO',
      priority: 'MEDIUM',
      route: '/farm',
      reasonKey: null,
      progressText: null,
    });
    push('CLEAR_DUNGEON', {
      status: 'TODO',
      priority: 'MEDIUM',
      route: '/dungeon',
      reasonKey: null,
      progressText: null,
    });
    push('CLIMB_TOWER', {
      status: 'TODO',
      priority: 'MEDIUM',
      route: '/trial-tower',
      reasonKey: null,
      progressText: null,
    });
    push('CHECK_MARKET', {
      status: 'TODO',
      priority: 'LOW',
      route: '/market',
      reasonKey: null,
      progressText: null,
    });
    push('JOIN_SECT_ACTIVITY', {
      status: 'TODO',
      priority: 'LOW',
      route: '/sect',
      reasonKey: null,
      progressText: null,
    });
    push('READ_MENTOR_REQUEST', {
      status: 'TODO',
      priority: 'LOW',
      route: '/mentor',
      reasonKey: null,
      progressText: null,
    });
    push('CHECK_RETURNER', {
      status: 'TODO',
      priority: 'LOW',
      route: '/returner',
      reasonKey: null,
      progressText: null,
    });
    return items;
  }

  private buildWarnings(ctx: {
    unreadMail: number;
    unreadNotification: number;
  }): DashboardWarning[] {
    const out: DashboardWarning[] = [];
    if (ctx.unreadMail >= 10) {
      out.push({
        key: 'dashboard.warnings.mailBackedUp',
        severity: 'WARNING',
        route: '/mail',
      });
    }
    if (ctx.unreadNotification >= 20) {
      out.push({
        key: 'dashboard.warnings.notificationBackedUp',
        severity: 'INFO',
        route: '/notifications',
      });
    }
    return out;
  }

  private buildQuickLinks(ctx: {
    unreadMail: number;
    unreadNotification: number;
    activeFeedbackCount: number;
  }): DashboardQuickLink[] {
    return [
      {
        key: 'mail',
        titleKey: 'dashboard.quickLinks.mail',
        route: '/mail',
        enabled: true,
        badge: ctx.unreadMail || null,
      },
      {
        key: 'cultivation',
        titleKey: 'dashboard.quickLinks.cultivation',
        route: '/breakthrough',
        enabled: true,
        badge: null,
      },
      {
        key: 'inventory',
        titleKey: 'dashboard.quickLinks.inventory',
        route: '/inventory',
        enabled: true,
        badge: null,
      },
      {
        key: 'feedback',
        titleKey: 'dashboard.quickLinks.feedback',
        route: '/support/feedback',
        enabled: true,
        badge: ctx.activeFeedbackCount || null,
      },
      {
        key: 'settings',
        titleKey: 'dashboard.quickLinks.settings',
        route: '/settings',
        enabled: true,
        badge: null,
      },
    ];
  }

  private async safeCount(fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(
        `dashboard sub-count failed: ${(e as Error).message}`,
      );
      return 0;
    }
  }
}

export const DASHBOARD_CHECKLIST_KEYS = CHECKLIST_KEYS;
