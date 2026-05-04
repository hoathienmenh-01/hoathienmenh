-- Phase 11.X admin seed harness extension (PR session 2026-05-04 part 2):
-- thêm cột `Character.bonusTalentPoints` Int default 0. Cộng dồn trên
-- `computeTalentPointBudget(realmOrder)` (3 realm = 1 điểm gốc) khi
-- `TalentService.canLearn`/`getRemainingTalentPoints` chạy. Use-case:
-- QA seed cho positive-path talent flow / Phase 11.X UI E2E
-- `talent learn → cast → cooldown` không cần advance realm. Mutate qua
-- `POST /admin/users/:id/grant-talent-point` (admin endpoint) — KHÔNG cho
-- player tự cộng (anti-FE-self-grant).
ALTER TABLE "Character" ADD COLUMN "bonusTalentPoints" INTEGER NOT NULL DEFAULT 0;
