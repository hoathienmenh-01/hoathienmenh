<script setup lang="ts">
/**
 * Phase 28.0 — Admin Event Builder View.
 *
 * Tách khỏi `AdminControlCenterView.vue` (đã 770+ dòng) — view riêng cho
 * Event Builder & Tier-Balanced LiveOps. PR1 minimal: list / detail / status
 * transition / template browse. Editor form đầy đủ (mission, shop, ranking,
 * boss, personal) ở PR sau — dữ liệu vẫn xử lý ở backend qua admin
 * endpoints đã có.
 *
 * 11 tab spec (events, bracket, balance, items, missions, shop, boss,
 * ranking, personal, audit, templates) — PR1 chỉ implement: events,
 * brackets, missions, templates. Còn lại read-only display.
 */
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import {
  adminEventCatalog,
  adminListEventTemplates,
  adminListEvents,
  adminGetEvent,
  adminListBrackets,
  adminListMissions,
  adminListShops,
  adminListRankings,
  adminListBosses,
  adminListItems,
  adminTransitionEvent,
  type EventCatalog,
} from '@/api/eventBuilder';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import AppShell from '@/components/shell/AppShell.vue';
import XTPageEyebrow from '@/components/xianxia/XTPageEyebrow.vue';
import MButton from '@/components/ui/MButton.vue';
import type {
  EventDef,
  EventStatus,
  EventType,
  EventTemplate,
  EventBracketDef,
  EventMissionDef,
  EventShopDef,
  EventBossDef,
  EventRankingDef,
  EventItemDef,
} from '@xuantoi/shared';

type Tab =
  | 'events'
  | 'brackets'
  | 'missions'
  | 'shops'
  | 'bosses'
  | 'rankings'
  | 'items'
  | 'templates';

const tab = ref<Tab>('events');
const tabs: readonly Tab[] = [
  'events',
  'brackets',
  'missions',
  'shops',
  'bosses',
  'rankings',
  'items',
  'templates',
];

const { t } = useI18n();
const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();

const loading = ref(false);
const catalog = ref<EventCatalog | null>(null);
const events = ref<EventDef[]>([]);
const templates = ref<readonly EventTemplate[]>([]);

const filterStatus = ref<EventStatus | ''>('');
const filterType = ref<EventType | ''>('');
const filterEnabled = ref<'' | 'true' | 'false'>('');

const selectedEventKey = ref<string | null>(null);
const selectedEvent = ref<EventDef | null>(null);
const detailBrackets = ref<EventBracketDef[]>([]);
const detailMissions = ref<EventMissionDef[]>([]);
const detailShops = ref<EventShopDef[]>([]);
const detailBosses = ref<EventBossDef[]>([]);
const detailRankings = ref<EventRankingDef[]>([]);
const detailItems = ref<EventItemDef[]>([]);

