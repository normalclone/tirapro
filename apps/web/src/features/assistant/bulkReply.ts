import type { Block } from './blocks';
import { buildBulkCard } from './bulkPreviewBuild';
import type { BulkIntent } from './bulkParse';
import {
  approximateMatches,
  planBulk,
  planNeedsChoice,
  planResolvedNothing,
  targetProjects,
  type BulkActor,
  type BulkAssignPlan,
  type BulkPlan,
} from './bulkPlan';
import type { Resolution } from './bulkResolve';
import type { AssistantDeps, RespondEnv } from './respond';

/**
 * Trả lời lệnh hàng loạt: dựng KẾ HOẠCH (chỉ đọc) rồi tóm tắt "mình đã hiểu gì". Đây là phần Task 1; thẻ xem trước có nút Xác
 * nhận / Hoàn tác (Task 2) thay cho khối chữ này. KHÔNG ghi gì.
 */

const NO_ACTOR: BulkActor = { id: '', displayName: '' };

const APPROX = ' (gần đúng — kiểm tra lại)';
const names = <T extends { displayName: string }>(list: Resolution<T>[]): string =>
  list
    .flatMap((r) => (r.status === 'ok' ? [`${r.value.displayName}${r.approx ? APPROX : ''}`] : []))
    .join(', ');

/** Dòng cho một kết quả khớp chưa chắc chắn (mơ hồ / không thấy) — thẻ yêu cầu chọn. */
function unresolvedLines(
  label: string,
  list: Resolution<{ id: string }>[],
  show: (v: never) => string,
): string[] {
  const out: string[] = [];
  for (const r of list) {
    if (r.status === 'ambiguous')
      out.push(
        `• ${label} “${r.query}” khớp ${r.options.length} người/mục: ${r.options.map((o) => show(o as never)).join('; ')} — cần chọn một.`,
      );
    else if (r.status === 'none') out.push(`• Không thấy ${label} “${r.query}”.`);
  }
  return out;
}

const personShow = (p: { displayName: string; email?: string | null }) =>
  p.email ? `${p.displayName} <${p.email}>` : p.displayName;

const DISTRIBUTION_LABEL = {
  one: 'tất cả cho một người',
  'round-robin': 'chia đều lần lượt theo thứ tự mã',
  pairs: 'theo cặp việc – người',
} as const;

function assignLines(plan: BulkAssignPlan): string[] {
  const lines: string[] = [];
  const who = names(plan.people.length ? plan.people : (plan.pairs ?? []).map((p) => p.person));
  lines.push(
    `Giao ${plan.issues.length} việc${who ? ` cho ${who}` : ''} (${DISTRIBUTION_LABEL[plan.distribution]}).`,
  );
  if (plan.filterNotes.length) lines.push(`Bộ lọc: ${plan.filterNotes.join(' · ')}.`);
  if (plan.filterJql) lines.push(`JQL: ${plan.filterJql}`);
  if (plan.truncated)
    lines.push(
      'Danh sách có thể còn nhiều việc hơn trang kết quả đầu tiên — mình mới lấy phần đầu.',
    );
  if (plan.missingKeys.length)
    lines.push(`Không thấy (sai mã hoặc bạn không có quyền xem): ${plan.missingKeys.join(', ')}.`);
  lines.push(...unresolvedLines('người nhận', plan.people, personShow));
  for (const p of plan.pairs ?? []) {
    if (p.person.status !== 'ok')
      lines.push(...unresolvedLines(`người nhận của ${p.issue.key}`, [p.person], personShow));
  }
  return lines;
}

/** Tóm tắt kế hoạch thành các dòng chữ (thuần hàm — dễ test). */
export function describePlan(plan: BulkPlan): string[] {
  const lines = dedupeLines(describeCore(plan), plan.problems);
  const approx = approximateMatches(plan);
  if (approx.length > 0) {
    const label = (r: Resolution<unknown>): string => {
      const v = (r as { value?: { displayName?: string; name?: string; key?: string } }).value;
      return `“${r.query}” → ${v?.displayName ?? (v?.key ? `${v.key} (${v.name})` : v?.name)}`;
    };
    lines.push(`Khớp gần đúng, hãy kiểm tra lại: ${approx.map(label).join('; ')}.`);
  }
  return lines;
}

