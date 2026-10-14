import { describe, expect, it, vi } from 'vitest';
import { VersionConflictException } from '../../common/exceptions/app.exception';
import { MAX_AUTOMATION_DEPTH, RuleEngineService } from './rule-engine.service';
import { isPrivateAddress } from './actions/webhook';

const SYS = 'SYS';

function issueDto(over: Record<string, unknown> = {}) {
  return {
    id: 'i1', key: 'P-TASK-1', summary: 'Lỗi đăng nhập', workspaceId: 'w1', projectId: 'p1',
    status: { id: 's1', name: 'Todo', category: 'TODO' },
    type: { id: 't1' }, priority: { id: 'P1', name: 'High' }, resolution: null,
    assigneeId: null, reporterId: 'rep1', sprintId: null, storyPoints: null, dueDate: null,
    labels: [], version: 3, ...over,
  };
}

function makeRule(over: Record<string, unknown> = {}) {
  return {
    id: 'r1', workspaceId: 'w1', projectId: null, name: 'Giao cho lead', enabled: true, trigger: 'ISSUE_CREATED',
    triggerConfig: {}, createdById: 'u1', lastRunAt: null, runCount: 0,
    conditions: [{ field: 'priorityId', op: 'eq', value: 'P1' }],
    actions: [{ type: 'assign', mode: 'lead' }],
    ...over,
  };
}

function setup(rule = makeRule(), issue = issueDto()) {
  const prisma = {
    user: { upsert: vi.fn(() => Promise.resolve({ id: SYS })), findUnique: vi.fn(() => Promise.resolve({ displayName: 'Bình' })) },
    project: { findFirst: vi.fn(() => Promise.resolve({ leadId: 'lead1' })) },
    workspaceMembership: {
      findFirst: vi.fn(() => Promise.resolve({ userId: 'x' })),
      findMany: vi.fn(() => Promise.resolve([{ userId: 'a' }, { userId: 'b' }])),
    },
    projectMembership: { findMany: vi.fn(() => Promise.resolve([])) },
    status: { findUnique: vi.fn(() => Promise.resolve({ name: 'Done' })) },
    label: { findFirst: vi.fn(() => Promise.resolve({ id: 'L1', name: 'bug' })) },
    issueLabel: { createMany: vi.fn(() => Promise.resolve({ count: 1 })), deleteMany: vi.fn(() => Promise.resolve({ count: 1 })) },
    issue: { count: vi.fn(() => Promise.resolve(1)), findFirst: vi.fn(() => Promise.resolve({ workspaceId: 'w1' })) },
    automationRun: { create: vi.fn(() => Promise.resolve({})), deleteMany: vi.fn(() => Promise.resolve({ count: 0 })) },
    automationRule: {
      update: vi.fn(() => Promise.resolve({})),
      findUnique: vi.fn(() => Promise.resolve({ runCount: 0 })),
      findMany: vi.fn(() => Promise.resolve([])),
      updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
    },
    notification: { create: vi.fn(() => Promise.resolve({ id: 'n1', type: 'ISSUE_UPDATED', issueId: 'i1', commentId: null, actorId: SYS, payload: {}, createdAt: new Date() })) },
  };
  let current = issue;
  const issues = {
    query: vi.fn(() => Promise.resolve({ data: [current] })),
    getByKey: vi.fn(() => Promise.resolve(current)),
    update: vi.fn((_ws: string, _uid: string, _id: string, input: Record<string, unknown>) => {
      current = { ...current, ...input, version: current.version + 1 };
      return Promise.resolve(current);
    }),
    transition: vi.fn(() => Promise.resolve(current)),
    create: vi.fn(() => Promise.resolve({ key: 'P-SUB-1' })),
  };
  const comments = { create: vi.fn(() => Promise.resolve({})) };
  const rules = { activeFor: vi.fn(() => Promise.resolve([rule])) };
  const events = { emit: vi.fn() };
  const redis = { isAvailable: () => false, getClient: () => null };
  const engine = new RuleEngineService(prisma as never, issues as never, comments as never, rules as never, events as never, redis as never);
  return { engine, prisma, issues, comments, rules, events };
}

const lastRun = (prisma: ReturnType<typeof setup>['prisma']) =>
  (prisma.automationRun.create.mock.calls.at(-1) as unknown as [{ data: { status: string; log: Array<{ ok: boolean; message: string }> } }])[0].data;

