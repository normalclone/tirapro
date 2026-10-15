import { MutationObserver, QueryClient } from '@tanstack/react-query';
import type { IssueDto } from '@tirapro/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/lib/queryKeys';

const post = vi.fn();
const toastInfo = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...a: unknown[]) => post(...a) as unknown },
  apiErrorMessage: vi.fn(() => 'msg'),
  wasErrorDescribed: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { info: (...a: unknown[]) => toastInfo(...a) as unknown, error: vi.fn() },
}));
import { isRankStaleError, moveMutationOptions, movePatch, type MoveVars } from './moveIssue';

const issue = (id: string, over: Partial<IssueDto> = {}) =>
  ({
    id,
    key: `P-${id}`,
    projectId: 'p1',
    version: 3,
    rank: id,
    sprintId: null,
    status: { id: 's1', name: 'Todo', category: 'TODO' },
    ...over,
  }) as IssueDto;
const axiosErr = (status: number, code: string) =>
  Object.assign(new Error(code), {
    isAxiosError: true,
    response: { status, data: { error: { code } } },
  });
const vars = (over: Partial<MoveVars> = {}): MoveVars => ({
  id: 'a',
  key: 'P-a',
  version: 3,
  afterId: 'b',
  beforeId: null,
  route: 'move',
  ...over,
});

describe('movePatch', () => {
  it('chỉ vá phần được yêu cầu (status/sprint), không đụng rank', () => {
    const i = issue('a');
    expect(movePatch(vars({ statusId: 's2', statusName: 'Doing' }))(i)).toEqual({
      status: { ...i.status, id: 's2', name: 'Doing' },
    });
    expect(movePatch(vars({ sprintId: null }))(i)).toEqual({ sprintId: null });
    expect(movePatch(vars())(i)).toEqual({});
  });
});

describe('moveMutationOptions', () => {
  let qc: QueryClient;
  beforeEach(() => {
    post.mockReset();
    toastInfo.mockReset();
    qc = new QueryClient();
    qc.setQueryData<IssueDto[]>(keys.issues.byProject('p1'), [issue('a'), issue('b')]);
  });
  const run = (v: MoveVars) => new MutationObserver(qc, moveMutationOptions(qc, 'p1')).mutate(v);
  const listA = () =>
    qc.getQueryData<IssueDto[]>(keys.issues.byProject('p1'))!.find((i) => i.id === 'a')!;

  it('route + body: move gửi statusId/boardId/force, rank chỉ gửi version + hai mốc + sprint', async () => {
    post.mockResolvedValue({ data: issue('a', { version: 4 }) });
    await run(vars({ statusId: 's2', boardId: 'b1', force: true }));
    expect(post).toHaveBeenLastCalledWith('/issues/a/move', {
      version: 3,
      afterId: 'b',
      beforeId: null,
      statusId: 's2',
      boardId: 'b1',
      force: true,
    });
    qc.setQueryData<IssueDto[]>(keys.issues.byProject('p1'), [issue('a'), issue('b')]); // lần trước đã ghi version 4
    await run(vars({ route: 'rank', statusId: 's2', sprintId: 'sp1' }));
    expect(post).toHaveBeenLastCalledWith('/issues/a/rank', {
      version: 3,
      afterId: 'b',
      beforeId: null,
      sprintId: 'sp1',
    });
  });

  it('thành công: ghi bản thật (rank/version) vào cache danh sách', async () => {
    post.mockResolvedValue({ data: issue('a', { version: 4, rank: 'zz' }) });
    await run(vars());
    expect(listA()).toMatchObject({ version: 4, rank: 'zz' });
  });

  it('lỗi: rollback bản vá lạc quan; RANK_NEIGHBORS_STALE được nhận diện', async () => {
    post.mockRejectedValue(axiosErr(409, 'RANK_NEIGHBORS_STALE'));
    await run(vars({ sprintId: 'sp1' })).catch(() => undefined); // mutate() reject khi lỗi
    expect(listA()).toMatchObject({ version: 3, sprintId: null });
    expect(isRankStaleError(axiosErr(409, 'RANK_NEIGHBORS_STALE'))).toBe(true);
    expect(isRankStaleError(axiosErr(409, 'VERSION_CONFLICT'))).toBe(false);
  });

  it('409 RANK_NEIGHBORS_STALE: nạp lại danh sách dự án + toast trung tính một lần', async () => {
    post.mockRejectedValue(axiosErr(409, 'RANK_NEIGHBORS_STALE'));
    await run(vars()).catch(() => undefined);
    expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(true);
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastInfo).toHaveBeenCalledWith('msg', expect.objectContaining({ id: 'rank-stale' }));
  });

  it('409 VERSION_CONFLICT: nạp lại danh sách nhưng KHÔNG toast info (toast chung của MutationCache báo)', async () => {
    post.mockRejectedValue(axiosErr(409, 'VERSION_CONFLICT'));
    await run(vars()).catch(() => undefined);
    expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(true);
    expect(toastInfo).not.toHaveBeenCalled();
  });

  it.each([
    ['403 FORBIDDEN', axiosErr(403, 'FORBIDDEN')],
    ['422 WIP_LIMIT_REACHED', axiosErr(422, 'WIP_LIMIT_REACHED')],
    ['lỗi mạng (không có response)', new Error('Network Error')],
  ])(
    '%s: rollback rồi nạp lại danh sách + chi tiết (cache không được giữ rank sai)',
    async (_n, err) => {
      qc.setQueryData<IssueDto>(keys.issues.byKey('P-a'), issue('a'));
      post.mockRejectedValue(err);
      await run(vars({ sprintId: 'sp1' })).catch(() => undefined);
      expect(listA()).toMatchObject({ version: 3, sprintId: null });
      expect(qc.getQueryState(keys.issues.byProject('p1'))?.isInvalidated).toBe(true);
      expect(qc.getQueryState(keys.issues.byKey('P-a'))?.isInvalidated).toBe(true);
      expect(toastInfo).not.toHaveBeenCalled();
    },
  );

  it('version gửi đi lấy từ cache (không phải v.version cũ): Hoàn tác sau khi đã kéo tiếp không VERSION_CONFLICT', async () => {
    qc.setQueryData<IssueDto[]>(keys.issues.byProject('p1'), [
      issue('a', { version: 7 }),
      issue('b'),
    ]);
    post.mockResolvedValue({ data: issue('a', { version: 8 }) });
    await run(vars({ version: 5 })); // version trong toast/closure đã cũ
    expect(post).toHaveBeenLastCalledWith(
      '/issues/a/move',
      expect.objectContaining({ version: 7 }),
    );
  });

  it('kéo cùng thẻ lần hai khi lần một chưa trả về: gửi version sau bản vá lạc quan của lần một (= version máy chủ sau lần một)', async () => {
    let resolveFirst!: (v: unknown) => void;
    post.mockReturnValueOnce(new Promise((r) => (resolveFirst = r)));
    post.mockResolvedValueOnce({ data: issue('a', { version: 5 }) });
    const first = run(vars({ version: 3, afterId: 'b' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const second = run(vars({ version: 3, afterId: null, beforeId: 'b' })); // closure cũ: vẫn version 3
    await vi.waitFor(() => expect(listA().version).toBe(5)); // hai bản vá lạc quan
    resolveFirst({ data: issue('a', { version: 4 }) });
    await first;
    await second;
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![1]).toMatchObject({ version: 3 });
    expect(post.mock.calls[1]![1]).toMatchObject({ version: 4 });
  });
});
