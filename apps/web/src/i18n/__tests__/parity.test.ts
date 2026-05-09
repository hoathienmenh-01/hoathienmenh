import { describe, it, expect } from 'vitest';
import { LIVE_OPS_EVENTS, TERRITORY_REGION_BUFFS } from '@xuantoi/shared';
import vi from '../vi.json';
import en from '../en.json';

type Json = Record<string, unknown>;

/**
 * Flatten i18n object thành Map `dot.path` -> leaf value.
 *
 * Hỗ trợ:
 *  - string / number leaf -> giữ nguyên.
 *  - array of string/number -> index hoá `key.0`, `key.1`,... để vi/en bắt
 *    buộc cùng số phần tử (onboarding lines, hint blocks).
 *  - object lồng -> recurse.
 *  - kiểu khác -> throw để báo schema sai.
 */
function flatten(obj: Json, prefix = ''): Map<string, string | number> {
  const out = new Map<string, string | number>();
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      v.forEach((item, idx) => {
        if (typeof item === 'string' || typeof item === 'number') {
          out.set(`${key}.${idx}`, item);
        } else {
          throw new Error(`i18n array ${key}[${idx}] phải là string/number`);
        }
      });
    } else if (typeof v === 'object') {
      for (const [kk, vv] of flatten(v as Json, key)) out.set(kk, vv);
    } else if (typeof v === 'string' || typeof v === 'number') {
      out.set(key, v);
    } else {
      throw new Error(`i18n key ${key} có kiểu không hợp lệ: ${typeof v}`);
    }
  }
  return out;
}

describe('i18n parity vi vs en', () => {
  const flatVi = flatten(vi as Json);
  const flatEn = flatten(en as Json);

  it('mọi key trong vi.json phải có trong en.json', () => {
    const missing = [...flatVi.keys()].filter((k) => !flatEn.has(k));
    expect(missing).toEqual([]);
  });

  it('mọi key trong en.json phải có trong vi.json', () => {
    const missing = [...flatEn.keys()].filter((k) => !flatVi.has(k));
    expect(missing).toEqual([]);
  });

  it('không có giá trị rỗng (string trim() === "") trong vi.json', () => {
    const empty = [...flatVi.entries()]
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('không có giá trị rỗng (string trim() === "") trong en.json', () => {
    const empty = [...flatEn.entries()]
      .filter(([, v]) => typeof v === 'string' && v.trim() === '')
      .map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it('placeholder ICU `{name}` parity — mỗi placeholder trong vi phải xuất hiện trong en cùng key', () => {
    const re = /\{(\w+)\}/g;
    const mismatches: Array<{ key: string; vi: string[]; en: string[] }> = [];
    for (const [key, viVal] of flatVi.entries()) {
      if (typeof viVal !== 'string') continue;
      const enVal = flatEn.get(key);
      if (typeof enVal !== 'string') continue;
      const viPlaceholders = [...viVal.matchAll(re)].map((m) => m[1]).sort();
      const enPlaceholders = [...enVal.matchAll(re)].map((m) => m[1]).sort();
      if (JSON.stringify(viPlaceholders) !== JSON.stringify(enPlaceholders)) {
        mismatches.push({ key, vi: viPlaceholders, en: enPlaceholders });
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('các badge key trong shell.badge.* (smoke test cho session 9g task C)', () => {
    expect(flatVi.get('shell.badge.breakthroughReady')).toBeTruthy();
    expect(flatEn.get('shell.badge.breakthroughReady')).toBeTruthy();
    expect(flatVi.get('shell.badge.bossActive')).toBeTruthy();
    expect(flatEn.get('shell.badge.bossActive')).toBeTruthy();
    expect(flatVi.get('shell.badge.topupPending')).toBeTruthy();
    expect(flatEn.get('shell.badge.topupPending')).toBeTruthy();
  });

  // Phase 13.0 audit pass #3 — Bug #6: catalog event keys must have matching
  // i18n entries (titleI18nKey/descriptionI18nKey/rewardHintI18nKey). Trước
  // khi fix: catalog có 4 key (daily_exp_rush_morning, daily_dungeon_rush_evening,
  // weekly_sect_aura_sunday, limited_lunar_new_year_2027) nhưng i18n chỉ có 2
  // orphan key (event_daily_exp_rush, event_weekly_dungeon_double_drop) → khi
  // event ACTIVE, FE render raw key string thay vì translated title.
  it('mọi LIVE_OPS_EVENTS titleI18nKey/descriptionI18nKey phải tồn tại trong vi.json', () => {
    const missing: string[] = [];
    for (const ev of LIVE_OPS_EVENTS) {
      if (!flatVi.has(ev.titleI18nKey)) missing.push(ev.titleI18nKey);
      if (!flatVi.has(ev.descriptionI18nKey)) missing.push(ev.descriptionI18nKey);
    }
    expect(missing).toEqual([]);
  });

  it('mọi LIVE_OPS_EVENTS titleI18nKey/descriptionI18nKey phải tồn tại trong en.json', () => {
    const missing: string[] = [];
    for (const ev of LIVE_OPS_EVENTS) {
      if (!flatEn.has(ev.titleI18nKey)) missing.push(ev.titleI18nKey);
      if (!flatEn.has(ev.descriptionI18nKey)) missing.push(ev.descriptionI18nKey);
    }
    expect(missing).toEqual([]);
  });

  // Phase 14.0.C — territory buff catalog i18n parity audit (post phase 14
  // hardening). Mỗi `TERRITORY_REGION_BUFFS[i].labelI18nKey` /
  // `descriptionI18nKey` phải tồn tại trong cả 2 locale file, nếu không FE
  // sẽ render raw key string (vd `territory.buff.son_coc_exp.label`) thay vì
  // text dịch — UX bug khó phát hiện ở build time.
  it('mọi TERRITORY_REGION_BUFFS labelI18nKey/descriptionI18nKey phải tồn tại trong vi.json', () => {
    const missing: string[] = [];
    for (const b of TERRITORY_REGION_BUFFS) {
      if (!flatVi.has(b.labelI18nKey)) missing.push(b.labelI18nKey);
      if (!flatVi.has(b.descriptionI18nKey)) missing.push(b.descriptionI18nKey);
    }
    expect(missing).toEqual([]);
  });

  it('mọi TERRITORY_REGION_BUFFS labelI18nKey/descriptionI18nKey phải tồn tại trong en.json', () => {
    const missing: string[] = [];
    for (const b of TERRITORY_REGION_BUFFS) {
      if (!flatEn.has(b.labelI18nKey)) missing.push(b.labelI18nKey);
      if (!flatEn.has(b.descriptionI18nKey)) missing.push(b.descriptionI18nKey);
    }
    expect(missing).toEqual([]);
  });
});
