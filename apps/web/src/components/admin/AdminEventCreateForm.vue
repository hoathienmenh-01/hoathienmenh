<script setup lang="ts">
/**
 * Phase 28.0 PR2 — Admin Event Create/Edit Form.
 *
 * Provides validated create/edit form for LiveOps events. Integrates with
 * existing backend `POST /admin/events` + `POST /admin/events/:key`
 * endpoints (server-authoritative validation via zod).
 *
 * Features:
 *   - Client-side validation (key format, title length, date range).
 *   - Loading + error states.
 *   - Success feedback via toast.
 *   - Audit reason field (required for publish/edit).
 *   - Template quick-fill from catalog.
 */
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToastStore } from '@/stores/toast';
import {
  adminCreateEvent,
  adminUpdateEvent,
  adminValidateEvent,
  type EventUpsertInput,
  type EventCatalog,
} from '@/api/eventBuilder';
import { extractApiErrorCodeOrDefault } from '@/lib/apiError';
import MButton from '@/components/ui/MButton.vue';
import type { EventDef, EventTemplate } from '@xuantoi/shared';

const props = defineProps<{
  catalog: EventCatalog | null;
  templates: readonly EventTemplate[];
  editEvent?: EventDef | null;
}>();

const emit = defineEmits<{
  (e: 'saved', ev: EventDef): void;
  (e: 'cancel'): void;
}>();

const { t } = useI18n();
const toast = useToastStore();

const isEdit = computed(() => !!props.editEvent);

// Form state
const key = ref('');
const name = ref('');
const eventType = ref('');
const bracketMode = ref('REALM_RANGE');
const description = ref('');
const startsAt = ref('');
const endsAt = ref('');
const enabled = ref(true);
const reason = ref('');

// UI state
const submitting = ref(false);
const validating = ref(false);
const validationErrors = ref<string[]>([]);
const submitError = ref<string | null>(null);

// Pre-fill from editEvent
watch(
  () => props.editEvent,
  (ev) => {
    if (ev) {
      key.value = ev.key;
      name.value = ev.name;
      eventType.value = ev.eventType;
      bracketMode.value = ev.bracketMode;
      description.value = ev.description ?? '';
      startsAt.value = ev.startsAt ? new Date(ev.startsAt).toISOString().slice(0, 16) : '';
      endsAt.value = ev.endsAt ? new Date(ev.endsAt).toISOString().slice(0, 16) : '';
      enabled.value = ev.enabled;
    }
  },
  { immediate: true },
);

// Client-side validation
const KEY_RE = /^[a-z][a-z0-9_]{2,63}$/;

const clientErrors = computed<string[]>(() => {
  const errs: string[] = [];
  if (!isEdit.value && !KEY_RE.test(key.value)) {
    errs.push(t('adminEvents.form.errors.keyFormat'));
  }
  if (!name.value.trim() || name.value.length > 120) {
    errs.push(t('adminEvents.form.errors.nameRequired'));
  }
  if (!eventType.value) {
    errs.push(t('adminEvents.form.errors.typeRequired'));
  }
  if (!startsAt.value || !endsAt.value) {
    errs.push(t('adminEvents.form.errors.datesRequired'));
  } else if (new Date(startsAt.value) >= new Date(endsAt.value)) {
    errs.push(t('adminEvents.form.errors.dateRange'));
  }
  if (!reason.value.trim() || reason.value.length < 3) {
    errs.push(t('adminEvents.form.errors.reasonRequired'));
  }
  return errs;
});

const canSubmit = computed(() => clientErrors.value.length === 0 && !submitting.value);

function buildInput(): EventUpsertInput {
  return {
    key: key.value,
    name: name.value.trim(),
    eventType: eventType.value,
    bracketMode: bracketMode.value,
    description: description.value.trim() || undefined,
    startsAt: new Date(startsAt.value).toISOString(),
    endsAt: new Date(endsAt.value).toISOString(),
    enabled: enabled.value,
    reason: reason.value.trim(),
  };
}

