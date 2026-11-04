import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertParityDatabase, parityDatabaseName } from '../../common/testing/parity-db-guard';

/**
 * MIGRATION chia sẻ bộ lọc TRÊN POSTGRES THẬT — OPT-IN (`test:parity`). Dựng DB nháp ở trạng thái TRƯỚC migration
 * `saved_filter_shares` (áp mọi migration cũ hơn), nạp bộ lọc PRIVATE / PROJECT / WORKSPACE như prod, áp migration rồi
 * kiểm dữ liệu. Dùng `psql` (biến `PSQL`, mặc định `psql`) và `prisma migrate deploy` trên bản sao thư mục migrations.
 *
 * Chạy: `PARITY_DATABASE_URL=postgresql://…/xxx_scratch?schema=public pnpm --filter @tirapro/api test:parity`.
 * Spec XOÁ SẠCH và dựng lại schema `public` của DB nháp đó — chỉ chạy trên DB nháp (hậu tố `_scratch`/`_parity`/`_w2c`).
 */
const DB_URL = process.env.PARITY_DATABASE_URL;
if (DB_URL) assertParityDatabase(DB_URL);

const PSQL = process.env.PSQL ?? 'psql';
const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');
const TARGET = '20261105100000_saved_filter_shares';
const SCHEMA = join(__dirname, '..', '..', '..', 'prisma', 'schema.prisma');

