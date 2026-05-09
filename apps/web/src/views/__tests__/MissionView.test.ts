import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { setActivePinia, createPinia } from 'pinia';
import type { MissionProgressView } from '@/api/mission';
import type { MissionProgressFramePayload, WsFrame } from '@xuantoi/shared';

const listMissionsMock = vi.fn();
const claimMissionMock = vi.fn();

vi.mock('@/api/mission', () => ({
  listMissions: (...a: unknown[]) => listMissionsMock(...a),
  claimMission: (...a: unknown[]) => claimMissionMock(...a),
}));

let capturedMissionProgressHandler:
  | ((frame: WsFrame<MissionProgressFramePayload>) => void)
  | null = null;
const wsUnsubMock = vi.fn();

vi.mock('@/ws/client', () => ({
  on: vi.fn(
    (type: string, fn: (frame: WsFrame<MissionProgressFramePayload>) => void) => {
      if (type === 'mission:progress') capturedMissionProgressHandler = fn;
      return wsUnsubMock;
    },
  ),
}));

vi.mock('@/components/shell/AppShell.vue', () => ({
  default: {
    name: 'AppShellStub',
    template: '<div data-testid="app-shell"><slot /></div>',
  },
}));

const toastPushMock = vi.fn();

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
    hydrate: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/stores/game', () => ({
  useGameStore: () => ({
    fetchState: vi.fn().mockResolvedValue(undefined),
    bindSocket: vi.fn(),
  }),
}));

