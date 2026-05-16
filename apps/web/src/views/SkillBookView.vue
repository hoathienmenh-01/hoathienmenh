<script setup lang="ts">
/**
 * Phase 11.2.C — Skill Book (Pháp Quyển) view.
 *
 * Hiển thị skill character đã học (server trả về qua `GET /character/skill`)
 * + 3 action server-authoritative:
 *   - `equip(skillKey)` — gắn vào loadout (cap 4 ngoài basic_attack).
 *   - `unequip(skillKey)` — gỡ.
 *   - `upgradeMastery(skillKey)` — +1 mastery, server deduct LinhThach qua
 *     `CurrencyService.applyTx({reason:'SKILL_UPGRADE'})`.
 *
 * Server validate ownership + cost + cap. UI chỉ enable/disable button +
 * hiển thị toast theo error code.
 *
 * Filters:
 *   - Tier: all | basic | intermediate | advanced | master | legendary.
 *   - Element: all | kim | moc | thuy | hoa | tho | none (vô hệ).
 *   - Equipped: all | equipped | unequipped.
 *
 * Mỗi skill card kết hợp `SkillView` server + `SkillDef` static catalog
 * (từ `@xuantoi/shared`) để lấy name/description/sect/element/role.
 *
 * KHÔNG đụng schema/seed/runtime — pure FE wire của 4 endpoint Phase 11.2.B.
 * Skill book drop/consume defer Phase 11.2.D (item ledger flow).
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import {
  SKILLS,
  SKILL_TAGS,
  SKILL_TEMPLATES,
  describeSkillElementIdentity,
  getSkillElementIdentity,
  realmByKey,
  skillByKey,
  type ElementKey,
  type SkillDef,
  type SkillTag,
} from '@xuantoi/shared';
import { useAuthStore } from '@/stores/auth';
import { useGameStore } from '@/stores/game';
import { useSkillStore } from '@/stores/skill';
import { useToastStore } from '@/stores/toast';
import type { SkillTier, SkillView } from '@/api/skill';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import ElementBadge from '@/components/ElementBadge.vue';
import SkillTagBadge from '@/components/SkillTagBadge.vue';

type TierFilter = 'all' | SkillTier;
type ElementFilter = 'all' | ElementKey | 'none';
type EquippedFilter = 'all' | 'equipped' | 'unequipped';
type TagFilter = 'all' | SkillTag;

/**
 * Content Scale 2 — Realm filter cho high-realm catalog panel.
 * Realm key tương ứng anchor unlock cho từng tier:
 *   - nhan_tien (order 10) — Nhân Tiên
 *   - huyen_tien (order 13) — Tiên Giới
 *   - thanh_nhan (order 18) — Hỗn Nguyên
 *   - vo_chung (order 25) — Vĩnh Hằng
 *   - dao_quan (order 23) — Special / Đạo Quân
 */
type RealmFilter =
  | 'all'
  | 'nhan_tien'
  | 'huyen_tien'
  | 'thanh_nhan'
  | 'vo_chung'
  | 'dao_quan';

interface SkillRow {
  view: SkillView;
  def: SkillDef;
}

const auth = useAuthStore();
const game = useGameStore();
const skills = useSkillStore();
const toast = useToastStore();
const router = useRouter();
const { t } = useI18n();

const tierFilter = ref<TierFilter>('all');
const elementFilter = ref<ElementFilter>('all');
const equippedFilter = ref<EquippedFilter>('all');
const tagFilter = ref<TagFilter>('all');

/** Realm filter cho high-realm catalog panel (Content Scale 2). */
const catalogRealmFilter = ref<RealmFilter>('all');
/** Element filter cho high-realm catalog panel. */
const catalogElementFilter = ref<ElementFilter>('all');

/**
 * Phase 14.2.C — Convenience: list all skill tags for filter dropdown.
 * Re-export from `@xuantoi/shared` (`SKILL_TAGS`) — keep FE in sync với
 * shared catalog.
 */
const tagOptions: readonly SkillTag[] = SKILL_TAGS;

const rows = computed<SkillRow[]>(() => {
  return skills.learned
    .map((view) => {
      const def = skillByKey(view.skillKey);
      return def ? { view, def } : null;
    })
    .filter((r): r is SkillRow => r !== null);
});