describe.skipIf(!DB_URL)(
  'migration chia sẻ bộ lọc ↔ dữ liệu prod (9 riêng tư, 1 cả tổ chức) + theo dự án',
  () => {
    let work = '';
    const q = (sql: string): string =>
      execFileSync(
        PSQL,
        [DB_URL!.replace(/\?.*$/, ''), '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql],
        {
          encoding: 'utf8',
        },
      ).trim();
    const rows = (sql: string): string[] => (q(sql) ? q(sql).split('\n') : []);

    beforeAll(() => {
      const name = parityDatabaseName(DB_URL!);
      expect(name).toMatch(/_scratch$|_parity$|_w2c$/);
      q('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      // Bản sao migrations CHỈ gồm các migration trước TARGET (và loại các migration sau nó).
      work = mkdtempSync(join(tmpdir(), 'mig-'));
      cpSync(join(__dirname, '..', '..', '..', 'prisma'), join(work, 'prisma'), {
        recursive: true,
      });
      for (const d of readdirSync(join(work, 'prisma', 'migrations'))) {
        if (/^\d/.test(d) && d >= TARGET)
          rmSync(join(work, 'prisma', 'migrations', d), { recursive: true });
      }
      execFileSync(
        'npx',
        ['prisma', 'migrate', 'deploy', '--schema', join(work, 'prisma', 'schema.prisma')],
        {
          env: { ...process.env, DATABASE_URL: DB_URL!, DIRECT_URL: DB_URL! },
          cwd: join(__dirname, '..', '..', '..'),
          stdio: 'pipe',
        },
      );
      void SCHEMA;

      // Dữ liệu: workspace A (bộ lọc của u1: là thành viên P1 sống, P2 sống, P3 đã xoá; công khai P4 không là thành viên),
      // workspace B (u1 cũng thành viên dự án PB nhưng khác workspace).
      q(`
      INSERT INTO "User"(id,email,"displayName","updatedAt") VALUES
        ('u1','u1@x.t','U1',now()),('u2','u2@x.t','U2',now()),('u3','u3@x.t','U3',now());
      INSERT INTO "Workspace"(id,name,slug,"ownerId","updatedAt") VALUES
        ('wA','A','a','u1',now()),('wB','B','b','u1',now());
      INSERT INTO "Project"(id,"workspaceId",key,name,"updatedAt","deletedAt") VALUES
        ('P1','wA','P1','P1',now(),NULL),('P2','wA','P2','P2',now(),NULL),
        ('P3','wA','P3','P3',now(),now()),('P4','wA','P4','P4',now(),NULL),
        ('PB','wB','PB','PB',now(),NULL);
      INSERT INTO "Role"(id,"workspaceId",name,scope,"updatedAt") VALUES ('r','wA','R','PROJECT',now());
      INSERT INTO "ProjectMembership"(id,"projectId","userId","roleId","updatedAt") VALUES
        ('m1','P1','u1','r',now()),('m2','P2','u1','r',now()),('m3','P3','u1','r',now()),
        ('m4','PB','u1','r',now()),('m5','P1','u2','r',now());
    `);
      const filter = (id: string, ws: string, owner: string, vis: string, proj: string | null) =>
        `INSERT INTO "SavedFilter"(id,"workspaceId","ownerId",name,jql,visibility,"sharedProjectId","updatedAt")
         VALUES ('${id}','${ws}','${owner}','${id}','type = Bug','${vis}',${proj ? `'${proj}'` : 'NULL'},now());`;
      q(
        [
          ...Array.from({ length: 9 }, (_, i) =>
            filter(`priv${i}`, 'wA', i % 2 ? 'u1' : 'u2', 'PRIVATE', null),
          ),
          filter('ws1', 'wA', 'u1', 'WORKSPACE', null),
          filter('wsNoProj', 'wA', 'u3', 'WORKSPACE', null), // u3 không thuộc dự án nào
          filter('prj1', 'wA', 'u1', 'PROJECT', 'P2'),
          filter('prjDeleted', 'wA', 'u1', 'PROJECT', 'P3'), // dự án đã xoá mềm
          filter('prjNull', 'wA', 'u1', 'PROJECT', null), // dữ liệu cũ: "cả workspace thấy"
        ].join('\n'),
      );
      // Áp ĐÚNG file migration cần kiểm.
      execFileSync(
        PSQL,
        [
          DB_URL!.replace(/\?.*$/, ''),
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          join(MIGRATIONS, TARGET, 'migration.sql'),
        ],
        {
          stdio: 'pipe',
        },
      );
    }, 300_000);

    afterAll(() => {
      if (work) rmSync(work, { recursive: true, force: true });
    });

    const shares = (id: string) =>
      rows(`SELECT "projectId" FROM "SavedFilterProjectShare" WHERE "filterId"='${id}' ORDER BY 1`);
    const vis = (id: string) => q(`SELECT visibility FROM "SavedFilter" WHERE id='${id}'`);

    it('9 bộ lọc riêng tư giữ nguyên, không có dòng chia sẻ', () => {
      for (let i = 0; i < 9; i++) {
        expect(vis(`priv${i}`)).toBe('PRIVATE');
        expect(shares(`priv${i}`)).toEqual([]);
      }
    });

    it('mức cũ "cả tổ chức" → chia sẻ cho MỌI dự án sống chủ là thành viên trong tổ chức đó (không dự án đã xoá, không tổ chức khác, không dự án chủ không thuộc)', () => {
      expect(vis('ws1')).toBe('SHARED');
      expect(shares('ws1')).toEqual(['P1', 'P2']);
    });

    it('mức cũ "cả tổ chức" mà chủ không thuộc dự án nào → riêng tư (không để SHARED rỗng)', () => {
      expect(vis('wsNoProj')).toBe('PRIVATE');
      expect(shares('wsNoProj')).toEqual([]);
    });

    it('mức cũ "theo dự án" + dự án sống → đúng một dòng chia sẻ dự án đó; dự án đã xoá → riêng tư', () => {
      expect(vis('prj1')).toBe('SHARED');
      expect(shares('prj1')).toEqual(['P2']);
      expect(vis('prjDeleted')).toBe('PRIVATE');
      expect(shares('prjDeleted')).toEqual([]);
    });

    it('mức cũ "theo dự án" không có dự án (từng là "cả tổ chức thấy") xử lý như "cả tổ chức"', () => {
      expect(vis('prjNull')).toBe('SHARED');
      expect(shares('prjNull')).toEqual(['P1', 'P2']);
    });

    it('enum chỉ còn hai giá trị, cột dự án cũ đã bỏ, mặc định riêng tư, không mất bộ lọc nào', () => {
      expect(rows(`SELECT unnest(enum_range(NULL::"FilterVisibility"))::text`)).toEqual([
        'PRIVATE',
        'SHARED',
      ]);
      expect(
        rows(
          `SELECT column_name FROM information_schema.columns WHERE table_name='SavedFilter' AND column_name='sharedProjectId'`,
        ),
      ).toEqual([]);
      expect(
        q(
          `SELECT column_default FROM information_schema.columns WHERE table_name='SavedFilter' AND column_name='visibility'`,
        ),
      ).toContain('PRIVATE');
      expect(q(`SELECT count(*) FROM "SavedFilter"`)).toBe('14');
    });

    it('khoá ngoại cascade: xoá bộ lọc / dự án / người dùng thì dòng chia sẻ biến mất', () => {
      q(
        `INSERT INTO "SavedFilterUserShare"("filterId","userId") VALUES ('prj1','u2'),('ws1','u3')`,
      );
      q(`DELETE FROM "SavedFilter" WHERE id='prj1'`);
      expect(shares('prj1')).toEqual([]);
      expect(rows(`SELECT "filterId" FROM "SavedFilterUserShare" WHERE "filterId"='prj1'`)).toEqual(
        [],
      );
      q(`DELETE FROM "User" WHERE id='u3'`);
      expect(rows(`SELECT "userId" FROM "SavedFilterUserShare" WHERE "filterId"='ws1'`)).toEqual(
        [],
      );
      q(`DELETE FROM "Project" WHERE id='P2'`);
      expect(shares('ws1')).toEqual(['P1']);
    });

    it('schema của repo đã có bảng chia sẻ', () => {
      expect(readFileSync(SCHEMA, 'utf8')).toContain('model SavedFilterProjectShare');
    });
  },
);
