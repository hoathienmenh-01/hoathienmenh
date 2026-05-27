# Economy & Ledger Memory

> **Last updated:** 2026-05-27

## Purpose
Record key invariants for currency, item, reward, market, topup, ledger.

## Critical Invariants (from CLAUDE.md)
1. **All currency/item mutations go through `CurrencyService`/`ItemService` + ledger row.**
2. **Reward sources have idempotency key `(characterId, sourceType, sourceKey)` UNIQUE.**
3. **Admin CANNOT mint Tiên Ngọc via bypass.**
4. **Violating invariants = data corruption.**

## Key Services
- `CurrencyService` — currency mutations (Linh Thạch, Tiên Ngọc, etc.)
- `ItemService` — item mutations (add, remove, consume)
- `RewardService` — reward grants with idempotency
- `LedgerService` — audit trail for all mutations
- `EconomyIntegrityAuditService` — detect anomalies/duplicates

## Guardrails
- **Do not change economy/balance without explicit task.**
- **Currency/item/reward mutations must follow service/ledger rules.**
- **Preserve auditability and consistency.**
- **Additive schema changes only** if schema task requires.
- **No bypass for admin minting Tiên Ngọc** (premium currency).

## Common patterns
- **Idempotent rewards:** Use `(characterId, sourceType, sourceKey)` UNIQUE constraint.
- **Ledger reasons:** Every mutation has a reason enum (e.g., `MISSION_REWARD`, `ADMIN_GRANT`, `MARKET_PURCHASE`).
- **Atomic transactions:** Use Prisma `$transaction` for multi-step mutations.
- **Reward caps:** Use `RewardCapService` to enforce daily/weekly caps.

## Known issues
- None currently.

## Source docs
- `CLAUDE.md` — economy invariants (CRITICAL section)
- `docs/ECONOMY_MODEL.md` — full economy model (68k chars — only read if deep changes needed)
- `docs/ECONOMY_INTEGRITY_AUDIT.md` — integrity audit patterns
- `docs/REWARD_POLICY.md` — reward caps and policies
