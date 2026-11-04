import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertParityDatabase } from './common/testing/parity-db-guard';

/**
 * `scripts/recompute-points.mjs` chuẩn hoá liên kết "cha là Epic" TRÊN POSTGRES THẬT — OPT-IN (vitest.int.config.ts), chạy script
 * thật bằng tiến trình con. Cần `PARITY_DATABASE_URL` (DB nháp đuôi _scratch/_parity/_w2c, đã migrate deploy) và đã build
 * @tirapro/types + @tirapro/shared. Mọi hàng mang TAG và được dọn ở `afterAll`.
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const API_DIR = join(__dirname, '..');
const TAG = `epp${randomBytes(3).toString('hex')}`;
const id = (n: string) => `${TAG}-${n}`;

describe.skipIf(!DB_URL)('recompute-points: cha là Epic -> epicId (Postgres thật)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: DB_URL! } } });
  const WS = id('ws');
  const stamp = new Date('2026-01-01T00:00:00.000Z');

  const run = () => {
    const r = spawnSync(process.execPath, [join(API_DIR, 'scripts', 'recompute-points.mjs')], {
      cwd: API_DIR,
      encoding: 'utf8',
      timeout: 120_000,
      env: { PATH: process.env.PATH ?? '', DATABASE_URL: DB_URL! },
    });
    return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
  };
  const row = (k: string) => prisma.issue.findUniqueOrThrow({ where: { id: id(k) } });

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: id('u'), email: `${id('u')}@epp.test`, displayName: 'u' },
    });
    await prisma.workspace.create({ data: { id: WS, name: TAG, slug: TAG, ownerId: id('u') } });
    await prisma.project.create({
      data: { id: id('p'), workspaceId: WS, key: 'EPP', name: 'EPP' },
    });
    await prisma.workflow.create({
      data: {
        id: id('wf'),
        workspaceId: WS,
        projectId: id('p'),
        name: 'wf',
        statuses: { create: [{ id: id('st'), name: 'To Do', category: 'TODO', isInitial: true }] },
      },
    });
    for (const [k, key] of [
      ['epic', 'EPIC'],
      ['task', 'TASK'],
    ] as const)
      await prisma.issueType.create({
        data: { id: id(`t-${k}`), workspaceId: WS, name: `${TAG}-${k}`, key },
      });
    let n = 0;
    const issue = (k: string, type: 'epic' | 'task', extra: Record<string, unknown> = {}) =>
      prisma.issue.create({
        data: {
          id: id(k),
          workspaceId: WS,
          projectId: id('p'),
          number: ++n,
          key: `EPP-${n}`,
          typeId: id(`t-${type}`),
          statusId: id('st'),
          summary: k,
          rank: `0|${n}`,
          createdAt: stamp,
          updatedAt: stamp,
          ...extra,
        },
      });
    await issue('epicA', 'epic');
    await issue('epicB', 'epic');
    // (điểm chỉnh tay để kết quả không phụ thuộc bảng hệ số)
    const manual = (pts: number) => ({ storyPoints: pts, pointsManual: true });
    await issue('c1', 'task', { parentId: id('epicA'), ...manual(5) }); // epicId null
    await issue('c2', 'task', { parentId: id('epicA'), epicId: id('epicA'), ...manual(3) }); // đã gắn đúng Epic
    await issue('c3', 'task', { parentId: id('epicA'), epicId: id('epicB'), ...manual(2) }); // gắn Epic KHÁC
    await issue('normalParent', 'task', { epicId: id('epicB'), ...manual(1) });
    await issue('c4', 'task', { parentId: id('normalParent'), epicId: id('epicB'), ...manual(4) });
    await issue('trashed', 'task', { parentId: id('epicA'), deletedAt: stamp, ...manual(9) });
  }, 60_000);

  afterAll(async () => {
    await prisma.issue.updateMany({
      where: { workspaceId: WS },
      data: { parentId: null, epicId: null },
    });
    await prisma.issue.deleteMany({ where: { workspaceId: WS } });
    await prisma.workflow.deleteMany({ where: { workspaceId: WS } });
    await prisma.issueType.deleteMany({ where: { workspaceId: WS } });
    await prisma.project.deleteMany({ where: { workspaceId: WS } });
    await prisma.workspace.deleteMany({ where: { id: WS } });
    await prisma.user.deleteMany({ where: { id: id('u') } });
    await prisma.$disconnect();
  }, 60_000);

  it('lần 1: chuẩn hoá việc có cha là Epic, in số liên kết, Epic cộng cả việc vừa chuyển', async () => {
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('normalised 3 epic-parent links');

    const c1 = await row('c1');
    expect([c1.parentId, c1.epicId]).toEqual([null, id('epicA')]);
    expect(c1.version).toBe(2);
    expect(c1.updatedAt.getTime()).toBe(stamp.getTime()); // không đổi updatedAt

    const c2 = await row('c2');
    expect([c2.parentId, c2.epicId]).toEqual([null, id('epicA')]);

    const c3 = await row('c3'); // Epic khác: giữ epicId, chỉ bỏ cha
    expect([c3.parentId, c3.epicId]).toEqual([null, id('epicB')]);

    const c4 = await row('c4'); // cha thường: không đụng
    expect([c4.parentId, c4.epicId, c4.version]).toEqual([id('normalParent'), id('epicB'), 1]);
    const t = await row('trashed'); // đã xoá mềm: không đụng
    expect([t.parentId, t.version]).toEqual([id('epicA'), 1]);

    // Epic A = c1 (5) + c2 (3); Epic B = c3 (2) + normalParent (= tổng con c4 = 4, cha thuần)
    expect((await row('epicA')).storyPoints).toBe(8);
    expect((await row('epicB')).storyPoints).toBe(6);
  });

  it('lần 2: idempotent — 0 liên kết, không đổi gì thêm', async () => {
    const before = await row('c1');
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('normalised 0 epic-parent links');
    const after = await row('c1');
    expect(after.version).toBe(before.version);
    expect((await row('epicA')).storyPoints).toBe(8);
  });
});
