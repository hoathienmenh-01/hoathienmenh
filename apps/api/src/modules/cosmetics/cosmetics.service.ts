import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COSMETICS_CATALOG,
  EMPTY_COSMETIC_LOADOUT,
  buildCosmeticView,
  canEquipCosmetic,
  getActiveCosmetics,
  getCosmeticById,
  isCosmeticOwnershipExpired,
  loadoutFieldForType,
  type CosmeticDef,
  type CosmeticLoadoutLike,
  type CosmeticOwnershipLike,
  type CosmeticSource,
  type CosmeticType,
  type CosmeticView,
} from '@xuantoi/shared';
import { PrismaService } from '../../common/prisma.service';

export class CosmeticError extends Error {
  constructor(
    public code:
      | 'NO_CHARACTER'
      | 'COSMETIC_NOT_FOUND'
      | 'COSMETIC_INACTIVE'
      | 'NOT_OWNED'
      | 'OWNERSHIP_EXPIRED'
      | 'INVALID_TYPE'
      | 'INVALID_INPUT'
      | 'ALREADY_OWNED_PERMANENT',
  ) {
    super(code);
  }
}

export interface CosmeticLoadoutView {
  activeAuraId: string | null;
  activeTitleId: string | null;
  activeAvatarFrameId: string | null;
  activeChatBadgeId: string | null;
  activeProfileDecorationId: string | null;
  activeElementAuraId: string | null;
}

export interface CosmeticOwnedRow {
  cosmeticId: string;
  source: string;
  ownedAt: string;
  expiresAt: string | null;
}

export interface CosmeticMeResponse {
  catalog: readonly CosmeticView[];
  loadout: CosmeticLoadoutView;
  owned: readonly CosmeticOwnedRow[];
}

/**
 * Phase 25.3 — Code-only Cosmetic Effects service.
 *
 * Server-authoritative wiring around the shared `COSMETICS_CATALOG`.
 *   - Ownership row created via grant (admin / battle pass / shop / etc).
 *   - Equip only mutates `CosmeticLoadout`; never touches stat / power
 *     / realm fields on Character.
 *   - Re-equipping the same id is idempotent.
 *   - Each cosmetic type has at most one active slot at a time.
 *
 * Phase 25.x guarantee preserved: cosmetic does not feed combat / progression.
 */
