import { describe, expect, it } from 'vitest';
import { EQUIPMENT_QUALITY_VISUALS, getEquipmentQualityVisual } from './equipment-visuals';

describe('equipment quality visuals', () => {
  it('visual class map đúng theo quality thật', () => {
    expect(getEquipmentQualityVisual('PHAM')).toMatchObject({
      quality: 'PHAM',
      textClass: 'text-ink-200',
      borderClass: 'border-ink-300/50',
    });
    expect(getEquipmentQualityVisual('LINH')).toMatchObject({
      quality: 'LINH',
      textClass: 'text-blue-300',
      borderClass: 'border-blue-300/60',
    });
    expect(getEquipmentQualityVisual('HUYEN')).toMatchObject({
      quality: 'HUYEN',
      textClass: 'text-purple-300',
      borderClass: 'border-purple-300/60',
    });
    expect(getEquipmentQualityVisual('TIEN')).toMatchObject({
      quality: 'TIEN',
      textClass: 'text-amber-300',
      borderClass: 'border-amber-300/70',
    });
    expect(getEquipmentQualityVisual('THAN')).toMatchObject({
      quality: 'THAN',
      textClass: 'text-red-300',
      borderClass: 'border-yellow-300/80',
    });
  });

  it('không tạo visual quality ngoài enum', () => {
    expect(Object.keys(EQUIPMENT_QUALITY_VISUALS)).toEqual([
      'PHAM',
      'LINH',
      'HUYEN',
      'TIEN',
      'THAN',
    ]);
  });
});
