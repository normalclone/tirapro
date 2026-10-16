import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IssueDto } from '@tirapro/types';
import { BusinessRuleException, NotFoundAppException } from '../../common/exceptions/app.exception';
import { ExportService } from './export.service';
import { resolveIssueCsvColumns, DEFAULT_ISSUE_CSV_COLUMNS } from './issues-csv';

function issue(over: Partial<IssueDto> = {}): IssueDto {
  return {
    id: 'i1',
    key: 'DEMO-1',
    summary: 'Tiêu đề',
    projectId: 'p1',
    sprintId: null,
    type: { id: 't', name: 'Bug' },
    status: { id: 's', name: 'Đang làm', category: 'IN_PROGRESS' },
    priority: { id: 'pr', name: 'Cao' },
    severity: { id: 'sv', name: 'Nghiêm trọng' },
    assignee: { id: 'u1', displayName: 'An' },
    reporter: { id: 'u2', displayName: 'Bình' },
    storyPoints: 3,
    startDate: '2026-10-01T00:00:00.000Z',
    dueDate: '2026-10-09T00:00:00.000Z',
    labels: [
      { id: 'l1', name: 'a' },
      { id: 'l2', name: 'b' },
    ],
    createdAt: '2026-10-01T10:30:00.000Z',
    updatedAt: '2026-10-02T17:00:00.000Z',
    ...over,
  } as unknown as IssueDto;
}

const page = (data: IssueDto[], hasNextPage = false) => ({
  data,
  pageInfo: { hasNextPage, endCursor: hasNextPage ? 'c' : null, limit: 200 },
});

function setup(opts: { query?: ReturnType<typeof vi.fn>; search?: ReturnType<typeof vi.fn> } = {}) {
  const prisma = {
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: 'p1', key: 'DEMO' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'p1', key: 'DEMO' }]),
    },
    sprint: {
      findFirst: vi.fn().mockResolvedValue({ id: 'sp1', name: 'Sprint 1' }),
      findMany: vi.fn().mockResolvedValue([{ id: 'sp1', name: 'Sprint 1' }]),
    },
  };
  const query = opts.query ?? vi.fn().mockResolvedValue(page([issue()]));
  const search = opts.search ?? vi.fn().mockResolvedValue(page([issue()]));
  const access = { assertCanSee: vi.fn().mockResolvedValue(undefined) };
  const svc = new ExportService(
    prisma as never,
    { query } as never,
    { search } as never,
    access as never,
  );
  return { svc, prisma, query, search, access };
}