@Injectable()
export class CosmeticsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Catalog & wardrobe
  // -------------------------------------------------------------------------

  catalog(): readonly CosmeticDef[] {
    return getActiveCosmetics();
  }

  async me(userId: string, now: Date = new Date()): Promise<CosmeticMeResponse> {
    const character = await this.getCharacter(userId);
    const ownerships = await this.prisma.cosmeticOwnership.findMany({
      where: { characterId: character.id },
    });
    const loadout = await this.ensureLoadout(character.id);
    const ownershipById = new Map<string, (typeof ownerships)[number]>();
    for (const o of ownerships) ownershipById.set(o.cosmeticId, o);
    const equippedIds = new Set<string>(
      [
        loadout.activeAuraId,
        loadout.activeTitleId,
        loadout.activeAvatarFrameId,
        loadout.activeChatBadgeId,
        loadout.activeProfileDecorationId,
        loadout.activeElementAuraId,
      ].filter((v): v is string => typeof v === 'string' && v.length > 0),
    );
    const catalog: CosmeticView[] = getActiveCosmetics().map((def) => {
      const ownership = ownershipById.get(def.cosmeticId);
      const ownerLike: CosmeticOwnershipLike | null = ownership
        ? { cosmeticId: ownership.cosmeticId, expiresAt: ownership.expiresAt }
        : null;
      return buildCosmeticView(def, ownerLike, equippedIds, now);
    });
    return {
      catalog,
      loadout: this.toLoadoutView(loadout),
      owned: ownerships
        .filter((o) => !isCosmeticOwnershipExpired({ cosmeticId: o.cosmeticId, expiresAt: o.expiresAt }, now))
        .map((o) => ({
          cosmeticId: o.cosmeticId,
          source: o.source,
          ownedAt: o.ownedAt.toISOString(),
          expiresAt: o.expiresAt ? o.expiresAt.toISOString() : null,
        })),
    };
  }

  // -------------------------------------------------------------------------
  // Equip / unequip
  // -------------------------------------------------------------------------

  async equip(
    userId: string,
    cosmeticId: string,
    now: Date = new Date(),
  ): Promise<CosmeticLoadoutView> {
    const character = await this.getCharacter(userId);
    const def = getCosmeticById(cosmeticId);
    if (!def) throw new CosmeticError('COSMETIC_NOT_FOUND');
    if (!def.active) throw new CosmeticError('COSMETIC_INACTIVE');

    return this.prisma.$transaction(async (tx) => {
      const ownership = await tx.cosmeticOwnership.findUnique({
        where: {
          characterId_cosmeticId: {
            characterId: character.id,
            cosmeticId,
          },
        },
      });
      const ownershipLike: CosmeticOwnershipLike | null = ownership
        ? { cosmeticId: ownership.cosmeticId, expiresAt: ownership.expiresAt }
        : null;
      const check = canEquipCosmetic(def, ownershipLike, now);
      if (!check.ok) throw new CosmeticError(check.reason);

      const field = loadoutFieldForType(def.type);
      const loadout = await tx.cosmeticLoadout.upsert({
        where: { characterId: character.id },
        create: {
          characterId: character.id,
          [field]: cosmeticId,
        },
        update: { [field]: cosmeticId },
      });
      return this.toLoadoutView(loadout);
    });
  }

  async unequip(
    userId: string,
    type: CosmeticType,
  ): Promise<CosmeticLoadoutView> {
    const character = await this.getCharacter(userId);
    const field = loadoutFieldForType(type);
    const loadout = await this.prisma.cosmeticLoadout.upsert({
      where: { characterId: character.id },
      create: { characterId: character.id },
      update: { [field]: null },
    });
    return this.toLoadoutView(loadout);
  }

  // -------------------------------------------------------------------------
  // Public profile loadout — used by ProfileView / PublicPlayerProfileModal.
  // -------------------------------------------------------------------------

  async loadoutByCharacterId(
    characterId: string,
    now: Date = new Date(),
  ): Promise<CosmeticLoadoutView> {
    const loadout = await this.prisma.cosmeticLoadout.findUnique({
      where: { characterId },
    });
    if (!loadout) return { ...EMPTY_COSMETIC_LOADOUT };
    // Filter slots where ownership is missing or expired (defensive — keeps
    // public render honest if an admin revoke happened after equip).
    const slots: (keyof CosmeticLoadoutLike)[] = [
      'activeAuraId',
      'activeTitleId',
      'activeAvatarFrameId',
      'activeChatBadgeId',
      'activeProfileDecorationId',
      'activeElementAuraId',
    ];
    const cleaned: Record<string, string | null> = {};
    for (const slot of slots) {
      const id = loadout[slot];
      if (!id) {
        cleaned[slot] = null;
        continue;
      }
      const def = getCosmeticById(id);
      if (!def || !def.active) {
        cleaned[slot] = null;
        continue;
      }
      const ownership = await this.prisma.cosmeticOwnership.findUnique({
        where: { characterId_cosmeticId: { characterId, cosmeticId: id } },
      });
      if (!ownership) {
        cleaned[slot] = null;
        continue;
      }
      if (
        isCosmeticOwnershipExpired(
          { cosmeticId: ownership.cosmeticId, expiresAt: ownership.expiresAt },
          now,
        )
      ) {
        cleaned[slot] = null;
        continue;
      }
      cleaned[slot] = id;
    }
    return cleaned as unknown as CosmeticLoadoutView;
  }

  // -------------------------------------------------------------------------
  // Admin grant / revoke
  // -------------------------------------------------------------------------

  async adminGrant(
    adminUserId: string,
    targetUserId: string,
    cosmeticId: string,
    options?: { source?: CosmeticSource; durationDays?: number; reason?: string },
  ): Promise<{ cosmeticId: string; source: string; expiresAt: string | null }> {
    const def = getCosmeticById(cosmeticId);
    if (!def) throw new CosmeticError('COSMETIC_NOT_FOUND');
    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { id: true },
    });
    if (!target) throw new CosmeticError('NO_CHARACTER');

    const source: CosmeticSource = options?.source ?? 'ADMIN';
    const expiresAt =
      options?.durationDays && options.durationDays > 0
        ? new Date(Date.now() + options.durationDays * 86_400_000)
        : def.durationDays && def.durationDays > 0
          ? new Date(Date.now() + def.durationDays * 86_400_000)
          : null;

    const ownership = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cosmeticOwnership.findUnique({
        where: {
          characterId_cosmeticId: {
            characterId: target.id,
            cosmeticId,
          },
        },
      });
      if (existing) {
        // Extend expiry / refresh source.
        const merged = await tx.cosmeticOwnership.update({
          where: { id: existing.id },
          data: {
            source,
            expiresAt: this.mergeExpiry(existing.expiresAt, expiresAt),
            grantReason: options?.reason ?? 'ADMIN_GRANT',
          },
        });
        return merged;
      }
      return tx.cosmeticOwnership.create({
        data: {
          characterId: target.id,
          cosmeticId,
          source,
          expiresAt,
          grantReason: options?.reason ?? 'ADMIN_GRANT',
        },
      });
    });

    await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'COSMETIC_GRANT',
        meta: {
          targetUserId,
          cosmeticId,
          source,
          durationDays: options?.durationDays ?? null,
          expiresAt: ownership.expiresAt ? ownership.expiresAt.toISOString() : null,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      cosmeticId: ownership.cosmeticId,
      source: ownership.source,
      expiresAt: ownership.expiresAt ? ownership.expiresAt.toISOString() : null,
    };
  }

  async adminRevoke(
    adminUserId: string,
    targetUserId: string,
    cosmeticId: string,
  ): Promise<{ cosmeticId: string }> {
    const def = getCosmeticById(cosmeticId);
    if (!def) throw new CosmeticError('COSMETIC_NOT_FOUND');
    const target = await this.prisma.character.findUnique({
      where: { userId: targetUserId },
      select: { id: true },
    });
    if (!target) throw new CosmeticError('NO_CHARACTER');

    await this.prisma.$transaction(async (tx) => {
      await tx.cosmeticOwnership.deleteMany({
        where: { characterId: target.id, cosmeticId },
      });
      // Clear any loadout slot that references the revoked cosmetic.
      const loadout = await tx.cosmeticLoadout.findUnique({
        where: { characterId: target.id },
      });
      if (loadout) {
        const updateData: Record<string, string | null> = {};
        const slots: (keyof CosmeticLoadoutLike)[] = [
          'activeAuraId',
          'activeTitleId',
          'activeAvatarFrameId',
          'activeChatBadgeId',
          'activeProfileDecorationId',
          'activeElementAuraId',
        ];
        for (const slot of slots) {
          if (loadout[slot] === cosmeticId) updateData[slot] = null;
        }
        if (Object.keys(updateData).length > 0) {
          await tx.cosmeticLoadout.update({
            where: { characterId: target.id },
            data: updateData,
          });
        }
      }
    });

    await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: adminUserId,
        action: 'COSMETIC_REVOKE',
        meta: { targetUserId, cosmeticId } as Prisma.InputJsonValue,
      },
    });

    return { cosmeticId };
  }

  /**
   * Phase 25.x integration seam — Battle Pass / Monthly Card / Shop Pack
   * grant flows can call this in their own transaction to materialize
   * a cosmetic reward. Idempotent on (characterId, cosmeticId).
   *
   * NOT used by Phase 25.3 itself; exposed so a future PR can wire
   * `cosmetic.kind` rewards from `MonetizationReward` without duplicating
   * the ownership shape.
   */
  async grantOwnershipTx(
    tx: Prisma.TransactionClient,
    characterId: string,
    cosmeticId: string,
    source: CosmeticSource,
    options?: { durationDays?: number; reason?: string; refId?: string },
  ): Promise<void> {
    const def = getCosmeticById(cosmeticId);
    if (!def) throw new CosmeticError('COSMETIC_NOT_FOUND');
    const expiresAt =
      options?.durationDays && options.durationDays > 0
        ? new Date(Date.now() + options.durationDays * 86_400_000)
        : def.durationDays && def.durationDays > 0
          ? new Date(Date.now() + def.durationDays * 86_400_000)
          : null;
    const existing = await tx.cosmeticOwnership.findUnique({
      where: { characterId_cosmeticId: { characterId, cosmeticId } },
    });
    if (existing) {
      await tx.cosmeticOwnership.update({
        where: { id: existing.id },
        data: {
          source,
          expiresAt: this.mergeExpiry(existing.expiresAt, expiresAt),
          grantReason: options?.reason ?? source,
          grantRefId: options?.refId ?? existing.grantRefId,
        },
      });
      return;
    }
    await tx.cosmeticOwnership.create({
      data: {
        characterId,
        cosmeticId,
        source,
        expiresAt,
        grantReason: options?.reason ?? source,
        grantRefId: options?.refId ?? null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async getCharacter(userId: string): Promise<{ id: string }> {
    const character = await this.prisma.character.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!character) throw new CosmeticError('NO_CHARACTER');
    return character;
  }

  private async ensureLoadout(characterId: string) {
    return this.prisma.cosmeticLoadout.upsert({
      where: { characterId },
      create: { characterId },
      update: {},
    });
  }

  private toLoadoutView(loadout: {
    activeAuraId: string | null;
    activeTitleId: string | null;
    activeAvatarFrameId: string | null;
    activeChatBadgeId: string | null;
    activeProfileDecorationId: string | null;
    activeElementAuraId: string | null;
  }): CosmeticLoadoutView {
    return {
      activeAuraId: loadout.activeAuraId,
      activeTitleId: loadout.activeTitleId,
      activeAvatarFrameId: loadout.activeAvatarFrameId,
      activeChatBadgeId: loadout.activeChatBadgeId,
      activeProfileDecorationId: loadout.activeProfileDecorationId,
      activeElementAuraId: loadout.activeElementAuraId,
    };
  }

  private mergeExpiry(
    current: Date | null,
    next: Date | null,
  ): Date | null {
    if (!current && !next) return null;
    if (!current) return next;
    if (!next) return null; // grant explicitly switches to permanent.
    // Always extend to the later of the two timestamps.
    return current.getTime() >= next.getTime() ? current : next;
  }
}

// Re-export for tests.
export { COSMETICS_CATALOG };
