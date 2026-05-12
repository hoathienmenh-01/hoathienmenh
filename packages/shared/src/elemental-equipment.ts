import { ELEMENTS, type ElementKey } from './combat';
import type { ItemBonus, ItemDef } from './items';

export interface ElementalEquipmentAffinity {
  itemKey: string;
  equipmentElement: ElementKey | null;
  elementalBonus: Partial<Record<ElementKey, number>>;
  resistBonus: Partial<Record<ElementKey, number>>;
}

export function getEquipmentElement(item: Pick<ItemDef, 'equipmentElement' | 'bonuses'>): ElementKey | null {
  if (item.equipmentElement !== undefined) return item.equipmentElement;
  const atkBonus = item.bonuses?.elementalAtkBonus;
  if (!atkBonus) return null;
  let best: ElementKey | null = null;
  let bestValue = 0;
  for (const element of ELEMENTS) {
    const value = atkBonus[element] ?? 0;
    if (value > bestValue) {
      best = element;
      bestValue = value;
    }
  }
  return best;
}

export function getEquipmentElementalAffinity(
  item: Pick<ItemDef, 'key' | 'equipmentElement' | 'bonuses'>,
): ElementalEquipmentAffinity {
  const bonuses: ItemBonus | undefined = item.bonuses;
  return {
    itemKey: item.key,
    equipmentElement: getEquipmentElement(item),
    elementalBonus: bonuses?.elementalAtkBonus ?? {},
    resistBonus: bonuses?.elementResist ?? {},
  };
}

export function summarizeEquipmentElementalAffinity(
  items: readonly Pick<ItemDef, 'key' | 'equipmentElement' | 'bonuses'>[],
): Partial<Record<ElementKey, number>> {
  const summary: Partial<Record<ElementKey, number>> = {};
  for (const item of items) {
    const affinity = getEquipmentElementalAffinity(item);
    if (affinity.equipmentElement) {
      summary[affinity.equipmentElement] = (summary[affinity.equipmentElement] ?? 0) + 1;
    }
    for (const element of ELEMENTS) {
      const value = affinity.elementalBonus[element] ?? 0;
      if (value > 0) summary[element] = (summary[element] ?? 0) + value;
    }
  }
  return summary;
}
