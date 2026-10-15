import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SOFT_DELETE_MODELS } from './prisma.service';

/**
 * Kiểm tra tĩnh (chưa dùng Prisma `$extends` vì chưa có DB test): mọi truy vấn ĐỌC trên model có
 * soft-delete phải nhắc tới `deletedAt` ngay trong tham số của lời gọi (hoặc trong hàm chứa nó, khi
 * `where` dựng sẵn thành biến). Truy vấn cố ý lấy cả bản đã xoá thì chú thích dòng trên:
 *   // allow-deleted: <lý do>
 */
const READ_METHODS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const SRC = join(__dirname, '..', '..');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listSources(full));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts'))
      out.push(full);
  }
  return out;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Model có cột `deletedAt` trong schema.prisma — nguồn sự thật cho SOFT_DELETE_MODELS. */
function modelsWithDeletedAt(): string[] {
  const schema = readFileSync(join(SRC, '..', 'prisma', 'schema.prisma'), 'utf8');
  const models: string[] = [];
  let current = '';
  for (const line of schema.split('\n')) {
    const m = /^model (\w+) \{/.exec(line);
    if (m?.[1]) current = m[1];
    else if (/^\s+deletedAt\s+DateTime\??/.test(line) && current) models.push(current);
  }
  return models;
}

function findViolations(): string[] {
  const delegates = new Map([...SOFT_DELETE_MODELS].map((m) => [lowerFirst(m), m]));
  const violations: string[] = [];
  for (const file of listSources(SRC)) {
    const text = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const lines = text.split('\n');
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text;
        const target = node.expression.expression;
        if (READ_METHODS.has(method) && ts.isPropertyAccessExpression(target)) {
          const model = delegates.get(target.name.text);
          if (model) {
            const line = sf.getLineAndCharacterOfPosition(node.getStart()).line; // 0-based
            const allowed = /allow-deleted:/.test(lines[line - 1] ?? '');
            const arg = node.arguments[0];
            let ok = !!arg && /\bdeletedAt\b/.test(arg.getText());
            if (!ok && arg && ts.isObjectLiteralExpression(arg)) {
              // `where` dựng sẵn (biến, hoặc `this.xxxWhere(...)`) → chấp nhận nếu hàm chứa lời gọi /
              // hàm dựng where có nhắc deletedAt.
              const whereProp = arg.properties.find(
                (p) =>
                  (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                  p.name.getText() === 'where',
              );
              const init =
                whereProp && ts.isPropertyAssignment(whereProp)
                  ? whereProp.initializer
                  : whereProp?.name;
              // `where: { ...baseWhere, x }` — spread một where dựng sẵn cũng được coi như biến.
              const spreadsBuilt =
                !!init &&
                ts.isObjectLiteralExpression(init) &&
                init.properties.some(
                  (p) => ts.isSpreadAssignment(p) && ts.isIdentifier(p.expression),
                );
              if (init && (ts.isIdentifier(init) || spreadsBuilt)) {
                let fn: ts.Node | undefined = node.parent;
                while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
                ok = !!fn && /\bdeletedAt\b/.test(fn.getText());
              } else if (
                init &&
                ts.isCallExpression(init) &&
                ts.isPropertyAccessExpression(init.expression)
              ) {
                const builder = init.expression.name.text;
                ts.forEachChild(sf, function find(n: ts.Node): void {
                  if (
                    ts.isMethodDeclaration(n) &&
                    n.name.getText() === builder &&
                    /\bdeletedAt\b/.test(n.getText())
                  )
                    ok = true;
                  ts.forEachChild(n, find);
                });
              }
            }
            if (!ok && !allowed) {
              violations.push(`${relative(SRC, file)}:${line + 1} ${target.name.text}.${method}()`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return violations;
}

describe('soft-delete coverage', () => {
  it('SOFT_DELETE_MODELS khớp các model có deletedAt trong schema.prisma', () => {
    expect([...SOFT_DELETE_MODELS].sort()).toEqual(modelsWithDeletedAt().sort());
  });

  it('mọi truy vấn đọc trên model soft-delete đều lọc deletedAt', () => {
    const violations = findViolations();
    expect(
      violations,
      `Thiếu lọc deletedAt (hoặc chú thích // allow-deleted: lý do):\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
