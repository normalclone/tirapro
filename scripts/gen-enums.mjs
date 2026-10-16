#!/usr/bin/env node
// Sinh packages/types/src/enums.ts từ apps/api/prisma/schema.prisma.
//   node scripts/gen-enums.mjs          → ghi lại enums.ts
//   node scripts/gen-enums.mjs --check  → exit 1 nếu enums.ts lệch so với schema (dùng ở CI)
// Không phụ thuộc gói ngoài — chỉ dùng node:fs / node:path.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = resolve(root, 'apps/api/prisma/schema.prisma');
const outPath = resolve(root, 'packages/types/src/enums.ts');

const HEADER = `// FILE SINH TỰ ĐỘNG từ schema.prisma — chạy pnpm gen:enums, KHÔNG sửa tay
/**
 * Enums dùng chung FE/BE. Giá trị khớp 1:1 với Prisma enums trong
 * apps/api/prisma/schema.prisma. Mỗi enum là const-object + type cùng tên
 * => dùng được cả như value (UserStatus.ACTIVE) lẫn như type (: UserStatus).
 *
 * LƯU Ý: IssuePriority / IssueResolution / IssueLinkType KHÔNG phải enum —
 * chúng là bảng config (Priority/Resolution/LinkType). Xem catalogs.ts cho
 * danh sách default seed + DTO ở entities.ts.
 */
`;

/** Đọc schema, trả về [{ name, values }] theo đúng thứ tự xuất hiện. */
export function parseEnums(schemaText) {
  // Bỏ comment cuối dòng / cả dòng (// và ///) để dấu } hay tên trong comment không làm lệch regex.
  const text = schemaText.replace(/\/\/.*$/gm, '');
  const enums = [];
  for (const m of text.matchAll(/\benum\s+(\w+)\s*\{([^}]*)\}/g)) {
    const values = m[2]
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0]) // bỏ attribute @map(...) nếu có
      .filter(Boolean);
    enums.push({ name: m[1], values });
  }
  return enums;
}

export function render(enums) {
  const blocks = enums.map(({ name, values }) => {
    const body = values.map((v) => `  ${v}: '${v}',`).join('\n');
    const typeLine = `export type ${name} = (typeof ${name})[keyof typeof ${name}];`;
    // Khớp prettier (printWidth 100) để format:check không báo lệch.
    const typeDecl =
      typeLine.length <= 100
        ? typeLine
        : `export type ${name} =\n  (typeof ${name})[keyof typeof ${name}];`;
    return `export const ${name} = {\n${body}\n} as const;\n${typeDecl}\n`;
  });
  return `${HEADER}\n${blocks.join('\n')}`;
}

function main() {
  const enums = parseEnums(readFileSync(schemaPath, 'utf8'));
  if (enums.length === 0) {
    console.error('gen-enums: không tìm thấy enum nào trong schema.prisma');
    process.exit(1);
  }
  const output = render(enums);

  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(outPath, 'utf8');
    } catch {
      /* file chưa có → coi như lệch */
    }
    if (current !== output) {
      console.error(
        'gen-enums: packages/types/src/enums.ts lệch so với schema.prisma — chạy `pnpm gen:enums` rồi commit.',
      );
      process.exit(1);
    }
    console.log(`gen-enums: OK (${enums.length} enum khớp schema.prisma)`);
    return;
  }

  writeFileSync(outPath, output);
  console.log(`gen-enums: đã ghi ${enums.length} enum → packages/types/src/enums.ts`);
}

main();
