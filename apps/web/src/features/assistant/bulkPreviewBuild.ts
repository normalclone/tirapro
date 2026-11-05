import type { IssueDto } from '@tirapro/types';
import type {
  AssignCard,
  AssignMode,
  CardPerson,
  MemberCard,
  MemberProjectCol,
  PersonSlot,
  RoleOpt,
} from './bulkPreview';
import type { BulkAddMemberPlan, BulkAssignPlan, BulkPlan, BulkRemoveMemberPlan } from './bulkPlan';
import { targetProjects } from './bulkPlan';
import type { PersonRef, Resolution } from './bulkResolve';
import type { AssistantDeps, RespondEnv } from './respond';

/**
 * Dựng THẺ XEM TRƯỚC từ kế hoạch chỉ-đọc (`bulkPlan.ts`): tải thêm dữ liệu cần để hiện trạng thái hiện tại + gợi ý quyền từng
 * dòng. Chỉ ĐỌC — không ghi gì. `null` = không có gì để xem trước (để `bulkReply` trả lời bằng chữ).
 */

const toCard = (p: PersonRef): CardPerson => ({
  id: p.id,
  name: p.displayName,
  email: p.email ?? null,
});

/** Một kết quả khớp người → ô tên; tên không tìm thấy vào `unmatched`. */
function slotsOf(list: Resolution<PersonRef>[]): { slots: PersonSlot[]; unmatched: string[] } {
  const slots: PersonSlot[] = [];
  const unmatched: string[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (r.status === 'none') {
      unmatched.push(r.query);
      continue;
    }
    if (seen.has(r.query)) continue; // cùng một tên gõ cho nhiều việc (kiểu theo cặp) chỉ một ô
    seen.add(r.query);
    if (r.status === 'ok')
      slots.push({
        query: r.query,
        person: toCard(r.value),
        options: null,
        ...(r.approx ? { approx: true } : {}),
      });
    else slots.push({ query: r.query, person: null, options: r.options.map(toCard) });
  }
  return { slots, unmatched };
}

/** `true` nếu cả hai quyền đều có; `false` nếu có một quyền chắc chắn thiếu; `undefined` = chưa biết. */
const allOf = (a: boolean | undefined, b: boolean | undefined): boolean | undefined =>
  a === false || b === false ? false : a === true && b === true ? true : undefined;

const projectKeyOf = (i: IssueDto, env: RespondEnv): string =>
  env.projects.find((p) => p.id === i.projectId)?.key ?? i.key.split('-')[0] ?? i.key;

async function buildAssignCard(
  plan: BulkAssignPlan,
  env: RespondEnv,
  deps: AssistantDeps,
): Promise<AssignCard | null> {
  const { slots, unmatched } = slotsOf(plan.pairs ? plan.pairs.map((p) => p.person) : plan.people);
  const issues = plan.pairs ? plan.pairs.map((p) => p.issue) : plan.issues;
  if (issues.length === 0 || (slots.length === 0 && unmatched.length === 0)) return null;

  const everyone = await deps.getPeople().catch(() => [] as PersonRef[]);
  const emailOf = new Map(everyone.map((p) => [p.id, p.email ?? null]));
  const projectIds = [...new Set(issues.map((i) => i.projectId))];
  const perms = new Map<string, boolean | undefined>();
  await Promise.all(
    projectIds.map(async (pid) => {
      const [assign, edit] = await Promise.all([
        deps.can(pid, 'issue:assign').catch(() => undefined),
        deps.can(pid, 'issue:edit').catch(() => undefined),
      ]);
      perms.set(pid, allOf(assign, edit));
    }),
  );
  const pairQuery = new Map((plan.pairs ?? []).map((p) => [p.issue.id, p.person.query]));
  const rows = issues.map((i) => {
    const cur = i.assignee ?? null;
    return {
      issueId: i.id,
      key: i.key,
      summary: i.summary,
      version: i.version,
      projectId: i.projectId,
      projectKey: projectKeyOf(i, env),
      current: cur
        ? { id: cur.id, name: cur.displayName, email: emailOf.get(cur.id) ?? null }
        : null,
      points: i.storyPoints ?? null,
      allowed: perms.get(i.projectId),
      ...(pairQuery.has(i.id) ? { pairQuery: pairQuery.get(i.id)! } : {}),
    };
  });
  // Điểm đang giữ chỉ cần khi có ≥ 2 người nhận có thể (chia theo điểm).
  const candidateIds = [
    ...new Set(
      slots.flatMap((s) => (s.person ? [s.person.id] : (s.options ?? []).map((o) => o.id))),
    ),
  ];
  const loads =
    candidateIds.length >= 2 ? await deps.getOpenLoad(candidateIds).catch(() => ({})) : {};
  const pairs = plan.pairs !== null;
  const modes: AssignMode[] = pairs
    ? ['pairs', 'one', 'round-robin', 'points']
    : ['one', 'round-robin', 'points'];
  return {
    kind: 'assign',
    rows,
    slots,
    unmatched,
    modes,
    defaultMode: pairs ? 'pairs' : plan.distribution === 'round-robin' ? 'round-robin' : 'one',
    loads,
    filterNotes: plan.filterNotes,
    filterJql: plan.filterJql,
    truncated: plan.truncated,
    missingKeys: plan.missingKeys,
    notes: plan.notes,
    problems: plan.problems,
  };
}

