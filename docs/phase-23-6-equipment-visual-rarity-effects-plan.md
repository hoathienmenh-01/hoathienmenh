# Phase 23.6 — Equipment Visual Rarity Effects + Quality Power Meaning

## Core rule

- `equipmentTier` / `requiredRealmOrder` là tầng sức mạnh lớn theo cảnh giới: 28 cảnh giới map vào 10 equipment tier, realm không đủ thì không được mặc, tier thấp không nâng trực tiếp thành tier cao.
- `quality` / phẩm cấp đại diện cho **sức mạnh và độ hiếm trong cùng equipmentTier**, không chỉ là màu/viền/glow.
- Visual rarity effect chỉ là UI thể hiện phẩm cấp thật; không tạo quality giả để đổi màu.

## Power score

```txt
powerScore =
  TierBase
  × QualityMultiplier
  × SlotWeight
  × EnhanceMultiplier
  × GemMultiplierCap
  × SetBonusCap
```

- `QualityMultiplier`: PHAM 1.00, LINH 1.20, HUYEN 1.50, TIEN 1.90, THAN 2.40.
- `TierBase`: 100, 260, 680, 1750, 4500, 11500, 29000, 72000, 175000, 420000.
- Cùng tier: PHAM < LINH < HUYEN < TIEN < THAN.

## Balance guard

- Thần phẩm tier cũ có thể gần bằng Phàm/Linh phẩm tier mới.
- Thần phẩm tier cũ không được vượt Huyền/Tiên phẩm tier mới.
- Enhance/gem/set/reforge/enchant không được biến đồ tier thấp thành tier cao.
- Quality không phá `requiredRealmOrder`.

## UI / tooltip

Tooltip trang bị phải hiển thị: tier, phẩm cấp, required realm, powerScore, dòng “Phẩm cấp tăng sức mạnh trong cùng tầng trang bị.” Nếu item bị khóa, hiển thị “Cần đạt cảnh giới yêu cầu để sử dụng.”

## Visual mapping

- PHAM: trắng/xám.
- LINH: xanh.
- HUYEN: tím.
- TIEN: cam/vàng.
- THAN: đỏ/vàng thần quang.
