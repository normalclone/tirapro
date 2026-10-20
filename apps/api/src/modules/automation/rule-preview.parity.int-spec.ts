/* eslint-disable max-lines-per-function -- spec tích hợp: một describe lớn dùng chung dữ liệu nạp một lần */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { IssueDto } from '@tirapro/types';
import {
  RULE_CONDITION_FIELDS,
  RULE_CONDITION_OPS,
  parseJql,
  previewMatchSchema,
  ruleConditionSchema,
} from '@tirapro/shared';
import { foldCase, isPgFoldSafe } from '../../common/case-fold';
import { compileJql } from '../search/jql-compiler';
import { ProjectAccessService } from '../rbac/project-access.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { RulePreviewService } from './rule-preview.service';
import { evalFieldCondition, fieldConditionToWhere, type FieldCondition } from './rule-conditions';

/**
 * ĐỐI CHỨNG TRÊN POSTGRES THẬT (ruling RC20) — OPT-IN, không chạy trong `pnpm test`.
 *
 * Spec đối chứng thường (`rule-conditions.parity.spec.ts`) chấm `where` bằng bộ mô phỏng trong bộ nhớ nên không thấy được
 * những gì CHỈ Postgres thật mới có: gấp hoa/thường của ILIKE theo locale (tiếng Việt, `İ`, `ß`, sigma cuối), so bằng
 * Float, ký tự NUL, escape `\`. Spec này nạp ~30 việc vào một DB nháp rồi so `evalFieldCondition` (engine) với
 * `fieldConditionToWhere` (qua Prisma) và với `RulePreviewService.previewMatch` TRÊN CÙNG các hàng đọc lại từ DB.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/projira_w2c?schema=public pnpm --filter @tirapro/api test:parity`
 * (đuôi `.int-spec.ts` không khớp `include` của vitest mặc định; DB nháp phải đã `migrate deploy`). Spec tự tạo workspace
 * riêng (tiền tố ngẫu nhiên) và dọn sạch khi xong; chỉ dùng DB nháp, KHÔNG BAO GIỜ trỏ vào DB demo/thật.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;

interface Fx {
  summary: string;
  assigneeId: string | null;
  reporterId: string | null;
  sprintId: string | null;
  priorityId: string | null;
  resolutionId: string | null;
  storyPoints: number | null;
  dueDate: Date | null;
  labels: string[];
  projectName: 'PUB' | 'MINE';
}

describe.skipIf(!DB_URL)('xem trước quy tắc ↔ engine trên Postgres thật', () => {
  const TAG = `par${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const id = (n: string) => `${TAG}-${n}`;
  const WS = id('ws');
  const WS2 = id('ws2');
  const EDITOR = id('editor');
  const UA = id('ua');
  const UB = id('ub');
  const P = { p1: id('p1'), p2: id('p2') };
  const R1 = id('r1');
  const S = { s1: id('s1'), s2: id('s2') };
  const SP = id('sp1');
  const L = { l1: id('l1'), l2: id('l2'), l3: id('l3') };
  const PROJ = {
    PUB: id('proj-pub'),
    MINE: id('proj-mine'),
    SECRET: id('proj-secret'),
    ARCH: id('proj-arch'),
    DEL: id('proj-del'),
    W2: id('proj-w2'),
  };

  let prisma: PrismaClient;
  let service: RulePreviewService;
  /** Hàng TRONG phạm vi (người soạn thấy, chưa xoá, dự án chưa lưu trữ) đọc lại từ DB, dạng IssueDto của engine. */
  let inScope: { id: string; dto: IssueDto }[] = [];
  let inScopeIds: string[] = [];

  const D = (s: string) => new Date(s);
  const base: Fx = {
    summary: 'plain ascii',
    assigneeId: UA,
    reporterId: UB,
    sprintId: SP,
    priorityId: P.p1,
    resolutionId: R1,
    storyPoints: 3,
    dueDate: D('2026-10-20T12:00:00.000Z'),
    labels: [L.l1],
    projectName: 'PUB',
  };
  const fx = (o: Partial<Fx>): Fx => ({ ...base, ...o });

  const FIXTURES: Fx[] = [
    // chữ tiếng Việt: hoa/thường, Đ/đ, ế NFC/NFD
    fx({ summary: 'Đăng nhập lỗi' }),
    fx({ summary: 'ĐĂNG NHẬP LỖI', assigneeId: null, sprintId: null }),
    fx({ summary: 'Lỗi đăng xuất', priorityId: null, resolutionId: null }),
    fx({ summary: 'đường đi', storyPoints: 0, labels: [] }),
    fx({ summary: 'Đường đi', storyPoints: 5, labels: [L.l1, L.l2] }),
    fx({ summary: 'ĐƯỜNG', storyPoints: 5.5, labels: [L.l2] }),
    fx({ summary: 'Kế hoạch', storyPoints: null }),
    fx({ summary: 'KẾ HOẠCH', storyPoints: 13 }),
    fx({ summary: 'Kế hoạch NFD', storyPoints: 1e21 }),
    // ký tự đại diện LIKE / escape
    fx({ summary: '100% xong' }),
    fx({ summary: 'a_b' }),
    fx({ summary: 'aXb' }),
    fx({ summary: 'c\\d' }),
    fx({ summary: 'trailing\\' }),
    fx({ summary: '' }),
    fx({ summary: 'ABC', assigneeId: UB }),
    fx({ summary: 'abc', reporterId: null }),
    // chữ hiếm (gấp hoa/thường có thể khác nhau giữa JS và glibc/ICU)
    fx({ summary: 'İSTANBUL' }),
    fx({ summary: 'Straße ẞ' }),
    fx({ summary: 'ΟΔΟΣ ΑΣ' }),
    fx({ summary: 'ǅ' }),
    // hạn chót quanh ranh giới ngày UTC
    fx({ summary: 'due-start', dueDate: D('2026-10-20T00:00:00.000Z'), storyPoints: 0.1 }),
    fx({ summary: 'due-end', dueDate: D('2026-10-20T23:59:59.999Z') }),
    fx({ summary: 'due-next', dueDate: D('2026-10-21T00:00:00.000Z') }),
    fx({ summary: 'due-prev', dueDate: D('2026-10-19T23:59:59.999Z') }),
    fx({ summary: 'due-null', dueDate: null }),
    // nhiều nhãn
    fx({ summary: 'labels-many', labels: [L.l1, L.l2, L.l3] }),
    // dự án riêng tư mà người soạn LÀ thành viên (vẫn được đếm)
    fx({ summary: 'mine-private', projectName: 'MINE', assigneeId: null }),
    fx({ summary: 'mine-private-2', projectName: 'MINE', sprintId: null, priorityId: P.p2 }),
  ];

  /* ------------------------------------------------------------------ dữ liệu ------------------------------------------------------------------ */
  beforeAll(async () => {
    process.env.DATABASE_URL = DB_URL;
    process.env.DIRECT_URL = DB_URL;
    prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
    await prisma.$connect();

    const mkUser = (uid: string) =>
      prisma.user.create({ data: { id: uid, email: `${uid}@parity.test`, displayName: uid } });
    await mkUser(EDITOR);
    await mkUser(UA);
    await mkUser(UB);
    const ws = (wid: string, slug: string) =>
      prisma.workspace.create({ data: { id: wid, name: slug, slug, ownerId: EDITOR } });
    await ws(WS, `${TAG}-a`);
    await ws(WS2, `${TAG}-b`);

    await prisma.workflow.create({ data: { id: id('wf'), workspaceId: WS, name: 'wf' } });
    await prisma.status.createMany({
      data: [
        { id: S.s1, workflowId: id('wf'), name: 'A', category: 'TODO' },
        { id: S.s2, workflowId: id('wf'), name: 'B', category: 'DONE' },
      ],
    });
    await prisma.issueType.create({ data: { id: id('t1'), workspaceId: WS, name: 'Task' } });
    await prisma.priority.createMany({
      data: [
        { id: P.p1, workspaceId: WS, name: 'High' },
        { id: P.p2, workspaceId: WS, name: 'Low' },
      ],
    });
    await prisma.resolution.create({ data: { id: R1, workspaceId: WS, name: 'Done' } });
    await prisma.role.create({
      data: { id: id('role'), workspaceId: WS, name: 'member', scope: 'PROJECT' },
    });

    const proj = (pid: string, key: string, extra: object = {}, w = WS) =>
      prisma.project.create({ data: { id: pid, workspaceId: w, key, name: key, ...extra } });
    await proj(PROJ.PUB, 'PUB');
    await proj(PROJ.MINE, 'MINE', { isPrivate: true });
    await proj(PROJ.SECRET, 'SEC', { isPrivate: true });
    await proj(PROJ.ARCH, 'ARCH', { isArchived: true, archivedAt: new Date() });
    await proj(PROJ.DEL, 'DEL', { deletedAt: new Date() });
    await proj(PROJ.W2, 'WTWO', {}, WS2);
    await prisma.projectMembership.create({
      data: { projectId: PROJ.MINE, userId: EDITOR, roleId: id('role') },
    });
    await prisma.sprint.create({ data: { id: SP, projectId: PROJ.PUB, name: 'sp', sequence: 1 } });
    await prisma.label.createMany({
      data: [L.l1, L.l2, L.l3].map((lid, i) => ({ id: lid, projectId: PROJ.PUB, name: `l${i}` })),
    });

    // Cùng bộ giá trị nhân bản sang MỌI chỗ phải KHÔNG BAO GIỜ được đếm: nếu phạm vi hỏng, số đếm lệch ngay.
    const outOf: { project: string; ws: string; deletedAt?: Date }[] = [
      { project: PROJ.SECRET, ws: WS },
      { project: PROJ.ARCH, ws: WS },
      { project: PROJ.DEL, ws: WS },
      { project: PROJ.W2, ws: WS2 },
      { project: PROJ.PUB, ws: WS, deletedAt: new Date() }, // issue xoá mềm trong dự án công khai
    ];
    let n = 0;
    const create = async (f: Fx, project: string, wsId: string, deletedAt?: Date) => {
      n += 1;
      const issue = await prisma.issue.create({
        data: {
          id: id(`i${n}`),
          workspaceId: wsId,
          projectId: project,
          number: n,
          key: `${TAG}-${n}`,
          typeId: id('t1'),
          statusId: S.s1,
          priorityId: f.priorityId,
          resolutionId: f.resolutionId,
          assigneeId: f.assigneeId,
          reporterId: f.reporterId,
          sprintId: f.sprintId,
          summary: f.summary,
          storyPoints: f.storyPoints,
          dueDate: f.dueDate,
          rank: `a${String(n).padStart(4, '0')}`,
          deletedAt: deletedAt ?? null,
        },
      });
      if (f.labels.length) {
        await prisma.issueLabel.createMany({
          data: f.labels.map((labelId) => ({ issueId: issue.id, labelId })),
        });
      }
    };
    for (const f of FIXTURES) await create(f, PROJ[f.projectName], WS);
    for (const o of outOf) for (const f of FIXTURES) await create(f, o.project, o.ws, o.deletedAt);

    // Đọc lại từ DB (Float/Date đã khứ hồi qua Postgres) → dạng IssueDto mà engine nhìn thấy.
    const rows = await prisma.issue.findMany({
      where: {
        workspaceId: WS,
        deletedAt: null,
        projectId: { in: [PROJ.PUB, PROJ.MINE] },
        id: { startsWith: TAG },
      },
      include: { labels: true },
      orderBy: { number: 'asc' },
    });
    inScope = rows.map((r) => ({
      id: r.id,
      dto: {
        status: { id: r.statusId },
        priority: r.priorityId ? { id: r.priorityId } : null,
        assigneeId: r.assigneeId,
        reporterId: r.reporterId,
        type: { id: r.typeId },
        sprintId: r.sprintId,
        resolution: r.resolutionId ? { id: r.resolutionId } : null,
        storyPoints: r.storyPoints,
        summary: r.summary,
        labels: r.labels.map((l) => ({ id: l.labelId })),
        dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      } as unknown as IssueDto,
    }));
    inScopeIds = inScope.map((r) => r.id);

    // Dịch vụ THẬT; chỉ thay RBAC bằng "người thường": thấy dự án công khai + dự án riêng tư mình là thành viên.
    const rbac = { projectVisibilityMode: () => Promise.resolve('memberOrPublic') };
    service = new RulePreviewService(
      prisma as unknown as PrismaService,
      new ProjectAccessService(prisma as unknown as PrismaService, rbac as never),
    );
  }, 120_000);

  afterAll(async () => {
    if (!prisma) return;
    // Con trước cha. Mọi hàng đều mang TAG nên không thể đụng dữ liệu khác.
    const like = { startsWith: TAG };
    await prisma.issueLabel.deleteMany({ where: { issueId: like } });
    await prisma.issue.deleteMany({ where: { id: like } });
    await prisma.label.deleteMany({ where: { id: like } });
    await prisma.sprint.deleteMany({ where: { id: like } });
    await prisma.projectMembership.deleteMany({ where: { projectId: like } });
    await prisma.project.deleteMany({ where: { id: like } });
    await prisma.status.deleteMany({ where: { id: like } });
    await prisma.workflow.deleteMany({ where: { id: like } });
    await prisma.issueType.deleteMany({ where: { id: like } });
    await prisma.priority.deleteMany({ where: { id: like } });
    await prisma.resolution.deleteMany({ where: { id: like } });
    await prisma.role.deleteMany({ where: { id: like } });
    await prisma.workspace.deleteMany({ where: { id: like } });
    await prisma.user.deleteMany({ where: { id: like } });
    await prisma.$disconnect();
  }, 120_000);

  /* ------------------------------------------------------------------ so sánh ------------------------------------------------------------------ */
  const show = (c: FieldCondition) => JSON.stringify(c);

  /** Engine nói thoả bao nhiêu hàng ↔ `where` (Prisma → Postgres) ↔ dịch vụ xem trước (đã có phạm vi quyền xem). */
  async function agree(c: FieldCondition): Promise<{ n: number; unsupported: boolean }> {
    const expected = inScope.filter((r) => evalFieldCondition(r.dto, c)).map((r) => r.id);
    const where = fieldConditionToWhere(c);
    if (where === null) return { n: expected.length, unsupported: true };
    const got = (
      await prisma.issue.findMany({
        where: { id: { in: inScopeIds }, AND: [where] },
        select: { id: true },
      })
    )
      .map((r) => r.id)
      .sort();
    expect(got, show(c)).toEqual([...expected].sort());
    const preview = await service.previewMatch(WS, EDITOR, { conditions: [c] });
    expect(preview.count, `${show(c)} (previewMatch)`).toBe(expected.length);
    return { n: expected.length, unsupported: false };
  }

  const cond = (
    field: FieldCondition['field'],
    op: FieldCondition['op'],
    value?: unknown,
  ): FieldCondition => ({ field, op, ...(value === undefined ? {} : { value }) });

  const NAMED: Record<string, () => FieldCondition[]> = {
    'summary contains — hoa/thường, Đ/đ, ế, NFD, ký tự đặc biệt, rỗng': () =>
      [
        ...['lỗi', 'LỖI', 'Lỗi', 'lỖi', 'đ', 'Đ', 'đường', 'ĐƯỜNG', 'Đường', 'ế', 'Ế', 'kế', 'KẾ'],
        ...['Kế', 'kế', 'ê', 'Ê', '%', '100%', '_', 'a_b', 'aXb'],
        ...['\\', 'c\\d', 'trailing\\', '\\\\', '\\%', '', ' ', 'ABC', 'abc', 'x'],
      ].map((v) => cond('summary', 'contains', v)),
    'summary contains — chữ hiếm': () =>
      [
        ...['istanbul', 'i̇stanbul', 'İSTANBUL', 'İstanbul', 'İ', 'ı', 'i', 'I', 'ß', 'ẞ', 'ss'],
        ...['SS', 'straße', 'STRASSE', 'ας', 'ασ', 'ΑΣ', 'Σ', 'σ', 'ς', 'οδος', 'ΟΔΟΣ'],
        ...['ǆ', 'ǅ', 'Ǆ'],
      ].map((v) => cond('summary', 'contains', v)),
    'summary eq/neq/in/nin/empty/notEmpty': () => [
      cond('summary', 'eq', 'đường đi'),
      cond('summary', 'eq', 'Đường đi'),
      cond('summary', 'eq', ''),
      cond('summary', 'neq', 'abc'),
      cond('summary', 'neq', ''),
      cond('summary', 'in', ['abc', 'ABC']),
      cond('summary', 'nin', ['abc', 'ABC', '']),
      cond('summary', 'empty'),
      cond('summary', 'notEmpty'),
      cond('summary', 'eq', 5),
      cond('summary', 'in', []),
    ],
    'neq/nin trên cột nullable (assignee/sprint/priority/resolution/reporter)': () =>
      (['assigneeId', 'sprintId', 'priorityId', 'resolutionId', 'reporterId'] as const).flatMap(
        (f) => {
          const real = {
            assigneeId: UA,
            sprintId: SP,
            priorityId: P.p1,
            resolutionId: R1,
            reporterId: UB,
          }[f];
          return [
            cond(f, 'neq', real),
            cond(f, 'neq', null),
            cond(f, 'neq', 'khong-co'),
            cond(f, 'neq', ''),
            cond(f, 'nin', [real]),
            cond(f, 'nin', [null]),
            cond(f, 'nin', [real, null]),
            cond(f, 'nin', [real, 'khong-co']),
            cond(f, 'nin', [null, 'khong-co']),
            cond(f, 'nin', []),
            cond(f, 'nin', ['khong-co']),
            cond(f, 'in', [real, null]),
            cond(f, 'in', [null]),
            cond(f, 'in', []),
            cond(f, 'eq', null),
            cond(f, 'eq', real),
            cond(f, 'eq', 'khong-co'),
            cond(f, 'eq', undefined),
            cond(f, 'neq', undefined),
            cond(f, 'empty'),
            cond(f, 'notEmpty'),
          ];
        },
      ),
    'empty/notEmpty — chuỗi NULL vs rỗng, storyPoints 0, nhãn 0/1/nhiều': () =>
      (
        ['summary', 'assigneeId', 'storyPoints', 'labelIds', 'dueDate', 'statusId'] as const
      ).flatMap((f) => [cond(f, 'empty'), cond(f, 'notEmpty')]),
    'nhãn eq/in/contains/neq/nin': () =>
      (['eq', 'in', 'contains', 'neq', 'nin'] as const).flatMap((o) => [
        cond('labelIds', o, [L.l1]),
        cond('labelIds', o, [L.l1, L.l2]),
        cond('labelIds', o, [L.l3]),
        cond('labelIds', o, []),
        cond('labelIds', o, ['khong-co']),
        cond('labelIds', o, [5]),
        cond('labelIds', o, L.l2),
        cond('labelIds', o, '5'),
        cond('labelIds', o, 5),
        cond('labelIds', o, undefined),
        cond('labelIds', o, null),
        cond('labelIds', o, [null]),
        cond('labelIds', o, [L.l1, 'khong-co']),
      ]),
    'storyPoints eq/neq/in/nin — 5 vs "5", 5.5, "5.0", "05", 1e21, 0.1': () =>
      [
        ...[5, '5', 5.5, '5.5', '5.0', '05', ' 5', '5 ', 0, '0', '-0', -0, 13, '13'],
        ...[1e21, '1e21', '1e+21', 0.1, '0.1', 0.3, '0.30000000000000004'],
        ...[NaN, Infinity, 'abc', '', true, null, [5], {}],
      ].flatMap((v) => [
        cond('storyPoints', 'eq', v),
        cond('storyPoints', 'neq', v),
        cond('storyPoints', 'in', [v]),
        cond('storyPoints', 'nin', [v]),
      ]),
    'storyPoints contains': () => [
      cond('storyPoints', 'contains', 5),
      cond('storyPoints', 'contains', '5'),
    ],
    'dueDate eq/neq/in/nin — 00:00, 23:59:59.999, giữa ngày, ngày sai': () =>
      [
        ...['2026-10-20', '2026-10-21', '2026-10-19', '2026-02-30', '2026-13-01'],
        ...['2026-10-20T12:00:00.000Z', '2026-10-20T00:00:00.000Z', '20261020', '2026-1-20', ''],
        ...[null, 20261020],
      ].flatMap((v) => [
        cond('dueDate', 'eq', v),
        cond('dueDate', 'neq', v),
        cond('dueDate', 'in', [v]),
        cond('dueDate', 'nin', [v]),
        cond('dueDate', 'in', [v, '2026-10-20']),
        cond('dueDate', 'nin', [v, '2026-10-20']),
      ]),
  };

  for (const [name, list] of Object.entries(NAMED)) {
    it(
      name,
      async () => {
        const failures: string[] = [];
        for (const c of list()) {
          try {
            await agree(c);
          } catch (e) {
            failures.push((e as Error).message.split('\n')[0] ?? String(e));
          }
        }
        // Gom MỌI điều kiện lệch thay vì dừng ở cái đầu tiên (để thấy cả họ lỗi).
        expect(failures).toEqual([]);
      },
      180_000,
    );
  }

  it('ma trận mọi trường × phép × giá trị phổ biến', async () => {
    const values: unknown[] = [
      undefined,
      null,
      '',
      'x',
      0,
      5,
      '5',
      [],
      ['x'],
      [null],
      'đ',
      'Đ',
      UA,
      SP,
      L.l1,
      '2026-10-20',
    ];
    const unsupported = new Set<string>();
    const failures: string[] = [];
    for (const field of RULE_CONDITION_FIELDS)
      for (const op of RULE_CONDITION_OPS)
        for (const v of values) {
          try {
            const r = await agree(cond(field, op, v));
            if (r.unsupported) unsupported.add(`${field}:${op}`);
          } catch (e) {
            failures.push((e as Error).message.split('\n')[0] ?? String(e));
          }
        }
    expect(failures).toEqual([]);
    // Chỉ `dueDate contains` được phép "không xem trước được" (trả null, không bao giờ đếm xấp xỉ).
    expect([...unsupported]).toEqual(['dueDate:contains']);
  }, 600_000);

  /* ------------------------------------------------------------------ quét toàn bộ điểm mã ------------------------------------------------------------------ */
  it('QUÉT MỌI điểm mã Unicode: ký tự mà isPgFoldSafe cho là an toàn thì lower() của Postgres == foldCase của engine', async () => {
    const rows = await prisma.$queryRawUnsafe<{ cp: number; l: string }[]>(
      `select g as cp, lower(chr(g)) as l from generate_series(1, 1114111) g
       where g not between 55296 and 57343 and lower(chr(g)) <> chr(g)`,
    );
    const pg = new Map(rows.map((r) => [r.cp, r.l]));
    const bad: string[] = [];
    let safe = 0;
    let unsafe = 0;
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const ch = String.fromCodePoint(cp);
      const pgLower = pg.get(cp) ?? ch;
      if (isPgFoldSafe(ch)) {
        safe++;
        if (foldCase(ch) !== pgLower)
          bad.push(`U+${cp.toString(16)} ${ch}: js=${foldCase(ch)} pg=${pgLower}`);
      } else unsafe++;
    }
    // Ghi số liệu vào log để đối chiếu khi đổi phiên bản DB/glibc.
    console.log(
      `quét điểm mã: an toàn=${safe}, không an toàn=${unsafe}, Postgres đổi chữ ở ${pg.size} điểm mã`,
    );
    expect(bad).toEqual([]);
  }, 120_000);

  it('chuỗi UTF-16 hỏng (surrogate lẻ): schema từ chối; gọi thẳng dịch vụ → count:null', async () => {
    const c = cond('summary', 'contains', 'a\ud800');
    expect(ruleConditionSchema.safeParse(c).success).toBe(false);
    const r = await service.previewMatch(WS, EDITOR, { conditions: [c] });
    expect(r.count).toBeNull();
    expect(r.reason).toBeTruthy();
  });

  /* ------------------------------------------------------------------ phạm vi ------------------------------------------------------------------ */
  it('phạm vi: dự án riêng tư người soạn không thấy / lưu trữ / xoá mềm / việc xoá mềm / không gian khác không bao giờ được đếm', async () => {
    const all = await service.previewMatch(WS, EDITOR, { conditions: [] });
    expect(all.count).toBe(FIXTURES.length); // mỗi nơi ngoài phạm vi có CÙNG bộ giá trị — chỉ bản trong phạm vi được đếm
    const total = await prisma.issue.count({ where: { id: { startsWith: TAG } } });
    expect(total).toBe(FIXTURES.length * 6); // bằng chứng: DB thật sự có thêm 5 bản sao ngoài phạm vi
    const onlyMine = await service.previewMatch(WS, EDITOR, {
      projectId: PROJ.MINE,
      conditions: [],
    });
    expect(onlyMine.count).toBe(FIXTURES.filter((f) => f.projectName === 'MINE').length);
    for (const p of [PROJ.SECRET, PROJ.ARCH, PROJ.DEL, PROJ.W2]) {
      const r = await service.previewMatch(WS, EDITOR, { projectId: p, conditions: [] });
      expect(r.count, p).toBe(0);
    }
    // Hỏi theo không gian thứ hai: chỉ đếm việc CỦA không gian đó (bản nhân của nó), không lẫn việc không gian thứ nhất.
    const otherWs = await service.previewMatch(WS2, EDITOR, { conditions: [] });
    expect(otherWs.count).toBe(FIXTURES.length);
  });

  /* ------------------------------------------------------------------ JQL ------------------------------------------------------------------ */
  /** Đúng như `RuleEngineService.matchesJql`: đếm từng issue với `where` đã biên dịch, cộng lại. */
  async function engineJqlCount(jql: string): Promise<number> {
    const { where } = compileJql(parseJql(jql), { currentUserId: '' });
    let n = 0;
    for (const r of inScope) {
      n += await prisma.issue.count({
        where: { id: r.id, workspaceId: WS, deletedAt: null, AND: [where] },
      });
    }
    return n;
  }

  it.each([
    ['assignee = currentUser()', 0],
    ['text ~ "x"', undefined],
    ['text ~ "LỖI"', undefined],
    ['status = Nonexistent', 0],
    ['summary ~ "đường"', undefined],
  ] as const)('JQL %s', async (jql, fixed) => {
    const expected = await engineJqlCount(jql);
    if (fixed !== undefined) expect(expected).toBe(fixed);
    const r = await service.previewMatch(WS, EDITOR, { conditions: [{ jql }] });
    expect(r.reason).toBeNull();
    expect(r.count).toBe(expected);
  });

  /* ------------------------------------------------------------------ NUL ------------------------------------------------------------------ */
  describe('ký tự NUL (\\u0000): Postgres không lưu/so được — phải ra 4xx hoặc count:null chứ không 500', () => {
    const NULS: unknown[] = [
      cond('summary', 'contains', 'a\u0000b'),
      cond('summary', 'contains', '\u0000'),
      cond('summary', 'eq', 'a\u0000'),
      cond('summary', 'in', ['ok', 'a\u0000']),
      cond('statusId', 'eq', 'x\u0000'),
      cond('labelIds', 'in', ['x\u0000']),
      cond('dueDate', 'eq', '2026-10-20\u0000'),
      cond('storyPoints', 'eq', '5\u0000'),
      { field: 'summary', op: 'eq', value: { a: 'x\u0000' } },
      { field: 'summary', op: 'eq', value: { 'k\u0000': 1 } },
      { jql: 'text ~ "a\u0000b"' },
    ];
    it('schema từ chối (=> 400 ở route)', () => {
      for (const c of NULS) {
        expect(ruleConditionSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
        expect(previewMatchSchema.safeParse({ conditions: [c] }).success).toBe(false);
      }
    });
    it('gọi thẳng dịch vụ (bỏ qua schema) vẫn không ném lỗi: count:null + lý do', async () => {
      for (const c of NULS) {
        const r = await service.previewMatch(WS, EDITOR, { conditions: [c as never] });
        expect(r.count, JSON.stringify(c)).toBeNull();
        expect(r.reason, JSON.stringify(c)).toBeTruthy();
      }
    });
  });
});
