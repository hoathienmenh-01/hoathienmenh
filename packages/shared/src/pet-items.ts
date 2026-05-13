/**
 * Phase 35.0 — Pet item catalog (vé/material/exp item).
 *
 * Bao gồm:
 *   - Pet box ticket (`pet_ticket_*`): vé mở box theo loại.
 *   - Pet exp item (`pet_mat_linh_thao`, `_huyet_linh_qua`, `_thu_linh_dan`).
 *   - Pet breakthrough/evolution material (`pet_mat_thu_hon_thach`,
 *     `_yeu_dan`, `_huyet_mach_tinh_hoa`, `_ban_menh_linh_chau`,
 *     `_ngu_hanh_tinh_tuy`).
 *
 * Tất cả `kind='MISC'`, `stackable=true`, `bindOnPickup=false` (cho phép
 * trade qua market) trừ ticket có `bindOnPickup=true` (giới hạn cá nhân).
 *
 * Inject vào `ITEMS` ở `items.ts` qua spread.
 */
import type { ItemDef } from './items';

export const PET_ITEMS: readonly ItemDef[] = [
  // ---- Pet box tickets ----
  {
    key: 'pet_ticket_standard',
    name: 'Vé Mở Hộp Thần Thú Tiêu Chuẩn',
    description: 'Vé mở 1 lần Hộp Thần Thú Tiêu Chuẩn. Không giao dịch.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    bindOnPickup: true,
    marketTradeable: false,
    price: 200,
  },
  {
    key: 'pet_ticket_premium',
    name: 'Vé Mở Hộp Thần Thú Cao Cấp',
    description: 'Vé mở 1 lần Hộp Thần Thú Cao Cấp. Không giao dịch.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    bindOnPickup: true,
    marketTradeable: false,
    price: 1000,
  },
  {
    key: 'pet_ticket_element',
    name: 'Vé Mở Hộp Linh Thú Ngũ Hành',
    description: 'Vé mở 1 lần Hộp Linh Thú Ngũ Hành. Không giao dịch.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    bindOnPickup: true,
    marketTradeable: false,
    price: 800,
  },
  {
    key: 'pet_ticket_event',
    name: 'Vé Mở Hộp Linh Thú Sự Kiện',
    description: 'Vé mở 1 lần Hộp Linh Thú Sự Kiện. Không giao dịch.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    bindOnPickup: true,
    marketTradeable: false,
    price: 1500,
  },

  // ---- Pet exp items ----
  {
    key: 'pet_mat_linh_thao',
    name: 'Linh Thảo',
    description: 'Cỏ linh thường, cho thú cưng 50 exp.',
    kind: 'MISC',
    quality: 'PHAM',
    stackable: true,
    marketTradeable: true,
    price: 20,
  },
  {
    key: 'pet_mat_huyet_linh_qua',
    name: 'Huyết Linh Quả',
    description: 'Quả tinh huyết, cho thú cưng 200 exp.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    marketTradeable: true,
    price: 80,
  },
  {
    key: 'pet_mat_thu_linh_dan',
    name: 'Thú Linh Đan',
    description: 'Đan dược dành riêng cho thú cưng, cho 1000 exp.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    marketTradeable: true,
    price: 400,
  },

  // ---- Pet breakthrough materials ----
  {
    key: 'pet_mat_thu_hon_thach',
    name: 'Thú Hồn Thạch',
    description: 'Đá hồn thú, dùng để giúp thú đột phá cấp 20.',
    kind: 'MISC',
    quality: 'LINH',
    stackable: true,
    marketTradeable: true,
    price: 150,
  },
  {
    key: 'pet_mat_yeu_dan',
    name: 'Yêu Đan',
    description: 'Đan dược chiết xuất từ yêu thú, hỗ trợ đột phá cấp 40+.',
    kind: 'MISC',
    quality: 'HUYEN',
    stackable: true,
    marketTradeable: true,
    price: 500,
  },
  {
    key: 'pet_mat_huyet_mach_tinh_hoa',
    name: 'Huyết Mạch Tinh Hoa',
    description: 'Tinh hoa huyết mạch yêu thú, dùng cho đột phá cấp 60+.',
    kind: 'MISC',
    quality: 'TIEN',
    stackable: true,
    marketTradeable: true,
    price: 2000,
  },
  {
    key: 'pet_mat_ban_menh_linh_chau',
    name: 'Bản Mệnh Linh Châu',
    description: 'Châu báu ngưng tụ bản mệnh, hỗ trợ đột phá cấp 80+.',
    kind: 'MISC',
    quality: 'THAN',
    stackable: true,
    marketTradeable: true,
    price: 8000,
  },
  {
    key: 'pet_mat_ngu_hanh_tinh_tuy',
    name: 'Ngũ Hành Tinh Tủy',
    description: 'Tinh tủy ngũ hành, dùng để tiến hóa và nâng kỹ năng thú.',
    kind: 'MISC',
    quality: 'THAN',
    stackable: true,
    marketTradeable: true,
    price: 12000,
  },
];

export const PET_ITEM_KEYS: ReadonlySet<string> = new Set(
  PET_ITEMS.map((i) => i.key),
);
