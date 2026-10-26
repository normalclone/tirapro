import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * GUARD (dùng chung bucket với app khác): mọi lệnh S3 trong mã nguồn phải dựng khoá QUA `S3Storage.objectKey()`
 * (luôn gắn tiền tố + assert thuộc tiền tố) và prefix liệt kê QUA `listPrefix()`. Chỉ `s3-storage.ts` được import
 * `@aws-sdk/client-s3` (ngoài test); không ListObjects/ListBuckets/DeleteObjects... nào tự dựng ở nơi khác.
 */
const SRC = join(__dirname, '..', '..');
const S3_FILE = join('common', 'storage', 's3-storage.ts');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}
const isTest = (f: string) => /\.(spec|int-spec|testutil)\.ts$/.test(f);
const files = walk(SRC).filter((f) => !isTest(f));

describe('guard: lệnh S3 chỉ đi qua objectKey()/listPrefix()', () => {
  it('chỉ s3-storage.ts import @aws-sdk/client-s3', () => {
    const offenders = files
      .map((f) => relative(SRC, f))
      .filter((rel) => rel !== S3_FILE)
      .filter((rel) => /@aws-sdk\/client-s3/.test(readFileSync(join(SRC, rel), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('scripts/*.mjs không tự dựng lệnh S3 (chỉ dùng S3Storage)', () => {
    const dir = join(SRC, '..', 'scripts');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.mjs')))
      expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/@aws-sdk\/client-s3/);
  });

  const src = readFileSync(join(SRC, S3_FILE), 'utf8');

  /** Phần thân (đối số, cân ngoặc) của từng `new XxxCommand(...)`. */
  const commandBodies = (): { cmd: string; body: string }[] =>
    [...src.matchAll(/new (\w+Command)\(/g)].map((m) => {
      const start = (m.index ?? 0) + m[0].length;
      let depth = 1;
      let i = start;
      while (i < src.length && depth > 0) {
        if (src[i] === '(') depth++;
        else if (src[i] === ')') depth--;
        i++;
      }
      return { cmd: m[1] ?? '', body: src.slice(start, i - 1) };
    });
  const valuesOf = (field: 'Key' | 'Prefix') =>
    commandBodies().flatMap(({ cmd, body }) =>
      [...body.matchAll(new RegExp(`\\b${field}:\\s*([^,\\n}]+)`, 'g'))].map((m) => ({
        cmd,
        value: (m[1] ?? '').trim(),
      })),
    );

  it('mọi `Key:` trong lệnh S3 có giá trị là this.objectKey(...)', () => {
    const uses = valuesOf('Key');
    expect(uses.length).toBeGreaterThanOrEqual(4); // put/get/head/delete
    for (const u of uses) expect(u.value, u.cmd).toMatch(/^this\.objectKey\(/);
  });

  it('mọi `Prefix:` trong lệnh S3 có giá trị là this.listPrefix(...)', () => {
    const uses = valuesOf('Prefix');
    expect(uses.length).toBeGreaterThanOrEqual(1);
    for (const u of uses) expect(u.value, u.cmd).toMatch(/^this\.listPrefix\(/);
  });

  it('mọi lệnh có Key/Prefix chỉ được dựng bên trong class S3Storage qua `new XxxCommand(`; không lệnh nguy hiểm', () => {
    expect(src).not.toMatch(
      /ListBucketsCommand|DeleteObjectsCommand|CopyObjectCommand|CreateBucketCommand|DeleteBucketCommand|PutBucket/,
    );
    const cmds = [...src.matchAll(/new (\w+Command)\(/g)].map((m) => m[1]);
    expect(new Set(cmds)).toEqual(
      new Set([
        'PutObjectCommand',
        'GetObjectCommand',
        'HeadObjectCommand',
        'DeleteObjectCommand',
        'ListObjectsV2Command',
        'HeadBucketCommand',
      ]),
    );
  });

  it('objectKey() gắn tiền tố và assert kết quả thuộc tiền tố (chốt chặn cứng)', () => {
    const m = /private objectKey\(key: string\): string \{([\s\S]*?)\n  \}/.exec(src);
    expect(m?.[1]).toBeDefined();
    expect(m?.[1]).toMatch(/assertSafeKey\(key\)/);
    expect(m?.[1]).toMatch(/this\.keyPrefix \+ key/);
    expect(m?.[1]).toMatch(/startsWith\(this\.keyPrefix\)/);
    expect(m?.[1]).toMatch(/throw /);
  });
});
