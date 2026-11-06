// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';

const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
  put: vi.fn(),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return { ...real, api: h };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { NotificationSection } from './NotificationSection';
import { ProjectTelegramSection } from './ProjectTelegramSection';
import { TelegramLinkCard } from './TelegramLinkCard';

const status = (over: Record<string, unknown> = {}) => ({
  available: true,
  reason: null,
  botUsername: 'TiraBot',
  linked: null,
  ...over,
});

const prefs = {
  preferences: { ISSUE_ASSIGNED: true, MENTIONED: true },
  defaults: {},
  email: { mention: true, assigned: true, comment: false, transition: false },
  emailDefaults: {},
  telegram: { ISSUE_ASSIGNED: true, MENTIONED: true, COMMENT_ADDED: false },
  telegramDefaults: {},
};

/** `routes`: đường dẫn GET → dữ liệu (hoặc lỗi). */
function mockGet(routes: Record<string, unknown>) {
  h.get.mockImplementation((url: string) =>
    url in routes
      ? Promise.resolve({ data: routes[url] })
      : Promise.reject(new Error(`GET ${url}`)),
  );
}

function renderUi(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return userEvent.setup();
}

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
});
afterEach(cleanup);

describe('TelegramLinkCard', () => {
  it('tổ chức chưa cài bot → chỉ hiện hướng dẫn, KHÔNG có nút liên kết', async () => {
    mockGet({ '/notifications/telegram': status({ available: false, reason: 'NO_BOT' }) });
    renderUi(<TelegramLinkCard />);
    expect(await screen.findByText(/Quản trị tổ chức cần cài bot Telegram/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Liên kết Telegram/ })).toBeNull();
  });

  it('đã liên kết → hiện @username và nút Huỷ liên kết (gọi DELETE)', async () => {
    mockGet({
      '/notifications/telegram': status({
        linked: { username: 'linh_nt', linkedAt: '2026-11-01T00:00:00.000Z' },
      }),
    });
    h.delete.mockResolvedValue({ data: { success: true } });
    const user = renderUi(<TelegramLinkCard />);
    expect(await screen.findByText('@linh_nt')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Huỷ liên kết' }));
    await waitFor(() => expect(h.delete).toHaveBeenCalledWith('/notifications/telegram/link'));
  });

  it('chưa liên kết → bấm nút: xin mã, hiện nút mở deep link ?start=<mã> và lệnh dự phòng, bắt đầu poll', async () => {
    mockGet({ '/notifications/telegram': status() });
    h.post.mockImplementation((url: string) => {
      if (url === '/notifications/telegram/link')
        return Promise.resolve({
          data: {
            code: 'K7M2QX9ABC',
            expiresAt: new Date(Date.now() + 600_000).toISOString(),
            botUsername: 'TiraBot',
            deepLink: 'https://t.me/TiraBot?start=K7M2QX9ABC',
            command: '/start K7M2QX9ABC',
          },
        });
      return Promise.resolve({ data: { status: 'waiting' } });
    });
    const user = renderUi(<TelegramLinkCard />);
    await user.click(await screen.findByRole('button', { name: /Liên kết Telegram/ }));
    const open = await screen.findByRole('link', { name: /Mở Telegram/ });
    expect(open.getAttribute('href')).toBe('https://t.me/TiraBot?start=K7M2QX9ABC');
    expect(screen.getByText('/start K7M2QX9ABC')).toBeTruthy();
    await waitFor(() =>
      expect(h.post).toHaveBeenCalledWith('/notifications/telegram/link/K7M2QX9ABC/poll'),
    );
    expect(await screen.findByText(/Đang chờ bạn bấm Start/)).toBeTruthy();
  });
});

describe('NotificationSection — công tắc Telegram', () => {
  it('chưa liên kết → ô Telegram mờ (disabled) kèm gợi ý; đã liên kết → bấm là lưu nhánh telegram', async () => {
    mockGet({ '/notifications/preferences': prefs, '/notifications/telegram': status() });
    const unlinked = renderUi(<NotificationSection />);
    const boxes = await screen.findAllByLabelText(/Gửi qua Telegram/);
    expect(boxes.length).toBeGreaterThan(0);
    expect(boxes.every((b) => (b as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByText(/Liên kết Telegram ở mục phía trên/).length).toBeGreaterThan(0);
    void unlinked;
    cleanup();

    mockGet({
      '/notifications/preferences': prefs,
      '/notifications/telegram': status({
        linked: { username: 'x', linkedAt: '2026-11-01T00:00:00Z' },
      }),
    });
    h.put.mockResolvedValue({ data: {} });
    const user = renderUi(<NotificationSection />);
    const comment = await screen.findByRole('checkbox', {
      name: /Gửi qua Telegram.*Bình luận mới/,
    });
    await waitFor(() => expect((comment as HTMLInputElement).disabled).toBe(false));
    await user.click(comment);
    await waitFor(() =>
      expect(h.put).toHaveBeenCalledWith('/notifications/preferences', {
        telegram: { COMMENT_ADDED: true },
      }),
    );
  });
});

describe('ProjectTelegramSection', () => {
  it('không quản trị dự án nào → không hiện gì', async () => {
    mockGet({ '/notifications/telegram/managed-projects': [] });
    renderUi(<ProjectTelegramSection />);
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(screen.queryByText('Kênh Telegram của dự án')).toBeNull();
  });

  it('có dự án quản trị → hiện mục; một dự án thì mở sẵn, liệt kê kênh với tóm tắt sự kiện', async () => {
    mockGet({
      '/notifications/telegram/managed-projects': [{ id: 'p1', key: 'TIRA', name: 'Tirapro' }],
      '/projects/p1/telegram': {
        botReady: true,
        reason: null,
        botUsername: 'TiraBot',
        eventTypes: ['STATUS_CHANGED', 'ISSUE_UPDATED', 'COMMENT_ADDED'],
        channels: [{ id: 'c1', title: 'Nhóm dev', events: ['COMMENT_ADDED'], isEnabled: true }],
      },
    });
    h.patch.mockResolvedValue({ data: {} });
    const user = renderUi(<ProjectTelegramSection />);
    expect(await screen.findByText('Kênh Telegram của dự án')).toBeTruthy();
    expect(await screen.findByText('Nhóm dev')).toBeTruthy();
    expect(screen.getAllByText('Bình luận mới').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Gắn nhóm\/kênh/ })).toBeTruthy();
    // bật thêm sự kiện: gửi PATCH với danh sách mới
    await user.click(screen.getByRole('button', { name: /Chọn sự kiện/ }));
    await user.click(screen.getByRole('checkbox', { name: /Đổi trạng thái/ }));
    await waitFor(() =>
      expect(h.patch).toHaveBeenCalledWith('/projects/p1/telegram/channels/c1', {
        events: ['STATUS_CHANGED', 'COMMENT_ADDED'],
      }),
    );
  });

  it('bot chưa sẵn sàng → hướng dẫn thay cho nút gắn nhóm', async () => {
    mockGet({
      '/notifications/telegram/managed-projects': [{ id: 'p1', key: 'TIRA', name: 'Tirapro' }],
      '/projects/p1/telegram': {
        botReady: false,
        reason: 'NO_BOT',
        botUsername: null,
        eventTypes: [],
        channels: [],
      },
    });
    renderUi(<ProjectTelegramSection />);
    expect(await screen.findByText(/cài bot Telegram ở Kết nối/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Gắn nhóm\/kênh/ })).toBeNull();
  });
});
