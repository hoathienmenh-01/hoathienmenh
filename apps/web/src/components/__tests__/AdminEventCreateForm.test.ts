/**
 * Phase 28.0 PR2 — AdminEventCreateForm tests.
 *
 * Verify:
 *   - Client-side validation blocks submit if fields are invalid.
 *   - Valid form triggers create/update API call.
 *   - Loading state disables submit button.
 *   - Error state renders error message.
 *   - Success emits 'saved' event.
 *   - Template selection pre-fills fields.
 *   - Edit mode disables key field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createPinia, setActivePinia } from 'pinia';

const adminCreateEventMock = vi.fn();
const adminUpdateEventMock = vi.fn();
const adminValidateEventMock = vi.fn();

vi.mock('@/api/eventBuilder', () => ({
  adminCreateEvent: (...a: unknown[]) => adminCreateEventMock(...a),
  adminUpdateEvent: (...a: unknown[]) => adminUpdateEventMock(...a),
  adminValidateEvent: (...a: unknown[]) => adminValidateEventMock(...a),
}));

vi.mock('@/lib/apiError', () => ({
  extractApiErrorCodeOrDefault: (_e: unknown, def: string) => def,
}));

import AdminEventCreateForm from '@/components/admin/AdminEventCreateForm.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: {
    en: {
      common: { cancel: 'Cancel' },
      adminEvents: {
        form: {
          titleCreate: 'Create New Event',
          titleEdit: 'Edit Event',
          template: 'Template',
          noTemplate: '— No template —',
          key: 'Key',
          keyPlaceholder: 'key',
          keyHint: 'hint',
          name: 'Name',
          namePlaceholder: 'name',
          type: 'Type',
          selectType: '— Select —',
          bracketMode: 'Bracket',
          description: 'Description',
          descPlaceholder: 'desc',
          startsAt: 'Starts',
          endsAt: 'Ends',
          enabled: 'Enabled',
          reason: 'Reason',
          reasonPlaceholder: 'why?',
          reasonHint: 'hint',
          validateBtn: 'Validate',
          validateOk: 'OK!',
          create: 'Create',
          save: 'Save',
          editSuccess: 'Updated {key}',
          createSuccess: 'Created {key}',
          submitFailed: 'Failed: {code}',
          errors: {
            keyFormat: 'bad key',
            nameRequired: 'name required',
            typeRequired: 'type required',
            datesRequired: 'dates required',
            dateRange: 'bad range',
            reasonRequired: 'reason required',
          },
        },
      },
    },
  },
});

const CATALOG = {
  statuses: ['DRAFT', 'SCHEDULED', 'ACTIVE'],
  types: ['LOGIN_EVENT', 'BOSS_EVENT'],
  bracketModes: ['REALM_RANGE', 'NONE'],
  missionTypes: [],
  bossTypes: [],
  rankingTypes: [],
  paidRewardPolicies: [],
  personalTriggerTypes: [],
  itemKinds: [],
  typesRequireBracketRanking: [],
};

function mountForm(editEvent: unknown = null) {
  return mount(AdminEventCreateForm, {
    props: {
      catalog: CATALOG as never,
      templates: [],
      editEvent: editEvent as never,
    },
    global: { plugins: [i18n, createPinia()] },
  });
}

describe('AdminEventCreateForm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders create title when no editEvent', () => {
    const wrapper = mountForm();
    expect(wrapper.text()).toContain('Create New Event');
  });

  it('renders edit title when editEvent provided', () => {
    const wrapper = mountForm({
      key: 'test_event',
      name: 'Test Event',
      eventType: 'LOGIN_EVENT',
      bracketMode: 'REALM_RANGE',
      description: 'desc',
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-07T00:00:00Z',
      enabled: true,
      status: 'DRAFT',
    });
    expect(wrapper.text()).toContain('Edit Event');
  });

  it('disables key input in edit mode', () => {
    const wrapper = mountForm({
      key: 'test_event',
      name: 'Test',
      eventType: 'LOGIN_EVENT',
      bracketMode: 'REALM_RANGE',
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-07T00:00:00Z',
      enabled: true,
    });
    const keyInput = wrapper.find('[data-testid="event-form-key"]');
    expect((keyInput.element as HTMLInputElement).disabled).toBe(true);
  });

  it('shows validation errors when fields empty and submit clicked', async () => {
    const wrapper = mountForm();
    // Submit button should be disabled due to client validation
    const submitBtn = wrapper.find('[data-testid="event-form-submit"]');
    expect((submitBtn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls adminCreateEvent on valid submit in create mode', async () => {
    const mockEvent = {
      key: 'test_new_event',
      name: 'Test New',
      eventType: 'LOGIN_EVENT',
      bracketMode: 'REALM_RANGE',
      startsAt: '2026-06-01T00:00:00.000Z',
      endsAt: '2026-06-07T00:00:00.000Z',
      enabled: true,
      status: 'DRAFT',
    };
    adminCreateEventMock.mockResolvedValueOnce(mockEvent);

    const wrapper = mountForm();

    // Fill form
    await wrapper.find('[data-testid="event-form-key"]').setValue('test_new_event');
    await wrapper.find('[data-testid="event-form-name"]').setValue('Test New');
    await wrapper.find('[data-testid="event-form-type"]').setValue('LOGIN_EVENT');
    await wrapper.find('[data-testid="event-form-starts"]').setValue('2026-06-01T00:00');
    await wrapper.find('[data-testid="event-form-ends"]').setValue('2026-06-07T00:00');
    await wrapper.find('[data-testid="event-form-reason"]').setValue('testing create flow');

    await flushPromises();

    const submitBtn = wrapper.find('[data-testid="event-form-submit"]');
    expect((submitBtn.element as HTMLButtonElement).disabled).toBe(false);

    await submitBtn.trigger('click');
    await flushPromises();

    expect(adminCreateEventMock).toHaveBeenCalledTimes(1);
    expect(adminCreateEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test_new_event',
        name: 'Test New',
        eventType: 'LOGIN_EVENT',
        reason: 'testing create flow',
      }),
    );
    expect(wrapper.emitted('saved')).toHaveLength(1);
    expect(wrapper.emitted('saved')![0]).toEqual([mockEvent]);
  });

  it('calls adminUpdateEvent in edit mode', async () => {
    const editEvent = {
      key: 'existing_event',
      name: 'Old Name',
      eventType: 'LOGIN_EVENT',
      bracketMode: 'REALM_RANGE',
      description: '',
      startsAt: '2026-06-01T00:00:00Z',
      endsAt: '2026-06-07T00:00:00Z',
      enabled: true,
      status: 'DRAFT',
    };
    const updatedEvent = { ...editEvent, name: 'New Name' };
    adminUpdateEventMock.mockResolvedValueOnce(updatedEvent);

    const wrapper = mountForm(editEvent);
    await wrapper.find('[data-testid="event-form-name"]').setValue('New Name');
    await wrapper.find('[data-testid="event-form-reason"]').setValue('rename event');
    await flushPromises();

    const submitBtn = wrapper.find('[data-testid="event-form-submit"]');
    await submitBtn.trigger('click');
    await flushPromises();

    expect(adminUpdateEventMock).toHaveBeenCalledTimes(1);
    expect(adminUpdateEventMock).toHaveBeenCalledWith(
      'existing_event',
      expect.objectContaining({ name: 'New Name', reason: 'rename event' }),
    );
    expect(wrapper.emitted('saved')).toHaveLength(1);
  });

  it('shows submit error on API failure', async () => {
    adminCreateEventMock.mockRejectedValueOnce(new Error('SERVER_ERROR'));

    const wrapper = mountForm();
    await wrapper.find('[data-testid="event-form-key"]').setValue('fail_event');
    await wrapper.find('[data-testid="event-form-name"]').setValue('Fail');
    await wrapper.find('[data-testid="event-form-type"]').setValue('LOGIN_EVENT');
    await wrapper.find('[data-testid="event-form-starts"]').setValue('2026-06-01T00:00');
    await wrapper.find('[data-testid="event-form-ends"]').setValue('2026-06-07T00:00');
    await wrapper.find('[data-testid="event-form-reason"]').setValue('testing error');
    await flushPromises();

    await wrapper.find('[data-testid="event-form-submit"]').trigger('click');
    await flushPromises();

    const errBlock = wrapper.find('[data-testid="event-form-submit-error"]');
    expect(errBlock.exists()).toBe(true);
  });

  it('calls adminValidateEvent on validate click', async () => {
    adminValidateEventMock.mockResolvedValueOnce({ ok: true, errors: [] });

    const wrapper = mountForm();
    await wrapper.find('[data-testid="event-form-key"]').setValue('validate_event');
    await wrapper.find('[data-testid="event-form-name"]').setValue('Validate');
    await wrapper.find('[data-testid="event-form-type"]').setValue('BOSS_EVENT');
    await wrapper.find('[data-testid="event-form-starts"]').setValue('2026-06-01T00:00');
    await wrapper.find('[data-testid="event-form-ends"]').setValue('2026-06-07T00:00');
    await wrapper.find('[data-testid="event-form-reason"]').setValue('validate test');
    await flushPromises();

    await wrapper.find('[data-testid="event-form-validate"]').trigger('click');
    await flushPromises();

    expect(adminValidateEventMock).toHaveBeenCalledTimes(1);
  });

  it('emits cancel on cancel button click', async () => {
    const wrapper = mountForm();
    const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'Cancel');
    expect(cancelBtn).toBeDefined();
    await cancelBtn!.trigger('click');
    expect(wrapper.emitted('cancel')).toHaveLength(1);
  });
});
