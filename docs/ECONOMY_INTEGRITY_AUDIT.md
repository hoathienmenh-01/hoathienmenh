# Economy Integrity Audit — Xuân Tôi

> Phase 44.0 — Economy Integrity, Reward Safety & Anti-Duplicate Claim Audit V1.
>
> Hướng dẫn vận hành audit script + module audit pure logic.
> Đây là **read-only** detection: không tự fix dữ liệu. Các finding cần
> con-người duyệt trước khi remediation.

---

## 1. Phạm vi

Audit phát hiện 4 nhóm vấn đề:

1. **Mail claim duplicate** — `MailAttachmentClaim` có > 1 row trên cùng
   `(mailId, characterId)`. Schema có UNIQUE; finding ≠ 0 nghĩa là
   UNIQUE bị bypass (migration sai / row legacy).
2. **System gift duplicate** — `SystemGiftClaim` có > 1 row trên cùng
   `(giftKey, characterId)`. Tương tự mail.
3. **Reward log duplicate** — `CurrencyLedger` có > 1 row trên cùng
   `(characterId, currency, reason, refType, refId)` cho reason
   thuộc danh sách `CLAIM_ONLY_LEDGER_REASONS`:
   - `MAIL_CLAIM`, `MISSION_CLAIM`, `QUEST_CLAIM`,
     `DUNGEON_RUN_REWARD`, `STORY_DUNGEON_REWARD`,
     `SECT_WAR_REWARD`, `SECT_SEASON_REWARD`, `BOSS_REWARD`,
     `GIFTCODE_REDEEM`, `ONBOARDING_CLAIM`, `DAILY_ENCOUNTER_CLAIM`,
     `SECRET_REALM_CLAIM`, `MENTOR_MILESTONE_CLAIM`,
     `LIVEOPS_EVENT_REWARD`.
4. **Admin grant policy violation** — trong cửa sổ 90 ngày gần nhất:
   - reason rỗng / `.trim().length < 3`.
   - delta linhThach > `MAX_ADMIN_GRANT_LINH_THACH` (1 tỷ).
   - delta tienNgoc > `MAX_ADMIN_GRANT_TIEN_NGOC` (1 triệu).

## 2. Cách chạy

### CLI (operator)

```bash
pnpm integrity:check
# JSON cho monitoring:
pnpm integrity:check -- --json
# Subset scope:
pnpm integrity:check -- --scope=mail,admin-grant,reward-log
# Không ghi artefact lên Redis:
pnpm integrity:check -- --no-redis
```

Kết quả in human-readable summary + (default) push 1 artefact lên Redis
key `ledger-integrity-check:latest` TTL 7d (Phase 43 layer giữ
nguyên).

### API runtime (admin endpoint — TBD Phase 44.1)

```ts
import { runEconomyIntegrityAudit } from '../economy/economy-integrity-audit';

const result = await runEconomyIntegrityAudit(prisma, {
  adminGrantSinceDays: 90,
});
// result: { runAt, findings[], totalIssueCount }
```

Audit module pure (apps/api/src/modules/economy/economy-integrity-audit.ts)
- read-only Prisma queries.
- accept `PrismaClient | TransactionClient`.
- mỗi check có `IntegrityFinding[]` riêng.
- aggregate runner chạy song song (read-only, không conflict).

### Test

```bash
pnpm --filter @xuantoi/api test src/modules/economy/economy-integrity-audit.test.ts
```

Bao gồm:
- DB sạch → no findings.
- Insert duplicate row trực tiếp (bypass service) → flag.
- Admin grant reason rỗng / over-cap → flag.
- `sinceDays` window respect.
- `runEconomyIntegrityAudit` aggregate đúng count.

## 3. Đọc kết quả

Mỗi `IntegrityFinding`:

```ts
{
  scope: 'mail' | 'system-gift' | 'reward-log' | 'admin-grant',
  severity: 'ERROR' | 'WARN' | 'FATAL',
  code: 'MAIL_CLAIM_DUPLICATE' | 'SYSTEM_GIFT_DUPLICATE' |
        'REWARD_LOG_DUPLICATE' | 'ADMIN_GRANT_REASON_MISSING_OR_SHORT' |
        'ADMIN_GRANT_LINH_THACH_OVER_POLICY' |
        'ADMIN_GRANT_TIEN_NGOC_OVER_POLICY',
  message: string,
  count?: number,
  sample?: Record<string, unknown>[],  // tối đa 5 row mẫu
}
```

Severity:
- **FATAL** — UNIQUE constraint bị bypass; data corruption.
- **ERROR** — bug runtime / migration sai → block release.
- **WARN** — vi phạm policy (vd thiếu reason); cần fix nhưng không
  corrupt invariant.

## 4. Triage

| Code | Hành động đầu tiên |
|---|---|
| `MAIL_CLAIM_DUPLICATE` | Check migration: `MailAttachmentClaim` UNIQUE phải còn. Kiểm tra service path mới tạo claim. |
| `SYSTEM_GIFT_DUPLICATE` | Như trên cho `SystemGiftClaim`. |
| `REWARD_LOG_DUPLICATE` | Tra `sample` ra `refId` → check claim flow tương ứng (mission, quest, …) xem CAS có miss không. |
| `ADMIN_GRANT_REASON_MISSING_OR_SHORT` | Liên hệ admin / verify nguồn grant. Cập nhật process audit. |
| `ADMIN_GRANT_*_OVER_POLICY` | **Khẩn**: có thể admin account bị compromise. Audit `actorUserId` trong `sample`, xem `SecurityEvent`. |

## 5. Module Status

| Module | Status |
|---|---|
| `economy-integrity-audit.ts` (pure logic) | **DONE** |
| `economy-integrity-audit.test.ts` (integration) | **DONE** (Postgres required) |
| `scripts/integrity-check.mjs` (CLI) | **DONE** — 4 scope mới. |
| Admin runtime endpoint | **FOLLOW-UP** (Phase 44.1). |
| Cron + persist findings vào `EconomyAnomaly` | **FOLLOW-UP** (Phase 44.1). |

## 6. Known Risks

- Query dùng `LIMIT 50` (duplicate detection) + `LIMIT 5000` (admin grant
  90d). Production scale (vài triệu row admin grant trong 90d) cần
  batch / pagination — defer Phase 44.1.
- Audit chỉ phát hiện row hiện hữu — không phục hồi state đã refund hoặc
  reset từ trước.
- `CLAIM_ONLY_LEDGER_REASONS` là allowlist; reason mới thêm vào ledger
  phải đồng thời update danh sách này (mirror ở 3 chỗ: shared module,
  API audit module, CLI script).

## 7. Test/QA

- 30 unit test `packages/shared/src/reward-policy.test.ts` cho caps +
  validators.
- 12 integration test `apps/api/src/modules/economy/economy-integrity-audit.test.ts`
  cover scope: clean / mail-dup / system-gift-dup / reward-log-dup /
  admin-grant variants / aggregate.
- 5 race test `apps/api/src/modules/mail/mail.service.duplicate-claim.test.ts`
  cho mail spam claim + claim-all idempotent + expired/attacker/deleted.
- Local checks: `pnpm typecheck` ✓ / `pnpm --filter @xuantoi/api lint` ✓.
  Full `pnpm test` / `pnpm build` chạy trên CI (Postgres+Redis service).
