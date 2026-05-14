import { describe, expect, it } from 'vitest';
import {
  ROGUELIKE_CHOICES,
  ROGUELIKE_FLOORS,
  ROGUELIKE_FLOOR_TYPES,
  ROGUELIKE_LIMITS,
  computeRoguelikeRewardPreview,
  getRoguelikeChoicesForFloor,
  isRoguelikeMilestoneFloor,
  roguelikeChoiceByKey,
  roguelikeFloorByNumber,
} from './roguelike';

describe('roguelike catalog integrity', () => {
  it('has at least 30 authored floors and every required floor type', () => {
    expect(ROGUELIKE_FLOORS.length).toBeGreaterThanOrEqual(30);
    const types = new Set(ROGUELIKE_FLOORS.map((f) => f.floorType));
    for (const t of ROGUELIKE_FLOOR_TYPES) expect(types.has(t)).toBe(true);
  });

  it('each authored floor has 1-3 valid choices', () => {
    const floorKeys = new Set<string>();
    for (const floor of ROGUELIKE_FLOORS) {
      expect(floorKeys.has(floor.key)).toBe(false);
      floorKeys.add(floor.key);
      expect(floor.choiceKeys.length).toBeGreaterThanOrEqual(
        ROGUELIKE_LIMITS.minChoicesPerFloor,
      );
      expect(floor.choiceKeys.length).toBeLessThanOrEqual(
        ROGUELIKE_LIMITS.maxChoicesPerFloor,
      );
      for (const key of floor.choiceKeys) {
        expect(roguelikeChoiceByKey(key)).toBeTruthy();
      }
    }
  });

  it('choice keys are unique and outcomes are explicit', () => {
    const keys = new Set<string>();
    for (const choice of ROGUELIKE_CHOICES) {
      expect(keys.has(choice.key)).toBe(false);
      keys.add(choice.key);
      expect(choice.outcomeVi.length).toBeGreaterThan(8);
      expect(choice.outcomeEn.length).toBeGreaterThan(8);
    }
  });

  it('seeded floor choices are deterministic and bounded', () => {
    const a = getRoguelikeChoicesForFloor(7, 'seed-abc').map((c) => c.key);
    const b = getRoguelikeChoicesForFloor(7, 'seed-abc').map((c) => c.key);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(3);
  });

  it('milestone floors scale to mini-boss checks', () => {
    expect(isRoguelikeMilestoneFloor(10)).toBe(true);
    expect(isRoguelikeMilestoneFloor(20)).toBe(true);
    expect(isRoguelikeMilestoneFloor(50)).toBe(true);
    expect(roguelikeFloorByNumber(10).floorType).toBe('MINI_BOSS');
    expect(roguelikeFloorByNumber(20).floorType).toBe('MINI_BOSS');
    expect(roguelikeFloorByNumber(50).floorType).toBe('MINI_BOSS');
  });

  it('reward preview is capped and never grants premium currency', () => {
    const preview = computeRoguelikeRewardPreview({
      realmKey: 'void_pagoda',
      floorReached: 999,
      rewardMultiplier: 10,
    });
    expect(preview.linhThach).toBeLessThanOrEqual(
      ROGUELIKE_LIMITS.maxLinhThachPerClaim,
    );
    expect(preview.exp).toBeLessThanOrEqual(ROGUELIKE_LIMITS.maxExpPerClaim);
    expect(preview.items.length).toBeLessThanOrEqual(3);
  });
});
