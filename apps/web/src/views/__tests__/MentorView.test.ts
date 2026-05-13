import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { MentorProfileRow, MentorRelationRow } from '@/api/mentor';

/**
 * MentorView smoke tests (Phase 31.0 PR5): render student-only / mentor /
 * pending-list states, dispatch register / request / accept.
 */

const getProfileMock = vi.fn();
const registerMock = vi.fn();
const sendRequestMock = vi.fn();
const respondMock = vi.fn();
const listStudentsMock = vi.fn();
const getStudentCtxMock = vi.fn();

vi.mock('@/api/mentor', () => ({
  getMentorProfile: (...a: unknown[]) => getProfileMock(...a),
  registerMentor: (...a: unknown[]) => registerMock(...a),
  sendMentorRequest: (...a: unknown[]) => sendRequestMock(...a),
  respondMentorRequest: (...a: unknown[]) => respondMock(...a),
  listMentorStudents: (...a: unknown[]) => listStudentsMock(...a),
  getStudentMentorContext: (...a: unknown[]) => getStudentCtxMock(...a),
}));

const routerReplaceMock = vi.fn();
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: routerReplaceMock }),
}));

const toastPushMock = vi.fn();
vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

const authState = {
  isAuthenticated: true,
  hydrate: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => authState,
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

vi.mock('@/components/ui/MButton.vue', () => ({
  default: {
    name: 'MButtonStub',
    template: '<button v-bind="$attrs"><slot /></button>',
  },
}));

import MentorViewComponent from '@/views/MentorView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  missingFallbackWarn: false,
  messages: {
    vi: {
      common: { accept: 'OK', decline: 'KHÔNG', loading: 'Đang xử lý…' },
      mentor: {
        title: 'Sư Đồ',
        subtitle: 'Sub',
        registerToast: 'Đã đăng ký',
        requestSent: 'Đã gửi yêu cầu',
        acceptedToast: 'Đã chấp nhận',
        declinedToast: 'Đã từ chối',
        profile: {
          title: 'Hồ sơ',
          notRegistered: 'Chưa đăng ký',
          tier: 'Tier {tier}',
          studentCount: 'Đệ tử: {count}',
          intro: 'Giới thiệu',
          introPlaceholder: 'placeholder',
          accepting: 'Tiếp nhận',
          register: 'Đăng ký',
          update: 'Cập nhật',
        },
        students: {
          title: 'Đồ đệ',
          empty: 'Empty',
          pending: 'Pending',
          noPending: 'NoPending',
        },
        student: {
          title: 'Tìm sư phụ',
          current: 'Sư phụ: {name}',
          noMentor: 'Chưa có sư phụ',
          mentorIdLabel: 'ID',
          messageLabel: 'Msg',
          send: 'Gửi',
          pendingTitle: 'Pending out',
          noPending: 'NoOut',
        },
        error: { UNKNOWN: 'Lỗi' },
      },
    },
  },
});

function mountView() {
  return mount(MentorViewComponent, { global: { plugins: [i18n] } });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  authState.isAuthenticated = true;
});

describe('MentorView — Phase 31.0', () => {
  it('non-mentor: render notRegistered + ẩn students panel', async () => {
    getProfileMock.mockResolvedValue(null);
    getStudentCtxMock.mockResolvedValue({ mentor: null, pending: [] });
    const w = mountView();
    await flushPromises();

    expect(w.find('[data-testid="mentor-view"]').exists()).toBe(true);
    expect(w.text()).toContain('Chưa đăng ký');
    expect(w.find('[data-testid="mentor-students-panel"]').exists()).toBe(false);
  });

  it('mentor: render profile + students panel với danh sách', async () => {
    const profile: MentorProfileRow = {
      mentorUserId: 'u1',
      displayName: 'Sư Phụ',
      realmTier: 9,
      intro: 'Hello',
      acceptingStudents: true,
      activeStudentCount: 2,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    const student1: MentorRelationRow = {
      id: 'r1',
      mentorUserId: 'u1',
      studentUserId: 's1',
      status: 'ACTIVE',
      message: null,
      mentorDisplayName: 'Sư Phụ',
      studentDisplayName: 'Đồ đệ A',
      createdAt: '2026-01-02T00:00:00Z',
      respondedAt: '2026-01-02T01:00:00Z',
      endedAt: null,
    };
    getProfileMock.mockResolvedValue(profile);
    listStudentsMock.mockResolvedValue({ students: [student1], pending: [] });
    getStudentCtxMock.mockResolvedValue({ mentor: null, pending: [] });

    const w = mountView();
    await flushPromises();

    const panel = w.find('[data-testid="mentor-students-panel"]');
    expect(panel.exists()).toBe(true);
    expect(panel.text()).toContain('Đồ đệ A');
    expect(panel.text()).toContain('ACTIVE');
  });

  it('send mentor request: gọi sendMentorRequest + show toast', async () => {
    getProfileMock.mockResolvedValue(null);
    getStudentCtxMock.mockResolvedValue({ mentor: null, pending: [] });
    sendRequestMock.mockResolvedValue({});
    const w = mountView();
    await flushPromises();

    await w.find('[data-testid="mentor-target-id"]').setValue('u_mentor');
    await w.find('[data-testid="mentor-target-msg"]').setValue('xin');
    // Click "Gửi" button (we stubbed MButton as <button>; find by text).
    const buttons = w.findAll('button');
    const sendBtn = buttons.find((b) => b.text().includes('Gửi'));
    expect(sendBtn).toBeTruthy();
    await sendBtn!.trigger('click');
    await flushPromises();

    expect(sendRequestMock).toHaveBeenCalledWith({
      mentorUserId: 'u_mentor',
      message: 'xin',
    });
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', text: 'Đã gửi yêu cầu' }),
    );
  });
});