const filtered = computed<SkillRow[]>(() => {
  return rows.value.filter((r) => {
    if (tierFilter.value !== 'all' && r.view.tier !== tierFilter.value) {
      return false;
    }
    if (elementFilter.value !== 'all') {
      if (elementFilter.value === 'none') {
        if (r.def.element != null) return false;
      } else if (r.def.element !== elementFilter.value) {
        return false;
      }
    }
    if (equippedFilter.value === 'equipped' && !r.view.isEquipped) return false;
    if (equippedFilter.value === 'unequipped' && r.view.isEquipped) return false;
    if (tagFilter.value !== 'all') {
      const tags = r.def.tags ?? [];
      if (!tags.includes(tagFilter.value)) return false;
    }
    return true;
  });
});

/**
 * Phase 14.2.C — Element identity tooltip text. Render khi skill có
 * element non-null. Gồm name + theme + playstyle, dùng ở `<header>` ngay
 * cạnh ElementBadge.
 */
function elementIdentityTooltip(element: ElementKey | null): string {
  if (element === null) return t('skillBook.elementIdentity.neutral');
  const id = getSkillElementIdentity(element);
  return `${describeSkillElementIdentity(element)} — ${id.playstyle}`;
}

const counts = computed(() => ({
  total: rows.value.length,
  filtered: filtered.value.length,
  catalog: SKILLS.length,
  equipped: skills.equippedCount,
  maxEquipped: skills.maxEquipped,
}));

/**
 * Content Scale 2 — High-realm catalog rows.
 *
 * Liệt kê toàn bộ skill có realm unlock requirement order >= 10
 * (Nhân Tiên trở lên). Server-authoritative learn — UI chỉ hiển thị
 * locked/unlocked state dựa vào character realm hiện tại để player
 * xem trước power fantasy late-game.
 *
 * Ổn định khi character chưa load (realmKey null) — coi tất cả
 * locked. Không crash.
 */
interface HighRealmCatalogRow {
  skillKey: string;
  def: SkillDef;
  reqRealmKey: string;
  reqRealmName: string;
  reqRealmOrder: number;
  isUnlocked: boolean;
  isLearned: boolean;
}

const HIGH_REALM_MIN_ORDER = 10;

const highRealmCatalog = computed<HighRealmCatalogRow[]>(() => {
  const charRealmKey = game.character?.realmKey ?? null;
  const charRealm = charRealmKey ? realmByKey(charRealmKey) : null;
  const charOrder = charRealm?.order ?? -1;
  const learnedSet = new Set(skills.learned.map((s) => s.skillKey));

  const list: HighRealmCatalogRow[] = [];
  for (const tpl of SKILL_TEMPLATES) {
    const realmReq = tpl.unlocks.find((u) => u.kind === 'realm');
    if (!realmReq) continue;
    const reqRealm = realmByKey(realmReq.ref);
    if (!reqRealm) continue;
    if (reqRealm.order < HIGH_REALM_MIN_ORDER) continue;
    const def = skillByKey(tpl.key);
    if (!def) continue;
    list.push({
      skillKey: tpl.key,
      def,
      reqRealmKey: reqRealm.key,
      reqRealmName: reqRealm.name,
      reqRealmOrder: reqRealm.order,
      isUnlocked: charOrder >= reqRealm.order,
      isLearned: learnedSet.has(tpl.key),
    });
  }
  list.sort((a, b) => {
    if (a.reqRealmOrder !== b.reqRealmOrder) {
      return a.reqRealmOrder - b.reqRealmOrder;
    }
    return a.def.name.localeCompare(b.def.name, 'vi');
  });
  return list;
});

const filteredCatalog = computed<HighRealmCatalogRow[]>(() => {
  return highRealmCatalog.value.filter((r) => {
    if (
      catalogRealmFilter.value !== 'all' &&
      r.reqRealmKey !== catalogRealmFilter.value
    ) {
      return false;
    }
    if (catalogElementFilter.value !== 'all') {
      if (catalogElementFilter.value === 'none') {
        if (r.def.element != null) return false;
      } else if (r.def.element !== catalogElementFilter.value) {
        return false;
      }
    }
    return true;
  });
});

const catalogCounts = computed(() => ({
  total: highRealmCatalog.value.length,
  filtered: filteredCatalog.value.length,
  unlocked: highRealmCatalog.value.filter((r) => r.isUnlocked).length,
  learned: highRealmCatalog.value.filter((r) => r.isLearned).length,
}));