async function validate(): Promise<void> {
  if (clientErrors.value.length > 0) {
    validationErrors.value = [...clientErrors.value];
    return;
  }
  validating.value = true;
  validationErrors.value = [];
  try {
    const result = await adminValidateEvent(buildInput());
    if (!result.ok && result.errors.length > 0) {
      validationErrors.value = result.errors.map(
        (e) => `${e.field ?? 'event'}: ${e.code}`,
      );
    } else {
      validationErrors.value = [];
      toast.push({ type: 'success', text: t('adminEvents.form.validateOk') });
    }
  } catch (err) {
    validationErrors.value = [extractApiErrorCodeOrDefault(err, 'UNKNOWN')];
  } finally {
    validating.value = false;
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const input = buildInput();
    let saved: EventDef;
    if (isEdit.value) {
      saved = await adminUpdateEvent(props.editEvent!.key, input);
    } else {
      saved = await adminCreateEvent(input);
    }
    toast.push({
      type: 'success',
      text: isEdit.value
        ? t('adminEvents.form.editSuccess', { key: saved.key })
        : t('adminEvents.form.createSuccess', { key: saved.key }),
    });
    emit('saved', saved);
  } catch (err) {
    submitError.value = extractApiErrorCodeOrDefault(err, 'UNKNOWN');
    toast.push({
      type: 'error',
      text: t('adminEvents.form.submitFailed', { code: submitError.value }),
    });
  } finally {
    submitting.value = false;
  }
}

function applyTemplate(tpl: EventTemplate): void {
  key.value = tpl.templateKey + '_' + Date.now().toString(36);
  name.value = tpl.name;
  eventType.value = tpl.eventType ?? '';
  bracketMode.value = tpl.bracketMode ?? 'REALM_RANGE';
  description.value = tpl.description ?? '';
}
</script>

