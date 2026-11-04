/**
 * Tirapro — chuyển dữ liệu cũ sang "quy trình theo loại việc" (Standard / Bug / Epic) cho MỌI workspace (hoặc một workspace).
 *
 *   node scripts/migrate-workflow-schemes.mjs --dry-run        # chỉ in kế hoạch + số liệu, KHÔNG ghi gì
 *   node scripts/migrate-workflow-schemes.mjs                  # chạy thật
 *   node scripts/migrate-workflow-schemes.mjs --workspace <id|slug>
 *
 * Mỗi workspace (một transaction, có khoá advisory như thao tác quản trị quy trình):
 *  1. đảm bảo 3 quy trình mặc định theo TÊN CHÍNH XÁC (thiếu thì tạo; quy trình khác — kể cả "Bug" tuỳ chỉnh — không bị đụng);
 *  2. đảm bảo dòng cấu hình cho mọi loại việc (dòng đã có luôn thắng → chạy lại sau khi quản trị viên chỉnh vẫn an toàn);
 *  3. chuyển việc (kể cả trong thùng rác) đang ở trạng thái của quy trình KHÁC quy trình hiệu lực: bảng ánh xạ cũ → cùng tên →
 *     cùng nhóm. SQL thô, KHÔNG đổi updatedAt, tăng version, ghi lịch sử STATUS;
 *  4. cột bảng: thêm trạng thái mới cạnh trạng thái cũ (không gỡ gì);
 *  5. quy tắc automation: sửa id trạng thái theo cùng ánh xạ (chỉ sang quy trình mà phạm vi quy tắc dùng); không ánh xạ được thì
 *     TẮT quy tắc + báo người tạo. Dry-run in từng quy tắc (trước -> sau) và các tham chiếu theo TÊN trong JQL sẽ hết khớp;
 *  6. quy trình cũ của dự án giữ nguyên (vẫn là defaultWorkflowId dự phòng). SLA / wipLimit không chứa id trạng thái.
 * --dry-run chạy đúng thuật toán thật rồi rollback nên số liệu khớp chạy thật. Idempotent: chạy lại không đổi gì.
 *
 * Cần DATABASE_URL và `pnpm --filter @tirapro/api build` trước (dùng mã đã biên dịch ở dist/).
 */
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const wsIdx = args.indexOf('--workspace');
const workspace = wsIdx >= 0 ? args[wsIdx + 1] : undefined;
if (wsIdx >= 0 && !workspace) {
  console.error('--workspace cần kèm id hoặc slug.');
  process.exit(1);
}
if (!(process.env.DATABASE_URL ?? '').trim()) {
  console.error('Thiếu DATABASE_URL.');
  process.exit(1);
}

let migrateWorkflowSchemes;
try {
  ({ migrateWorkflowSchemes } =
    await import('../dist/modules/workflow-admin/migrate-workflow-schemes.js'));
} catch (err) {
  console.error(
    `Không nạp được mã đã biên dịch (dist/): ${err.message}\nChạy \`pnpm --filter @tirapro/api build\` trước.`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();
const tag = dryRun ? '[DRY-RUN] ' : '';
try {
  const result = await migrateWorkflowSchemes(prisma, {
    dryRun,
    workspace,
    // Thông báo ghi thẳng bảng Notification (script chạy ngoài Nest; cùng dạng với NotificationsService.publish:
    // loại ISSUE_UPDATED, không gắn việc, payload.automationRuleDisabled).
    notify: async (n) => {
      await prisma.notification.create({
        data: {
          recipientId: n.recipientId,
          workspaceId: n.workspaceId,
          type: 'ISSUE_UPDATED',
          payload: { automationRuleDisabled: n.ruleName },
        },
      });
    },
  });
  for (const w of result.workspaces) {
    console.log(`\n${tag}== ${w.workspaceName} (${w.workspaceId})`);
    if (w.createdWorkflows.length) console.log(`  quy trình mới: ${w.createdWorkflows.join(', ')}`);
    console.log(`  dòng cấu hình mới: ${w.createdSchemeRows}`);
    if (w.moves.length) {
      console.log(
        '  dự án | loại việc | quy trình nguồn | trạng thái cũ -> mới (quy trình đích) | số việc | nguồn ánh xạ',
      );
      for (const m of w.moves)
        console.log(
          `  ${m.projectKey} | ${m.issueTypeName} | ${m.fromWorkflowName} | ${m.fromStatusName} -> ${m.toStatusName} (${m.toWorkflowName}) | ${m.count} | ${m.via}`,
        );
    }
    console.log(
      `  việc chuyển: ${w.movedIssues}; liên kết cột bảng thêm: ${w.boardLinksAdded}, gỡ (trạng thái cũ không còn dùng): ${w.boardLinksRemoved}`,
    );
    for (const r of w.rules) {
      console.log(
        `  quy tắc "${r.name}" [${r.projectId ? `dự án ${r.projectId}` : 'cả tổ chức'}]: ${r.outcome === 'disabled' ? 'SẼ BỊ TẮT (không ánh xạ được trạng thái)' : 'sửa id trạng thái'}`,
      );
      for (const ref of r.statusRefs ?? [])
        console.log(
          `      ${ref.fromName} (${ref.fromId}) -> ${ref.toIds.length ? ref.toNames.map((n, i) => `${n} (${ref.toIds[i]})`).join(', ') : '(không có)'}`,
        );
    }
    if (w.nameRefs.length) {
      console.log(
        '  THAM CHIẾU THEO TÊN trạng thái trong JQL sẽ KHÔNG còn khớp (chỉ báo, không sửa):',
      );
      for (const n of w.nameRefs)
        console.log(`      [${n.kind}] ${n.label} (${n.id}): ${n.names.join(', ')}`);
    }
  }
  const t = result.totals;
  console.log(
    `\n${tag}Tổng: ${t.workspaces} workspace, ${t.createdWorkflows} quy trình mới, ${t.createdSchemeRows} dòng cấu hình mới, ` +
      `${t.movedIssues} việc chuyển, ${t.boardLinksAdded} liên kết cột thêm, ${t.boardLinksRemoved} gỡ, ${t.rulesRewritten} quy tắc sửa, ${t.rulesDisabled} quy tắc tắt` +
      `${dryRun ? ' (dry-run — chưa ghi gì)' : ''}.`,
  );
} finally {
  await prisma.$disconnect();
}
