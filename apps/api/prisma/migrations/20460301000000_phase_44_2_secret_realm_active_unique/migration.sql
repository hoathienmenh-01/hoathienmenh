-- Phase 44.2 — Secret Realm partial unique index hardening.
--
-- Race-window: 2 request `enter` đồng thời cùng (characterId, secretRealmKey)
-- có thể lọt qua `findFirst({ status: { in: ['ENTERED','CLEARED'] } })` rồi
-- create 2 rows song song. Application-layer guard không đủ — cần DB-level
-- partial unique index để chống.
--
-- Postgres partial unique index: chỉ unique khi status ∈ ('ENTERED','CLEARED').
-- CLAIMED/EXPIRED runs (history) KHÔNG bị ràng buộc — character có thể có
-- nhiều run cũ cùng realmKey trong history.
--
-- Prisma schema không native-declare partial unique → raw SQL migration ở đây.
-- DOWN-migration tay (DROP INDEX) — không phá dữ liệu hiện hữu vì index chỉ
-- enforce uniqueness ở subset active.
--
-- IMPORTANT: Nếu DB hiện đã có duplicate active runs (lý thuyết do bug cũ),
-- migration sẽ FAIL ở `CREATE UNIQUE INDEX`. Trong trường hợp đó cần dọn data
-- trước khi apply — không tự ý dedupe trong migration để tránh mất run hợp lệ.
CREATE UNIQUE INDEX IF NOT EXISTS "CharacterSecretRealmRun_active_unique"
  ON "CharacterSecretRealmRun" ("characterId", "secretRealmKey")
  WHERE "status" IN ('ENTERED', 'CLEARED');