describe('RuleEngineService — kích hoạt theo sự kiện', () => {
  it('ISSUE_CREATED + priorityId eq P1 + assign lead => issues.update với assigneeId=lead, chạy bằng user hệ thống', async () => {
    const { engine, issues, prisma } = setup();
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });

    expect(issues.update).toHaveBeenCalledTimes(1);
    const [ws, actor, id, input, meta] = issues.update.mock.calls[0] as unknown as [string, string, string, Record<string, unknown>, Record<string, unknown>];
    expect([ws, actor, id]).toEqual(['w1', SYS, 'i1']);
    expect(input).toMatchObject({ assigneeId: 'lead1', version: 3 });
    // sự kiện do hành động này phát ra mang độ sâu +1 và chuỗi chứa quy tắc
    expect(meta).toEqual({ automationDepth: 1, automationChain: ['r1'] });
    expect(lastRun(prisma).status).toBe('SUCCESS');
    expect(prisma.automationRule.update.mock.calls[0]).toMatchObject([{ data: { runCount: { increment: 1 } } }]);
  });

  it(`depth >= ${MAX_AUTOMATION_DEPTH} => bỏ qua, ghi SKIPPED, không gọi issues.update`, async () => {
    const { engine, issues, prisma } = setup();
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: SYS, meta: { automationDepth: MAX_AUTOMATION_DEPTH } });
    expect(issues.update).not.toHaveBeenCalled();
    expect(lastRun(prisma).status).toBe('SKIPPED');
    // SKIPPED không tính là một lần chạy
    expect(prisma.automationRule.update).not.toHaveBeenCalled();
  });

  it('depth 2 vẫn chạy (chỉ chặn từ 3)', async () => {
    const { engine, issues } = setup();
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: SYS, meta: { automationDepth: 2, automationChain: ['other'] } });
    expect(issues.update).toHaveBeenCalledTimes(1);
    expect((issues.update.mock.calls[0] as unknown[])[4]).toEqual({ automationDepth: 3, automationChain: ['other', 'r1'] });
  });

  it('quy tắc đã nằm trong chuỗi => không chạy lại chính nó', async () => {
    const { engine, issues, prisma } = setup();
    await engine.handle('ISSUE_UPDATED', { issue: issueDto() as never, actorId: SYS, meta: { automationDepth: 1, automationChain: ['r1'] } });
    expect(issues.update).not.toHaveBeenCalled();
    expect(lastRun(prisma).status).toBe('SKIPPED');
  });

  it('điều kiện sai => SKIPPED, không hành động', async () => {
    const { engine, issues, prisma } = setup(makeRule(), issueDto({ priority: { id: 'P3', name: 'Low' } }));
    await engine.handle('ISSUE_CREATED', { issue: issueDto({ priority: { id: 'P3', name: 'Low' } }) as never, actorId: 'u1' });
    expect(issues.update).not.toHaveBeenCalled();
    expect(lastRun(prisma).status).toBe('SKIPPED');
    expect(lastRun(prisma).log[0]?.message).toContain('priorityId eq');
  });

  it('ISSUE_TRANSITIONED chỉ chạy khi toStatusId khớp cấu hình', async () => {
    const rule = makeRule({ trigger: 'ISSUE_TRANSITIONED', triggerConfig: { toStatusId: 'done' }, conditions: [] });
    const a = setup(rule);
    await a.engine.handle('ISSUE_TRANSITIONED', { issue: issueDto({ status: { id: 'doing', name: 'Doing', category: 'IN_PROGRESS' } }) as never, actorId: 'u1' });
    expect(a.prisma.automationRun.create).not.toHaveBeenCalled();
    const b = setup(rule);
    await b.engine.handle('ISSUE_TRANSITIONED', { issue: issueDto({ status: { id: 'done', name: 'Done', category: 'DONE' } }) as never, actorId: 'u1' });
    expect(b.prisma.automationRun.create).toHaveBeenCalledTimes(1);
  });

  it('ISSUE_UPDATED với fields chỉ chạy khi trường đó vừa đổi', async () => {
    const rule = makeRule({ trigger: 'ISSUE_UPDATED', triggerConfig: { fields: ['priorityId'] }, conditions: [] });
    const a = setup(rule);
    await a.engine.handle('ISSUE_UPDATED', { issue: issueDto() as never, actorId: 'u1', changedFields: ['summary'] });
    expect(a.prisma.automationRun.create).not.toHaveBeenCalled();
    const b = setup(rule);
    await b.engine.handle('ISSUE_UPDATED', { issue: issueDto() as never, actorId: 'u1', changedFields: ['priorityId'] });
    expect(b.prisma.automationRun.create).toHaveBeenCalledTimes(1);
  });

  it('điều kiện JQL: compile rồi đếm đúng issue này (count === 1)', async () => {
    const rule = makeRule({ conditions: [{ jql: 'priority = High' }] });
    const { engine, prisma, issues } = setup(rule);
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    const arg = (prisma.issue.count.mock.calls[0] as unknown as [{ where: { id: string; deletedAt: null; AND: unknown[] } }])[0];
    expect(arg.where).toMatchObject({ id: 'i1', workspaceId: 'w1', deletedAt: null });
    expect(arg.where.AND).toHaveLength(1);
    expect(issues.update).toHaveBeenCalled();

    const none = setup(rule);
    none.prisma.issue.count.mockResolvedValueOnce(0);
    await none.engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    expect(none.issues.update).not.toHaveBeenCalled();
  });
});