async function buildMemberCard(
  plan: BulkAddMemberPlan | BulkRemoveMemberPlan,
  env: RespondEnv,
  deps: AssistantDeps,
): Promise<MemberCard | null> {
  const adding = plan.kind === 'bulk-add-member';
  const { slots, unmatched } = slotsOf(plan.people);
  if (adding) {
    for (const c of plan.candidates) {
      if (c.via)
        slots.push({
          query: c.person.displayName,
          person: toCard(c.person),
          options: null,
          via: c.via.teamName,
        });
    }
  }
  const targets = targetProjects(plan);
  if ((slots.length === 0 && unmatched.length === 0) || targets.length === 0) return null;

  const problems = [...plan.problems];
  const columns: MemberProjectCol[] = await Promise.all(
    targets.map(async (p) => {
      const [allowed, members] = await Promise.all([
        deps.can(p.id, 'project:admin').catch(() => undefined),
        deps.getProjectMembers(p.id).then(
          (m) => m,
          () => null,
        ),
      ]);
      if (members === null)
        problems.push(`Không tải được thành viên dự án ${p.key} — hãy thử lại sau.`);
      return {
        id: p.id,
        key: p.key,
        name: p.name,
        isPrivate: env.projects.find((x) => x.id === p.id)?.isPrivate === true,
        allowed,
        members: Object.fromEntries(
          (members ?? []).map((m) => [
            m.userId,
            { roleIds: m.roleIds, roleNames: m.roleNames, isOverride: m.isOverride },
          ]),
        ),
      };
    }),
  );

  let roles: RoleOpt[] = [];
  let defaultRole: MemberCard['defaultRole'] = { id: null, source: 'none' };
  const info: string[] = [];
  if (adding) {
    roles = (await deps.getProjectRoles().catch(() => [])).map((r) => ({ id: r.id, name: r.name }));
    if (plan.role?.status === 'ok')
      defaultRole = {
        id: plan.role.value.id,
        source: 'parsed',
        query: plan.role.query,
        ...(plan.role.approx ? { approx: true } : {}),
      };
    else if (plan.role?.status === 'ambiguous')
      info.push(`“${plan.role.query}” khớp nhiều vai trò — hãy chọn vai trò trên thẻ.`);
    else if (plan.role?.status === 'none')
      info.push(`Không thấy vai trò “${plan.role.query}” — hãy chọn vai trò trên thẻ.`);
    if (defaultRole.id === null && !plan.role) {
      const dev = roles.find((r) => r.name === 'Developer');
      if (dev) defaultRole = { id: dev.id, source: 'default' };
    }
  }
  if (plan.group?.status === 'ok')
    info.push(
      `Nhóm dự án của bạn “${plan.group.value.name}”: ${plan.groupProjects.length} dự án đang hoạt động.`,
    );
  return {
    kind: adding ? 'add-member' : 'remove-member',
    slots,
    unmatched,
    projects: columns,
    groupName: plan.group?.status === 'ok' ? plan.group.value.name : null,
    roles,
    defaultRole,
    info,
    notes: [],
    // Vai trò chưa rõ được xử lý bằng ô chọn vai trò trên thẻ, không phải lỗi chặn.
    problems: problems.filter((p) => !p.startsWith('Không thấy vai trò')),
  };
}

/** Điểm vào duy nhất: kế hoạch → thẻ (hoặc null nếu không có gì để xem trước). */
export function buildBulkCard(
  plan: BulkPlan,
  env: RespondEnv,
  deps: AssistantDeps,
): Promise<AssignCard | MemberCard | null> {
  return plan.kind === 'bulk-assign'
    ? buildAssignCard(plan, env, deps)
    : buildMemberCard(plan, env, deps);
}
