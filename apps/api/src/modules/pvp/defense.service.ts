/**
 * Phase 29.0 — PvP Defense Profile service.
 *
 * Quản lý 1-1 `PvpDefenseProfile` per character. Khi character bị
 * challenge ngoài arena (DUEL/SECT_WAR/TERRITORY_WAR), server load
 * snapshot này thay vì rebuild realtime → tránh stale & cho player tự
 * "set up defense" trước khi đi offline.
 *
 * Fallback: nếu chưa có profile, BattleService sẽ build snapshot từ
 * stats hiện tại (xem `battle.service.ts`).
 */
import { Injectable } from '@nestjs/common';
import {
  validatePvpDefenseProfile,
  type PvpBattleSnapshot,
  type PvpDefenseProfileDef,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';
import { PvpSnapshotService } from './snapshot.service';

export class PvpDefenseError extends Error {
  constructor(
    public readonly code:
      | 'PVP_DEFENSE_INVALID_LABEL'
      | 'PVP_DEFENSE_VALIDATION_FAILED'
      | 'PVP_DEFENSE_NOT_FOUND',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PvpDefenseError';
  }
}

@Injectable()
export class PvpDefenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotSvc: PvpSnapshotService,
  ) {}

  /**
   * Get current defense profile (return null nếu chưa có).
   * Caller (battle.service) gọi qua `loadOrBuild` để có fallback.
   */
  async get(characterId: string): Promise<PvpDefenseProfileDef | null> {
    const row = await this.prisma.pvpDefenseProfile.findUnique({
      where: { characterId },
    });
    if (!row) return null;
    return {
      characterId: this.numericId(characterId),
      characterKey: characterId,
      snapshot: row.snapshotJson as unknown as PvpBattleSnapshot,
      label: row.label ?? undefined,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Upsert defense profile. Build snapshot mới từ stats hiện tại (DEFENDER
   * snapshotType) — KHÔNG cho player truyền snapshot raw để chặn forge.
   */
  async upsert(
    characterId: string,
    label: string | null | undefined,
  ): Promise<PvpDefenseProfileDef> {
    if (label && label.length > 60) {
      throw new PvpDefenseError(
        'PVP_DEFENSE_INVALID_LABEL',
        'label tối đa 60 ký tự',
      );
    }
    const snapshot = await this.snapshotSvc.buildForCharacter(
      characterId,
      'DEFENDER',
    );
    const profile: PvpDefenseProfileDef = {
      characterId: snapshot.characterId,
      characterKey: characterId,
      snapshot,
      label: label ?? undefined,
      updatedAt: new Date().toISOString(),
    };
    const issues = validatePvpDefenseProfile(profile);
    if (issues.length > 0) {
      throw new PvpDefenseError(
        'PVP_DEFENSE_VALIDATION_FAILED',
        `defense validation thất bại: ${issues.map((i) => i.code).join(',')}`,
        issues,
      );
    }
    await this.prisma.pvpDefenseProfile.upsert({
      where: { characterId },
      create: {
        characterId,
        snapshotJson: snapshot as unknown as object,
        label: label ?? null,
      },
      update: {
        snapshotJson: snapshot as unknown as object,
        label: label ?? null,
      },
    });
    return profile;
  }

  /**
   * Load saved snapshot, fallback rebuild realtime (DEFENDER snapshotType).
   * BattleService gọi khi setup match.
   */
  async loadOrBuild(characterId: string): Promise<PvpBattleSnapshot> {
    const existing = await this.get(characterId);
    if (existing) return existing.snapshot;
    return await this.snapshotSvc.buildForCharacter(characterId, 'DEFENDER');
  }

  private numericId(cuid: string): number {
    let h = 0;
    for (let i = 0; i < cuid.length; i++) {
      h = (h * 31 + cuid.charCodeAt(i)) | 0;
    }
    return Math.abs(h) || 1;
  }
}