describe('RuleEngineService — hành động', () => {
  it('setField + assign liền nhau gộp thành MỘT lần update (nguyên tử)', async () => {
    const rule = makeRule({ conditions: [], actions: [{ type: 'setField', field: 'storyPoints', value: 5 }, { type: 'assign', mode: 'reporter' }] });
    const { engine, issues } = setup(rule);
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    expect(issues.update).toHaveBeenCalledTimes(1);
    expect((issues.update.mock.calls[0] as unknown[])[3]).toMatchObject({ storyPoints: 5, assigneeId: 'rep1' });
  });

  it('giá trị đã đúng => không update (không phát sự kiện thừa, chặn vòng lặp)', async () => {
    const rule = makeRule({ conditions: [], actions: [{ type: 'setField', field: 'priorityId', value: 'P1' }] });
    const { engine, issues, prisma } = setup(rule);
    await engine.handle('ISSUE_UPDATED', { issue: issueDto() as never, actorId: 'u1' });
    expect(issues.update).not.toHaveBeenCalled();
    expect(lastRun(prisma).status).toBe('SUCCESS');
    expect(lastRun(prisma).log[0]?.message).toMatch(/không có gì cần đổi/i);
  });

  it('action lỗi => FAILED, dừng các action sau, bước trước đó giữ nguyên', async () => {
    const rule = makeRule({
      conditions: [],
      actions: [{ type: 'addLabel', labelId: 'L1' }, { type: 'assign', mode: 'user', userId: 'ghost' }, { type: 'addComment', body: 'xong' }],
    });
    const { engine, prisma, comments } = setup(rule);
    prisma.workspaceMembership.findFirst.mockResolvedValueOnce(null as never);
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    const run = lastRun(prisma);
    expect(run.status).toBe('FAILED');
    expect(prisma.issueLabel.createMany).toHaveBeenCalledTimes(1); // bước 1 đã áp dụng
    expect(comments.create).not.toHaveBeenCalled(); // bước 3 không chạy
    expect(run.log.map((l) => l.ok)).toEqual([true, false, false]);
  });

  it('OCC: version lệch giữa chừng => đọc lại issue và thử lại', async () => {
    const rule = makeRule({ conditions: [], actions: [{ type: 'assign', mode: 'lead' }] });
    const { engine, issues, prisma } = setup(rule);
    issues.update.mockRejectedValueOnce(new VersionConflictException('lệch', { version: 4 }));
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    expect(issues.update).toHaveBeenCalledTimes(2);
    expect(lastRun(prisma).status).toBe('SUCCESS');
  });

  it('addComment thay {{issue.key}} {{issue.summary}} {{actor.displayName}} và truyền meta', async () => {
    const rule = makeRule({ conditions: [], actions: [{ type: 'addComment', body: '{{actor.displayName}} vừa tạo {{issue.key}}: {{issue.summary}}' }] });
    const { engine, comments } = setup(rule);
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    const args = comments.create.mock.calls[0] as unknown as [string, string, string, { body: string }, unknown];
    expect(args[3].body).toBe('Bình vừa tạo P-TASK-1: Lỗi đăng nhập');
    expect(args[1]).toBe(SYS);
    expect(args[4]).toEqual({ automationDepth: 1, automationChain: ['r1'] });
  });

  it('transition gọi issues.transition với version mới nhất và meta', async () => {
    const rule = makeRule({ conditions: [], actions: [{ type: 'transition', toStatusId: 'done' }] });
    const { engine, issues } = setup(rule);
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    expect(issues.transition).toHaveBeenCalledWith('w1', SYS, 'i1', { toStatusId: 'done', version: 3 }, { automationDepth: 1, automationChain: ['r1'] });
  });

  it('roundRobin luân phiên theo runCount', async () => {
    const rule = makeRule({ conditions: [], actions: [{ type: 'assign', mode: 'roundRobin' }] });
    const { engine, issues, prisma } = setup(rule);
    prisma.automationRule.findUnique.mockResolvedValueOnce({ runCount: 3 });
    await engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' });
    expect((issues.update.mock.calls[0] as unknown[])[3]).toMatchObject({ assigneeId: 'b' }); // 3 % 2 = 1
  });
});

