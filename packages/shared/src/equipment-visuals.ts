import type { Quality } from './enums';

export interface EquipmentQualityVisualDef {
  quality: Quality;
  textClass: string;
  borderClass: string;
  glowClass: string;
  auraClass: string;
  labelVi: string;
  labelEn: string;
}

export const EQUIPMENT_QUALITY_VISUALS: Readonly<Record<Quality, EquipmentQualityVisualDef>> = {
  PHAM: {
    quality: 'PHAM',
    textClass: 'text-ink-200',
    borderClass: 'border-ink-300/50',
    glowClass: 'shadow-ink-300/20',
    auraClass: 'bg-ink-300/10',
    labelVi: 'Phàm phẩm',
    labelEn: 'Mortal quality',
  },
  LINH: {
    quality: 'LINH',
    textClass: 'text-blue-300',
    borderClass: 'border-blue-300/60',
    glowClass: 'shadow-blue-300/30',
    auraClass: 'bg-blue-400/10',
    labelVi: 'Linh phẩm',
    labelEn: 'Spirit quality',
  },
  HUYEN: {
    quality: 'HUYEN',
    textClass: 'text-purple-300',
    borderClass: 'border-purple-300/60',
    glowClass: 'shadow-purple-300/30',
    auraClass: 'bg-purple-400/10',
    labelVi: 'Huyền phẩm',
    labelEn: 'Mystic quality',
  },
  TIEN: {
    quality: 'TIEN',
    textClass: 'text-amber-300',
    borderClass: 'border-amber-300/70',
    glowClass: 'shadow-amber-300/40',
    auraClass: 'bg-amber-400/15',
    labelVi: 'Tiên phẩm',
    labelEn: 'Immortal quality',
  },
  THAN: {
    quality: 'THAN',
    textClass: 'text-red-300',
    borderClass: 'border-yellow-300/80',
    glowClass: 'shadow-yellow-300/50',
    auraClass: 'bg-red-500/15',
    labelVi: 'Thần phẩm',
    labelEn: 'Divine quality',
  },
};

export function getEquipmentQualityVisual(quality: Quality): EquipmentQualityVisualDef {
  return EQUIPMENT_QUALITY_VISUALS[quality];
}