function tierClass(tier: SkillTier): string {
  switch (tier) {
    case 'basic':
      return 'bg-stone-700/40 text-stone-200 border-stone-500/40';
    case 'intermediate':
      return 'bg-sky-700/40 text-sky-200 border-sky-500/40';
    case 'advanced':
      return 'bg-violet-700/40 text-violet-200 border-violet-500/40';
    case 'master':
      return 'bg-amber-700/40 text-amber-200 border-amber-500/40';
    case 'legendary':
      return 'bg-rose-700/40 text-rose-200 border-rose-500/40';
    default:
      return 'bg-ink-700/40 text-ink-200 border-ink-300/30';
  }
}

function isInFlight(skillKey: string): boolean {
  return skills.isInFlight(skillKey);
}

function equipDisabled(row: SkillRow): boolean {
  // basic_attack always equipped — never disable; server treats it as exempt.
  return row.view.isEquipped || isInFlight(row.view.skillKey);
}

function unequipDisabled(row: SkillRow): boolean {
  return !row.view.isEquipped || isInFlight(row.view.skillKey);
}

function upgradeDisabled(row: SkillRow): boolean {
  if (isInFlight(row.view.skillKey)) return true;
  return row.view.masteryLevel >= row.view.maxMastery;
}

function upgradeLabel(row: SkillRow): string {
  if (isInFlight(row.view.skillKey)) {
    return t('skillBook.button.upgrading');
  }
  if (row.view.masteryLevel >= row.view.maxMastery) {
    return t('skillBook.button.upgradeMax');
  }
  if (row.view.nextLevelLinhThachCost != null) {
    return t('skillBook.button.upgrade', {
      cost: row.view.nextLevelLinhThachCost,
    });
  }
  return t('skillBook.button.upgradeUnknown');
}

function pushErrorToast(code: string, fallbackKey: string): void {
  if (code === 'IN_FLIGHT') return;
  const key = `skillBook.errors.${code}`;
  const text = t(key);
  toast.push({
    type: 'error',
    text: text === key ? t(fallbackKey) : text,
  });
}

async function onEquip(row: SkillRow): Promise<void> {
  if (equipDisabled(row)) return;
  const code = await skills.equip(row.view.skillKey);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('skillBook.equip.success', { name: row.def.name }),
    });
  } else {
    pushErrorToast(code, 'skillBook.errors.UNKNOWN');
  }
}

async function onUnequip(row: SkillRow): Promise<void> {
  if (unequipDisabled(row)) return;
  const code = await skills.unequip(row.view.skillKey);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('skillBook.unequip.success', { name: row.def.name }),
    });
  } else {
    pushErrorToast(code, 'skillBook.errors.UNKNOWN');
  }
}

async function onUpgrade(row: SkillRow): Promise<void> {
  if (upgradeDisabled(row)) return;
  const code = await skills.upgradeMastery(row.view.skillKey);
  if (code === null) {
    toast.push({
      type: 'success',
      text: t('skillBook.upgrade.success', { name: row.def.name }),
    });
  } else {
    pushErrorToast(code, 'skillBook.errors.UNKNOWN');
  }
}

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await game.fetchState().catch(() => null);
  game.bindSocket();
  await skills.fetchState().catch(() => null);
});
</script>

