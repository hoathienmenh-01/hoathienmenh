import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventPersonalMilestone,
  type PersonalEventTriggerType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — PersonalMilestoneEventService.
 *
 * Auto-trigger event cá nhân khi player đạt mốc (realm reached, body realm
 * reached, content cleared). Tạo `PersonalEventProgress` row với expiresAt
 * = startedAt + durationDays.
 *
 * `EventDef` row cha cho personal events được admin tạo trước (status=ACTIVE
 * + bracketMode=NONE + eventType=PERSONAL_*); service này chỉ tạo
 * instance per character.
 */

export interface TriggerInput {
  eventKey: string;
  characterId: string;
  triggerType: PersonalEventTriggerType;
  triggerValue: number;
  durationDays: number;
  bracketTier?: number;
  now?: Date;
}

@Injectable()
export class EventPersonalMilestoneService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventKey: string) {
    return this.prisma.personalEventProgress.findMany({
      where: { eventKey },
      orderBy: [{ startedAt: 'desc' }],
      take: 200,
    });
  }

  async listForCharacter(characterId: string) {
    const now = new Date();
    return this.prisma.personalEventProgress.findMany({
      where: { characterId, expiresAt: { gt: now } },
      orderBy: [{ startedAt: 'desc' }],
      take: 50,
    });
  }

  validateTemplate(input: {
    key: string;
    name?: string;
    description?: string;
    triggerType: PersonalEventTriggerType;
    triggerValue: number;
    durationDays: number;
    bracketTier?: number;
    missionGroupKey?: string | null;
    rewardProfileKey?: string | null;
    enabled?: boolean;
  }) {
    return validateEventPersonalMilestone({
      key: input.key,
      name: input.name,
      description: input.description,
      triggerType: input.triggerType,
      triggerValue: input.triggerValue,
      durationDays: input.durationDays,
      bracketTier: input.bracketTier ?? 1,
      missionGroupKey: input.missionGroupKey ?? undefined,
      rewardProfileKey: input.rewardProfileKey ?? undefined,
      enabled: input.enabled ?? true,
    });
  }

  /**
   * Trigger 1 event personal cho 1 character. Idempotent — gọi lại với
   * cùng (eventKey, characterId) trả row đã có.
   */
  async trigger(input: TriggerInput): Promise<{
    created: boolean;
    rowId: string;
    expiresAt: Date;
  }> {
    const evt = await this.prisma.eventDef.findUnique({
      where: { key: input.eventKey },
    });
    if (!evt) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (!evt.enabled || evt.status !== 'ACTIVE') {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_ACTIVE' } },
        HttpStatus.CONFLICT,
      );
    }
    const now = input.now ?? new Date();
    const existing = await this.prisma.personalEventProgress.findUnique({
      where: {
        eventKey_characterId: {
          eventKey: input.eventKey,
          characterId: input.characterId,
        },
      },
    });
    if (existing) {
      return {
        created: false,
        rowId: existing.id,
        expiresAt: existing.expiresAt,
      };
    }
    const durationMs = Math.max(1, input.durationDays) * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(now.getTime() + durationMs);
    const row = await this.prisma.personalEventProgress.create({
      data: {
        eventKey: input.eventKey,
        characterId: input.characterId,
        triggerType: input.triggerType,
        triggerValue: input.triggerValue,
        startedAt: now,
        expiresAt,
        bracketTier: input.bracketTier ?? 1,
      },
    });
    return { created: true, rowId: row.id, expiresAt };
  }

  async claim(rowId: string, characterId: string) {
    const row = await this.prisma.personalEventProgress.findUnique({
      where: { id: rowId },
    });
    if (!row || row.characterId !== characterId) {
      throw new HttpException(
        { ok: false, error: { code: 'PERSONAL_EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    if (row.claimedAt) {
      return { claimed: false, alreadyClaimed: true };
    }
    if (new Date() > row.expiresAt) {
      throw new HttpException(
        { ok: false, error: { code: 'PERSONAL_EVENT_EXPIRED' } },
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.personalEventProgress.update({
      where: { id: rowId },
      data: { claimedAt: new Date(), completedAt: new Date() },
    });
    return { claimed: true, alreadyClaimed: false };
  }
}
