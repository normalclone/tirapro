// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import type * as ApiModule from '@/lib/api';
import { mk } from '@/lib/issueFixture';

const h = vi.hoisted(() => ({ patch: vi.fn(), issues: [] as unknown[] }));
vi.mock('@/lib/api', async (orig) => {
  const real = await orig<typeof ApiModule>();
  return {
    ...real,
    api: {
      patch: h.patch,
      get: vi.fn((url: string) => {
        if (url.startsWith('/issues?'))
          return Promise.resolve({
            data: { success: true, data: h.issues, pageInfo: { hasNextPage: false }, meta: {} },
          });
        if (url === '/projects')
          return Promise.resolve({ data: [{ id: 'p1', key: 'TIRA', name: 'TIRA' }] });
        if (url === '/projects/TIRA/meta')
          return Promise.resolve({
            data: {
              issueTypes: [
                { id: 'ty-bug', name: 'Bug', key: 'BUG', color: null, isSubtask: false },
                {
                  id: 'te',
                  name: 'Epic',
                  key: 'EPIC',
                  color: null,
                  isSubtask: false,
                  hierarchyLevel: 1,
                },
              ],
            },
          });
        return Promise.reject(new Error(`unexpected GET ${url}`));
      }),
    },
  };
});
vi.mock('@/features/projects/permissions', () => ({
  useCanEditIssue: () => () => true,
  useCanIn: () => () => true,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

import { toast } from 'sonner';
import { ConfirmHost, useConfirmStore } from '@/components/ui/useConfirm';
import { epicConversionCopy, epicConversionPlan, isEpicTypeOption } from './epicConversion';
import { IssueTypeSelect } from './IssueProperties';

const bugType = { ...mk('x').type, id: 'ty-bug', name: 'Bug', key: 'BUG' as const };
const epic = mk('e1', { t: 'epic', summary: 'Thanh toán', key: 'TIRA-1', projectId: 'p1' });
const story = mk('s1', { summary: 'Cha thường', key: 'TIRA-2', projectId: 'p1' });
const bug = (over: Partial<IssueDto> = {}) =>
  mk('b1', { key: 'TIRA-9', projectId: 'p1', version: 5, type: bugType, ...over });

describe('epicConversionPlan / epicConversionCopy', () => {
  it('không thuộc ai và không có việc con => không cần hỏi; đã là Epic => không hỏi', () => {
    expect(epicConversionPlan(bug(), [bug()])).toBeNull();
    expect(epicConversionPlan(epic, [epic])).toBeNull();
  });

  it('thuộc Epic: nêu mã + tên Epic, có thể hoàn tác', () => {
    const b = bug({ epicId: 'e1' });
    const plan = epicConversionPlan(b, [epic, b])!;
    expect(plan).toMatchObject({ detaches: true, childCount: 0, parent: null });
    const { title, description } = epicConversionCopy('TIRA-9', plan);
    expect(title).toBe('Đổi TIRA-9 thành Epic?');
    expect(description).toContain(
      'Việc này đang thuộc Epic TIRA-1 Thanh toán — đổi thành Epic sẽ gỡ nó khỏi Epic đó.',
    );
    expect(description).toContain('hoàn tác');
  });

  it('có việc cha thường: nhắc cả việc cha; cha trực tiếp là Epic (dữ liệu cũ) tính là Epic', () => {
    const b = bug({ parentId: 's1', epicId: 'e1' });
    const d = epicConversionCopy('TIRA-9', epicConversionPlan(b, [epic, story, b])!).description;
    expect(d).toContain('đang thuộc Epic TIRA-1 Thanh toán');
    expect(d).toContain(
      'việc con của TIRA-2 Cha thường — đổi thành Epic sẽ gỡ nó khỏi việc cha đó',
    );
    const legacy = bug({ parentId: 'e1' });
    const lp = epicConversionPlan(legacy, [epic, legacy])!;
    expect(lp.epic).toMatchObject({ key: 'TIRA-1' });
    expect(lp.parent).toBeNull();
  });

  it('có việc con trực tiếp: nêu số việc con và KHÔNG hứa hoàn tác', () => {
    const b = bug();
    const kids = [
      mk('k1', { parentId: 'b1' }),
      mk('k2', { parentId: 'b1' }),
      mk('g', { parentId: 'k1' }),
    ];
    const plan = epicConversionPlan(b, [b, ...kids])!;
    expect(plan).toMatchObject({ childCount: 2, detaches: false });
    const d = epicConversionCopy('TIRA-9', plan).description;
    expect(d).toContain('2 việc con trực tiếp sẽ chuyển thành việc thuộc Epic này');
    expect(d).not.toContain('hoàn tác');
  });

  it('Epic thuộc dự án nhưng không có trong danh sách nạp: vẫn hỏi, nói "Epic khác"', () => {
    const b = bug({ epicId: 'e-missing' });
    const d = epicConversionCopy('TIRA-9', epicConversionPlan(b, [b])!).description;
    expect(d).toContain('đang thuộc Epic khác');
  });

  it('isEpicTypeOption: key EPIC hoặc cấp ≥ 1', () => {
    expect(isEpicTypeOption({ key: 'EPIC' })).toBe(true);
    expect(isEpicTypeOption({ key: 'THEME', hierarchyLevel: 2 })).toBe(true);
    expect(isEpicTypeOption({ key: 'BUG', hierarchyLevel: 0 })).toBe(false);
    expect(isEpicTypeOption({ key: null })).toBe(false);
  });
});

function setup(issue: IssueDto, all: IssueDto[]) {
  h.issues = all;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <IssueTypeSelect issue={issue} />
      <ConfirmHost />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('button', { name: 'Loại việc' }));
  await user.click(await screen.findByRole('option', { name }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  h.patch.mockReset();
  vi.mocked(toast.error).mockReset();
  vi.mocked(toast.success).mockReset();
  act(() => useConfirmStore.setState({ open: false, opts: null, resolve: null }));
});
afterEach(cleanup);

describe('Đổi loại sang Epic từ bộ chọn loại (TIRA-BUG-20)', () => {
  it('việc thuộc Epic: hỏi trước; đồng ý => MỘT PATCH vừa đổi loại vừa gỡ epicId/parentId', async () => {
    const b = bug({ epicId: 'e1', parentId: 's1' });
    h.patch.mockResolvedValue({ data: { ...b, version: 6 } });
    const user = setup(b, [epic, story, b]);
    // chờ danh sách việc dự án nạp xong (mô tả Epic cần tên)
    await waitFor(() => expect(vi.mocked(toast.error)).not.toHaveBeenCalled());
    await pick(user, /Epic/);
    const dialog = await screen.findByRole('dialog', { name: 'Đổi TIRA-9 thành Epic?' });
    expect(h.patch).not.toHaveBeenCalled(); // chưa gửi gì khi chưa đồng ý
    expect(dialog.textContent).toContain('Epic TIRA-1 Thanh toán');
    expect(dialog.textContent).toContain('TIRA-2 Cha thường');
    await user.click(within(dialog).getByRole('button', { name: 'Đổi thành Epic' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![0]).toBe('/issues/b1');
    expect(h.patch.mock.calls[0]![1]).toEqual({
      typeId: 'te',
      epicId: null,
      parentId: null,
      version: 5,
    });
  });

  it('Huỷ hộp => không gửi gì', async () => {
    const b = bug({ epicId: 'e1' });
    const user = setup(b, [epic, b]);
    await pick(user, /Epic/);
    const dialog = await screen.findByRole('dialog', { name: 'Đổi TIRA-9 thành Epic?' });
    await user.click(within(dialog).getByRole('button', { name: 'Huỷ' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(h.patch).not.toHaveBeenCalled();
  });

  it('thành công: toast "Hoàn tác" gửi lại loại + epicId/parentId cũ', async () => {
    const b = bug({ epicId: 'e1' });
    h.patch.mockResolvedValue({ data: { ...b, version: 6 } });
    const user = setup(b, [epic, b]);
    await pick(user, /Epic/);
    await user.click(
      await within(await screen.findByRole('dialog')).findByRole('button', {
        name: 'Đổi thành Epic',
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const opts = vi.mocked(toast.success).mock.calls[0]![1] as {
      action: { label: string; onClick: () => void };
    };
    expect(opts.action.label).toBe('Hoàn tác');
    opts.action.onClick();
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(2));
    expect(h.patch.mock.calls[1]![1]).toEqual({
      typeId: 'ty-bug',
      epicId: 'e1',
      parentId: null,
      targetStatusId: 'TODO',
      version: 6,
    });
  });

  it('việc không thuộc Epic/cha và không có việc con: đổi thẳng, không hỏi, không gửi epicId/parentId', async () => {
    const b = bug();
    h.patch.mockResolvedValue({ data: { ...b, version: 6 } });
    const user = setup(b, [b]);
    await pick(user, /Epic/);
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(h.patch.mock.calls[0]![1]).toEqual({ typeId: 'te', version: 5 });
  });

  it('đổi sang loại thường (Epic → ... hoặc Task → Bug) không hỏi', async () => {
    const t = bug({
      epicId: 'e1',
      type: { ...bugType, id: 'ty-task', name: 'Task', key: 'TASK' as const },
    });
    h.patch.mockResolvedValue({ data: t });
    const user = setup(t, [epic, t]);
    await pick(user, /Bug/);
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(h.patch.mock.calls[0]![1]).toEqual({ typeId: 'ty-bug', version: 5 });
  });

  it('có việc con: hộp nói việc con chuyển sang Epic và không có Hoàn tác', async () => {
    const b = bug();
    const kid = mk('k1', { parentId: 'b1', projectId: 'p1' });
    h.patch.mockResolvedValue({ data: { ...b, version: 6 } });
    const user = setup(b, [b, kid]);
    await pick(user, /Epic/);
    const dialog = await screen.findByRole('dialog', { name: 'Đổi TIRA-9 thành Epic?' });
    expect(dialog.textContent).toContain('1 việc con trực tiếp');
    await user.click(within(dialog).getByRole('button', { name: 'Đổi thành Epic' }));
    await waitFor(() => expect(h.patch).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });
});