describe('RuleEngineService — chạy thử, lịch, người dùng hệ thống', () => {
  it('dryRun: trả log, KHÔNG ghi gì và không tạo AutomationRun', async () => {
    const rule = makeRule({ actions: [{ type: 'assign', mode: 'lead' }, { type: 'addComment', body: 'hi' }, { type: 'addLabel', labelId: 'L1' }] });
    const { engine, issues, comments, prisma } = setup(rule);
    const res = await engine.dryRun('w1', rule as never, 'P-TASK-1');
    expect(res.status).toBe('SUCCESS');
    expect(res.log.length).toBeGreaterThanOrEqual(3);
    expect(issues.update).not.toHaveBeenCalled();
    expect(comments.create).not.toHaveBeenCalled();
    expect(prisma.issueLabel.createMany).not.toHaveBeenCalled();
    expect(prisma.automationRun.create).not.toHaveBeenCalled();
  });

  it('dryRun ngoài phạm vi dự án của quy tắc => SKIPPED', async () => {
    const rule = makeRule({ projectId: 'other' });
    const { engine } = setup(rule);
    expect((await engine.dryRun('w1', rule as never, 'P-TASK-1')).status).toBe('SKIPPED');
  });

  it('cronMatches khớp đúng phút', () => {
    const { engine } = setup();
    const t = new Date('2026-10-15T09:30:00Z');
    expect(engine.cronMatches('30 9 * * *', t)).toBe(true);
    expect(engine.cronMatches('*/15 9 * * *', t)).toBe(true);
    expect(engine.cronMatches('31 9 * * *', t)).toBe(false);
    expect(engine.cronMatches('không phải cron', t)).toBe(false);
  });

  it('runScheduled: chỉ chạy rule có cron khớp phút, nhận lượt nguyên tử, chạy trên tập issue từ JQL', async () => {
    const rule = makeRule({ trigger: 'SCHEDULED', triggerConfig: { cron: '30 9 * * *' }, conditions: [{ jql: 'priority = High' }], actions: [{ type: 'addLabel', labelId: 'L1' }] });
    const other = makeRule({ id: 'r2', trigger: 'SCHEDULED', triggerConfig: { cron: '0 0 * * *' }, conditions: [{ jql: 'priority = High' }] });
    const { engine, prisma, issues } = setup(rule);
    prisma.automationRule.findMany.mockResolvedValueOnce([rule, other] as never);
    await engine.runScheduled(new Date('2026-10-15T09:30:20Z'));
    expect(prisma.automationRule.updateMany).toHaveBeenCalledTimes(1); // chỉ r1 khớp
    expect(issues.query).toHaveBeenCalled();
    expect(prisma.issueLabel.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.issue.count).not.toHaveBeenCalled(); // JQL đã lọc ở truy vấn chọn issue
  });

  it('runScheduled: lượt đã bị node khác nhận (count=0) => không chạy', async () => {
    const rule = makeRule({ trigger: 'SCHEDULED', triggerConfig: { cron: '30 9 * * *' }, conditions: [{ jql: 'priority = High' }] });
    const { engine, prisma, issues } = setup(rule);
    prisma.automationRule.findMany.mockResolvedValueOnce([rule] as never);
    prisma.automationRule.updateMany.mockResolvedValueOnce({ count: 0 });
    await engine.runScheduled(new Date('2026-10-15T09:30:20Z'));
    expect(issues.query).not.toHaveBeenCalled();
  });

  it('systemUserId upsert theo email, không phải admin, không mật khẩu, và được cache', async () => {
    const { engine, prisma } = setup();
    await engine.onModuleInit();
    await engine.systemUserId();
    expect(prisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.user.upsert.mock.calls[0]).toMatchObject([
      { where: { email: 'automation@tirapro.local' }, create: { passwordHash: null, isSystemAdmin: false, status: 'ACTIVE' } },
    ]);
  });

  it('lỗi bên trong không bao giờ ném ra khỏi handle()', async () => {
    const { engine, rules } = setup();
    rules.activeFor.mockRejectedValueOnce(new Error('db chết'));
    await expect(engine.handle('ISSUE_CREATED', { issue: issueDto() as never, actorId: 'u1' })).resolves.toBeUndefined();
  });
});

describe('webhook — chặn địa chỉ nội bộ', () => {
  it.each(['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1'])('%s là nội bộ', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111'])('%s là công khai', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});
