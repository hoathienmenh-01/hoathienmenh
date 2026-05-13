import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  validateEventMission,
  type EventMissionDef,
  type EventMissionType,
  type EventMissionResetType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 28.0 — EventMissionService.
 *
 * - CRUD mission def.
 * - Increment progress per character per resetCycleId.
 * - Claim mission (one-shot per (mission, character, resetCycleId)).
 *
 * Reward grant logic (currency/items) wire qua RewardProfile + ledger ở PR2;
 * PR1 chỉ track progress + claimedAt (idempotent claim).
 */
@Injectable()
export class EventMissionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventKey: string): Promise<EventMissionDef[]> {
    const rows = await this.prisma.eventMissionDef.findMany({
      where: { eventKey },
      orderBy: [{ enabled: 'desc' }, { missionType: 'asc' }, { key: 'asc' }],
    });
    return rows.map((r) => this.toShared(r));
  }

  async upsert(
    input: EventMissionDef,
    _adminUserId: string,
  ): Promise<EventMissionDef> {
    const v = validateEventMission(input);
    if (!v.ok) {
      throw new HttpException(
        {
          ok: false,
          error: { code: 'EVENT_MISSION_INVALID', meta: { issues: v.errors } },
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const evt = await this.prisma.eventDef.findUnique({
      where: { key: input.eventKey },
    });
    if (!evt) {
      throw new HttpException(
        { ok: false, error: { code: 'EVENT_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const row = await this.prisma.eventMissionDef.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        eventKey: input.eventKey,
        bracketKey: input.bracketKey ?? null,
        name: input.name,
        description: input.description ?? '',
        missionType: input.missionType,
        targetValue: input.targetValue,
        resetType: input.resetType,
        rewardProfileKey: input.rewardProfileKey ?? null,
        scoreAmount: input.scoreAmount,
        tokenReward: input.tokenReward,
        enabled: input.enabled,
      },
      update: {
        bracketKey: input.bracketKey ?? null,
        name: input.name,
        description: input.description ?? '',
        missionType: input.missionType,
        targetValue: input.targetValue,
        resetType: input.resetType,
        rewardProfileKey: input.rewardProfileKey ?? null,
        scoreAmount: input.scoreAmount,
        tokenReward: input.tokenReward,
        enabled: input.enabled,
      },
    });
    return this.toShared(row);
  }

  async delete(key: string): Promise<{ deleted: boolean }> {
    await this.prisma.eventMissionDef.delete({ where: { key } });
    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Player runtime: progress + claim
  // -------------------------------------------------------------------------

  /** Compute `resetCycleId` cho mission tuỳ resetType. */
  computeResetCycleId(
    resetType: EventMissionResetType,
    eventKey: string,
    now: Date,
  ): string {
    if (resetType === 'DAILY') {
      const yyyy = now.getUTCFullYear();
      const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(now.getUTCDate()).padStart(2, '0');
      return `${eventKey}__D${yyyy}${mm}${dd}`;
    }
    if (resetType === 'WEEKLY') {
      // ISO week (UTC).
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const day = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - day);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
      );
      return `${eventKey}__W${d.getUTCFullYear()}${String(weekNo).padStart(
        2,
        '0',
      )}`;
    }
    return `${eventKey}__EVENT_ONCE`;
  }

  async getProgress(
    missionKey: string,
    characterId: string,
    resetCycleId: string,
  ) {
    return this.prisma.eventMissionProgress.findUnique({
      where: {
        missionKey_characterId_resetCycleId: {
          missionKey,
          characterId,
          resetCycleId,
        },
      },
    });
  }

  async listProgressForCharacter(
    eventKey: string,
    characterId: string,
  ) {
    return this.prisma.eventMissionProgress.findMany({
      where: { eventKey, characterId },
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
    });
  }

  async incrementProgress(
    missionKey: string,
    characterId: string,
    delta: number,
    now: Date = new Date(),
  ) {
    const mission = await this.prisma.eventMissionDef.findUnique({
      where: { key: missionKey },
    });
    if (!mission || !mission.enabled) {
      throw new HttpException(
        { ok: false, error: { code: 'MISSION_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const resetCycleId = this.computeResetCycleId(
      mission.resetType as EventMissionResetType,
      mission.eventKey,
      now,
    );
    const cur = await this.prisma.eventMissionProgress.findUnique({
      where: {
        missionKey_characterId_resetCycleId: {
          missionKey,
          characterId,
          resetCycleId,
        },
      },
    });
    const newValue = Math.min(
      mission.targetValue,
      (cur?.currentValue ?? 0) + Math.max(0, Math.floor(delta)),
    );
    const completedAt =
      newValue >= mission.targetValue
        ? cur?.completedAt ?? now
        : cur?.completedAt ?? null;
    const row = await this.prisma.eventMissionProgress.upsert({
      where: {
        missionKey_characterId_resetCycleId: {
          missionKey,
          characterId,
          resetCycleId,
        },
      },
      create: {
        eventKey: mission.eventKey,
        missionKey,
        characterId,
        bracketKey: mission.bracketKey ?? null,
        currentValue: newValue,
        completedAt,
        resetCycleId,
      },
      update: {
        currentValue: newValue,
        completedAt,
      },
    });
    return row;
  }

  /** Claim mission — idempotent: claim 2 lần trả cùng row, không double reward. */
  async claim(
    missionKey: string,
    characterId: string,
    now: Date = new Date(),
  ): Promise<{ claimed: boolean; alreadyClaimed: boolean; row: unknown }> {
    const mission = await this.prisma.eventMissionDef.findUnique({
      where: { key: missionKey },
    });
    if (!mission || !mission.enabled) {
      throw new HttpException(
        { ok: false, error: { code: 'MISSION_NOT_FOUND' } },
        HttpStatus.NOT_FOUND,
      );
    }
    const resetCycleId = this.computeResetCycleId(
      mission.resetType as EventMissionResetType,
      mission.eventKey,
      now,
    );
    const cur = await this.prisma.eventMissionProgress.findUnique({
      where: {
        missionKey_characterId_resetCycleId: {
          missionKey,
          characterId,
          resetCycleId,
        },
      },
    });
    if (!cur || cur.currentValue < mission.targetValue) {
      throw new HttpException(
        { ok: false, error: { code: 'MISSION_NOT_COMPLETE' } },
        HttpStatus.CONFLICT,
      );
    }
    if (cur.claimedAt) {
      return { claimed: false, alreadyClaimed: true, row: cur };
    }
    const updated = await this.prisma.eventMissionProgress.update({
      where: { id: cur.id },
      data: { claimedAt: now },
    });
    return { claimed: true, alreadyClaimed: false, row: updated };
  }

  private toShared(row: {
    key: string;
    eventKey: string;
    bracketKey: string | null;
    name: string;
    description: string;
    missionType: string;
    targetValue: number;
    resetType: string;
    rewardProfileKey: string | null;
    scoreAmount: number;
    tokenReward: number;
    enabled: boolean;
  }): EventMissionDef {
    return {
      key: row.key,
      eventKey: row.eventKey,
      bracketKey: row.bracketKey,
      name: row.name,
      description: row.description,
      missionType: row.missionType as EventMissionType,
      targetValue: row.targetValue,
      resetType: row.resetType as EventMissionResetType,
      rewardProfileKey: row.rewardProfileKey,
      scoreAmount: row.scoreAmount,
      tokenReward: row.tokenReward,
      enabled: row.enabled,
    };
  }
}
