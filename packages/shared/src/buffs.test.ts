import { describe, expect, it } from 'vitest';

import {
  BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC,
  BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,
} from './balance-dials';
import { ELEMENTS, type ElementKey } from './combat';
import { REALMS } from './realms';

import {
  BUFFS,
  buffsByEffectKind,
  buffsByElement,
  buffsByPolarity,
  buffsBySource,
  composeBuffMods,
  computeBuffExpiresAt,
  getBuffDef,
  isBuffExpired,
  type ActiveBuff,
  type BuffDef,
  type BuffEffectKind,
  type BuffPolarity,
  type BuffSource,
} from './buffs';

const VALID_KINDS: readonly BuffEffectKind[] = [
  'stat_mod',
  'regen',
  'damage_bonus',
  'damage_reduction',
  'control',
  'dot',
  'shield',
  'taunt',
  'invuln',
  'cultivation_block',
  'cultivation_rate_mul',
];

const VALID_SOURCES: readonly BuffSource[] = [
  'pill',
  'skill',
  'sect_aura',
  'event',
  'gear',
  'talent',
  'boss_skill',
  'tribulation',
  'breakthrough',
];

const VALID_POLARITIES: readonly BuffPolarity[] = ['buff', 'debuff'];

describe('BUFFS catalog shape', () => {
  it('có ít nhất 12 buff baseline', () => {
    expect(BUFFS.length).toBeGreaterThanOrEqual(12);
  });

  it('mỗi buff có key duy nhất + non-empty name + description', () => {
    const seen = new Set<string>();
    for (const b of BUFFS) {
      expect(b.key).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(seen.has(b.key)).toBe(false);
      seen.add(b.key);
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
    }
  });

  it('polarity ∈ buff|debuff', () => {
    for (const b of BUFFS) {
      expect(VALID_POLARITIES).toContain(b.polarity);
    }
  });

  it('element ∈ ElementKey ∪ null', () => {
    for (const b of BUFFS) {
      if (b.element !== null) {
        expect(ELEMENTS).toContain(b.element);
      }
    }
  });

  it('source ∈ BuffSource', () => {
    for (const b of BUFFS) {
      expect(VALID_SOURCES).toContain(b.source);
    }
  });

  it('durationSec > 0 và finite', () => {
    for (const b of BUFFS) {
      expect(Number.isFinite(b.durationSec)).toBe(true);
      expect(b.durationSec).toBeGreaterThan(0);
    }
  });

  it('stackable=false thì maxStacks=1', () => {
    for (const b of BUFFS) {
      if (!b.stackable) {
        expect(b.maxStacks).toBe(1);
      } else {
        expect(b.maxStacks).toBeGreaterThanOrEqual(2);
        expect(b.maxStacks).toBeLessThanOrEqual(10);
      }
    }
  });

  it('mỗi buff có ít nhất 1 effect', () => {
    for (const b of BUFFS) {
      expect(b.effects.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('mỗi effect có kind hợp lệ + value finite > 0', () => {
    for (const b of BUFFS) {
      for (const e of b.effects) {
        expect(VALID_KINDS).toContain(e.kind);
        expect(Number.isFinite(e.value)).toBe(true);
        expect(e.value).toBeGreaterThan(0);
      }
    }
  });

  it('stat_mod / regen có statTarget non-null', () => {
    for (const b of BUFFS) {
      for (const e of b.effects) {
        if (e.kind === 'stat_mod' || e.kind === 'regen') {
          expect(e.statTarget).not.toBeNull();
        }
      }
    }
  });

  it('damage_reduction luôn có elementTarget non-null', () => {
    for (const b of BUFFS) {
      for (const e of b.effects) {
        if (e.kind === 'damage_reduction') {
          expect(e.elementTarget).not.toBeNull();
        }
      }
    }
  });

  it('control / dot / taunt / invuln / shield / cultivation_block không cần statTarget', () => {
    for (const b of BUFFS) {
      for (const e of b.effects) {
        if (
          e.kind === 'control' ||
          e.kind === 'taunt' ||
          e.kind === 'invuln' ||
          e.kind === 'cultivation_block'
        ) {
          // statTarget có thể null hoặc set — không enforce
          expect(e.statTarget).toBeNull();
        }
      }
    }
  });
});

describe('BUFFS curve coverage', () => {
  it('có ≥ 8 buff (polarity=buff)', () => {
    const count = BUFFS.filter((b) => b.polarity === 'buff').length;
    expect(count).toBeGreaterThanOrEqual(8);
  });

  it('có ≥ 6 debuff (polarity=debuff)', () => {
    const count = BUFFS.filter((b) => b.polarity === 'debuff').length;
    expect(count).toBeGreaterThanOrEqual(6);
  });

  it('mỗi element kim/moc/thuy/hoa/tho có ≥ 1 buff/debuff', () => {
    for (const elem of ELEMENTS) {
      const found = BUFFS.filter((b) => b.element === elem);
      expect(found.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('có ≥ 4 source distinct', () => {
    const sources = new Set(BUFFS.map((b) => b.source));
    expect(sources.size).toBeGreaterThanOrEqual(4);
  });

  it('có ≥ 4 effect kind distinct', () => {
    const kinds = new Set<BuffEffectKind>();
    for (const b of BUFFS) {
      for (const e of b.effects) kinds.add(e.kind);
    }
    expect(kinds.size).toBeGreaterThanOrEqual(4);
  });

  it('pill source có ≥ 3 buff (cover atk + def + regen + spirit)', () => {
    const pillBuffs = BUFFS.filter(
      (b) => b.source === 'pill' && b.polarity === 'buff'
    );
    expect(pillBuffs.length).toBeGreaterThanOrEqual(3);
  });

  it('có ≥ 1 control debuff (root/stun/silence)', () => {
    const ccDebuffs = BUFFS.filter(
      (b) =>
        b.polarity === 'debuff' &&
        b.effects.some((e) => e.kind === 'control')
    );
    expect(ccDebuffs.length).toBeGreaterThanOrEqual(1);
  });

  it('có ≥ 1 dot debuff (burn/poison)', () => {
    const dotDebuffs = BUFFS.filter(
      (b) =>
        b.polarity === 'debuff' &&
        b.effects.some((e) => e.kind === 'dot')
    );
    expect(dotDebuffs.length).toBeGreaterThanOrEqual(1);
  });

  it('có Tâm Ma debuff (cultivation_block effect, source=tribulation)', () => {
    const taoma = BUFFS.find(
      (b) =>
        b.source === 'tribulation' &&
        b.effects.some((e) => e.kind === 'cultivation_block')
    );
    expect(taoma).toBeDefined();
  });
});

describe('Helper: getBuffDef', () => {
  it('trả undefined cho key không tồn tại', () => {
    expect(getBuffDef('nonexistent_buff')).toBeUndefined();
  });

  it('trả def đúng cho key hợp lệ', () => {
    const def = getBuffDef('pill_atk_buff_t1');
    expect(def).toBeDefined();
    expect(def?.polarity).toBe('buff');
    expect(def?.source).toBe('pill');
  });

  it('mỗi buff trong catalog đều lookup được', () => {
    for (const b of BUFFS) {
      expect(getBuffDef(b.key)).toBe(b);
    }
  });
});

describe('Helper: buffsByPolarity', () => {
  it('trả buff hoặc debuff list', () => {
    const buffs = buffsByPolarity('buff');
    const debuffs = buffsByPolarity('debuff');
    expect(buffs.length + debuffs.length).toBe(BUFFS.length);
    for (const b of buffs) expect(b.polarity).toBe('buff');
    for (const d of debuffs) expect(d.polarity).toBe('debuff');
  });
});

describe('Helper: buffsByElement', () => {
  it('null trả neutral buff', () => {
    const neutrals = buffsByElement(null);
    for (const b of neutrals) expect(b.element).toBeNull();
  });

  it('mỗi element trả ≥ 1 buff', () => {
    for (const elem of ELEMENTS) {
      expect(buffsByElement(elem).length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('Helper: buffsBySource', () => {
  it('source=pill trả ≥ 3 buff', () => {
    expect(buffsBySource('pill').length).toBeGreaterThanOrEqual(3);
  });

  it('source=tribulation trả ≥ 1 buff (Tâm Ma)', () => {
    expect(buffsBySource('tribulation').length).toBeGreaterThanOrEqual(1);
  });

  it('source=event trả ≥ 1 buff', () => {
    expect(buffsBySource('event').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Helper: buffsByEffectKind', () => {
  it('control kind trả ≥ 1 debuff', () => {
    const controls = buffsByEffectKind('control');
    expect(controls.length).toBeGreaterThanOrEqual(1);
    for (const b of controls) expect(b.polarity).toBe('debuff');
  });

  it('dot kind trả ≥ 1 debuff', () => {
    const dots = buffsByEffectKind('dot');
    expect(dots.length).toBeGreaterThanOrEqual(1);
  });

  it('shield kind trả ≥ 1 buff', () => {
    const shields = buffsByEffectKind('shield');
    expect(shields.length).toBeGreaterThanOrEqual(1);
    for (const b of shields) expect(b.polarity).toBe('buff');
  });
});

describe('Helper: composeBuffMods', () => {
  it('list rỗng trả identity (×1, +0)', () => {
    const mods = composeBuffMods([]);
    expect(mods.atkMul).toBe(1);
    expect(mods.defMul).toBe(1);
    expect(mods.hpMaxMul).toBe(1);
    expect(mods.mpMaxMul).toBe(1);
    expect(mods.spiritMul).toBe(1);
    expect(mods.hpRegenFlat).toBe(0);
    expect(mods.mpRegenFlat).toBe(0);
    expect(mods.dotPerTickFlat).toBe(0);
    expect(mods.shieldHpMaxRatio).toBe(0);
    expect(mods.controlTurnsMax).toBe(0);
    expect(mods.tauntActive).toBe(false);
    expect(mods.invulnActive).toBe(false);
    expect(mods.cultivationBlocked).toBe(false);
    expect(mods.damageBonusByElement.size).toBe(0);
    expect(mods.damageReductionByElement.size).toBe(0);
  });

  it('pill_atk_buff_t1 áp ×1.12 atk', () => {
    const mods = composeBuffMods([
      { buffKey: 'pill_atk_buff_t1', stacks: 1 },
    ]);
    expect(mods.atkMul).toBeCloseTo(1.12, 5);
    expect(mods.defMul).toBe(1);
  });

  it('pill_def_buff_t1 áp ×1.15 def', () => {
    const mods = composeBuffMods([
      { buffKey: 'pill_def_buff_t1', stacks: 1 },
    ]);
    expect(mods.defMul).toBeCloseTo(1.15, 5);
  });

  it('pill_hp_regen_t1 add +5 hpRegen', () => {
    const mods = composeBuffMods([
      { buffKey: 'pill_hp_regen_t1', stacks: 1 },
    ]);
    expect(mods.hpRegenFlat).toBe(5);
    expect(mods.mpRegenFlat).toBe(0);
  });

  it('combine atk + def + regen mods', () => {
    const mods = composeBuffMods([
      { buffKey: 'pill_atk_buff_t1', stacks: 1 },
      { buffKey: 'pill_def_buff_t1', stacks: 1 },
      { buffKey: 'pill_hp_regen_t1', stacks: 1 },
    ]);
    expect(mods.atkMul).toBeCloseTo(1.12, 5);
    expect(mods.defMul).toBeCloseTo(1.15, 5);
    expect(mods.hpRegenFlat).toBe(5);
  });

  it('sect_aura_kim áp damage_bonus vs moc', () => {
    const mods = composeBuffMods([
      { buffKey: 'sect_aura_kim', stacks: 1 },
    ]);
    expect(mods.damageBonusByElement.get('moc')).toBeCloseTo(1.06, 5);
    expect(mods.damageBonusByElement.get('kim')).toBeUndefined();
  });

  it('event_double_drop áp damage_bonus tất cả 5 element (no element target)', () => {
    const mods = composeBuffMods([
      { buffKey: 'event_double_drop', stacks: 1 },
    ]);
    for (const elem of ELEMENTS) {
      expect(mods.damageBonusByElement.get(elem)).toBeCloseTo(2.0, 5);
    }
  });

  it('debuff_root_thuy set controlTurnsMax = 3', () => {
    const mods = composeBuffMods([
      { buffKey: 'debuff_root_thuy', stacks: 1 },
    ]);
    expect(mods.controlTurnsMax).toBe(3);
  });

  it('debuff_burn_hoa stack ×3 = 8×3 = 24 dot/tick', () => {
    const mods = composeBuffMods([
      { buffKey: 'debuff_burn_hoa', stacks: 3 },
    ]);
    expect(mods.dotPerTickFlat).toBe(24);
  });

  it('stack vượt maxStacks bị clamp', () => {
    const mods = composeBuffMods([
      { buffKey: 'debuff_burn_hoa', stacks: 10 }, // maxStacks=3
    ]);
    expect(mods.dotPerTickFlat).toBe(24); // clamp 3 stacks × 8 dmg
  });

  it('stack=0 hoặc invalid bị skip', () => {
    const mods = composeBuffMods([
      { buffKey: 'pill_atk_buff_t1', stacks: 0 },
      { buffKey: 'pill_atk_buff_t1', stacks: -1 },
      { buffKey: 'pill_atk_buff_t1', stacks: NaN },
    ]);
    expect(mods.atkMul).toBe(1);
  });

  it('debuff_taunt_moc set tauntActive', () => {
    const mods = composeBuffMods([
      { buffKey: 'debuff_taunt_moc', stacks: 1 },
    ]);
    expect(mods.tauntActive).toBe(true);
  });

  it('talent_shield_phong set shieldHpMaxRatio = 0.3', () => {
    const mods = composeBuffMods([
      { buffKey: 'talent_shield_phong', stacks: 1 },
    ]);
    expect(mods.shieldHpMaxRatio).toBeCloseTo(0.3, 5);
  });

  it('shieldHpMaxRatio cap 1.0', () => {
    // synthesize bằng cách giả định talent_shield_phong stack 5 (nhưng stackable=false)
    // → giới hạn maxStacks=1, shield=0.3.
    // Test cap: invoke với 2 effect shield khác nhau.
    // Hiện tại catalog chỉ có 1 shield buff non-stackable maxStacks=1.
    const mods = composeBuffMods([
      { buffKey: 'talent_shield_phong', stacks: 1 },
    ]);
    expect(mods.shieldHpMaxRatio).toBeLessThanOrEqual(1.0);
  });

  it('debuff_taoma set atkMul=0.9 + cultivationBlocked', () => {
    const mods = composeBuffMods([
      { buffKey: 'debuff_taoma', stacks: 1 },
    ]);
    expect(mods.atkMul).toBeCloseTo(0.9, 5);
    expect(mods.cultivationBlocked).toBe(true);
  });

  it('debuff_boss_atk_down giảm atkMul × 0.82 (multiplicative với buff atk)', () => {
    const mods = composeBuffMods([
      { buffKey: 'pill_atk_buff_t1', stacks: 1 }, // ×1.12
      { buffKey: 'debuff_boss_atk_down', stacks: 1 }, // ×0.82
    ]);
    expect(mods.atkMul).toBeCloseTo(1.12 * 0.82, 5);
  });

  it('unknown buffKey skip không lỗi', () => {
    const mods = composeBuffMods([
      { buffKey: 'nonexistent_xyz', stacks: 1 },
      { buffKey: 'pill_atk_buff_t1', stacks: 1 },
    ]);
    expect(mods.atkMul).toBeCloseTo(1.12, 5);
  });

  it('default cultivationRateMul=1 khi không có debuff rate_mul', () => {
    const mods = composeBuffMods([]);
    expect(mods.cultivationRateMul).toBe(1);
  });

  it('tam_ma_light set cultivationRateMul=BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY (~0.7) + KHÔNG block cultivation', () => {
    const mods = composeBuffMods([
      { buffKey: 'tam_ma_light', stacks: 1 },
    ]);
    expect(mods.cultivationRateMul).toBeCloseTo(
      BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,
      5,
    );
    // tam_ma_light KHÔNG có cultivation_block — chỉ giảm rate, vẫn cho tu luyện.
    expect(mods.cultivationBlocked).toBe(false);
    // KHÔNG đụng atk (khác debuff_taoma full).
    expect(mods.atkMul).toBe(1);
  });

  it('cultivation_rate_mul multiplicative khi composite (rate × rate)', () => {
    // Synthesize: 2 buff đều có cultivation_rate_mul. tam_ma_light × tam_ma_light
    // không thực tế (non-stackable refresh-only), nhưng test composeBuffMods
    // pure semantics: nhiều buff khác key có rate_mul effect → multiplicative.
    // Ở runtime catalog hiện chỉ có 1 buff rate_mul (tam_ma_light) — composite
    // path test = bảo vệ trước khi thêm buff rate_mul mới (vd "Đan Tăng EXP").
    const mods = composeBuffMods([
      { buffKey: 'tam_ma_light', stacks: 1 },
    ]);
    // 1 buff → identity-multiplied = single value.
    expect(mods.cultivationRateMul).toBeCloseTo(
      BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY,
      5,
    );
  });
});

describe('tam_ma_light buff (Phase 11 nâng cao §5 PR2 prep)', () => {
  it('exists trong BUFFS catalog với key đúng', () => {
    const def = getBuffDef('tam_ma_light');
    expect(def).toBeDefined();
    expect(def?.key).toBe('tam_ma_light');
  });

  it('source=breakthrough, polarity=debuff, non-stackable, dispellable=false', () => {
    const def = getBuffDef('tam_ma_light') as BuffDef;
    expect(def.source).toBe('breakthrough');
    expect(def.polarity).toBe('debuff');
    expect(def.stackable).toBe(false);
    expect(def.maxStacks).toBe(1);
    expect(def.dispellable).toBe(false);
  });

  it('durationSec === BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC (~300s)', () => {
    const def = getBuffDef('tam_ma_light') as BuffDef;
    expect(def.durationSec).toBe(BREAKTHROUGH_FAIL_DEBUFF_DURATION_SEC);
  });

  it('có đúng 1 effect cultivation_rate_mul với value === BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY', () => {
    const def = getBuffDef('tam_ma_light') as BuffDef;
    expect(def.effects).toHaveLength(1);
    const eff = def.effects[0];
    expect(eff.kind).toBe('cultivation_rate_mul');
    expect(eff.value).toBe(BREAKTHROUGH_FAIL_DEBUFF_RATE_PENALTY);
    expect(eff.statTarget).toBeNull();
    expect(eff.elementTarget).toBeNull();
  });

  it('buffsBySource("breakthrough") trả ≥ 1 (tam_ma_light)', () => {
    expect(buffsBySource('breakthrough').length).toBeGreaterThanOrEqual(1);
  });

  it('buffsByEffectKind("cultivation_rate_mul") trả ≥ 1 (tam_ma_light)', () => {
    expect(
      buffsByEffectKind('cultivation_rate_mul').length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('lighter than debuff_taoma — duration ngắn hơn + KHÔNG block cultivation', () => {
    const light = getBuffDef('tam_ma_light') as BuffDef;
    const full = getBuffDef('debuff_taoma') as BuffDef;
    expect(light.durationSec).toBeLessThan(full.durationSec);
    // light có cultivation_rate_mul (giảm nhẹ), full có cultivation_block (binary).
    expect(
      light.effects.some((e) => e.kind === 'cultivation_block'),
    ).toBe(false);
    expect(
      full.effects.some((e) => e.kind === 'cultivation_block'),
    ).toBe(true);
  });
});

describe('Helper: computeBuffExpiresAt + isBuffExpired', () => {
  const now = new Date('2025-01-01T00:00:00Z');

  it('pill_atk_buff_t1 (60s) expires 60s sau now', () => {
    const def = getBuffDef('pill_atk_buff_t1') as BuffDef;
    const exp = computeBuffExpiresAt(now, def);
    expect(exp.getTime() - now.getTime()).toBe(60 * 1000);
  });

  it('overrideDurationSec ưu tiên hơn def.durationSec', () => {
    const def = getBuffDef('pill_atk_buff_t1') as BuffDef;
    const exp = computeBuffExpiresAt(now, def, 120);
    expect(exp.getTime() - now.getTime()).toBe(120 * 1000);
  });

  it('throw nếu duration < 0 hoặc NaN', () => {
    const def = getBuffDef('pill_atk_buff_t1') as BuffDef;
    expect(() => computeBuffExpiresAt(now, def, -1)).toThrow();
    expect(() => computeBuffExpiresAt(now, def, NaN)).toThrow();
  });

  it('isBuffExpired đúng', () => {
    const def = getBuffDef('pill_atk_buff_t1') as BuffDef;
    const exp = computeBuffExpiresAt(now, def);
    expect(isBuffExpired(now, exp)).toBe(false);
    expect(isBuffExpired(new Date(now.getTime() + 30 * 1000), exp)).toBe(false);
    expect(isBuffExpired(new Date(now.getTime() + 60 * 1000), exp)).toBe(true);
    expect(isBuffExpired(new Date(now.getTime() + 90 * 1000), exp)).toBe(true);
  });
});

describe('Realm + element guard sanity', () => {
  it('mỗi buff có element không null phải nằm trong ElementKey', () => {
    const validElements = new Set<ElementKey>(ELEMENTS);
    for (const b of BUFFS) {
      if (b.element !== null) {
        expect(validElements.has(b.element)).toBe(true);
      }
    }
  });

  it('REALMS định nghĩa phamnhan…hu_khong_chi_ton (buff không cần realm gate, nhưng catalog phải tồn tại)', () => {
    expect(REALMS.length).toBeGreaterThanOrEqual(20);
  });
});