/**
 * Bỏ dòng "• Không thấy … “X”" đã được `problems` nói rồi (cùng “X”) và dòng trùng nguyên văn — mỗi điều chỉ nói một lần.
 */
export function dedupeLines(lines: string[], problems: readonly string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((l) => {
    const q = l.startsWith('• Không thấy') ? /“([^”]+)”/.exec(l)?.[1] : undefined;
    if (q && problems.some((p) => p.includes(`“${q}”`))) return false;
    if (seen.has(l)) return false;
    seen.add(l);
    return true;
  });
}

function describeCore(plan: BulkPlan): string[] {
  if (plan.kind === 'bulk-assign') return [...assignLines(plan), ...plan.problems];
  const lines: string[] = [];
  const projects = targetProjects(plan);
  const verb = plan.kind === 'bulk-add-member' ? 'Thêm' : 'Gỡ';
  const prep = plan.kind === 'bulk-add-member' ? 'vào' : 'khỏi';
  const who =
    plan.kind === 'bulk-add-member'
      ? plan.candidates.map((c) => c.person.displayName).join(', ')
      : names(plan.people);
  lines.push(
    `${verb} ${who || '(chưa rõ ai)'} ${prep} ${projects.length} dự án${projects.length ? ` (${projects.map((p) => p.key).join(', ')})` : ''}.`,
  );
  if (plan.group?.status === 'ok') lines.push(`Nhóm dự án của bạn: ${plan.group.value.name}.`);
  if (plan.kind === 'bulk-add-member') {
    if (plan.role?.status === 'ok') lines.push(`Vai trò: ${plan.role.value.name}.`);
    else if (!plan.role) lines.push('Chưa nói vai trò — bạn sẽ chọn trên thẻ.');
    const viaTeams = plan.candidates.filter((c) => c.via);
    if (viaTeams.length)
      lines.push(
        `Gồm ${viaTeams.length} người từ team ${[...new Set(viaTeams.map((c) => c.via!.teamName))].join(', ')} (thêm từng người).`,
      );
    lines.push(...unresolvedLines('team', plan.teams, (t: { name: string }) => t.name));
    if (plan.role && plan.role.status !== 'ok')
      lines.push(...unresolvedLines('vai trò', [plan.role], (r: { name: string }) => r.name));
  }
  lines.push(...unresolvedLines('người', plan.people, personShow));
  lines.push(
    ...unresolvedLines(
      'dự án',
      plan.projects,
      (p: { key: string; name: string }) => `${p.key} (${p.name})`,
    ),
  );
  if (plan.group && plan.group.status !== 'ok')
    lines.push(...unresolvedLines('nhóm dự án', [plan.group], (g: { name: string }) => g.name));
  return [...lines, ...plan.problems];
}

export async function bulkReply(
  intent: BulkIntent,
  env: RespondEnv,
  deps: AssistantDeps,
): Promise<Block[] | null> {
  const plan = await planBulk(intent, env, deps, env.actor ?? NO_ACTOR);
  // Không khớp được gì + biết câu gốc → nhường lại ý định cũ (câu thường như "thêm bình luận vào KYHOP-12" đừng thành "Không thấy người …").
  if (intent.raw !== undefined && planResolvedNothing(plan)) return null;
  // Có gì để xem trước → THẺ xem trước (chưa ghi gì; chỉ khi bấm Xác nhận mới thực hiện). Không có → trả lời bằng chữ.
  const card = await buildBulkCard(plan, env, deps);
  if (card)
    return [
      {
        type: 'text',
        text: 'Đây là bản xem trước — mình chưa ghi gì. Kiểm tra rồi bấm Xác nhận; sau đó vẫn có thể Hoàn tác.',
      },
      { type: 'bulk', card, status: 'pending' },
    ];
  const lines = describePlan(plan);
  const tail = planNeedsChoice(plan)
    ? 'Còn mục cần chọn lại — mình chưa làm gì.'
    : 'Không có gì để thực hiện — mình chưa ghi gì.';
  return [{ type: 'text', text: `${lines.join('\n')}\n${tail}` }];
}
