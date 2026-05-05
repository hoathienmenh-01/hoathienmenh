import { describe, it, expect } from 'vitest';
import { NPCS } from './npcs';
import { QUESTS } from './quests';
import {
  DIALOGUES,
  dialogueById,
  dialoguesByNpc,
  pickDialogueForNpc,
} from './dialogues';

describe('DIALOGUES catalog integrity (Phase 12 PR-1 + Story Foundation Extension)', () => {
  it('has unique ids', () => {
    const ids = DIALOGUES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every dialogue id starts with `dlg_`', () => {
    for (const d of DIALOGUES) {
      expect(d.id, d.id).toMatch(/^dlg_/);
    }
  });

  it('every speakerNpcKey points to an existing NPC', () => {
    const npcKeys = new Set(NPCS.map((n) => n.key));
    for (const d of DIALOGUES) {
      expect(npcKeys.has(d.speakerNpcKey), `${d.id} speaker ${d.speakerNpcKey}`).toBe(true);
    }
  });

  it('every NPC has at least 1 default dialogue (kind=always or realm_min=0)', () => {
    for (const n of NPCS) {
      const dlgs = dialoguesByNpc(n.key);
      expect(dlgs.length, `${n.key}`).toBeGreaterThan(0);
    }
  });

  it('every choice acceptQuestKey points to an existing quest (or undefined)', () => {
    const questKeys = new Set(QUESTS.map((q) => q.key));
    for (const d of DIALOGUES) {
      for (const c of d.choices) {
        if (c.acceptQuestKey) {
          expect(questKeys.has(c.acceptQuestKey), `${d.id}.${c.key}`).toBe(true);
        }
      }
    }
  });

  it('every choice nextDialogueId points to an existing dialogue (or undefined)', () => {
    const dlgIds = new Set(DIALOGUES.map((d) => d.id));
    for (const d of DIALOGUES) {
      for (const c of d.choices) {
        if (c.nextDialogueId) {
          expect(dlgIds.has(c.nextDialogueId), `${d.id}.${c.key}`).toBe(true);
        }
      }
    }
  });

  it('every choice key is unique within its dialogue', () => {
    for (const d of DIALOGUES) {
      const keys = d.choices.map((c) => c.key);
      expect(new Set(keys).size, d.id).toBe(keys.length);
    }
  });

  it('dialogueById resolves known ids, returns undefined for unknown', () => {
    expect(dialogueById('dlg_lang_van_sinh_default')?.speakerNpcKey).toBe('npc_lang_van_sinh');
    expect(dialogueById('dlg_nonexistent')).toBeUndefined();
  });

  it('dialoguesByNpc returns correct count', () => {
    expect(dialoguesByNpc('npc_lang_van_sinh').length).toBe(4); // default + truc_co + kim_dan + nguyen_anh
    expect(dialoguesByNpc('npc_moc_thanh_y').length).toBe(4); // default + luyen_khi + kim_dan + nguyen_anh
    expect(dialoguesByNpc('npc_han_da').length).toBe(1);
    expect(dialoguesByNpc('npc_to_nguyet_ly').length).toBe(1);
    expect(dialoguesByNpc('npc_huyet_la_sat').length).toBe(1);
  });

  it('pickDialogueForNpc picks specific (high realm_min) over always for Lăng Vân Sinh', () => {
    // realm 0 (phamnhan) → default
    const r0 = pickDialogueForNpc('npc_lang_van_sinh', 0);
    expect(r0?.id).toBe('dlg_lang_van_sinh_default');

    // realm 2 (truc_co) → truc_co branch (specific wins)
    const r2 = pickDialogueForNpc('npc_lang_van_sinh', 2);
    expect(r2?.id).toBe('dlg_lang_van_sinh_truc_co');

    // realm 3 (kim_dan) → kim_dan branch (highest realm_min wins)
    const r3 = pickDialogueForNpc('npc_lang_van_sinh', 3);
    expect(r3?.id).toBe('dlg_lang_van_sinh_kim_dan');

    // realm 4 (nguyen_anh) → nguyen_anh branch
    const r4 = pickDialogueForNpc('npc_lang_van_sinh', 4);
    expect(r4?.id).toBe('dlg_lang_van_sinh_nguyen_anh');
  });

  it('pickDialogueForNpc picks specific branch for Mộc Thanh Y across realms', () => {
    expect(pickDialogueForNpc('npc_moc_thanh_y', 0)?.id).toBe('dlg_moc_thanh_y_default');
    expect(pickDialogueForNpc('npc_moc_thanh_y', 1)?.id).toBe('dlg_moc_thanh_y_luyen_khi');
    expect(pickDialogueForNpc('npc_moc_thanh_y', 3)?.id).toBe('dlg_moc_thanh_y_kim_dan');
    expect(pickDialogueForNpc('npc_moc_thanh_y', 4)?.id).toBe('dlg_moc_thanh_y_nguyen_anh');
  });

  it('pickDialogueForNpc returns Huyết La Sát default only at realm 3+', () => {
    expect(pickDialogueForNpc('npc_huyet_la_sat', 0)).toBeUndefined();
    expect(pickDialogueForNpc('npc_huyet_la_sat', 2)).toBeUndefined();
    expect(pickDialogueForNpc('npc_huyet_la_sat', 3)?.id).toBe('dlg_huyet_la_sat_default');
    expect(pickDialogueForNpc('npc_huyet_la_sat', 4)?.id).toBe('dlg_huyet_la_sat_default');
  });

  it('pickDialogueForNpc returns undefined when realm gate not met (Hàn Dạ at realm 0)', () => {
    const r0 = pickDialogueForNpc('npc_han_da', 0);
    expect(r0).toBeUndefined(); // Hàn Dạ requires realm_min=1 (luyenkhi)
  });

  it('pickDialogueForNpc returns Hàn Dạ default at realm 1', () => {
    const r1 = pickDialogueForNpc('npc_han_da', 1);
    expect(r1?.id).toBe('dlg_han_da_default');
  });

  it('pickDialogueForNpc returns Tô Nguyệt Ly default only at realm 2', () => {
    expect(pickDialogueForNpc('npc_to_nguyet_ly', 0)).toBeUndefined();
    expect(pickDialogueForNpc('npc_to_nguyet_ly', 1)).toBeUndefined();
    expect(pickDialogueForNpc('npc_to_nguyet_ly', 2)?.id).toBe('dlg_to_nguyet_ly_default');
  });

  it('every dialogue has non-empty text', () => {
    for (const d of DIALOGUES) {
      expect(d.text.length, d.id).toBeGreaterThan(0);
    }
  });
});
