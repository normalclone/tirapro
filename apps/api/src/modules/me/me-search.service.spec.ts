/* eslint-disable max-lines-per-function -- spec: một describe lớn dùng chung bộ giả lập */
import { describe, expect, it, vi } from 'vitest';
import { BusinessRuleException } from '../../common/exceptions/app.exception';
import { getStore } from '../../common/context/request-context';
import { MeSearchService } from './me-search.service';

interface Row {
  id: string;
  key: string;
  projectId: string;
  updatedAt: string;
  dueDate: string | null;
  priority: { name: string } | null;
}

const USER = 'U1';
const ws = (id: string) => ({ id, name: `WS ${id}` });
let seq = 0;
const row = (p: Partial<Row> & { id: string; projectId?: string; updatedAt?: string }): Row => ({
  key: `${p.projectId ?? 'P'}-TASK-${++seq}`,
  projectId: p.projectId ?? 'P',
  updatedAt: p.updatedAt ?? '2026-01-01T00:00:00.000Z',
  dueDate: null,
  priority: null,
  ...p,
});

/** Giả lập `SearchService.search` theo từng workspace: xếp (updatedAt DESC, id ASC), con trỏ = id, trang có limit+1 để biết hasNextPage. */
function fakeSearch(data: Record<string, Row[]>, behaviour: Record<string, Error> = {}) {
  return vi.fn(
    (
      workspaceId: string,
      _userId: string,
      opts: { limit: number; cursor?: string; jql?: string },
    ) => {
      const err = behaviour[workspaceId];
      if (err) return Promise.reject(err);
      const sorted = [...(data[workspaceId] ?? [])].sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
      );
      const start = opts.cursor ? sorted.findIndex((r) => r.id === opts.cursor) + 1 : 0;
      const slice = sorted.slice(start, start + opts.limit + 1);
      const items = slice.slice(0, opts.limit);
      return Promise.resolve({
        data: items,
        pageInfo: {
          hasNextPage: slice.length > opts.limit,
          endCursor: items.length ? items[items.length - 1]!.id : null,
          limit: opts.limit,
        },
      });
    },
  );
}

interface Opts {
  workspaces?: { id: string; name: string }[];
  data?: Record<string, Row[]>;
  errors?: Record<string, Error>;
  perms?: Record<string, string[]>;
  isSystemAdmin?: boolean;
}
function make(o: Opts = {}) {
  const workspaces = o.workspaces ?? [ws('A')];
  const search = fakeSearch(o.data ?? {}, o.errors);
  const membershipFindMany = vi.fn().mockResolvedValue(workspaces.map((w) => ({ workspace: w })));
  const projectFindMany = vi.fn((args: { where: { id: { in: string[] } } }) =>
    Promise.resolve(args.where.id.in.map((id) => ({ id, key: `K${id}` }))),
  );
  const prisma = {
    workspaceMembership: { findMany: membershipFindMany },
    project: { findMany: projectFindMany },
    user: { findUnique: vi.fn().mockResolvedValue({ isSystemAdmin: o.isSystemAdmin ?? false }) },
  };
  const rbac = {
    getEffectivePermissions: vi.fn((_u: string, wsId: string) =>
      Promise.resolve(new Set(o.perms?.[wsId] ?? ['project:view'])),
    ),
  };
  const service = new MeSearchService(prisma as never, rbac as never, { search } as never);
  return { service, search, prisma, rbac, membershipFindMany, projectFindMany };
}

const ids = (r: { data: { id: string }[] }) => r.data.map((d) => d.id);

describe('MeSearchService.myWorkspaces', () => {
  it('chỉ workspace chưa xoá mà người dùng là thành viên', async () => {
    const { service, membershipFindMany } = make({ workspaces: [ws('A'), ws('B')] });
    expect(await service.myWorkspaces(USER)).toEqual([ws('A'), ws('B')]);
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, workspace: { deletedAt: null } } }),
    );
  });
});

