// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';
import { keys } from '@/lib/queryKeys';

const h = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
}));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: {
      get: vi.fn().mockRejectedValue(new Error('offline')),
      patch: h.patch,
      post: h.post,
    },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { useAuth } from '@/stores/auth';
import { IssueStoryPointsInline } from './IssueProperties';

const issue = (o: Partial<IssueDto> = {}) =>
  mk('b', { storyPoints: 9, version: 3, pointsExplain: 'Bug · Khó · High = 2×3×1.5 = 9', ...o });

function setup(i: IssueDto, o: { admin?: boolean; seed?: IssueDto[] | null } = {}) {
  useAuth.setState({
    user: { id: 'u', isSystemAdmin: o.admin ?? true } as never,
    permissions: [],
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // `null` = danh sách việc của dự án CHƯA nạp (liên kết sâu lúc nguội).
  if (o.seed !== null) qc.setQueryData(keys.issues.byProject(i.projectId), o.seed ?? [i]);
  render(
    <QueryClientProvider client={qc}>
      <IssueStoryPointsInline issue={i} />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  h.patch.mockReset();
  h.post.mockReset();
  h.patch.mockImplementation((_url: string, body: { storyPoints?: number }) =>
    Promise.resolve({ data: { ...issue(), storyPoints: body.storyPoints, version: 4 } }),
  );
});
afterEach(cleanup);

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /9 điểm/ }));
  return screen.getByLabelText('Điểm chỉnh tay');
}

describe('chỉnh tay điểm trên trang việc (tương tác thật)', () => {
  it('Quản trị gõ 7 + Enter → PATCH đúng { storyPoints: 7, version } (số nguyên, không null)', async () => {
    const user = setup(issue());
    const input = await openEditor(user);
    await user.clear(input);
    await user.type(input, '7{Enter}');
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith('/issues/b', { storyPoints: 7, version: 3 });
    const body = h.patch.mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['storyPoints', 'version']);
    expect(Number.isInteger(body.storyPoints)).toBe(true);
  });

  it('số lẻ (2.5) → không gửi gì, báo lỗi tiếng Việt', async () => {
    const user = setup(issue());
    const input = await openEditor(user);
    await user.clear(input);
    await user.type(input, '2.5{Enter}');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(h.patch).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls.at(-1)![0]).toContain('số nguyên');
  });

  it('để trống → không gửi gì (không có "xoá điểm", không bao giờ gửi null)', async () => {
    const user = setup(issue());
    const input = await openEditor(user);
    await user.clear(input);
    await user.type(input, '{Enter}');
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('giá trị không đổi → không gửi; Esc huỷ → không gửi', async () => {
    const user = setup(issue());
    const input = await openEditor(user);
    await user.type(input, '{Enter}'); // vẫn 9
    expect(h.patch).not.toHaveBeenCalled();
    const input2 = await openEditor(user);
    await user.clear(input2);
    await user.type(input2, '5{Escape}');
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('người không phải Quản trị: không có nút để mở ô sửa', () => {
    setup(issue(), { admin: false });
    expect(screen.queryByRole('button', { name: /9 điểm/ })).toBeNull();
    expect(screen.getByTitle(/= 2×3×1.5 = 9/)).toBeTruthy();
  });

  it('danh sách việc dự án CHƯA nạp: không mở chỉnh tay (có chỉ báo đang kiểm tra), nạp xong mới mở', async () => {
    const i = issue();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useAuth.setState({ user: { id: 'u', isSystemAdmin: true } as never, permissions: [] });
    const view = render(
      <QueryClientProvider client={qc}>
        <IssueStoryPointsInline issue={i} />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: /9 điểm/ })).toBeNull();
    expect(screen.getByLabelText('Đang kiểm tra')).toBeTruthy();
    qc.setQueryData(keys.issues.byProject(i.projectId), [i]);
    await waitFor(() => expect(screen.getByRole('button', { name: /9 điểm/ })).toBeTruthy());
    view.unmount();
  });

  it('việc cha (đã nạp việc con): chỉ đọc, "Tổng điểm việc con", không có nút', () => {
    const i = issue({ pointsManual: true });
    setup(i, { seed: [i, mk('c', { parentId: 'b', storyPoints: 4 })] });
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle(/Tổng điểm việc con/)).toBeTruthy();
  });

  it('"Tính lại theo công thức" gọi POST /issues/:id/points/reset', async () => {
    h.post.mockResolvedValue({ data: issue() });
    const user = setup(issue({ pointsManual: true }));
    await user.click(screen.getByRole('button', { name: 'Tính lại theo công thức' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('/issues/b/points/reset'));
  });
});
