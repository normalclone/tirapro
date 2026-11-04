// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';
import { keys } from '@/lib/queryKeys';

const h = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: { get: vi.fn().mockRejectedValue(new Error('offline')), patch: h.patch, post: vi.fn() },
  };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { useAi } from '@/stores/ai';
import { useAuth } from '@/stores/auth';
import { IssueAssigneeControl } from './IssueProperties';

const ME = { id: 'me', displayName: 'Tôi', email: 'me@x', avatarUrl: null, isSystemAdmin: false };
const OTHER = { id: 'an', displayName: 'An', email: 'an@x', avatarUrl: null };

const issue = (assignee: typeof OTHER | typeof ME | null): IssueDto =>
  mk('a1', {
    key: 'A-1',
    version: 7,
    assigneeId: assignee?.id ?? null,
    assignee,
  } as unknown as Partial<IssueDto>);

function setup(i: IssueDto, o: { perms?: string[]; admin?: boolean } = {}) {
  act(() => {
    useAuth.setState({
      user: { ...ME, isSystemAdmin: o.admin ?? false } as never,
      permissions: (o.perms ?? ['issue:edit', 'issue:assign']) as never,
    });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(keys.issues.byProject(i.projectId), [i]);
  qc.setQueryData(keys.issues.byKey(i.key), i);
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IssueAssigneeControl issue={i} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), qc };
}

const assignBtn = () => screen.queryByRole('button', { name: /Gán cho tôi/ });

beforeEach(() => {
  h.patch.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  h.patch.mockImplementation((_u: string, body: { assigneeId: string }) =>
    Promise.resolve({ data: { ...issue(ME), version: 8, assigneeId: body.assigneeId } }),
  );
  act(() => useAi.getState().set(true));
});
afterEach(cleanup);

describe('"Gán cho tôi" cạnh Người phụ trách', () => {
  it('việc của người khác + có quyền gán: hiện nút', () => {
    setup(issue(OTHER));
    expect(assignBtn()).toBeTruthy();
  });

  it('chưa gán cho ai + có quyền: hiện nút', () => {
    setup(issue(null));
    expect(assignBtn()).toBeTruthy();
  });

  it('đã gán cho chính mình: ẩn', () => {
    setup(issue(ME));
    expect(assignBtn()).toBeNull();
  });

  it('thiếu quyền gán (issue:assign): ẩn', () => {
    setup(issue(OTHER), { perms: ['issue:edit'] });
    expect(assignBtn()).toBeNull();
  });

  it('không sửa được việc (thiếu issue:edit): ẩn', () => {
    setup(issue(OTHER), { perms: ['issue:assign'] });
    expect(assignBtn()).toBeNull();
  });

  it('bấm: PATCH đúng { assigneeId: me.id, version } (vá lạc quan KHÔNG gửi lên máy chủ), toast "Đã gán cho bạn"', async () => {
    const { user, qc } = setup(issue(OTHER));
    await user.click(assignBtn()!);
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch).toHaveBeenCalledWith('/issues/a1', { assigneeId: 'me', version: 7 });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Đã gán cho bạn', expect.anything()),
    );
    // vá lạc quan đã ghi người phụ trách vào cache danh sách (bản thật của máy chủ về sau thay thế)
    const cached = qc
      .getQueryData<IssueDto[]>(keys.issues.byProject('p'))!
      .find((x) => x.id === 'a1')!;
    expect(cached.assigneeId).toBe('me');
  });

  it('lỗi máy chủ: báo lỗi, không báo "Đã gán cho bạn"', async () => {
    h.patch.mockRejectedValueOnce(new Error('boom'));
    const { user } = setup(issue(OTHER));
    await user.click(assignBtn()!);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('ô người phụ trách theo bật/tắt Trợ lý AI', () => {
  const sug = () => screen.queryByRole('button', { name: /Gợi ý/ });
  it('AI bật + quyền ai:use: có "Gợi ý"; AI tắt: biến mất, "Gán cho tôi" và ô chọn người vẫn còn', () => {
    act(() => {
      useAuth.setState({
        user: { ...ME, isSystemAdmin: false } as never,
        permissions: ['issue:edit', 'issue:assign', 'ai:use'] as never,
      });
    });
    const i = issue(OTHER);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <IssueAssigneeControl issue={i} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const { rerender } = render(tree);
    expect(sug()).toBeTruthy();
    act(() => useAi.getState().set(false));
    rerender(tree);
    expect(sug()).toBeNull();
    expect(assignBtn()).toBeTruthy();
    expect(screen.getByRole('button', { name: /Người phụ trách|An/ })).toBeTruthy();
  });
});