describe('MeSearchService.search', () => {
  it('một workspace: cùng id, cùng thứ tự với tìm kiếm của workspace; gọi đúng (wsId, userId, opts)', async () => {
    const data = {
      A: [
        row({ id: 'a1', updatedAt: '2026-03-01T00:00:00.000Z' }),
        row({ id: 'a2', updatedAt: '2026-03-02T00:00:00.000Z' }),
        row({ id: 'a3', updatedAt: '2026-03-03T00:00:00.000Z' }),
      ],
    };
    const { service, search } = make({ data });
    const direct = await fakeSearch(data)('A', USER, { limit: 50 });
    const res = await service.search(USER, { jql: 'status = Done', limit: 50 });
    expect(ids(res)).toEqual(ids(direct));
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(
      'A',
      USER,
      expect.objectContaining({
        jql: 'status = Done',
        limit: 50,
        checkValues: true,
        scope: 'personal',
        cursor: undefined,
      }),
    );
  });

  it('mỗi việc kèm workspace {id,name} và projectKey', async () => {
    const { service } = make({ data: { A: [row({ id: 'a1', projectId: 'p1' })] } });
    const res = await service.search(USER, { jql: 'type = Bug', limit: 10 });
    expect(res.data[0]).toMatchObject({ workspace: ws('A'), projectKey: 'Kp1' });
  });

  it('gọi tìm kiếm một lần cho MỖI workspace, trong ngữ cảnh request mang đúng workspaceId', async () => {
    const seen: Record<string, string | null | undefined> = {};
    const { service, search } = make({
      workspaces: [ws('A'), ws('B')],
      data: { A: [row({ id: 'a1' })], B: [row({ id: 'b1' })] },
    });
    search.mockImplementation((wsId: string) => {
      seen[wsId] = getStore()?.workspaceId;
      return Promise.resolve({
        data: [],
        pageInfo: { hasNextPage: false, endCursor: null, limit: 1 },
      });
    });
    await service.search(USER, { jql: 'type = Bug', limit: 10 });
    expect(search.mock.calls.map((c) => c[0]).sort()).toEqual(['A', 'B']);
    expect(seen).toEqual({ A: 'A', B: 'B' });
  });

  it('workspace mà vai trò không có project:view (guard của /search sẽ 403) bị bỏ qua; admin hệ thống thì không', async () => {
    const base = { workspaces: [ws('A'), ws('B')], perms: { B: [] as string[] } };
    const a = make(base);
    await a.service.search(USER, { jql: 'type = Bug', limit: 10 });
    expect(a.search.mock.calls.map((c) => c[0])).toEqual(['A']);
    const b = make({ ...base, isSystemAdmin: true });
    await b.service.search(USER, { jql: 'type = Bug', limit: 10 });
    expect(b.search.mock.calls.map((c) => c[0]).sort()).toEqual(['A', 'B']);
    const own = make({ ...base, perms: { B: ['project:view:own'] } });
    await own.service.search(USER, { jql: 'type = Bug', limit: 10 });
    expect(own.search.mock.calls.map((c) => c[0]).sort()).toEqual(['A', 'B']);
  });

  it('gộp nhiều workspace theo (updatedAt DESC, id ASC), mỗi trang tối đa limit', async () => {
    const t = (n: number) => `2026-03-0${n}T00:00:00.000Z`;
    const { service } = make({
      workspaces: [ws('A'), ws('B')],
      data: {
        A: [row({ id: 'a1', updatedAt: t(1) }), row({ id: 'a3', updatedAt: t(3) })],
        B: [row({ id: 'b2', updatedAt: t(2) }), row({ id: 'b3', updatedAt: t(3) })],
      },
    });
    const res = await service.search(USER, { jql: 'type = Bug', limit: 3 });
    expect(ids(res)).toEqual(['a3', 'b3', 'b2']);
    expect(res.pageInfo).toMatchObject({ hasNextPage: true, limit: 3 });
  });

  it('phân trang 3 trang qua 3 workspace: không trùng, không sót, đúng thứ tự (sortKey, id)', async () => {
    const data: Record<string, Row[]> = { A: [], B: [], C: [] };
    // 21 việc, nhiều cặp trùng updatedAt giữa các workspace để ép dùng id làm khoá phụ.
    for (let i = 0; i < 21; i++) {
      const w = (['A', 'B', 'C'] as const)[i % 3]!;
      data[w]!.push(
        row({
          id: `${w}${String(i).padStart(2, '0')}`,
          updatedAt: `2026-03-${10 + (i % 5)}T00:00:00.000Z`,
        }),
      );
    }
    const all = Object.values(data).flat();
    const { service } = make({ workspaces: [ws('A'), ws('B'), ws('C')], data });
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const res = await service.search(USER, { jql: 'type = Bug', limit: 8, cursor });
      seen.push(...ids(res));
      pages++;
      if (!(res.pageInfo as { hasNextPage: boolean }).hasNextPage) break;
      cursor = (res.pageInfo as { endCursor: string }).endCursor;
      expect(pages).toBeLessThan(10);
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(all.map((r) => r.id).sort());
  });

  it('thứ tự toàn cục của các trang liền nhau là (updatedAt DESC, id ASC)', async () => {
    const data: Record<string, Row[]> = { A: [], B: [] };
    for (let i = 0; i < 12; i++) {
      const w = i % 2 ? 'A' : 'B';
      data[w]!.push(
        row({ id: `${w}${i}`, updatedAt: `2026-03-${10 + Math.floor(i / 2)}T00:00:00.000Z` }),
      );
    }
    const { service } = make({ workspaces: [ws('A'), ws('B')], data });
    const order: Row[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await service.search(USER, { jql: 'type = Bug', limit: 5, cursor });
      order.push(...(res.data as unknown as Row[]));
      if (!(res.pageInfo as { hasNextPage: boolean }).hasNextPage) break;
      cursor = (res.pageInfo as { endCursor: string }).endCursor;
    }
    const expected = [...order].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
    expect(order.map((r) => r.id)).toEqual(expected.map((r) => r.id));
  });

  it('ORDER BY due ASC: việc không có hạn xuống cuối (nulls last), xuyên workspace', async () => {
    // Mock tìm kiếm trả sẵn từng workspace đã sắp theo due ASC (DB làm việc đó); service chỉ gộp.
    const sorted = {
      A: [row({ id: 'a-late', dueDate: '2026-05-01T00:00:00.000Z' }), row({ id: 'a-none' })],
      B: [row({ id: 'b-soon', dueDate: '2026-04-01T00:00:00.000Z' })],
    };
    const { service, search } = make({ workspaces: [ws('A'), ws('B')] });
    search.mockImplementation((wsId: string) =>
      Promise.resolve({
        data: sorted[wsId as 'A' | 'B'],
        pageInfo: { hasNextPage: false, endCursor: null, limit: 10 },
      }),
    );
    const res = await service.search(USER, { jql: 'type = Bug ORDER BY due ASC', limit: 10 });
    expect(ids(res)).toEqual(['b-soon', 'a-late', 'a-none']);
  });

  it('ORDER BY due DESC: việc không có hạn lên đầu (nulls first như Postgres)', async () => {
    const sorted = {
      A: [row({ id: 'a-none' }), row({ id: 'a-late', dueDate: '2026-05-01T00:00:00.000Z' })],
      B: [row({ id: 'b-soon', dueDate: '2026-04-01T00:00:00.000Z' })],
    };
    const { service, search } = make({ workspaces: [ws('A'), ws('B')] });
    search.mockImplementation((wsId: string) =>
      Promise.resolve({
        data: sorted[wsId as 'A' | 'B'],
        pageInfo: { hasNextPage: false, endCursor: null, limit: 10 },
      }),
    );
    const res = await service.search(USER, { jql: 'type = Bug ORDER BY due DESC', limit: 10 });
    expect(ids(res)).toEqual(['a-none', 'a-late', 'b-soon']);
  });

  it('giá trị không có ở MỘT workspace → workspace đó 0 việc, không lỗi', async () => {
    const { service } = make({
      workspaces: [ws('A'), ws('B')],
      data: { A: [row({ id: 'a1' })], B: [row({ id: 'b1' })] },
      errors: { B: new BusinessRuleException('Không có trạng thái "Chờ test"') },
    });
    const res = await service.search(USER, { jql: 'status = "Chờ test"', limit: 10 });
    expect(ids(res)).toEqual(['a1']);
    expect(res.pageInfo).toMatchObject({ hasNextPage: false });
  });

  it('giá trị không có ở MỌI workspace → 422 cùng dạng lỗi như tìm kiếm workspace', async () => {
    const err = new BusinessRuleException('Không có trạng thái "Chờ test"');
    const { service } = make({ workspaces: [ws('A'), ws('B')], errors: { A: err, B: err } });
    await expect(service.search(USER, { jql: 'status = "Chờ test"', limit: 10 })).rejects.toBe(err);
  });

  it('lỗi KHÁC lỗi nghiệp vụ (vd DB) vẫn ném, không bị nuốt thành 0 việc', async () => {
    const { service } = make({
      workspaces: [ws('A'), ws('B')],
      data: { A: [row({ id: 'a1' })] },
      errors: { B: new Error('db down') },
    });
    await expect(service.search(USER, { jql: 'type = Bug', limit: 10 })).rejects.toThrow('db down');
  });

  it('JQL sai cú pháp → 422 ngay, không gọi workspace nào', async () => {
    const { service, search } = make({ workspaces: [ws('A'), ws('B')] });
    await expect(service.search(USER, { jql: 'type = = Bug', limit: 10 })).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('JQL không hợp lệ') as unknown,
    });
    expect(search).not.toHaveBeenCalled();
  });

  it('con trỏ hỏng → 422', async () => {
    const { service } = make({ workspaces: [ws('A')] });
    await expect(
      service.search(USER, { jql: 'type = Bug', limit: 10, cursor: '!!không-phải-base64!!' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('không thuộc workspace nào → trang rỗng', async () => {
    const { service, search } = make({ workspaces: [] });
    const res = await service.search(USER, { jql: 'type = Bug', limit: 10 });
    expect(res.data).toEqual([]);
    expect(res.pageInfo).toMatchObject({ hasNextPage: false, endCursor: null });
    expect(search).not.toHaveBeenCalled();
  });

  it('limit bị kẹp trong 1..200', async () => {
    const { service, search } = make({ data: { A: [] } });
    await service.search(USER, { jql: 'type = Bug', limit: 9999 });
    expect(search.mock.calls[0]![2]).toMatchObject({ limit: 200 });
    await service.search(USER, { jql: 'type = Bug', limit: 0 });
    expect(search.mock.calls[1]![2]).toMatchObject({ limit: 1 });
  });

  it('chỉ bỏ gợi ý xếp hạng full-text khi gộp NHIỀU workspace', async () => {
    const one = make({ workspaces: [ws('A')], data: { A: [] } });
    await one.service.search(USER, { jql: 'text ~ "x"', limit: 10 });
    expect(one.search.mock.calls[0]![2]).toMatchObject({ ignoreRankHint: false });
    const two = make({ workspaces: [ws('A'), ws('B')], data: { A: [], B: [] } });
    await two.service.search(USER, { jql: 'text ~ "x"', limit: 10 });
    expect(two.search.mock.calls[0]![2]).toMatchObject({ ignoreRankHint: true });
  });

  it('con trỏ chứa workspace không còn là của người dùng thì bị bỏ qua', async () => {
    const data = { A: [row({ id: 'a1' })] };
    const { service } = make({ workspaces: [ws('A')], data });
    const cursor = Buffer.from(JSON.stringify({ wsCursors: { GONE: 'x', A: null } })).toString(
      'base64',
    );
    const res = await service.search(USER, { jql: 'type = Bug', limit: 10, cursor });
    expect(ids(res)).toEqual(['a1']);
  });
});
