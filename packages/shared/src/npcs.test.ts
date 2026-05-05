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

describe('NPCS catalog integrity (Phase 12 PR-1)', () => {
  it('has unique keys', () => {
    const keys = NPCS.map((n) => n.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('PR-1 catalogs exactly 4 NPC trụ cột', () => {
    expect(NPCS).toHaveLength(4);
    expect(npcByKey('npc_lang_van_sinh')).toBeDefined();
    expect(npcByKey('npc_moc_thanh_y')).toBeDefined();
    expect(npcByKey('npc_han_da')).toBeDefined();
    expect(npcByKey('npc_to_nguyet_ly')).toBeDefined();
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

  it('NPC giver consistency: NPC.questKeys reverse-matches QUESTS[giverNpcKey===npc]', () => {
    for (const n of NPCS) {
      const declaredQuests = new Set(n.questKeys);
      const reverseMatched = QUESTS.filter((q) => q.giverNpcKey === n.key).map((q) => q.key);
      // declared questKeys must equal reverse match
      expect(new Set(reverseMatched), n.key).toEqual(declaredQuests);
    }
  });

  it('npcsByFaction returns correct count', () => {
    expect(npcsByFaction('hoa_thien_mon').length).toBe(2); // Lăng Vân Sinh + Mộc Thanh Y
    expect(npcsByFaction('huyen_kiem_tong').length).toBe(1); // Hàn Dạ
    expect(npcsByFaction('tich_thien_dien').length).toBe(0); // không có ở PR-1
  });

  it('npcsAvailableAtRealm gates correctly', () => {
    expect(npcsAvailableAtRealm(0).length).toBe(2); // Lăng Vân Sinh + Mộc Thanh Y
    expect(npcsAvailableAtRealm(1).length).toBe(3); // + Hàn Dạ
    expect(npcsAvailableAtRealm(2).length).toBe(4); // + Tô Nguyệt Ly
  });

  it('Tô Nguyệt Ly faction is null (hậu nhân Hoa Thiên lưu đày)', () => {
    expect(npcByKey('npc_to_nguyet_ly')?.faction).toBeNull();
  });
});
