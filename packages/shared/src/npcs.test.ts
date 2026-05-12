import { describe, it, expect } from 'vitest';
import { REALMS } from './realms';
import { QUESTS } from './quests';
import { DIALOGUES } from './dialogues';
import {
  NPCS,
  npcByKey,
  npcsByFaction,
  npcsAvailableAtRealm,
} from './npcs';
import type { NpcFaction } from './npcs';

const VALID_FACTIONS: NpcFaction[] = [
  'hoa_thien_mon',
  'tich_thien_dien',
  'huyen_kiem_tong',
  'van_bao_thuong_hoi',
  'huyet_ha_ma_tong',
  'tien_dinh_bach_de',
  'wandering',
];

describe('NPCS catalog integrity (Phase 12 PR-1 + Story Foundation Extension)', () => {
  it('has unique keys', () => {
    const keys = NPCS.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('catalogs Phase 21 NPC trụ cột including 5 early-game quest givers', () => {
    expect(NPCS).toHaveLength(12);
    expect(npcByKey('npc_lang_van_sinh')).toBeDefined();
    expect(npcByKey('npc_moc_thanh_y')).toBeDefined();
    expect(npcByKey('npc_han_da')).toBeDefined();
    expect(npcByKey('npc_to_nguyet_ly')).toBeDefined();
    expect(npcByKey('npc_huyet_la_sat')).toBeDefined();
    expect(npcByKey('npc_a_linh')).toBeDefined();
    expect(npcByKey('npc_van_kim_nuong')).toBeDefined();
    expect(npcByKey('npc_bach_de_tu')).toBeDefined();
    expect(npcByKey('npc_tich_linh_su_gia')).toBeDefined();
    expect(npcByKey('npc_huyet_ha_su_gia')).toBeDefined();
    expect(npcByKey('npc_hoa_thien_dao_to')).toBeDefined();
    expect(npcByKey('npc_tich_thien_dao_chu')).toBeDefined();
  });

  it('every NPC key starts with `npc_`', () => {
    for (const n of NPCS) {
      expect(n.key, n.key).toMatch(/^npc_/);
    }
  });

  it('every faction is valid (or null)', () => {
    for (const n of NPCS) {
      if (n.faction !== null) {
        expect(VALID_FACTIONS, n.key).toContain(n.faction);
      }
    }
  });

  it('every realmGateOrder matches a realm in REALMS', () => {
    const orders = new Set(REALMS.map((r) => r.order));
    for (const n of NPCS) {
      expect(orders.has(n.realmGateOrder), n.key).toBe(true);
    }
  });

  it('every defaultDialogueId points to an existing dialogue speaker = self', () => {
    const dialogueIds = new Set(DIALOGUES.map((d) => d.id));
    for (const n of NPCS) {
      expect(dialogueIds.has(n.defaultDialogueId), `${n.key} default ${n.defaultDialogueId}`).toBe(true);
      const dlg = DIALOGUES.find((d) => d.id === n.defaultDialogueId)!;
      expect(dlg.speakerNpcKey, `${n.key} dialogue speaker mismatch`).toBe(n.key);
    }
  });

  it('every questKey points to an existing quest in QUESTS', () => {
    const questKeys = new Set(QUESTS.map((q) => q.key));
    for (const n of NPCS) {
      for (const qkey of n.questKeys) {
        expect(questKeys.has(qkey), `${n.key} → quest ${qkey}`).toBe(true);
      }
    }
  });

  it('NPC declared quest keys are valid and reverse giver references point to cataloged NPCs', () => {
    const npcKeys = new Set(NPCS.map((n) => n.key));
    const questKeys = new Set(QUESTS.map((q) => q.key));
    for (const n of NPCS) {
      for (const qkey of n.questKeys) {
        expect(questKeys.has(qkey), `${n.key} declared quest ${qkey}`).toBe(true);
      }
    }
    for (const q of QUESTS) {
      expect(npcKeys.has(q.giverNpcKey), `quest ${q.key} giver ${q.giverNpcKey}`).toBe(true);
    }
  });

  it('npcsByFaction returns correct count', () => {
    expect(npcsByFaction('hoa_thien_mon').length).toBe(4); // core sect + A Linh + Đạo Tổ remnant
    expect(npcsByFaction('huyen_kiem_tong').length).toBe(1); // Hàn Dạ
    expect(npcsByFaction('van_bao_thuong_hoi').length).toBe(1); // Vạn Kim Nương
    expect(npcsByFaction('huyet_ha_ma_tong').length).toBe(2); // Huyết La Sát + sứ giả
    expect(npcsByFaction('tich_thien_dien').length).toBe(2); // sứ giả + Đạo Chủ echo
    expect(npcsByFaction('tien_dinh_bach_de').length).toBe(1); // Bạch Đế Tử
  });

  it('npcsAvailableAtRealm gates correctly', () => {
    expect(npcsAvailableAtRealm(0).length).toBe(3); // Lăng Vân Sinh + Mộc Thanh Y + A Linh
    expect(npcsAvailableAtRealm(1).length).toBe(5); // + Hàn Dạ + Vạn Kim Nương
    expect(npcsAvailableAtRealm(2).length).toBe(7); // + Tô Nguyệt Ly + Tịch Linh Sứ Giả
    expect(npcsAvailableAtRealm(3).length).toBe(9); // + Huyết La Sát + Huyết Hà Sứ Giả
    expect(npcsAvailableAtRealm(4).length).toBe(12); // + Bạch Đế Tử + Đạo Tổ + Tịch Thiên echo
  });

  it('Tô Nguyệt Ly faction is null (hậu nhân Hoa Thiên lưu đày)', () => {
    expect(npcByKey('npc_to_nguyet_ly')?.faction).toBeNull();
  });

  it('Huyết La Sát faction is huyet_ha_ma_tong và unlock từ Kim Đan', () => {
    const hls = npcByKey('npc_huyet_la_sat');
    expect(hls).toBeDefined();
    expect(hls!.faction).toBe('huyet_ha_ma_tong');
    expect(hls!.realmGateOrder).toBe(3);
  });
});
