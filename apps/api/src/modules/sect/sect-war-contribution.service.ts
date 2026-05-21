import { Injectable } from '@nestjs/common';
import { Prisma, SectRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

/**
 * Phase 13.8 — Sect war contribution tracking with role-aware queries.
 *
 * Extends existing SectWarContribution model with role-aware aggregation.
 * Tracks contribution per member during sect war events with role filtering.
 */

export interface SectWarContributionByRole {
  role: SectRole;
  totalPoints: number;
  memberCount: number;
  topContributors: Array<{
    characterId: string;
    characterName: string;
    role: SectRole;
    points: number;
  }>;
}

export interface SectWarContributionSummary {
  weekKey: string;
  sectId: string;
  totalPoints: number;
  byRole: SectWarContributionByRole[];
  topContributors: Array<{
    characterId: string;
    characterName: string;
    role: SectRole;
    points: number;
  }>;
}

@Injectable()
export class SectWarContributionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get sect war contribution summary with role-aware breakdown.
   */
  async getSummary(
    sectId: string,
    weekKey: string,
  ): Promise<SectWarContributionSummary> {
    // Get all contributions for sect in week.
    const contributions = await this.prisma.sectWarContribution.findMany({
      where: { sectId, weekKey },
      include: {
        character: {
          select: {
            id: true,
            name: true,
            sectMembers: {
              where: { sectId },
              select: { role: true },
            },
          },
        },
      },
    });

    // Aggregate by character with role.
    const byChar = new Map<
      string,
      { name: string; role: SectRole; points: number }
    >();
    for (const c of contributions) {
      const role = c.character.sectMembers[0]?.role ?? 'MEMBER';
      const existing = byChar.get(c.characterId);
      if (existing) {
        existing.points += c.points;
      } else {
        byChar.set(c.characterId, {
          name: c.character.name,
          role,
          points: c.points,
        });
      }
    }

    // Aggregate by role.
    const byRole = new Map<
      SectRole,
      { totalPoints: number; members: Set<string>; top: Array<{ id: string; name: string; points: number }> }
    >();
    for (const [charId, data] of byChar.entries()) {
      if (!byRole.has(data.role)) {
        byRole.set(data.role, { totalPoints: 0, members: new Set(), top: [] });
      }
      const roleData = byRole.get(data.role)!;
      roleData.totalPoints += data.points;
      roleData.members.add(charId);
      roleData.top.push({ id: charId, name: data.name, points: data.points });
    }

    // Sort top contributors per role.
    const byRoleArray: SectWarContributionByRole[] = [];
    for (const [role, data] of byRole.entries()) {
      data.top.sort((a, b) => b.points - a.points);
      byRoleArray.push({
        role,
        totalPoints: data.totalPoints,
        memberCount: data.members.size,
        topContributors: data.top.slice(0, 5).map((t) => ({
          characterId: t.id,
          characterName: t.name,
          role,
          points: t.points,
        })),
      });
    }

    // Sort by role hierarchy (LEADER > ELDER > MEMBER).
    byRoleArray.sort((a, b) => {
      const order = { LEADER: 0, ELDER: 1, MEMBER: 2 };
      return order[a.role] - order[b.role];
    });

    // Overall top contributors.
    const allTop = Array.from(byChar.entries())
      .map(([id, data]) => ({
        characterId: id,
        characterName: data.name,
        role: data.role,
        points: data.points,
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 10);

    const totalPoints = contributions.reduce((sum, c) => sum + c.points, 0);

    return {
      weekKey,
      sectId,
      totalPoints,
      byRole: byRoleArray,
      topContributors: allTop,
    };
  }

  /**
   * Get personal contribution for a character in a week.
   */
  async getPersonalContribution(
    characterId: string,
    weekKey: string,
  ): Promise<{
    totalPoints: number;
    rank: number | null;
    breakdown: Array<{ activityKey: string; points: number; count: number }>;
  }> {
    const char = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { sectId: true },
    });
    if (!char?.sectId) {
      return { totalPoints: 0, rank: null, breakdown: [] };
    }

    // Get personal contributions.
    const contributions = await this.prisma.sectWarContribution.findMany({
      where: { characterId, weekKey },
    });

    const totalPoints = contributions.reduce((sum, c) => sum + c.points, 0);

    // Breakdown by activity.
    const byActivity = new Map<string, { points: number; count: number }>();
    for (const c of contributions) {
      const existing = byActivity.get(c.activityKey);
      if (existing) {
        existing.points += c.points;
        existing.count += 1;
      } else {
        byActivity.set(c.activityKey, { points: c.points, count: 1 });
      }
    }

    const breakdown = Array.from(byActivity.entries()).map(([key, data]) => ({
      activityKey: key,
      points: data.points,
      count: data.count,
    }));

    // Compute rank within sect.
    const sectContributions = await this.prisma.sectWarContribution.groupBy({
      by: ['characterId'],
      where: { sectId: char.sectId, weekKey },
      _sum: { points: true },
    });
    sectContributions.sort((a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0));
    const rank = sectContributions.findIndex((c) => c.characterId === characterId);

    return {
      totalPoints,
      rank: rank === -1 ? null : rank + 1,
      breakdown,
    };
  }

  /**
   * Get leaderboard for a sect with role annotations.
   */
  async getSectLeaderboard(
    sectId: string,
    weekKey: string,
    limit = 20,
  ): Promise<
    Array<{
      characterId: string;
      characterName: string;
      role: SectRole;
      points: number;
      rank: number;
    }>
  > {
    const contributions = await this.prisma.sectWarContribution.groupBy({
      by: ['characterId'],
      where: { sectId, weekKey },
      _sum: { points: true },
    });
    contributions.sort((a, b) => (b._sum.points ?? 0) - (a._sum.points ?? 0));

    const top = contributions.slice(0, limit);
    if (top.length === 0) return [];

    const chars = await this.prisma.character.findMany({
      where: { id: { in: top.map((c) => c.characterId) } },
      select: {
        id: true,
        name: true,
        sectMembers: {
          where: { sectId },
          select: { role: true },
        },
      },
    });

    const charMap = new Map(
      chars.map((c) => [
        c.id,
        { name: c.name, role: c.sectMembers[0]?.role ?? 'MEMBER' },
      ]),
    );

    return top.map((c, i) => {
      const charData = charMap.get(c.characterId);
      return {
        characterId: c.characterId,
        characterName: charData?.name ?? c.characterId,
        role: charData?.role ?? 'MEMBER',
        points: c._sum.points ?? 0,
        rank: i + 1,
      };
    });
  }
}