vi.mock('@/stores/toast', () => ({
  useToastStore: () => ({ push: toastPushMock }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import MissionView from '@/views/MissionView.vue';

const i18n = createI18n({
  legacy: false,
  locale: 'vi',
  fallbackLocale: 'vi',
  missingWarn: false,
  fallbackWarn: false,
  messages: {
    vi: {
      common: { reload: 'Tải lại', loading: 'Đang xử lý…', loadingData: 'Đang tải…' },
      mission: {
        title: 'Bảng Nhiệm Vụ',
        empty: 'Không có nhiệm vụ trong mục này.',
        claim: 'Nhận Thưởng',
        claimToast: 'Đã nhận thưởng: {name}',
        resetIn: 'Làm mới sau',
        resetImminent: 'Đang làm mới',
        tab: { daily: 'Hằng Ngày', weekly: 'Hằng Tuần', once: 'Thiên Kiếp' },
        status: { ready: 'Sẵn sàng', claimed: 'Đã nhận' },
        quality: {
          PHAM: 'Phàm',
          LINH: 'Linh',
          HUYEN: 'Huyền',
          TIEN: 'Tiên',
          THANH: 'Thánh',
        },
        reward: {
          label: 'Phần thưởng',
          linhThach: 'Linh Thạch',
          tienNgoc: 'Tiên Ngọc',
          exp: 'EXP',
          congHien: 'Cống Hiến',
        },
        errors: {
          NO_CHARACTER: 'Chưa tạo nhân vật.',
          ALREADY_CLAIMED: 'Nhiệm vụ này đã được nhận.',
          UNKNOWN: 'Lỗi bất định.',
        },
      },
    },
  },
});

function makeMission(over: Partial<MissionProgressView> = {}): MissionProgressView {
  return {
    key: 'M_TEST',
    name: 'Test Mission',
    description: 'Test description',
    period: 'DAILY',
    goalKind: 'CULTIVATE_TICKS',
    goalAmount: 10,
    currentAmount: 0,
    claimed: false,
    completable: false,
    windowEnd: null,
    rewards: { linhThach: 100 },
    quality: 'PHAM',
    ...over,
  };
}

function mountView() {
  return mount(MissionView, { global: { plugins: [i18n] } });
}

describe('MissionView — claim flow vitest', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listMissionsMock.mockReset();
    claimMissionMock.mockReset();
    toastPushMock.mockReset();
    wsUnsubMock.mockReset();
    capturedMissionProgressHandler = null;
  });

  it('render nút Nhận Thưởng enabled cho mission completable & chưa claim', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({ key: 'M_READY', name: 'Ready Mission', completable: true }),
    ]);

    const w = mountView();
    await flushPromises();

    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    expect(claimBtn).toBeDefined();
    expect(claimBtn!.attributes('disabled')).toBeUndefined();
    expect(w.text()).toContain('Sẵn sàng');
  });

  it('render nút Nhận Thưởng disabled khi mission chưa completable', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({ key: 'M_NOT_READY', name: 'Pending Mission', completable: false }),
    ]);

    const w = mountView();
    await flushPromises();

    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    expect(claimBtn).toBeDefined();
    expect(claimBtn!.attributes('disabled')).toBeDefined();
    expect(w.text()).not.toContain('Sẵn sàng');
  });

  it('hiển thị badge "Đã nhận" và ẩn nút Nhận Thưởng khi đã claim', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({
        key: 'M_DONE',
        name: 'Done Mission',
        completable: true,
        claimed: true,
        currentAmount: 10,
      }),
    ]);

    const w = mountView();
    await flushPromises();

    expect(w.text()).toContain('Đã nhận');
    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    expect(claimBtn).toBeUndefined();
  });

  it('click Nhận Thưởng → gọi claimMission + toast success + cập nhật list', async () => {
    const before = makeMission({
      key: 'M_C1',
      name: 'Claim Mission',
      completable: true,
      currentAmount: 10,
    });
    const after = { ...before, claimed: true };
    listMissionsMock.mockResolvedValue([before]);
    // Phase 16.5 — claimMission trả `{ missions, claim? }` (claim optional).
    claimMissionMock.mockResolvedValue({ missions: [after] });

    const w = mountView();
    await flushPromises();

    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    await claimBtn!.trigger('click');
    await flushPromises();

    expect(claimMissionMock).toHaveBeenCalledWith('M_C1');
    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        text: expect.stringContaining('Claim Mission'),
      }),
    );
    expect(w.text()).toContain('Đã nhận');
  });

  it('claim lỗi ALREADY_CLAIMED → toast error i18n key tương ứng', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({
        key: 'M_ERR',
        name: 'Err Mission',
        completable: true,
        currentAmount: 10,
      }),
    ]);
    claimMissionMock.mockRejectedValue(
      Object.assign(new Error('ALREADY_CLAIMED'), { code: 'ALREADY_CLAIMED' }),
    );

    const w = mountView();
    await flushPromises();

    const claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    await claimBtn!.trigger('click');
    await flushPromises();

    expect(toastPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text: 'Nhiệm vụ này đã được nhận.',
      }),
    );
  });

  it('WS mission:progress frame → cập nhật currentAmount + completable enable nút', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({
        key: 'M_WS',
        name: 'WS Mission',
        completable: false,
        currentAmount: 0,
        goalAmount: 10,
      }),
    ]);

    const w = mountView();
    await flushPromises();

    // Trước WS frame: nút disabled
    let claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    expect(claimBtn!.attributes('disabled')).toBeDefined();

    expect(capturedMissionProgressHandler).not.toBeNull();
    capturedMissionProgressHandler!({
      type: 'mission:progress',
      ts: Date.now(),
      payload: {
        characterId: 'char-1',
        changes: [
          {
            missionKey: 'M_WS',
            period: 'DAILY',
            currentAmount: 10,
            goalAmount: 10,
            completable: true,
          },
        ],
      },
    });
    await flushPromises();

    expect(w.text()).toContain('10 / 10');
    claimBtn = w.findAll('button').find((b) => b.text().includes('Nhận Thưởng'));
    expect(claimBtn!.attributes('disabled')).toBeUndefined();
    expect(w.text()).toContain('Sẵn sàng');
  });

  it('sort: completable → chưa xong → đã claim trong cùng tab', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({ key: 'M_DONE', name: 'B Done', claimed: true, completable: true }),
      makeMission({ key: 'M_PENDING', name: 'A Pending', completable: false }),
      makeMission({ key: 'M_READY', name: 'C Ready', completable: true }),
    ]);

    const w = mountView();
    await flushPromises();

    const items = w.findAll('li');
    expect(items.length).toBe(3);
    expect(items[0].text()).toContain('C Ready');
    expect(items[1].text()).toContain('A Pending');
    expect(items[2].text()).toContain('B Done');
  });

  it('tab WEEKLY filter → ẩn DAILY mission', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({ key: 'M_D', name: 'Daily Mission', period: 'DAILY' }),
      makeMission({ key: 'M_W', name: 'Weekly Mission', period: 'WEEKLY' }),
    ]);

    const w = mountView();
    await flushPromises();

    expect(w.text()).toContain('Daily Mission');
    expect(w.text()).not.toContain('Weekly Mission');

    const weeklyTab = w.findAll('button').find((b) => b.text().includes('Hằng Tuần'));
    await weeklyTab!.trigger('click');
    await flushPromises();

    expect(w.text()).not.toContain('Daily Mission');
    expect(w.text()).toContain('Weekly Mission');
  });

  it('empty state khi tab không có mission nào', async () => {
    listMissionsMock.mockResolvedValue([
      makeMission({ key: 'M_D', name: 'Daily Mission', period: 'DAILY' }),
    ]);

    const w = mountView();
    await flushPromises();

    const onceTab = w.findAll('button').find((b) => b.text().includes('Thiên Kiếp'));
    await onceTab!.trigger('click');
    await flushPromises();

    expect(w.text()).toContain('Không có nhiệm vụ trong mục này');
  });
});
