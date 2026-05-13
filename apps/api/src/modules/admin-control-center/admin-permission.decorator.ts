import { SetMetadata } from '@nestjs/common';
import type { AdminPermissionKey } from '@xuantoi/shared';

/**
 * Phase 27.6 — Admin Control Center V2 permission decorator.
 *
 * Đánh dấu route/method yêu cầu admin có 1 hoặc nhiều
 * `AdminPermissionKey` (catalog ở `@xuantoi/shared`). `AdminPermissionGuard`
 * đọc metadata này qua `Reflector` và:
 *   - Nếu role === ADMIN → mặc định `SUPER_ADMIN` (back-compat) — có tất
 *     cả permissions.
 *   - Nếu role === MOD → mặc định `MODERATOR` — chỉ
 *     `ADMIN_VIEW_DASHBOARD|VIEW_PLAYERS|MODERATE_CHAT|MUTE_USER|BAN_USER`.
 *   - Nếu thiếu permission → reject `ADMIN_PERMISSION_DENIED` 403.
 *
 * Khi PR sau thêm `AdminRoleAssignment` table (per-admin role override),
 * Guard sẽ đọc role assignment thay vì map cố định.
 *
 * KHÔNG dùng `@RequireAdmin()` cùng decorator này — dùng riêng:
 *   - `@RequireAdmin()` chặn MOD bất kể permission (legacy strict).
 *   - `@RequireAdminPermission(perm)` granular, ưu tiên nếu cần MOD truy
 *     cập 1 subset.
 */
export const REQUIRE_ADMIN_PERMISSION_KEY = 'requireAdminPermission';

export const RequireAdminPermission = (
  ...perms: AdminPermissionKey[]
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_ADMIN_PERMISSION_KEY, perms);
