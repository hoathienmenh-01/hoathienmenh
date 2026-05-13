import { describe, expect, it } from 'vitest';
import {
  isSecretRealmCleared,
  SECRET_REALM_REWARD_CAPS,
  SECRET_REALMS,
  secretRealmByKey,
  secretRealmGateStatusFor,
} from './secret-realm';

describe('secret-realm — catalog audit', () => {
  it('exposes >= 4 realms', () => {
    expect(SECRET_REALMS.length).toBeGreaterThanOrEqual(4);
  });

  it('keys are unique', () => {
    const set = new Set(SECRET_REALMS.map((r) => r.key));
    expect(set.size).toBe(SECRET_REALMS.length);
  });

  it('each realm has at least one objective', () => {
    for (const r of SECRET_REALMS) {
      expect(r.objectives.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('objective keys are unique within a realm', () => {
    for (const r of SECRET_REALMS) {
      const set = new Set(r.objectives.map((o) => o.key));
      expect(set.size).toBe(r.objectives.length);
    }
  });

  it('every realm has bilingual title + description', () => {
    for (const r of SECRET_REALMS) {
      expect(r.nameVi.length).toBeGreaterThan(0);
      expect(r.nameEn.length).toBeGreaterThan(0);
      expect(r.descriptionVi.length).toBeGreaterThan(0);
      expect(r.descriptionEn.length).toBeGreaterThan(0);
    }
  });
});

describe('secret-realm — reward guardrails', () => {
  it('NO tienNgoc on any realm clear (catalog enforces 0)', () => {
    for (const r of SECRET_REALMS) {
      expect(r.rewardProfile.tienNgoc).toBe(0);
    }
  });

  it('NO endgame item / inventory grants', () => {
    for (const r of SECRET_REALMS) {
      expect(r.rewardProfile.items).toEqual([]);
    }
  });

  it('linhThach within [200, linhThachMax]', () => {
    for (const r of SECRET_REALMS) {
      expect(r.rewardProfile.linhThach).toBeGreaterThanOrEqual(200);
      expect(r.rewardProfile.linhThach).toBeLessThanOrEqual(
        SECRET_REALM_REWARD_CAPS.linhThachMax,
      );
    }
  });

  it('exp within [400, expMax]', () => {
    for (const r of SECRET_REALMS) {
      expect(r.rewardProfile.exp).toBeGreaterThanOrEqual(400);
      expect(r.rewardProfile.exp).toBeLessThanOrEqual(
        SECRET_REALM_REWARD_CAPS.expMax,
      );
    }
  });
});

describe('secret-realm — gating', () => {
  it('LOCKED when realm too low', () => {
    const r = SECRET_REALMS[SECRET_REALMS.length - 1]!;
    expect(
      secretRealmGateStatusFor(r, { realmOrder: 0 }),
    ).toBe('LOCKED');
  });

  it('AVAILABLE when realm + flags satisfied', () => {
    const r = SECRET_REALMS[0]!;
    expect(
      secretRealmGateStatusFor(r, { realmOrder: 99 }),
    ).toBe('AVAILABLE');
  });

  it('LOCKED when within cooldown window', () => {
    const r = SECRET_REALMS[0]!;
    const now = new Date('2025-05-13T12:00:00Z').getTime();
    const cleared = new Date(now - 60 * 60 * 1000); // 1h ago
    expect(
      secretRealmGateStatusFor(r, {
        realmOrder: 99,
        lastClearedAt: cleared,
        nowMs: now,
      }),
    ).toBe('LOCKED');
  });

  it('AVAILABLE after cooldown elapses', () => {
    const r = SECRET_REALMS[0]!;
    const now = new Date('2025-05-13T12:00:00Z').getTime();
    const cleared = new Date(now - (r.cooldownHours + 1) * 60 * 60 * 1000);
    expect(
      secretRealmGateStatusFor(r, {
        realmOrder: 99,
        lastClearedAt: cleared,
        nowMs: now,
      }),
    ).toBe('AVAILABLE');
  });

  it('LOCKED when story flag missing', () => {
    const gated = SECRET_REALMS.find(
      (r) => r.requiredStoryFlags && r.requiredStoryFlags.length > 0,
    )!;
    expect(
      secretRealmGateStatusFor(gated, {
        realmOrder: 99,
        storyFlags: new Set<string>(),
      }),
    ).toBe('LOCKED');
    expect(
      secretRealmGateStatusFor(gated, {
        realmOrder: 99,
        storyFlags: new Set(gated.requiredStoryFlags!),
      }),
    ).toBe('AVAILABLE');
  });
});

describe('secret-realm — clear detection', () => {
  it('cleared when ALL objectives meet target', () => {
    const r = SECRET_REALMS[0]!;
    const progress: Record<string, number> = {};
    for (const o of r.objectives) progress[o.key] = o.target;
    expect(isSecretRealmCleared(r, progress)).toBe(true);
  });

  it('NOT cleared when objective short', () => {
    const r = SECRET_REALMS[0]!;
    const progress: Record<string, number> = {};
    for (const o of r.objectives) progress[o.key] = Math.max(0, o.target - 1);
    expect(isSecretRealmCleared(r, progress)).toBe(false);
  });

  it('NOT cleared when objective missing entirely', () => {
    const r = SECRET_REALMS[0]!;
    expect(isSecretRealmCleared(r, {})).toBe(false);
  });
});

describe('secret-realm — lookup', () => {
  it('byKey works', () => {
    expect(secretRealmByKey(SECRET_REALMS[0]!.key)?.key).toBe(
      SECRET_REALMS[0]!.key,
    );
    expect(secretRealmByKey('not_found')).toBeUndefined();
  });
});
