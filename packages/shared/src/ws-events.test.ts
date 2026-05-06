import { describe, it, expect } from 'vitest';

import type {
  WsFrame,
  WsEventType,
  CharacterStatePayload,
  CultivateTickPayload,
  MissionProgressFramePayload,
  MissionProgressChange,
} from './ws-events';
import {
  WS_HEARTBEAT_INTERVAL_MS,
  WS_HEARTBEAT_TIMEOUT_MS,
  WS_RECONNECT_MAX_DELAY_MS,
  WS_RECONNECT_MAX_ATTEMPTS,
  CULTIVATION_TICK_MS,
  CULTIVATION_TICK_BASE_EXP,
  MISSION_PROGRESS_PUSH_THROTTLE_MS,
} from './ws-events';

/**
 * `ws-events.ts` là wire contract giữa BE gateway (`apps/api/src/ws/`) và FE
 * socket client (`apps/web/src/lib/ws.ts`). Mọi constant thời gian / giới hạn
 * reconnect đều ảnh hưởng UX thực tế (heartbeat drop, double-cultivate tick,
 * mission progress spam). Test khoá giá trị + invariant quan hệ giữa các hằng.
 */
describe('ws-events', () => {
  describe('heartbeat constants', () => {
    it('interval is 25s (sub-minute so proxy/LB không timeout)', () => {
      expect(WS_HEARTBEAT_INTERVAL_MS).toBe(25_000);
    });

    it('timeout is 8s (strictly less than interval)', () => {
      expect(WS_HEARTBEAT_TIMEOUT_MS).toBe(8_000);
      expect(WS_HEARTBEAT_TIMEOUT_MS).toBeLessThan(WS_HEARTBEAT_INTERVAL_MS);
    });

    it('interval + timeout <= 60s (giữ dưới default nginx proxy_read_timeout)', () => {
      expect(WS_HEARTBEAT_INTERVAL_MS + WS_HEARTBEAT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    });
  });

  describe('reconnect constants', () => {
    it('max delay is 30s', () => {
      expect(WS_RECONNECT_MAX_DELAY_MS).toBe(30_000);
    });

    it('max attempts is 10', () => {
      expect(WS_RECONNECT_MAX_ATTEMPTS).toBe(10);
    });

    it('values are positive integers', () => {
      expect(WS_RECONNECT_MAX_DELAY_MS).toBeGreaterThan(0);
      expect(WS_RECONNECT_MAX_ATTEMPTS).toBeGreaterThan(0);
      expect(Number.isInteger(WS_RECONNECT_MAX_ATTEMPTS)).toBe(true);
    });
  });

  describe('cultivation tick constants', () => {
    it('tick interval 30s (BALANCE.md §cultivation)', () => {
      expect(CULTIVATION_TICK_MS).toBe(30_000);
    });

    it('tick base EXP is 5 (BALANCE.md §cultivation)', () => {
      expect(CULTIVATION_TICK_BASE_EXP).toBe(5);
      expect(CULTIVATION_TICK_BASE_EXP).toBeGreaterThan(0);
    });

    it('tick interval > heartbeat timeout (tránh mis-detect stale conn)', () => {
      expect(CULTIVATION_TICK_MS).toBeGreaterThan(WS_HEARTBEAT_TIMEOUT_MS);
    });
  });

  describe('mission progress throttle', () => {
    it('throttle is 500ms (file ws-events.ts §comment)', () => {
      expect(MISSION_PROGRESS_PUSH_THROTTLE_MS).toBe(500);
    });

    it('throttle < cultivation tick (tránh drop legitimate event trong 1 tick)', () => {
      expect(MISSION_PROGRESS_PUSH_THROTTLE_MS).toBeLessThan(CULTIVATION_TICK_MS);
    });
  });

  describe('WsFrame shape', () => {
    it('accepts well-formed frame', () => {
      const frame: WsFrame<{ hello: string }> = {
        type: 'state:update',
        payload: { hello: 'world' },
        ts: Date.now(),
      };
      expect(frame.type).toBe('state:update');
      expect(frame.payload.hello).toBe('world');
      expect(typeof frame.ts).toBe('number');
    });

    it('accepts all documented event types (compile-time lock)', () => {
      const types: WsEventType[] = [
        'state:update',
        'cultivate:tick',
        'logs:append',
        'marquee',
        'chat:msg',
        'boss:spawn',
        'boss:update',
        'boss:end',
        'boss:defeated',
        'mail:new',
        'mission:progress',
        'pong',
        'ping',
        'chat:send',
      ];
      expect(types).toHaveLength(14);
      expect(new Set(types).size).toBe(types.length);
    });
  });

  describe('CharacterStatePayload shape', () => {
    it('accepts full character snapshot', () => {
      const snap: CharacterStatePayload = {
        id: 'char_1',
        name: 'Tester',
        realmKey: 'luyen_khi_1',
        realmStage: 1,
        level: 1,
        exp: '0',
        expNext: '100',
        hp: 100,
        hpMax: 100,
        mp: 50,
        mpMax: 50,
        stamina: 100,
        staminaMax: 100,
        power: 10,
        spirit: 10,
        speed: 10,
        luck: 5,
        linhThach: '0',
        tienNgoc: 0,
        cultivating: false,
        sectId: null,
        sectKey: null,
        role: 'PLAYER',
        banned: false,
        tribulationCooldownAt: null,
        taoMaUntil: null,
        spiritualRootGrade: null,
        primaryElement: null,
        secondaryElements: [],
        rootPurity: 100,
        title: null,
      };
      expect(snap.role).toBe('PLAYER');
      expect(snap.sectKey).toBeNull();
      expect(snap.tribulationCooldownAt).toBeNull();
      expect(snap.taoMaUntil).toBeNull();
      expect(snap.spiritualRootGrade).toBeNull();
      expect(snap.primaryElement).toBeNull();
      expect(snap.secondaryElements).toEqual([]);
      expect(snap.rootPurity).toBe(100);
    });

    it('allows sectKey as valid literal thanh_van/huyen_thuy/tu_la', () => {
      const sects: Array<CharacterStatePayload['sectKey']> = [
        'thanh_van',
        'huyen_thuy',
        'tu_la',
        null,
      ];
      expect(sects).toHaveLength(4);
    });

    it('Phase 11.6.E — accepts active cooldown + Tâm Ma timestamps', () => {
      const snap: CharacterStatePayload = {
        id: 'char_1',
        name: 'Tester',
        realmKey: 'kim_dan',
        realmStage: 9,
        level: 1,
        exp: '0',
        expNext: '100',
        hp: 100,
        hpMax: 100,
        mp: 50,
        mpMax: 50,
        stamina: 100,
        staminaMax: 100,
        power: 10,
        spirit: 10,
        speed: 10,
        luck: 5,
        linhThach: '0',
        tienNgoc: 0,
        cultivating: false,
        sectId: null,
        sectKey: null,
        role: 'PLAYER',
        banned: false,
        tribulationCooldownAt: '2026-05-02T07:00:00.000Z',
        taoMaUntil: '2026-05-02T08:00:00.000Z',
        spiritualRootGrade: 'huyen',
        primaryElement: 'thuy',
        secondaryElements: ['tho', 'kim'],
        rootPurity: 80,
        title: null,
      };
      expect(typeof snap.tribulationCooldownAt).toBe('string');
      expect(typeof snap.taoMaUntil).toBe('string');
    });

    it('Phase 11.3.A — accepts spiritualRoot fields populated', () => {
      const snap: CharacterStatePayload = {
        id: 'char_1',
        name: 'Tester',
        realmKey: 'kim_dan',
        realmStage: 9,
        level: 1,
        exp: '0',
        expNext: '100',
        hp: 100,
        hpMax: 100,
        mp: 50,
        mpMax: 50,
        stamina: 100,
        staminaMax: 100,
        power: 10,
        spirit: 10,
        speed: 10,
        luck: 5,
        linhThach: '0',
        tienNgoc: 0,
        cultivating: false,
        sectId: null,
        sectKey: null,
        role: 'PLAYER',
        banned: false,
        tribulationCooldownAt: null,
        taoMaUntil: null,
        spiritualRootGrade: 'huyen',
        primaryElement: 'thuy',
        secondaryElements: ['tho', 'kim'],
        rootPurity: 80,
        title: 'realm_kim_dan_adept',
      };
      expect(snap.spiritualRootGrade).toBe('huyen');
      expect(snap.primaryElement).toBe('thuy');
      expect(snap.secondaryElements).toEqual(['tho', 'kim']);
      expect(snap.rootPurity).toBe(80);
      expect(snap.title).toBe('realm_kim_dan_adept');
    });

    it('Phase 11.3.A — accepts legacy null spiritualRoot (pre-Phase-11.3)', () => {
      const snap: CharacterStatePayload = {
        id: 'char_legacy',
        name: 'Legacy',
        realmKey: 'luyen_khi_1',
        realmStage: 1,
        level: 1,
        exp: '0',
        expNext: '100',
        hp: 100,
        hpMax: 100,
        mp: 50,
        mpMax: 50,
        stamina: 100,
        staminaMax: 100,
        power: 10,
        spirit: 10,
        speed: 10,
        luck: 5,
        linhThach: '0',
        tienNgoc: 0,
        cultivating: false,
        sectId: null,
        sectKey: null,
        role: 'PLAYER',
        banned: false,
        tribulationCooldownAt: null,
        taoMaUntil: null,
        spiritualRootGrade: null,
        primaryElement: null,
        secondaryElements: [],
        rootPurity: 100,
        title: null,
      };
      expect(snap.spiritualRootGrade).toBeNull();
      expect(snap.primaryElement).toBeNull();
      expect(snap.secondaryElements).toHaveLength(0);
    });
  });

  describe('CultivateTickPayload shape', () => {
    it('accepts happy-path tick', () => {
      const tick: CultivateTickPayload = {
        characterId: 'char_1',
        expGained: '5',
        exp: '105',
        expNext: '200',
        realmKey: 'luyen_khi_1',
        realmStage: 1,
        brokeThrough: false,
      };
      expect(tick.brokeThrough).toBe(false);
      expect(typeof tick.expGained).toBe('string');
    });
  });

  describe('MissionProgressFramePayload shape', () => {
    it('accepts empty changes array (edge case — throttle emit)', () => {
      const frame: MissionProgressFramePayload = {
        characterId: 'char_1',
        changes: [],
      };
      expect(frame.changes).toHaveLength(0);
    });

    it('accepts multiple concurrent changes in one frame', () => {
      const changes: MissionProgressChange[] = [
        {
          missionKey: 'daily_cultivate_600s',
          period: 'DAILY',
          currentAmount: 120,
          goalAmount: 600,
          completable: false,
        },
        {
          missionKey: 'weekly_kill_monster_100',
          period: 'WEEKLY',
          currentAmount: 100,
          goalAmount: 100,
          completable: true,
        },
      ];
      const frame: MissionProgressFramePayload = {
        characterId: 'char_1',
        changes,
      };
      expect(frame.changes).toHaveLength(2);
      expect(frame.changes[1].completable).toBe(true);
    });

    it('completable flag consistent với currentAmount >= goalAmount', () => {
      const c: MissionProgressChange = {
        missionKey: 'foo',
        period: 'DAILY',
        currentAmount: 50,
        goalAmount: 100,
        completable: false,
      };
      expect(c.currentAmount < c.goalAmount).toBe(true);
      expect(c.completable).toBe(false);
    });
  });
});
