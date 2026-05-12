# Admin Runbook — Xuân Tôi

Operational notes for admin-only maintenance and grant endpoints.

## Phase 25.2 — Shop Pack Grant

Endpoint:

```http
POST /api/admin/shop-packs/users/:id/grant
# or
POST /api/admin/shop/grant-pack
Cookie: xt_access=<ADMIN session>
Content-Type: application/json

{ "packId": "daily_cultivation_support" }
# compatibility path body:
{ "userId": "target-user-id", "packId": "daily_cultivation_support" }
```

Purpose:

- QA/admin test grant for limited resource packs.
- Does **not** deduct player `tienNgoc`.
- Grants the exact shared catalog rewards from `packages/shared/src/shop-packs.ts`.
- Writes `CurrencyLedger` / `ItemLedger` rows with reason `SHOP_PACK_REWARD`.
- Writes `AdminAuditLog` action `admin.shop_pack.grant`.

Safety rules:

- Use only for QA, compensation, or migration validation.
- Do not use to bypass normal purchase limits for production balancing.
- Never grant packs that violate Phase 25.2 reward guardrails: no direct top equipment, no max-star/max-awaken pháp bảo, no realm bypass, no unlimited resources.

Common errors:

| Code | Meaning |
|---|---|
| `UNAUTHENTICATED` | Missing/expired admin session |
| `FORBIDDEN` | User is not ADMIN |
| `PACK_NOT_FOUND` | Unknown `packId` |
| `NO_CHARACTER` | Target user has no character |
| `INVALID_INPUT` | Invalid request body |
