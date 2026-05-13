import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_DAYS,
  ONBOARDING_TASKS,
  ONBOARDING_TASK_COUNT,
  ONBOARDING_TOTAL_DAYS,
  onboardingDayByNumber,
  onboardingTaskByKey,
  onboardingTasksForDay,
  onboardingTotalExpCap,
  onboardingTotalLinhThachCap,
  type OnboardingTaskDef,
} from './onboarding-7-day';

describe('Phase 34.0 — Onboarding 7-Day Catalog', () => {
  it('exposes exactly 7 days', () => {
    expect(ONBOARDING_DAYS).toHaveLength(7);
    expect(ONBOARDING_TOTAL_DAYS).toBe(7);
    for (let i = 1; i <= 7; i++) {
      const day = onboardingDayByNumber(i);
      expect(day).not.toBeNull();
      expect(day?.dayNumber).toBe(i);
    }
  });

  it('day numbers are 1..7 in order', () => {
    expect(ONBOARDING_DAYS.map((d) => d.dayNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('each day has 3-5 tasks (per spec)', () => {
    for (const day of ONBOARDING_DAYS) {
      expect(day.taskKeys.length).toBeGreaterThanOrEqual(3);
      expect(day.taskKeys.length).toBeLessThanOrEqual(5);
    }
  });

  it('every taskKey in day.taskKeys resolves to a task def', () => {
    for (const day of ONBOARDING_DAYS) {
      for (const tk of day.taskKeys) {
        const task = onboardingTaskByKey(tk);
        expect(task, `task ${tk} from day ${day.dayNumber} must exist`).not.toBeNull();
        expect(task?.dayNumber).toBe(day.dayNumber);
      }
    }
  });

  it('every task in ONBOARDING_TASKS belongs to a day taskKeys list', () => {
    const allDayKeys = new Set<string>();
    for (const d of ONBOARDING_DAYS) for (const k of d.taskKeys) allDayKeys.add(k);
    for (const t of ONBOARDING_TASKS) {
      expect(allDayKeys.has(t.taskKey), `${t.taskKey} not in any day`).toBe(true);
    }
  });

  it('task keys are unique', () => {
    const seen = new Set<string>();
    for (const t of ONBOARDING_TASKS) {
      expect(seen.has(t.taskKey), `duplicate task ${t.taskKey}`).toBe(false);
      seen.add(t.taskKey);
    }
    expect(seen.size).toBe(ONBOARDING_TASK_COUNT);
  });

  it('task keys follow d{N}_<slug> convention', () => {
    const re = /^d[1-7]_[a-z][a-z0-9_]*$/;
    for (const t of ONBOARDING_TASKS) {
      expect(t.taskKey).toMatch(re);
      const expectedDay = parseInt(t.taskKey.slice(1, 2), 10);
      expect(t.dayNumber).toBe(expectedDay);
    }
  });

  it('titles + descriptions VI/EN non-empty', () => {
    for (const t of ONBOARDING_TASKS) {
      expect(t.titleVi.length).toBeGreaterThan(0);
      expect(t.titleEn.length).toBeGreaterThan(0);
      expect(t.descriptionVi.length).toBeGreaterThan(0);
      expect(t.descriptionEn.length).toBeGreaterThan(0);
    }
    for (const d of ONBOARDING_DAYS) {
      expect(d.titleVi.length).toBeGreaterThan(0);
      expect(d.titleEn.length).toBeGreaterThan(0);
      expect(d.themeVi.length).toBeGreaterThan(0);
      expect(d.themeEn.length).toBeGreaterThan(0);
    }
  });

  it('action routes start with /', () => {
    for (const t of ONBOARDING_TASKS) {
      expect(t.actionRoute.startsWith('/')).toBe(true);
    }
  });

  it('reward guardrails — linh thach in [0, 500] per task', () => {
    for (const t of ONBOARDING_TASKS) {
      expect(t.reward.linhThach).toBeGreaterThanOrEqual(0);
      expect(t.reward.linhThach).toBeLessThanOrEqual(500);
      expect(t.reward.exp).toBeGreaterThanOrEqual(0);
      expect(t.reward.exp).toBeLessThanOrEqual(500);
    }
  });

  it('reward total cap — linh thach ≤ 4500, exp ≤ 2000 across all 7 days', () => {
    expect(onboardingTotalLinhThachCap()).toBeLessThanOrEqual(4500);
    expect(onboardingTotalExpCap()).toBeLessThanOrEqual(2000);
  });

  it('only Day 7 final task may grant a title', () => {
    for (const t of ONBOARDING_TASKS) {
      if (t.taskKey === 'd7_complete_onboarding') {
        expect(t.reward.titleKey).toBeTruthy();
      } else {
        expect(t.reward.titleKey).toBeUndefined();
      }
    }
  });

  it('NO Tien Ngoc grant anywhere in onboarding (premium currency)', () => {
    for (const t of ONBOARDING_TASKS) {
      // Should not have any field named `tienNgoc` in reward — TS structurally
      // enforces but assert at runtime too via shape audit.
      expect((t.reward as unknown as { tienNgoc?: number }).tienNgoc).toBeUndefined();
    }
  });

  it('NO endgame item key in task rewards', () => {
    const FORBIDDEN_PATTERNS = [/^artifact_endgame/, /^void_/, /^primordial_/, /_endgame$/];
    for (const t of ONBOARDING_TASKS) {
      for (const it of t.reward.items ?? []) {
        for (const pat of FORBIDDEN_PATTERNS) {
          expect(pat.test(it.itemKey)).toBe(false);
        }
      }
    }
  });

  it('onboardingTasksForDay returns correct tasks per day in order', () => {
    for (const day of ONBOARDING_DAYS) {
      const tasks = onboardingTasksForDay(day.dayNumber);
      expect(tasks.map((t) => t.taskKey)).toEqual(day.taskKeys);
    }
  });

  it('onboardingTasksForDay returns empty for unknown day', () => {
    expect(onboardingTasksForDay(0)).toEqual([]);
    expect(onboardingTasksForDay(8)).toEqual([]);
    expect(onboardingTasksForDay(-1)).toEqual([]);
  });

  it('onboardingTaskByKey + onboardingDayByNumber return null for unknown', () => {
    expect(onboardingTaskByKey('nonexistent_task')).toBeNull();
    expect(onboardingDayByNumber(99)).toBeNull();
  });

  it('category is one of the known enum values', () => {
    const known = new Set<OnboardingTaskDef['category']>([
      'tutorial',
      'cultivation',
      'combat',
      'story',
      'social',
      'system',
    ]);
    for (const t of ONBOARDING_TASKS) {
      expect(known.has(t.category)).toBe(true);
    }
  });

  it('day 7 final task has bigger reward + title key', () => {
    const final = onboardingTaskByKey('d7_complete_onboarding');
    expect(final).not.toBeNull();
    expect(final?.reward.linhThach).toBeGreaterThanOrEqual(300);
    expect(final?.reward.titleKey).toBe('onboarding_novice_cultivator');
  });
});
