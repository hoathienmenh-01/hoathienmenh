/**
 * Phase 29.0 — PvP Snapshot service.
 *
 * Build immutable battle snapshot từ Character row tại thời điểm queue.
 * Snapshot KHÔNG được rebuild sau resolve — anti-cheat invariant (spec
 * PHẦN 1 §4). Snapshot type:
 *   - ATTACKER: build cho người khiêu chiến.
 *   - DEFENDER: build cho người phòng thủ (passive).
 *   - SECT_MEMBER: build cho roster trong sect war.
 *   - TERRITORY_GUARD: build cho roster defend territory.
 *
 * Power formula reuse `Character.power` (cached, server-authoritative).
 * Detail breakdown (HP/MP/spirit/speed/luck/realmStage) đi kèm để
 * replay verify (spec PHẦN 16).
 */
import { Injectable } from '@nestjs/common';
import {
  realmByKey,
  validatePvpSnapshot,
  type PvpBattleSnapshot,
  type PvpSnapshotType,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export class PvpSnapshotError extends Error {
  constructor(
    public readonly code: 'PVP_TARGET_NOT_FOUND' | 'PVP_SNAPSHOT_INVALID',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'PvpSnapshotError';
  }
}

@Injectable()
export class PvpSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build snapshot trực tiếp từ DB. KHÔNG cache — caller responsible.
   * Throw `PvpSnapshotError` nếu character không tồn tại hoặc snapshot
   * fail validator (data corruption).
   */
  async buildForCharacter(
    characterId: string,
    snapshotType: PvpSnapshotType,
  ): Promise<PvpBattleSnapshot> {
    const c = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        name: true,
        realmKey: true,
        realmStage: true,
        level: true,
        power: true,
        hp: true,
        hpMax: true,
        mp: true,
        mpMax: true,
        spirit: true,
        speed: true,
        luck: true,
      },
    });
    if (!c) {
      throw new PvpSnapshotError(
        'PVP_TARGET_NOT_FOUND',
        `character ${characterId} không tồn tại`,
      );
    }
    const realm = realmByKey(c.realmKey);
    const realmOrder = realm?.order ?? 0;
    const snapshot: PvpBattleSnapshot = {
      characterId: this.stableNumericId(c.id),
      characterKey: c.id,
      displayName: c.name,
      realmKey: c.realmKey,
      realmOrder,
      realmStage: c.realmStage,
      level: c.level,
      totalPower: c.power,
      snapshotType,
      stats: {
        hp: c.hp,
        hpMax: c.hpMax,
        mp: c.mp,
        mpMax: c.mpMax,
        spirit: c.spirit,
        speed: c.speed,
        luck: c.luck,
      },
      createdAt: new Date().toISOString(),
    };
    const issues = validatePvpSnapshot(snapshot);
    if (issues.length > 0) {
      throw new PvpSnapshotError(
        'PVP_SNAPSHOT_INVALID',
        `snapshot validation thất bại: ${issues.map((i) => i.code).join(',')}`,
        issues,
      );
    }
    return snapshot;
  }

  /**
   * Stable numeric id từ characterId string (cuid). Snapshot type yêu cầu
   * `characterId: number` cho compat với combat hiện có; ta hash cuid -> 32-bit.
   */
  private stableNumericId(cuid: string): number {
    let h = 0;
    for (let i = 0; i < cuid.length; i++) {
      h = (h * 31 + cuid.charCodeAt(i)) | 0;
    }
    // Đảm bảo dương để JSON đẹp.
    return Math.abs(h) || 1;
  }
}
