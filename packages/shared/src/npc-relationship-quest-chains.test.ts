/**
 * Phase 12.10.D — invariant tests cho `NPC_RELATIONSHIP_QUEST_CHAINS`.
 */

import { describe, expect, it } from 'vitest';

import {
  NPC_RELATIONSHIP_QUEST_CHAINS,
  NPC_RELATIONSHIP_CHAIN_AFFINITY_CAP,
  NPC_RELATIONSHIP_CHAIN_LINH_THACH_CAP,
  NPC_RELATIONSHIP_CHAIN_TIEN_NGOC_CAP,
  NPC_RELATIONSHIP_CHAIN_EXP_CAP,
  validateNpcRelationshipChainsCatalog,
  hardErrorsOnly,
  npcRelationshipChainByKey,
  npcRelationshipChainsForNpc,
  chainClaimedFlagKey,
} from './npc-relationship-quest-chains';
import { AFFINITY_TIERS } from './npc-affinity';
import { NPCS } from './npcs';
import { QUESTS } from './quests';
import { STORY_DIALOGUES } from './story-dialogues';

describe('NPC_RELATIONSHIP_QUEST_CHAINS catalog', () => {
  it('has at least 3 chains covering early/mid sect + rival + hidden NPC', () => {
    expect(NPC_RELATIONSHIP_QUEST_CHAINS.length).toBeGreaterThanOrEqual(3);
  });

  it('passes hard-error invariants', () => {
    const errs = hardErrorsOnly(validateNpcRelationshipChainsCatalog());
    expect(errs).toEqual([]);
  });

  it('has unique chainKey', () => {
    const keys = NPC_RELATIONSHIP_QUEST_CHAINS.map((c) => c.chainKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('only references existing NPCs', () => {
    const npcKeys = new Set(NPCS.map((n) => n.key));
    for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
      expect(npcKeys.has(c.npcKey)).toBe(true);
    }
  });

  it('only references existing quests', () => {
    const questKeys = new Set(QUESTS.map((q) => q.key));
    for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
      expect(c.questKeys.length).toBeGreaterThan(0);
      for (const qk of c.questKeys) {
        expect(questKeys.has(qk)).toBe(true);
      }
    }
  });

  it('only references existing dialogue nodes', () => {
    const ids = new Set(STORY_DIALOGUES.map((d) => d.id));
    for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
      for (const dk of c.dialogueNodeKeys) {
        expect(ids.has(dk)).toBe(true);
      }
    }
  });

  it('only references valid affinity tiers', () => {
    const tk = new Set(AFFINITY_TIERS.map((t) => t.key));
    for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
      expect(tk.has(c.requiredAffinityTier)).toBe(true);
    }
  });

  it('respects reward caps', () => {
    for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
      const r = c.rewardHint;
      expect(r.affinity).toBeGreaterThanOrEqual(0);
      expect(r.affinity).toBeLessThanOrEqual(NPC_RELATIONSHIP_CHAIN_AFFINITY_CAP);
      expect(r.linhThach).toBeLessThanOrEqual(NPC_RELATIONSHIP_CHAIN_LINH_THACH_CAP);
      expect(r.tienNgoc).toBeLessThanOrEqual(NPC_RELATIONSHIP_CHAIN_TIEN_NGOC_CAP);
      expect(r.exp).toBeLessThanOrEqual(NPC_RELATIONSHIP_CHAIN_EXP_CAP);
    }
  });

  it('has non-empty endingFlags with proper prefix', () => {
    for (const c of NPC_RELATIONSHIP_QUEST_CHAINS) {
      const keys = Object.keys(c.endingFlags);
      expect(keys.length).toBeGreaterThan(0);
      for (const k of keys) {
        expect(k.startsWith('rel_') || k.startsWith('relchain_')).toBe(true);
      }
    }
  });

  it('npcRelationshipChainByKey looks up correctly', () => {
    const def = npcRelationshipChainByKey('relchain_moc_thanh_y_sect_path');
    expect(def).toBeDefined();
    expect(def?.npcKey).toBe('npc_moc_thanh_y');
    expect(npcRelationshipChainByKey('relchain_does_not_exist')).toBeUndefined();
  });

  it('npcRelationshipChainsForNpc returns sorted chains', () => {
    const chains = npcRelationshipChainsForNpc('npc_moc_thanh_y');
    expect(chains.length).toBeGreaterThanOrEqual(1);
    for (const c of chains) {
      expect(c.npcKey).toBe('npc_moc_thanh_y');
    }
  });

  it('chainClaimedFlagKey produces stable namespace', () => {
    expect(chainClaimedFlagKey('relchain_moc_thanh_y_sect_path')).toBe(
      'relchain_moc_thanh_y_sect_path_claimed',
    );
    expect(chainClaimedFlagKey('moc_thanh_y_sect_path')).toBe(
      'relchain_moc_thanh_y_sect_path_claimed',
    );
  });
});