async function refreshCatalog(): Promise<void> {
  try {
    catalog.value = await adminEventCatalog();
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('adminEvents.errors.catalog', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  }
}

async function refreshEvents(): Promise<void> {
  loading.value = true;
  try {
    events.value = await adminListEvents({
      status: filterStatus.value || undefined,
      eventType: filterType.value || undefined,
      enabled:
        filterEnabled.value === ''
          ? undefined
          : filterEnabled.value === 'true',
    });
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('adminEvents.errors.list', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    loading.value = false;
  }
}

async function refreshTemplates(): Promise<void> {
  loading.value = true;
  try {
    templates.value = await adminListEventTemplates();
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('adminEvents.errors.templates', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    loading.value = false;
  }
}

async function openEvent(key: string): Promise<void> {
  selectedEventKey.value = key;
  loading.value = true;
  try {
    const [ev, br, ms, sh, bo, rk, it] = await Promise.all([
      adminGetEvent(key),
      adminListBrackets(key),
      adminListMissions(key),
      adminListShops(key),
      adminListBosses(key),
      adminListRankings(key),
      adminListItems(key),
    ]);
    selectedEvent.value = ev;
    detailBrackets.value = [...br];
    detailMissions.value = [...ms];
    detailShops.value = [...sh];
    detailBosses.value = [...bo];
    detailRankings.value = [...rk];
    detailItems.value = [...it];
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('adminEvents.errors.detail', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  } finally {
    loading.value = false;
  }
}

function closeEvent(): void {
  selectedEventKey.value = null;
  selectedEvent.value = null;
}

async function transition(key: string, nextStatus: EventStatus): Promise<void> {
  const reason = window.prompt(t('adminEvents.promptReason'), '');
  if (reason === null) return;
  try {
    const updated = await adminTransitionEvent(key, {
      nextStatus,
      reason: reason || undefined,
    });
    selectedEvent.value = updated;
    events.value = events.value.map((e) => (e.key === key ? updated : e));
    toast.push({
      type: 'success',
      text: t('adminEvents.transitionSuccess', { status: nextStatus }),
    });
  } catch (err) {
    toast.push({
      type: 'error',
      text: t('adminEvents.errors.transition', {
        code: extractApiErrorCodeOrDefault(err, 'UNKNOWN'),
      }),
    });
  }
}

const allowedNextStatuses = computed<readonly EventStatus[]>(() => {
  if (!selectedEvent.value) return [];
  const s = selectedEvent.value.status;
  // Mirror server STATUS_TRANSITIONS map.
  const map: Record<EventStatus, readonly EventStatus[]> = {
    DRAFT: ['SCHEDULED', 'CANCELLED'],
    SCHEDULED: ['ACTIVE', 'CANCELLED'],
    ACTIVE: ['PAUSED', 'REWARD_LOCKED', 'ENDED'],
    PAUSED: ['ACTIVE', 'ENDED'],
    REWARD_LOCKED: ['ENDED'],
    ENDED: ['FINALIZED'],
    FINALIZED: ['ARCHIVED'],
    ARCHIVED: [],
    CANCELLED: [],
  };
  return map[s] ?? [];
});

onMounted(async () => {
  await auth.hydrate();
  if (!auth.isAuthenticated) {
    router.replace('/auth');
    return;
  }
  await Promise.all([refreshCatalog(), refreshEvents()]);
});
</script>

<template>
  <AppShell>
    <div class="admin-event-builder">
      <header class="header">
        <XTPageEyebrow label="Sự Đức Là Ngổ" />
        <h1 class="mt-1">{{ t('adminEvents.title') }}</h1>
        <p class="muted">{{ t('adminEvents.subtitle') }}</p>
      </header>

      <nav class="tabs">
        <button
          v-for="x in tabs"
          :key="x"
          :class="['tab', { active: tab === x }]"
          @click="
            tab = x;
            if (x === 'templates') void refreshTemplates();
          "
        >
          {{ t(`adminEvents.tab.${x}`) }}
        </button>
      </nav>

      <!-- EVENTS TAB -->
      <section v-if="tab === 'events'">
        <div class="filters">
          <select v-model="filterStatus" @change="refreshEvents">
            <option value="">
              {{ t('adminEvents.filter.allStatuses') }}
            </option>
            <option
              v-for="s in catalog?.statuses ?? []"
              :key="s"
              :value="s"
            >
              {{ s }}
            </option>
          </select>
          <select v-model="filterType" @change="refreshEvents">
            <option value="">{{ t('adminEvents.filter.allTypes') }}</option>
            <option
              v-for="x in catalog?.types ?? []"
              :key="x"
              :value="x"
            >
              {{ x }}
            </option>
          </select>
          <select v-model="filterEnabled" @change="refreshEvents">
            <option value="">{{ t('adminEvents.filter.anyEnabled') }}</option>
            <option value="true">{{ t('adminEvents.filter.enabled') }}</option>
            <option value="false">
              {{ t('adminEvents.filter.disabled') }}
            </option>
          </select>
        </div>
        <div v-if="loading" class="muted">{{ t('adminEvents.loading') }}</div>
        <div v-else-if="events.length === 0" class="muted">
          {{ t('adminEvents.empty') }}
        </div>
        <table v-else class="table">
          <thead>
            <tr>
              <th>{{ t('adminEvents.table.key') }}</th>
              <th>{{ t('adminEvents.table.name') }}</th>
              <th>{{ t('adminEvents.table.type') }}</th>
              <th>{{ t('adminEvents.table.status') }}</th>
              <th>{{ t('adminEvents.table.bracketMode') }}</th>
              <th>{{ t('adminEvents.table.enabled') }}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in events" :key="e.key">
              <td><code>{{ e.key }}</code></td>
              <td>{{ e.name }}</td>
              <td>{{ e.eventType }}</td>
              <td>
                <span :class="['badge', e.status.toLowerCase()]">
                  {{ e.status }}
                </span>
              </td>
              <td>{{ e.bracketMode }}</td>
              <td>{{ e.enabled ? '✓' : '×' }}</td>
              <td>
                <MButton @click="openEvent(e.key)">
                  {{ t('adminEvents.action.open') }}
                </MButton>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- DETAIL TABS (need selected event) -->
      <section v-else-if="!selectedEvent" class="muted">
        {{ t('adminEvents.selectFirst') }}
      </section>
      <section v-else-if="tab === 'brackets'">
        <h2>{{ t('adminEvents.tab.brackets') }}</h2>
        <ul>
          <li v-for="b in detailBrackets" :key="b.key">
            <strong>{{ b.name }}</strong> ({{ b.key }}) — tier {{ b.bracketTier }}
            <span class="muted small">
              [{{ b.minRealmOrder }} … {{ b.maxRealmOrder }}]
            </span>
          </li>
        </ul>
      </section>
      <section v-else-if="tab === 'missions'">
        <h2>{{ t('adminEvents.tab.missions') }}</h2>
        <ul>
          <li v-for="m in detailMissions" :key="m.key">
            <strong>{{ m.name }}</strong> ({{ m.missionType }}) —
            <span class="muted small">target {{ m.targetValue }}</span>
          </li>
        </ul>
      </section>
      <section v-else-if="tab === 'shops'">
        <h2>{{ t('adminEvents.tab.shops') }}</h2>
        <ul>
          <li v-for="s in detailShops" :key="s.key">
            <strong>{{ s.name }}</strong> — token {{ s.tokenCurrencyKey }}
          </li>
        </ul>
      </section>
      <section v-else-if="tab === 'bosses'">
        <h2>{{ t('adminEvents.tab.bosses') }}</h2>
        <ul>
          <li v-for="b in detailBosses" :key="b.key">
            <strong>{{ b.name }}</strong> ({{ b.bossType }})
          </li>
        </ul>
      </section>
      <section v-else-if="tab === 'rankings'">
        <h2>{{ t('adminEvents.tab.rankings') }}</h2>
        <ul>
          <li v-for="r in detailRankings" :key="r.key">
            <strong>{{ r.key }}</strong> ({{ r.rankingType }})
            <span v-if="r.finalized" class="muted small">[finalized]</span>
          </li>
        </ul>
      </section>
      <section v-else-if="tab === 'items'">
        <h2>{{ t('adminEvents.tab.items') }}</h2>
        <ul>
          <li v-for="i in detailItems" :key="i.key">
            <code>{{ i.key }}</code> — {{ i.itemKind }} (tier {{ i.itemTier }})
          </li>
        </ul>
      </section>

      <!-- TEMPLATES TAB -->
      <section v-else-if="tab === 'templates'">
        <h2>{{ t('adminEvents.tab.templates') }}</h2>
        <div v-if="loading" class="muted">{{ t('adminEvents.loading') }}</div>
        <ul v-else>
          <li v-for="tpl in templates" :key="tpl.templateKey">
            <strong>{{ tpl.name }}</strong> ({{ tpl.templateKey }})
            <p class="muted small">{{ tpl.description }}</p>
          </li>
        </ul>
      </section>

      <!-- DETAIL MODAL -->
      <aside v-if="selectedEvent" class="detail-modal">
        <header>
          <h2>{{ selectedEvent.name }}</h2>
          <button class="close" @click="closeEvent">×</button>
        </header>
        <p class="muted small">
          {{ t('adminEvents.detail.key') }}:
          <code>{{ selectedEvent.key }}</code>
        </p>
        <p>{{ selectedEvent.description }}</p>
        <p>
          <strong>{{ t('adminEvents.detail.status') }}:</strong>
          {{ selectedEvent.status }}
        </p>
        <p>
          <strong>{{ t('adminEvents.detail.bracketMode') }}:</strong>
          {{ selectedEvent.bracketMode }}
        </p>
        <p>
          <strong>{{ t('adminEvents.detail.window') }}:</strong>
          {{ new Date(selectedEvent.startsAt).toLocaleString() }} →
          {{ new Date(selectedEvent.endsAt).toLocaleString() }}
        </p>
        <div class="transition-buttons">
          <MButton
            v-for="next in allowedNextStatuses"
            :key="next"
            @click="transition(selectedEvent.key, next)"
          >
            {{ t('adminEvents.action.transitionTo', { status: next }) }}
          </MButton>
        </div>
      </aside>
    </div>
  </AppShell>
</template>

<style scoped>
.admin-event-builder {
  padding: 1rem;
  max-width: 1200px;
  margin: 0 auto;
}
.header h1 {
  margin: 0 0 0.25rem;
}
.muted {
  color: var(--text-muted, #8a8a8a);
}
.small {
  font-size: 0.875em;
}
.tabs {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  margin: 1rem 0;
}
.tab {
  background: transparent;
  border: 1px solid var(--border, #ccc);
  color: inherit;
  padding: 0.4rem 0.8rem;
  border-radius: 4px;
  cursor: pointer;
}
.tab.active {
  background: var(--accent, #4f46e5);
  color: #fff;
}
.filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.filters select {
  padding: 0.3rem 0.6rem;
  border-radius: 4px;
  border: 1px solid var(--border, #ccc);
  background: var(--surface, #1a1a1a);
  color: inherit;
}
.table {
  width: 100%;
  border-collapse: collapse;
}
.table th,
.table td {
  padding: 0.5rem;
  border-bottom: 1px solid var(--border, #333);
  text-align: left;
}
.badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-size: 0.75em;
  background: #555;
  color: #fff;
}
.badge.active {
  background: #22c55e;
}
.badge.scheduled {
  background: #3b82f6;
}
.badge.paused {
  background: #f59e0b;
}
.detail-modal {
  position: fixed;
  top: 4rem;
  right: 1rem;
  width: 360px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  z-index: 30;
}
.detail-modal header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.close {
  background: transparent;
  border: none;
  font-size: 1.4rem;
  cursor: pointer;
  color: inherit;
}
.transition-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.8rem;
}
</style>