<template>
  <div class="event-form" data-testid="admin-event-form">
    <header class="form-header">
      <h2>{{ isEdit ? t('adminEvents.form.titleEdit') : t('adminEvents.form.titleCreate') }}</h2>
      <MButton variant="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</MButton>
    </header>

    <!-- Template quick-fill -->
    <div v-if="!isEdit && templates.length > 0" class="template-picker">
      <label class="field-label">{{ t('adminEvents.form.template') }}</label>
      <select @change="(e: Event) => {
        const val = (e.target as HTMLSelectElement).value;
        const tpl = templates.find(t => t.templateKey === val);
        if (tpl) applyTemplate(tpl);
      }">
        <option value="">{{ t('adminEvents.form.noTemplate') }}</option>
        <option v-for="tpl in templates" :key="tpl.templateKey" :value="tpl.templateKey">
          {{ tpl.name }}
        </option>
      </select>
    </div>

    <!-- Key -->
    <div class="field">
      <label class="field-label">{{ t('adminEvents.form.key') }}</label>
      <input
        v-model="key"
        type="text"
        :disabled="isEdit"
        :placeholder="t('adminEvents.form.keyPlaceholder')"
        class="field-input"
        data-testid="event-form-key"
      />
      <p v-if="!isEdit" class="field-hint">{{ t('adminEvents.form.keyHint') }}</p>
    </div>

    <!-- Name -->
    <div class="field">
      <label class="field-label">{{ t('adminEvents.form.name') }}</label>
      <input
        v-model="name"
        type="text"
        :placeholder="t('adminEvents.form.namePlaceholder')"
        class="field-input"
        data-testid="event-form-name"
      />
    </div>

    <!-- Event Type -->
    <div class="field">
      <label class="field-label">{{ t('adminEvents.form.type') }}</label>
      <select v-model="eventType" class="field-input" data-testid="event-form-type">
        <option value="">{{ t('adminEvents.form.selectType') }}</option>
        <option v-for="tp in catalog?.types ?? []" :key="tp" :value="tp">{{ tp }}</option>
      </select>
    </div>

    <!-- Bracket Mode -->
    <div class="field">
      <label class="field-label">{{ t('adminEvents.form.bracketMode') }}</label>
      <select v-model="bracketMode" class="field-input" data-testid="event-form-bracket-mode">
        <option v-for="bm in catalog?.bracketModes ?? ['REALM_RANGE', 'NONE', 'MANUAL']" :key="bm" :value="bm">
          {{ bm }}
        </option>
      </select>
    </div>

    <!-- Description -->
    <div class="field">
      <label class="field-label">{{ t('adminEvents.form.description') }}</label>
      <textarea
        v-model="description"
        rows="3"
        class="field-input"
        :placeholder="t('adminEvents.form.descPlaceholder')"
        data-testid="event-form-desc"
      />
    </div>

    <!-- Date range -->
    <div class="field-row">
      <div class="field">
        <label class="field-label">{{ t('adminEvents.form.startsAt') }}</label>
        <input v-model="startsAt" type="datetime-local" class="field-input" data-testid="event-form-starts" />
      </div>
      <div class="field">
        <label class="field-label">{{ t('adminEvents.form.endsAt') }}</label>
        <input v-model="endsAt" type="datetime-local" class="field-input" data-testid="event-form-ends" />
      </div>
    </div>

    <!-- Enabled -->
    <div class="field">
      <label class="field-label flex items-center gap-2">
        <input v-model="enabled" type="checkbox" data-testid="event-form-enabled" />
        {{ t('adminEvents.form.enabled') }}
      </label>
    </div>

    <!-- Audit reason -->
    <div class="field">
      <label class="field-label">{{ t('adminEvents.form.reason') }}</label>
      <input
        v-model="reason"
        type="text"
        :placeholder="t('adminEvents.form.reasonPlaceholder')"
        class="field-input"
        data-testid="event-form-reason"
      />
      <p class="field-hint">{{ t('adminEvents.form.reasonHint') }}</p>
    </div>

    <!-- Validation errors -->
    <div v-if="validationErrors.length > 0" class="error-list" data-testid="event-form-errors">
      <p v-for="(err, i) in validationErrors" :key="i" class="error-item">{{ err }}</p>
    </div>

    <!-- Submit error -->
    <div v-if="submitError" class="error-list" data-testid="event-form-submit-error">
      <p class="error-item">{{ t('adminEvents.form.submitFailed', { code: submitError }) }}</p>
    </div>

    <!-- Actions -->
    <footer class="form-footer">
      <MButton
        :loading="validating"
        :disabled="clientErrors.length > 0"
        variant="outline"
        data-testid="event-form-validate"
        @click="validate"
      >
        {{ t('adminEvents.form.validateBtn') }}
      </MButton>
      <MButton
        :loading="submitting"
        :disabled="!canSubmit"
        data-testid="event-form-submit"
        @click="submit"
      >
        {{ isEdit ? t('adminEvents.form.save') : t('adminEvents.form.create') }}
      </MButton>
    </footer>
  </div>
</template>

<style scoped>
.event-form {
  background: var(--surface, #1a1a1a);
  border: 1px solid var(--border, #333);
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 640px;
}
.form-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}
.form-header h2 {
  margin: 0;
  font-size: 1.25rem;
}
.field {
  margin-bottom: 0.75rem;
}
.field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}
.field-label {
  display: block;
  font-size: 0.875rem;
  color: var(--text-muted, #aaa);
  margin-bottom: 0.25rem;
}
.field-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  border: 1px solid var(--border, #444);
  background: var(--bg, #111);
  color: inherit;
  font-size: 0.875rem;
}
.field-input:disabled {
  opacity: 0.5;
}
.field-hint {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  margin-top: 0.2rem;
}
.template-picker {
  margin-bottom: 1rem;
  padding: 0.75rem;
  border: 1px dashed var(--border, #444);
  border-radius: 4px;
}
.template-picker select {
  width: 100%;
  padding: 0.4rem;
  border-radius: 4px;
  border: 1px solid var(--border, #444);
  background: var(--bg, #111);
  color: inherit;
  margin-top: 0.25rem;
}
.error-list {
  margin: 0.75rem 0;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
}
.error-item {
  font-size: 0.8rem;
  color: #f87171;
  margin: 0.2rem 0;
}
.form-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
</style>
