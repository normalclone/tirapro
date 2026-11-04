import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertParityDatabase, parityDatabaseName } from '../../common/testing/parity-db-guard';

/**
 * MIGRATION đổi tên Workspace -> Organization TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). Dựng DB nháp ở trạng thái TRƯỚC migration
 * `organization_rename` (áp mọi migration cũ hơn), nạp dữ liệu theo TÊN CŨ (tổ chức, thành viên + vai trò phụ, quyền `workspace:*`,
 * vai trò hệ thống `Workspace *`, nhật ký), áp migration rồi kiểm: số dòng mọi bảng KHÔNG đổi, quyền hiệu lực của từng người
 * giống hệt (chỉ khác tên khoá), không còn đối tượng nào tên "workspace", `prisma migrate diff` không đòi gì thêm.
 * Migration chạy bằng vòng lặp theo danh mục nên đúng trên cả PostgreSQL 16 (prod) lẫn 18; ràng buộc NOT NULL có tên (chỉ có từ PG 18)
 * không bị đụng, và bước "không còn đối tượng workspace" bỏ qua loại ràng buộc đó. Bản chạy trên bản sao prod thật: xem task-1/3-report.md.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`.
 * Spec XOÁ SẠCH và dựng lại schema `public` của DB nháp đó — chỉ chạy trên DB nháp (hậu tố `_scratch`/`_parity`/`_w2c`).
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const PSQL = process.env.PSQL ?? 'psql';
const API = join(__dirname, '..', '..', '..');
const TARGET = '20261106100000_organization_rename';

describe.skipIf(!DB_URL)('migration organization_rename ↔ dữ liệu theo tên cũ', () => {
  let work = '';
  const q = (sql: string): string =>
    execFileSync(PSQL, [DB_URL!.replace(/\?.*$/, ''), '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], {
      encoding: 'utf8',
    }).trim();
  const rows = (sql: string): string[] => {
    const out = q(sql);
    return out ? out.split('\n') : [];
  };
  const deploy = (schemaDir: string): void => {
    execFileSync(
      'npx',
      ['prisma', 'migrate', 'deploy', '--schema', join(schemaDir, 'schema.prisma')],
      {
        env: { ...process.env, DATABASE_URL: DB_URL!, DIRECT_URL: DB_URL! },
        cwd: API,
        stdio: 'pipe',
      },
    );
  };
  /** Số dòng mỗi bảng (khoá = tên bảng đã quy về tên mới, bỏ `_prisma_migrations`). */
  const counts = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const t of rows(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY 1",
    ))
      out[t.replace('Workspace', 'Organization')] = Number(q(`SELECT count(*) FROM "${t}"`));
    return out;
  };
  /** Quyền hiệu lực cấp tổ chức của từng người: userId -> khoá quyền đã quy về tên mới (vai trò chính + vai trò phụ). */
  const effective = (m: 'Workspace' | 'Organization'): string[] => {
    const col = m === 'Workspace' ? 'workspaceId' : 'organizationId';
    return rows(`
      SELECT mem."userId" || '|' || mem."${col}" || '|' || replace(p."key", 'workspace:', 'organization:')
        FROM "${m}Membership" mem
        JOIN "Role" r ON r.id = mem."roleId" OR r.id IN (SELECT x."roleId" FROM "${m}MembershipRole" x WHERE x."membershipId" = mem.id)
        JOIN "RolePermission" rp ON rp."roleId" = r.id
        JOIN "Permission" p ON p.id = rp."permissionId"
       ORDER BY 1`);
  };

  beforeAll(() => {
    expect(parityDatabaseName(DB_URL!)).toMatch(/_scratch$|_parity$|_w2c$/);
    q('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    // Bản sao thư mục prisma CHỈ gồm migration trước TARGET.
    work = mkdtempSync(join(tmpdir(), 'org-mig-'));
    cpSync(join(API, 'prisma'), join(work, 'prisma'), { recursive: true });
    for (const d of readdirSync(join(work, 'prisma', 'migrations')))
      if (/^\d/.test(d) && d >= TARGET)
        rmSync(join(work, 'prisma', 'migrations', d), { recursive: true });
    // schema.prisma của bản sao mang tên MỚI nhưng chỉ dùng để `migrate deploy` (đọc thư mục migrations) — không cần khớp.
    deploy(join(work, 'prisma'));
    q(`
      INSERT INTO "User"(id,email,"displayName","updatedAt") VALUES ('u1','a@x.vn','A',now()),('u2','b@x.vn','B',now()),('u3','c@x.vn','C',now());
      INSERT INTO "Workspace"(id,name,slug,"ownerId","updatedAt") VALUES ('w1','TECA','teca','u1',now());
      INSERT INTO "Permission"(id,key,description,scope) VALUES
        ('p1','workspace:admin','d','WORKSPACE'),('p2','workspace:view','d','WORKSPACE'),('p3','project:create','d','PROJECT');
      INSERT INTO "Role"(id,name,scope,"isSystem","updatedAt") VALUES
        ('r-adm','Workspace Admin','WORKSPACE',true,now()),('r-mem','Workspace Member','WORKSPACE',true,now()),
        ('r-view','Workspace Viewer','WORKSPACE',true,now()),('r-cus','Custom admin','WORKSPACE',false,now());
      INSERT INTO "RolePermission"("roleId","permissionId") VALUES
        ('r-adm','p1'),('r-adm','p2'),('r-adm','p3'),('r-mem','p2'),('r-view','p2'),('r-cus','p1');
      INSERT INTO "WorkspaceMembership"(id,"workspaceId","userId","roleId","updatedAt") VALUES
        ('m1','w1','u1','r-adm',now()),('m2','w1','u2','r-mem',now()),('m3','w1','u3','r-view',now());
      INSERT INTO "WorkspaceMembershipRole"("membershipId","roleId") VALUES ('m2','r-cus');
      INSERT INTO "AuditLog"(id,action,"entityType",summary) VALUES ('a1','account.workspace_added','User','x'),('a2','project.created','Project','y');
    `);
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('áp migration: số dòng mọi bảng giữ nguyên, quyền hiệu lực của từng người giống hệt, tên mới có mặt', () => {
    const beforeCounts = counts();
    const beforeEffective = effective('Workspace');
    expect(beforeEffective.length).toBeGreaterThan(0);
    deploy(join(API, 'prisma'));

    expect(counts()).toEqual(beforeCounts);
    expect(effective('Organization')).toEqual(beforeEffective);
    expect(
      rows(
        `SELECT key FROM "Permission" WHERE key LIKE 'organization:%' OR key LIKE 'workspace:%' ORDER BY 1`,
      ),
    ).toEqual(['organization:admin', 'organization:view']);
    expect(rows('SELECT name FROM "Role" WHERE "isSystem" ORDER BY 1')).toEqual([
      'Organization Admin',
      'Organization Member',
      'Organization Viewer',
    ]);
    expect(q('SELECT DISTINCT scope FROM "Role" WHERE "isSystem" LIMIT 1')).toBe('ORGANIZATION');
    expect(rows('SELECT action FROM "AuditLog" ORDER BY 1')).toEqual([
      'account.organization_added',
      'project.created',
    ]);
  });

  it('không còn bảng/cột/kiểu/giá trị enum/chỉ mục/ràng buộc nào tên "workspace"', () => {
    expect(
      rows(`
        SELECT 'table ' || relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relname ILIKE '%workspace%'
        UNION ALL SELECT 'column ' || table_name || '.' || column_name FROM information_schema.columns
          WHERE table_schema='public' AND column_name ILIKE '%workspace%'
        UNION ALL SELECT 'type ' || typname FROM pg_type WHERE typnamespace='public'::regnamespace AND typname ILIKE '%workspace%'
        UNION ALL SELECT 'enum ' || enumlabel FROM pg_enum WHERE enumlabel ILIKE '%workspace%'
        UNION ALL SELECT 'constraint ' || conname FROM pg_constraint WHERE conname ILIKE '%workspace%' AND contype <> 'n'`),
    ).toEqual([]);
  });

  it('đối tượng của migration personal_groups (đứng TRƯỚC migration này) cũng được đổi tên: unique (organizationId, ownerId, name)', () => {
    expect(
      rows(
        `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='Program' AND indexname LIKE '%ownerId_name_key'`,
      ),
    ).toEqual(['Program_organizationId_ownerId_name_key']);
    expect(
      rows(
        `SELECT column_name FROM information_schema.columns WHERE table_name='Program' AND column_name LIKE '%rganization%'`,
      ),
    ).toEqual(['organizationId']);
  });

  it('prisma migrate diff: schema khớp DB sau migration (không còn đổi tên nào chờ)', () => {
    const out = execFileSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-url',
        DB_URL!,
        '--to-schema-datamodel',
        join(API, 'prisma', 'schema.prisma'),
        '--script',
      ],
      { env: { ...process.env, DIRECT_URL: DB_URL! }, cwd: API, encoding: 'utf8' },
    );
    expect(out).toMatch(/empty migration|^\s*$|-- This is an empty migration/i);
  });
});