<template>
  <AppShell>
    <div class="max-w-5xl mx-auto space-y-4">
      <header class="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <XTPageEyebrow label="Yêu Thuật Bích Bản" />
          <h1 class="text-2xl tracking-widest font-bold mt-1">{{ t('skillBook.title') }}</h1>
          <p class="text-xs text-ink-300 mt-1">
            {{ t('skillBook.subtitle') }}
          </p>
        </div>
        <div class="text-xs text-ink-300" data-testid="skill-book-equipped-count">
          {{
            t('skillBook.equippedSummary', {
              equipped: counts.equipped,
              max: counts.maxEquipped,
            })
          }}
        </div>
      </header>

      <section class="flex flex-wrap gap-3 items-center text-xs">
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.tier') }}</label>
          <select
            v-model="tierFilter"
            data-testid="skill-book-filter-tier"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option value="basic">{{ t('skillBook.tier.basic') }}</option>
            <option value="intermediate">{{ t('skillBook.tier.intermediate') }}</option>
            <option value="advanced">{{ t('skillBook.tier.advanced') }}</option>
            <option value="master">{{ t('skillBook.tier.master') }}</option>
            <option value="legendary">{{ t('skillBook.tier.legendary') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.element') }}</label>
          <select
            v-model="elementFilter"
            data-testid="skill-book-filter-element"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option value="kim">{{ t('skillBook.element.kim') }}</option>
            <option value="moc">{{ t('skillBook.element.moc') }}</option>
            <option value="thuy">{{ t('skillBook.element.thuy') }}</option>
            <option value="hoa">{{ t('skillBook.element.hoa') }}</option>
            <option value="tho">{{ t('skillBook.element.tho') }}</option>
            <option value="none">{{ t('skillBook.element.none') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.equipped') }}</label>
          <select
            v-model="equippedFilter"
            data-testid="skill-book-filter-equipped"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option value="equipped">{{ t('skillBook.equipFilter.equipped') }}</option>
            <option value="unequipped">{{ t('skillBook.equipFilter.unequipped') }}</option>
          </select>
        </div>
        <div class="flex items-center gap-2">
          <label class="text-ink-300">{{ t('skillBook.filter.tag') }}</label>
          <select
            v-model="tagFilter"
            data-testid="skill-book-filter-tag"
            class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
          >
            <option value="all">{{ t('skillBook.filter.all') }}</option>
            <option v-for="tg in tagOptions" :key="tg" :value="tg">
              {{ t(`skillTagBadge.tag.${tg}`) }}
            </option>
          </select>
        </div>
        <span class="ml-auto text-ink-300" data-testid="skill-book-count">
          {{
            t('skillBook.filter.shown', {
              shown: counts.filtered,
              total: counts.total,
              catalog: counts.catalog,
            })
          }}
        </span>
      </section>

      <section
        v-if="!skills.loaded"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="skill-book-loading"
      >
        {{ t('skillBook.loading') }}
      </section>

      <section
        v-else-if="counts.filtered === 0"
        class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
        data-testid="skill-book-empty"
      >
        {{ t('skillBook.empty') }}
      </section>

      <section
        v-else
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
        data-testid="skill-book-list"
      >
        <article
          v-for="row in filtered"
          :key="row.view.skillKey"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-3 space-y-2"
          :data-testid="`skill-book-card-${row.view.skillKey}`"
        >
          <header class="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 class="text-amber-200 text-base font-semibold">{{ row.def.name }}</h2>
            <div class="flex items-center gap-1">
              <span
                :class="['text-[10px] px-1.5 py-0.5 rounded border', tierClass(row.view.tier)]"
                :data-testid="`skill-book-tier-${row.view.skillKey}`"
              >
                {{ t(`skillBook.tier.${row.view.tier}`) }}
              </span>
              <span
                :title="elementIdentityTooltip(row.def.element ?? null)"
                :data-testid="`skill-book-element-tooltip-${row.view.skillKey}`"
              >
                <ElementBadge
                  :element="row.def.element ?? null"
                  :show-neutral="true"
                  size="sm"
                  :data-testid="`skill-book-element-${row.view.skillKey}`"
                />
              </span>
              <SkillTagBadge
                v-for="tg in row.def.tags ?? []"
                :key="tg"
                :tag="tg"
                size="sm"
                :data-testid="`skill-book-tag-${row.view.skillKey}-${tg.toLowerCase()}`"
              />
              <span
                v-if="row.view.isEquipped"
                class="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
                :data-testid="`skill-book-equipped-badge-${row.view.skillKey}`"
              >
                {{ t('skillBook.badge.equipped') }}
              </span>
            </div>
          </header>

          <p class="text-xs text-ink-300">{{ row.def.description }}</p>

          <p
            v-if="row.def.element"
            class="text-[11px] text-ink-300 italic"
            :data-testid="`skill-book-identity-${row.view.skillKey}`"
          >
            {{ describeSkillElementIdentity(row.def.element) }}
          </p>

          <div class="text-xs space-y-1">
            <div
              class="flex items-center gap-1"
              :data-testid="`skill-book-mastery-${row.view.skillKey}`"
            >
              <span class="text-ink-300">{{ t('skillBook.field.mastery') }}:</span>
              <span class="text-amber-200">
                {{ row.view.masteryLevel }} / {{ row.view.maxMastery }}
              </span>
            </div>
            <div
              v-if="row.view.effective"
              class="flex flex-wrap gap-x-3"
              :data-testid="`skill-book-effective-${row.view.skillKey}`"
            >
              <span>
                <span class="text-ink-300">{{ t('skillBook.field.atkScale') }}</span>
                <span class="text-amber-200 ml-1">×{{ row.view.effective.atkScale.toFixed(2) }}</span>
              </span>
              <span>
                <span class="text-ink-300">{{ t('skillBook.field.mpCost') }}</span>
                <span class="text-sky-200 ml-1">{{ row.view.effective.mpCost }}</span>
              </span>
              <span v-if="row.view.effective.cooldownTurns > 0">
                <span class="text-ink-300">{{ t('skillBook.field.cooldown') }}</span>
                <span class="text-rose-200 ml-1">{{ row.view.effective.cooldownTurns }}</span>
              </span>
            </div>
            <div>
              <span class="text-ink-300">{{ t('skillBook.field.source') }}:</span>
              <span
                class="text-ink-100 ml-1"
                :data-testid="`skill-book-source-${row.view.skillKey}`"
              >
                {{ row.view.source }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2 mt-1">
            <button
              v-if="!row.view.isEquipped"
              type="button"
              :disabled="equipDisabled(row)"
              :data-testid="`skill-book-equip-${row.view.skillKey}`"
              class="flex-1 min-w-[120px] px-3 py-1.5 text-sm rounded bg-amber-700 text-amber-50 hover:bg-amber-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              @click="onEquip(row)"
            >
              {{ isInFlight(row.view.skillKey) ? t('skillBook.button.equipping') : t('skillBook.button.equip') }}
            </button>
            <button
              v-else
              type="button"
              :disabled="unequipDisabled(row)"
              :data-testid="`skill-book-unequip-${row.view.skillKey}`"
              class="flex-1 min-w-[120px] px-3 py-1.5 text-sm rounded bg-ink-700 text-ink-100 hover:bg-ink-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              @click="onUnequip(row)"
            >
              {{ isInFlight(row.view.skillKey) ? t('skillBook.button.unequipping') : t('skillBook.button.unequip') }}
            </button>
            <button
              type="button"
              :disabled="upgradeDisabled(row)"
              :data-testid="`skill-book-upgrade-${row.view.skillKey}`"
              class="flex-1 min-w-[140px] px-3 py-1.5 text-sm rounded bg-violet-700 text-violet-50 hover:bg-violet-600 disabled:bg-ink-700/40 disabled:text-ink-300 disabled:cursor-not-allowed"
              @click="onUpgrade(row)"
            >
              {{ upgradeLabel(row) }}
            </button>
          </div>
        </article>
      </section>

      <!-- Content Scale 2 — High-Realm Catalog panel -->
      <section class="mt-8 space-y-3" data-testid="skill-book-high-realm-section">
        <header class="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h2 class="text-xl tracking-widest font-bold text-amber-200">
              {{ t('skillBook.highRealm.title') }}
            </h2>
            <p class="text-xs text-ink-300 mt-1">
              {{ t('skillBook.highRealm.subtitle') }}
            </p>
          </div>
          <div class="text-xs text-ink-300" data-testid="skill-book-high-realm-count">
            {{
              t('skillBook.highRealm.summary', {
                shown: catalogCounts.filtered,
                total: catalogCounts.total,
                unlocked: catalogCounts.unlocked,
                learned: catalogCounts.learned,
              })
            }}
          </div>
        </header>

        <div class="flex flex-wrap gap-3 items-center text-xs">
          <div class="flex items-center gap-2">
            <label class="text-ink-300">{{ t('skillBook.highRealm.filter.realm') }}</label>
            <select
              v-model="catalogRealmFilter"
              data-testid="skill-book-high-realm-filter-realm"
              class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
            >
              <option value="all">{{ t('skillBook.filter.all') }}</option>
              <option value="nhan_tien">{{ t('skillBook.highRealm.realm.nhan_tien') }}</option>
              <option value="huyen_tien">{{ t('skillBook.highRealm.realm.huyen_tien') }}</option>
              <option value="thanh_nhan">{{ t('skillBook.highRealm.realm.thanh_nhan') }}</option>
              <option value="vo_chung">{{ t('skillBook.highRealm.realm.vo_chung') }}</option>
              <option value="dao_quan">{{ t('skillBook.highRealm.realm.dao_quan') }}</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <label class="text-ink-300">{{ t('skillBook.filter.element') }}</label>
            <select
              v-model="catalogElementFilter"
              data-testid="skill-book-high-realm-filter-element"
              class="bg-ink-900 border border-ink-300/30 rounded px-2 py-1 text-ink-100"
            >
              <option value="all">{{ t('skillBook.filter.all') }}</option>
              <option value="kim">{{ t('skillBook.element.kim') }}</option>
              <option value="moc">{{ t('skillBook.element.moc') }}</option>
              <option value="thuy">{{ t('skillBook.element.thuy') }}</option>
              <option value="hoa">{{ t('skillBook.element.hoa') }}</option>
              <option value="tho">{{ t('skillBook.element.tho') }}</option>
              <option value="none">{{ t('skillBook.element.none') }}</option>
            </select>
          </div>
        </div>

        <div
          v-if="filteredCatalog.length === 0"
          class="bg-ink-700/30 border border-ink-300/20 rounded p-6 text-center text-ink-300"
          data-testid="skill-book-high-realm-empty"
        >
          {{ t('skillBook.highRealm.empty') }}
        </div>

        <div
          v-else
          class="grid grid-cols-1 md:grid-cols-2 gap-3"
          data-testid="skill-book-high-realm-list"
        >
          <article
            v-for="row in filteredCatalog"
            :key="row.skillKey"
            :class="[
              'border rounded p-3 space-y-2',
              row.isLearned
                ? 'bg-emerald-700/10 border-emerald-500/40'
                : row.isUnlocked
                  ? 'bg-amber-700/10 border-amber-500/40'
                  : 'bg-ink-700/30 border-ink-300/20 opacity-80',
            ]"
            :data-testid="`skill-book-high-realm-card-${row.skillKey}`"
          >
            <header class="flex items-baseline justify-between gap-2 flex-wrap">
              <h3 class="text-amber-200 text-base font-semibold">{{ row.def.name }}</h3>
              <div class="flex items-center gap-1">
                <span
                  :title="elementIdentityTooltip(row.def.element ?? null)"
                >
                  <ElementBadge
                    :element="row.def.element ?? null"
                    :show-neutral="true"
                    size="sm"
                    :data-testid="`skill-book-high-realm-element-${row.skillKey}`"
                  />
                </span>
                <SkillTagBadge
                  v-for="tg in row.def.tags ?? []"
                  :key="tg"
                  :tag="tg"
                  size="sm"
                  :data-testid="`skill-book-high-realm-tag-${row.skillKey}-${tg.toLowerCase()}`"
                />
                <span
                  v-if="row.isLearned"
                  class="text-[10px] px-1.5 py-0.5 rounded border bg-emerald-700/40 text-emerald-200 border-emerald-500/40"
                  :data-testid="`skill-book-high-realm-learned-${row.skillKey}`"
                >
                  {{ t('skillBook.highRealm.badge.learned') }}
                </span>
                <span
                  v-else-if="row.isUnlocked"
                  class="text-[10px] px-1.5 py-0.5 rounded border bg-amber-700/40 text-amber-200 border-amber-500/40"
                  :data-testid="`skill-book-high-realm-unlocked-${row.skillKey}`"
                >
                  {{ t('skillBook.highRealm.badge.unlocked') }}
                </span>
                <span
                  v-else
                  class="text-[10px] px-1.5 py-0.5 rounded border bg-ink-800/60 text-ink-300 border-ink-300/40"
                  :title="t('skillBook.highRealm.lockTooltip', { realm: row.reqRealmName })"
                  :data-testid="`skill-book-high-realm-locked-${row.skillKey}`"
                >
                  {{ t('skillBook.highRealm.badge.locked') }}
                </span>
              </div>
            </header>

            <p class="text-xs text-ink-300">{{ row.def.description }}</p>

            <div class="text-xs flex flex-wrap gap-x-3 gap-y-1">
              <span :data-testid="`skill-book-high-realm-realm-${row.skillKey}`">
                <span class="text-ink-300">{{ t('skillBook.highRealm.field.realm') }}:</span>
                <span class="text-amber-200 ml-1">{{ row.reqRealmName }}</span>
              </span>
              <span>
                <span class="text-ink-300">{{ t('skillBook.field.atkScale') }}</span>
                <span class="text-amber-200 ml-1">×{{ row.def.atkScale.toFixed(2) }}</span>
              </span>
              <span>
                <span class="text-ink-300">{{ t('skillBook.field.mpCost') }}</span>
                <span class="text-sky-200 ml-1">{{ row.def.mpCost }}</span>
              </span>
              <span v-if="row.def.cooldownTurns && row.def.cooldownTurns > 0">
                <span class="text-ink-300">{{ t('skillBook.field.cooldown') }}</span>
                <span class="text-rose-200 ml-1">{{ row.def.cooldownTurns }}</span>
              </span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </AppShell>
</template>