describe('ExportService.exportIssuesCsv', () => {
  it('preset backlog: where chỉ gồm việc chưa Done, chưa vào sprint, đúng dự án; CSV có BOM + header', async () => {
    const { svc, query } = setup({
      query: vi.fn().mockResolvedValue(page([issue({ summary: '=HYPERLINK("x")' })])),
    });
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'backlog' });
    expect(query.mock.calls[0]![1]).toMatchObject({
      projectId: 'p1',
      sprintId: null,
      status: { category: { not: 'DONE' } },
    });
    expect(query.mock.calls[0]![2]).toEqual([{ rank: 'asc' }]);
    // cùng tập với màn Việc chờ: ẩn việc chưa duyệt/đã từ chối (TRIAGE_VISIBLE)
    expect(query.mock.calls[0]![1]).toMatchObject({
      AND: [{ OR: [{ triageState: null }, { triageState: 'ACCEPTED' }] }],
    });
    // viewerId luôn truyền (dự án riêng tư): tham số thứ 6 của IssuesService.query
    expect(query.mock.calls[0]![5]).toBe('u1');
    expect(out.csv.startsWith('﻿Mã,')).toBe(true);
    expect(out.csv).toContain("'=HYPERLINK"); // chống công thức
    expect(out.truncated).toBe(false);
    expect(out.filename).toMatch(/^tirapro-DEMO-backlog-\d{8}\.csv$/);
  });

  it('preset bugs: loại BUG, mới nhất trước', async () => {
    const { svc, query } = setup();
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'bugs' });
    // định nghĩa "bug" dùng chung với báo cáo QA / KR OPEN_BUGS (key BUG hoặc tên "Bug") + chỉ việc đã duyệt
    expect(query.mock.calls[0]![1]).toMatchObject({
      projectId: 'p1',
      type: { OR: [{ key: 'BUG' }, { name: { equals: 'Bug', mode: 'insensitive' } }] },
      AND: [{ OR: [{ triageState: null }, { triageState: 'ACCEPTED' }] }],
    });
    expect(query.mock.calls[0]![2]).toEqual([{ createdAt: 'desc' }]);
    expect(out.filename).toMatch(/-bugs-/);
  });

  it('sprintId: lọc đúng sprint của dự án, cột Sprint có tên', async () => {
    const { svc, query, prisma } = setup({
      query: vi.fn().mockResolvedValue(page([issue({ sprintId: 'sp1' })])),
    });
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', sprintId: 'sp1' });
    expect(prisma.sprint.findFirst.mock.calls[0]![0].where).toMatchObject({
      id: 'sp1',
      projectId: 'p1',
      deletedAt: null,
    });
    expect(query.mock.calls[0]![1]).toMatchObject({
      projectId: 'p1',
      sprintId: 'sp1',
      AND: [{ OR: [{ triageState: null }, { triageState: 'ACCEPTED' }] }],
    });
    expect(out.csv).toContain('Sprint 1');
    expect(out.filename).toMatch(/^tirapro-DEMO-sprint-sprint-1-\d{8}\.csv$/);
  });

  it('JQL đi qua SearchService.search (không tự dựng where), có người xem + trang 200', async () => {
    const { svc, search, query } = setup();
    const out = await svc.exportIssuesCsv('w1', 'u1', { jql: 'type = Bug' });
    expect(query).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith(
      'w1',
      'u1',
      expect.objectContaining({ mode: 'jql', jql: 'type = Bug', limit: 200 }),
    );
    expect(out.filename).toMatch(/^tirapro-workspace-jql-\d{8}\.csv$/);
  });

  it('cột theo columns, luôn có Mã đầu tiên; dấu ; khi delimiter=semicolon', async () => {
    const { svc } = setup();
    const out = await svc.exportIssuesCsv('w1', 'u1', {
      jql: 'x = 1',
      columns: 'status,summary,bogus',
      delimiter: 'semicolon',
    });
    expect(out.csv.split('\r\n')[0]).toBe('﻿Mã;Trạng thái;Tiêu đề');
  });

  it('bộ cột mặc định đủ các cột và định dạng ngày/nhãn/sprint', async () => {
    const { svc } = setup({
      query: vi.fn().mockResolvedValue(page([issue({ sprintId: 'sp1' })])),
    });
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'bugs' });
    const [head, row] = out.csv.split('\r\n');
    expect(head).toBe(
      '﻿Mã,Tiêu đề,Loại,Trạng thái,Ưu tiên,Mức nghiêm trọng,Người phụ trách,Người báo cáo,Sprint,Điểm,Bắt đầu,Hạn,Nhãn,Tạo,Cập nhật',
    );
    expect(row).toBe(
      'DEMO-1,Tiêu đề,Bug,Đang làm,Cao,Nghiêm trọng,An,Bình,Sprint 1,3,01/10/2026,09/10/2026,a; b,01/10/2026 17:30,03/10/2026 00:00',
    );
  });

  it('dừng ở 5.000 dòng (25 trang × 200) và báo truncated', async () => {
    const full = Array.from({ length: 200 }, (_, n) => issue({ id: `i${n}`, key: `DEMO-${n}` }));
    const query = vi.fn().mockResolvedValue(page(full, true));
    const { svc } = setup({ query });
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'backlog' });
    expect(query).toHaveBeenCalledTimes(25);
    expect(out.truncated).toBe(true);
    expect(out.csv.trimEnd().split('\r\n')).toHaveLength(1 + 5000);
  });

  it('đúng 5.000 dòng và hết trang → không truncated', async () => {
    const full = Array.from({ length: 200 }, (_, n) => issue({ id: `i${n}` }));
    const query = vi.fn();
    for (let n = 0; n < 24; n++) query.mockResolvedValueOnce(page(full, true));
    query.mockResolvedValueOnce(page(full, false));
    const { svc } = setup({ query });
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'backlog' });
    expect(out.truncated).toBe(false);
  });

  it('preset/sprintId thiếu projectId → BusinessRuleException', async () => {
    const { svc } = setup();
    await expect(svc.exportIssuesCsv('w1', 'u1', { preset: 'bugs' })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
    await expect(svc.exportIssuesCsv('w1', 'u1', { sprintId: 'sp1' })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('thiếu điều kiện (không jql/preset/sprintId) → BusinessRuleException', async () => {
    const { svc } = setup();
    await expect(svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1' })).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('jql cùng preset/sprintId, hoặc backlog cùng sprintId → BusinessRuleException', async () => {
    const { svc } = setup();
    await expect(
      svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', jql: 'x=1', preset: 'bugs' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    await expect(
      svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'backlog', sprintId: 'sp1' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('sprintId không thuộc projectId → NotFoundAppException, không truy vấn việc', async () => {
    const { svc, prisma, query } = setup();
    prisma.sprint.findFirst.mockResolvedValue(null);
    await expect(
      svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', sprintId: 'khac' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
    expect(query).not.toHaveBeenCalled();
  });

  it('projectId không có trong workspace → NotFoundAppException', async () => {
    const { svc, prisma } = setup();
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      svc.exportIssuesCsv('w1', 'u1', { projectId: 'nope', jql: 'x = 1' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('ExportService.exportIssuesCsv — quyền, ngày, số dòng', () => {
  afterEach(() => vi.useRealTimers());

  it('tự kiểm dự án riêng tư với người xuất; người ngoài → NotFound, không truy vấn việc', async () => {
    const { svc, access, query } = setup();
    await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'bugs' });
    expect(access.assertCanSee).toHaveBeenCalledWith('u1', 'w1', 'p1', 'Dự án');
    access.assertCanSee.mockRejectedValue(new NotFoundAppException('Dự án'));
    query.mockClear();
    await expect(
      svc.exportIssuesCsv('w1', 'u2', { projectId: 'p1', preset: 'bugs' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
    expect(query).not.toHaveBeenCalled();
  });

  it('tên file dùng NGÀY giờ Việt Nam (03:00 thứ Hai VN còn là Chủ nhật UTC)', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-18T20:00:00Z') });
    const { svc } = setup();
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'bugs' });
    expect(out.filename).toBe('tirapro-DEMO-bugs-20261019.csv');
  });

  it('trả số dòng dữ liệu (sprint rỗng → 0 để FE không tải file trống)', async () => {
    const { svc } = setup({ query: vi.fn().mockResolvedValue(page([])) });
    const out = await svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', sprintId: 'sp1' });
    expect(out.rows).toBe(0);
    const full = setup();
    expect(
      (await full.svc.exportIssuesCsv('w1', 'u1', { projectId: 'p1', preset: 'bugs' })).rows,
    ).toBe(1);
  });

  it('chống công thức cả khi dùng dấu ; và ô có dấu ; bên trong', async () => {
    const { svc } = setup({
      query: vi.fn().mockResolvedValue(page([issue({ summary: '@SUM(A1;A2)' })])),
    });
    const out = await svc.exportIssuesCsv('w1', 'u1', {
      projectId: 'p1',
      preset: 'bugs',
      columns: 'summary',
      delimiter: 'semicolon',
    });
    expect(out.csv.split('\r\n')[1]).toBe('DEMO-1;"\'@SUM(A1;A2)"');
  });
});

describe('resolveIssueCsvColumns', () => {
  it('không truyền → mặc định; id lạ/trùng bỏ; key luôn đầu', () => {
    expect(resolveIssueCsvColumns(undefined)).toEqual([...DEFAULT_ISSUE_CSV_COLUMNS]);
    expect(resolveIssueCsvColumns('zzz')).toEqual([...DEFAULT_ISSUE_CSV_COLUMNS]);
    expect(resolveIssueCsvColumns('due, status,due,created,key')).toEqual([
      'key',
      'due',
      'status',
      'created',
    ]);
  });
});
