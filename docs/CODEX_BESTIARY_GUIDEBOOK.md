# Codex / Tu Tiên Bách Khoa / Bestiary / Guidebook (Phase 32.0)

A **read-only knowledge catalog** that indexes existing game content
(`ITEMS`, `MONSTERS`, `FARM_MAPS`, `REALMS`, …) into a unified `CodexEntry`
table. Players progress by discovering entries through gameplay; the codex
also surfaces **market price hints** for tradeable items (bi-directional
link with Market V2).

> **Scope**: Phase 32.0 ships ITEM indexing only (covers ITEM, MATERIAL,
> PILL, EQUIPMENT, ARTIFACT subtypes). Monster/map/realm indexer adapters
> are stubbed and will be filled in Phase 32.1.

## 1. Components

- `apps/api/src/modules/codex/codex-indexer.service.ts` — read catalog → upsert entries.
- `apps/api/src/modules/codex/codex.service.ts` — list/detail/discover/progress.
- `apps/api/src/modules/codex/codex.player.controller.ts` — player HTTP API.
- `apps/api/src/modules/codex/codex.admin.controller.ts` — admin HTTP API.
- `packages/shared/src/codex.ts` — types + visibility logic + indexer pure functions.
- Prisma models: `CodexEntry`, `CharacterCodexProgress`, `CodexAuditIssue`, `CodexReindexLog`.

## 2. Entry Types (22)

```
ITEM, MATERIAL, PILL, EQUIPMENT, ARTIFACT,
METHOD, RECIPE,
MONSTER, ELITE_MONSTER, BOSS, WORLD_BOSS, EVENT_BOSS, SECT_BOSS,
FARM_MAP, DUNGEON, SECT_DUNGEON, TRIAL_TOWER,
REALM, BODY_REALM,
NPC, QUEST, EVENT
```

## 3. Visibility (4)

| Visibility               | Behavior |
|--------------------------|----------|
| `PUBLIC`                 | Visible to everyone (default for most ITEM types). |
| `DISCOVERED_ONLY`        | Visible only after the character has discovered it. |
| `HIDDEN_UNTIL_DISCOVERED`| Listed but redacted (shows ??? until discovered). |
| `ADMIN_ONLY`             | Hidden from players; admin can review/show. |

Logic in `packages/shared/src/codex.ts isEntryVisible()`. Player API uses
`viewerIsAdmin=false`; admin API uses `viewerIsAdmin=true`.

## 4. Indexer Flow

```
   ITEMS catalog → buildIndexerInputFromCatalog()
                 → indexCatalogToCodex(input) [pure]
                 → CodexEntry[]
                 → upsert via prisma.codexEntry.upsert(...)
                 → auditCodexEntries(entries) [pure]
                 → CodexAuditIssue[]
                 → sync (resolved=false rows)
                 → log to CodexReindexLog
```

- Idempotent: re-running does not duplicate entries (upsert by `entryKey`).
- Admin-overridden fields (`description`, `iconKey`, `visibility` when
  `updatedBy IS NOT NULL`) are preserved.
- Stale entries (in DB but not in new pass) are deleted; their
  `CharacterCodexProgress` rows are NOT cascaded (FK on `entryKey`).

Trigger:
- Manual: `POST /admin/codex/reindex { reason }` → audited
  `CODEX_REINDEX`.
- Future: cron after content patch.

## 5. Progress Tracking

`CharacterCodexProgress { characterId, entryKey, context, discoveredAt }`
is the per-character discovery record. Inserted by:

- Server-side hooks (combat, loot drop, quest complete) call
  `CodexService.discover(characterId, entryKey, context)`.
- **Idempotent**: re-discovery returns `alreadyDiscovered: true` and does
  not create a new row.
- Player HTTP endpoint `POST /codex/entries/:entryKey/discover` is exposed
  for client-side narrative beats (e.g. "open first chest"); does not
  generate reward — only marks progress.

`CodexService.getProgress(characterId)` returns
`{ overallPct, bestiaryPct, isComplete }` summarized via
`summarizeCodexProgress()`.

## 6. Bi-directional Linking (Codex ↔ Market V2)

`CodexService.getDetail(entryKey)` returns:
```ts
{
  entry: CodexEntry,         // with .discovered flag if characterId given
  marketPrice: MarketPriceSnapshot | null,
}
```

`marketPrice` is queried by `prisma.marketPriceSnapshot.findUnique({ itemKey: entry.refKey })`
and is **only attached** for ITEM-like types (`ITEM`, `MATERIAL`, `PILL`,
`EQUIPMENT`, `ARTIFACT`). For non-tradeable types (NPC, REALM, MONSTER,
…) `marketPrice` is always `null`.

Web UI (`CodexView.vue`) displays a "Giá tham khảo chợ" panel in the
detail modal when `marketPrice` is present.

## 7. Endpoints

### Player
| Method | Path | Description |
|--------|------|-------------|
| GET    | `/codex/entries`              | List entries (filter `type`, paginate). |
| GET    | `/codex/entries/:entryKey`    | Detail (with marketPrice). |
| POST   | `/codex/entries/:entryKey/discover` | Mark as discovered (idempotent). |
| GET    | `/codex/progress`             | Progress summary. |
| GET    | `/codex/types`                | List of `CODEX_ENTRY_TYPES`. |

### Admin (`ADMIN_MANAGE_CODEX` permission)
| Method | Path | Description |
|--------|------|-------------|
| POST   | `/admin/codex/reindex`        | Full reindex from catalog. |
| GET    | `/admin/codex/audit`          | List unresolved issues. |
| POST   | `/admin/codex/audit/:id/resolve` | Mark issue resolved. |
| POST   | `/admin/codex/entries/:entryKey` | Update `description` / `visibility` / `iconKey`. |

All admin POSTs require `reason: string` and audit via
`AdminAuditWriter.write` (`CODEX_REINDEX` / `CODEX_AUDIT_RESOLVE` /
`CODEX_ENTRY_UPDATE` / `CODEX_ENTRY_HIDE` / `CODEX_ENTRY_SHOW`).

## 8. Audit Issues

`auditCodexEntries(entries)` (pure, in `packages/shared/src/codex.ts`)
detects:
- Missing description.
- Missing icon for high-tier items.
- Duplicate `refKey` collisions.
- Unknown entry types.

Issues are upserted into `CodexAuditIssue { resolved: false }`. Admin
clears via `POST /admin/codex/audit/:id/resolve { reason }`.

## 9. Runbook

- **Content patch**: after adding new items in `packages/shared/src/items.ts`,
  hit `POST /admin/codex/reindex` to refresh.
- **Hidden spoiler**: `POST /admin/codex/entries/<key>` with
  `visibility='ADMIN_ONLY'` to hide. Audit log records who/when/why.
- **Restoring after wrong hide**: same endpoint with `visibility='PUBLIC'`.
- **Player progress lost**: progress rows are FK on `entryKey`, so deleting
  a stale entry will NOT cascade. Re-running indexer with the same key
  restores access.

## 10. Forbidden Patterns

- **Codex MUST NOT generate rewards.** Discovering an entry is metadata
  only — never grants currency, items, or progression. (Reward gating goes
  through Quest/Achievement systems.)
- **Codex MUST NOT bypass visibility checks.** `getDetail` always runs
  `isEntryVisible()` before returning the entry.
- **Codex MUST NOT cache market prices longer than the snapshot refresh
  window.** Price reads always join `MarketPriceSnapshot` live.
