import {
  getBodyRealmByKey,
  realmByKey,
} from '@xuantoi/shared';

const FEATURE_LABELS: Record<string, string> = {
  pets: 'Linh Thú',
  spiritPets: 'Linh Thú',
  pet: 'Linh Thú',
  dashboard: 'Thiên Cung Tổng Quan',
  cultivation: 'Tu Luyện',
  breakthrough: 'Đột Phá',
  bodyCultivation: 'Luyện Thể',
  cultivationMethod: 'Công Pháp',
  spiritualRoot: 'Linh Căn',
  skillBook: 'Pháp Quyển',
  alchemy: 'Luyện Đan',
  inventory: 'Linh Bảo Các',
  equipment: 'Trang Bị',
  secretRealms: 'Bí Cảnh',
  boss: 'Boss Thế Giới',
  market: 'Phường Thị',
  auction: 'Đấu Giá',
  events: 'Sự Kiện',
  achievements: 'Thành Tựu',
  notifications: 'Thông Báo',
  settings: 'Cài Đặt',
};

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function formatRealmName(realmKey: string, stage?: number | null): string {
  const realm = realmByKey(realmKey);
  const name = realm?.name ?? humanizeKey(realmKey);
  if (!stage || (realm && realm.stages <= 1)) return name;
  return `${name} · Tầng ${stage}`;
}

export function formatBodyRealmName(
  bodyRealmKey: string,
  stage?: number | null,
): string {
  const realm = getBodyRealmByKey(bodyRealmKey);
  const name = realm?.name ?? humanizeKey(bodyRealmKey);
  if (!stage || (realm && realm.stages <= 1)) return name;
  return `${name} · Tầng ${stage}`;
}

export function formatFeatureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? humanizeKey(key);
}

export function formatNumberCompact(value: string | number): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(numeric);
}
