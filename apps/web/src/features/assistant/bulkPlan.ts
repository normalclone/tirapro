import type { IssueDto } from '@tirapro/types';
import {
  filterToJql,
  prefixKeyword,
  resolveGroup,
  resolveMany,
  resolvePerson,
  resolveProject,
  resolveRole,
  resolveTeam,
  titlePrefixMatches,
  type GroupRef,
  type PersonRef,
  type ProjectRef,
  type Resolution,
  type RoleRef,
  type TeamRef,
} from './bulkResolve';
import {
  isSelfName,
  type BulkAddMemberIntent,
  type BulkAssignIntent,
  type BulkIssueType,
  type BulkRemoveMemberIntent,
} from './bulkParse';
import type { AssistantDeps, AssistantProject, RespondEnv } from './respond';

/**
 * Từ lệnh đã phân tích → KẾ HOẠCH đã khớp với dữ liệu thật (người, dự án, việc, nhóm, vai trò). Chỉ ĐỌC (qua `AssistantDeps`):
 * không hàm nào ở đây ghi dữ liệu. Thẻ xem trước (Task 2) dựng từ kế hoạch này; quyền theo dòng (`issue:assign`,
 * `project:admin`), "đã là thành viên" và hiện trạng thành viên-qua-team được kiểm ở bước xem trước/thực thi, không ở đây.
 */

/** Cách chia mặc định theo lệnh: một người → tất cả; nhiều người → chia đều lần lượt; kiểu cặp → theo cặp. */
type Distribution = 'one' | 'round-robin' | 'pairs';

export interface BulkAssignPlan {
  kind: 'bulk-assign';
  distribution: Distribution;
  /** Việc đã tìm thấy (theo thứ tự mã). Kiểu cặp: `pairs` mới là nguồn chính, đây vẫn liệt kê các việc có mặt. */
  issues: IssueDto[];
  /** Mã người dùng nêu nhưng không tìm thấy / không xem được. */
  missingKeys: string[];
  /** Danh sách bị cắt (còn nhiều hơn một trang kết quả) — thẻ phải nói rõ, không giả vờ đã đủ. */
  truncated: boolean;
  /** JQL chạy cho bộ lọc (hiện trên thẻ); null với danh sách mã / việc con. */
  filterJql: string | null;
  /** Mô tả bộ lọc bằng lời (hiện trên thẻ cạnh JQL). */
  filterNotes: string[];
  people: Resolution<PersonRef>[];
  /** Kiểu theo cặp: mỗi việc kèm kết quả khớp người của nó. */
  pairs: Array<{ issue: IssueDto; person: Resolution<PersonRef> }> | null;
  /** Lỗi cú pháp + lỗi khớp (dự án không thấy, thiếu phạm vi…) tiếng Việt, hiển thị nguyên văn. */
  problems: string[];
}

export interface BulkMemberPlanBase {
  /** Người nêu tên trực tiếp. */
  people: Resolution<PersonRef>[];
  projects: Resolution<ProjectRef>[];
  /** Nhóm dự án cá nhân ("nhóm X của tôi"); null nếu không dùng nhóm. */
  group: Resolution<GroupRef> | null;
  /** Dự án của nhóm mà người gõ XEM ĐƯỢC (nhóm ∩ dự án đang hoạt động trong tổ chức), bỏ dự án đã lưu trữ. */
  groupProjects: ProjectRef[];
  /**
   * Người gõ trần "nhóm QA" mà vừa có nhóm dự án của họ vừa có team của tổ chức cùng tên → phải hỏi lại (thêm vào MỌI dự án
   * của nhóm khác hẳn việc thêm team). null = không nhập nhằng.
   */
  groupVsTeam: TeamRef | null;
  problems: string[];
}

/** Một người được thêm: nêu tên trực tiếp (`via = null`) hoặc nằm trong một team của tổ chức. */
interface MemberCandidate {
  person: PersonRef;
  via: { teamId: string; teamName: string } | null;
}

export interface BulkAddMemberPlan extends BulkMemberPlanBase {
  kind: 'bulk-add-member';
  teams: Resolution<TeamRef>[];
  /**
   * Danh sách người cuối cùng (người nêu tên + thành viên của team, mỗi người một lần; nêu tên trực tiếp thắng).
   * SEAM (team theo dự án — đợt khác): hiện thực thi TỪNG NGƯỜI qua API thành viên dự án; khi có liên kết team ↔ dự án thì
   * các ứng viên có `via` có thể chuyển sang liên kết team mà không đổi kế hoạch này.
   */
  candidates: MemberCandidate[];
  /** null = người dùng không nói vai trò (thẻ cho chọn). */
  role: Resolution<RoleRef> | null;
}

export interface BulkRemoveMemberPlan extends BulkMemberPlanBase {
  kind: 'bulk-remove-member';
}

export type BulkPlan = BulkAssignPlan | BulkAddMemberPlan | BulkRemoveMemberPlan;

/** Người đang gõ — để hiểu "giao cho tôi". */
export interface BulkActor {
  id: string;
  displayName: string;
  email?: string | null;
}

const asProject = (p: AssistantProject): ProjectRef => ({ id: p.id, key: p.key, name: p.name });

/** Chạy `fn` trên danh sách với tối đa `limit` lời gọi song song, giữ thứ tự. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const TYPE_KEY: Record<BulkIssueType, string> = {
  bug: 'BUG',
  task: 'TASK',
  'sub-task': 'SUBTASK',
  story: 'STORY',
};
const TYPE_NAME: Record<BulkIssueType, string> = {
  bug: 'Bug',
  task: 'Task',
  'sub-task': 'Sub-task',
  story: 'Story',
};
/** Ghi chú bộ lọc hiển thị trên thẻ. Tên loại (Task…) lấy từ TYPE_NAME, không viết cứng trong câu tiếng Việt. */
const typeLabel = (t: BulkIssueType): string =>
  t === 'sub-task' ? `việc con (${TYPE_NAME[t]})` : `loại ${TYPE_NAME[t]}`;

/* ------------------------------ người ------------------------------ */

type PeopleDeps = Pick<AssistantDeps, 'getPeople' | 'searchPeople'>;

/** Khớp TỪNG tên (không bỏ bản trùng). "tôi/mình" = người gõ; tên không thấy trong danh sách đã tải (tối đa 200) thì thử tìm phía máy chủ. */
async function resolveEach(
  names: readonly string[],
  actor: BulkActor,
  deps: PeopleDeps,
): Promise<Resolution<PersonRef>[]> {
  if (names.length === 0) return [];
  const everyone = await deps.getPeople();
  const self: PersonRef = { id: actor.id, displayName: actor.displayName, email: actor.email };
  const out: Resolution<PersonRef>[] = [];
  for (const n of names) {
    if (isSelfName(n)) {
      out.push({ status: 'ok', query: n, value: self });
      continue;
    }
    let r = resolvePerson(n, everyone);
    if (r.status === 'none')
      r = resolvePerson(n, await deps.searchPeople(n).catch(() => [] as PersonRef[]));
    out.push(r);
  }
  return out;
}

/** Như `resolveEach`, nhưng hai tên cùng trỏ về MỘT người chỉ giữ lần đầu (không bị thêm/giao hai lần). */
export async function resolvePeopleNames(
  names: readonly string[],
  actor: BulkActor,
  deps: PeopleDeps,
): Promise<Resolution<PersonRef>[]> {
  const seen = new Set<string>();
  return (await resolveEach(names, actor, deps)).filter((r) => {
    if (r.status !== 'ok') return true;
    if (seen.has(r.value.id)) return false;
    seen.add(r.value.id);
    return true;
  });
}

/* ------------------------------ giao việc ------------------------------ */

/**
 * Kế hoạch giao việc: tìm các việc (mã / việc con / bộ lọc), khớp người nhận, chọn cách chia mặc định. Việc nào không tìm
 * thấy hoặc người gõ không xem được nằm ở `missingKeys` (API trả 404 cho cả hai nên không phân biệt được — không lộ sự tồn tại).
 */
export async function planBulkAssign(
  intent: BulkAssignIntent,
  env: RespondEnv,
  deps: AssistantDeps,
  actor: BulkActor,
): Promise<BulkAssignPlan> {
  const problems = [...intent.problems];
  const base = {
    kind: 'bulk-assign' as const,
    issues: [] as IssueDto[],
    missingKeys: [] as string[],
    truncated: false,
    filterJql: null as string | null,
    filterNotes: [] as string[],
    pairs: null as BulkAssignPlan['pairs'],
  };

  // Kiểu theo cặp.
  if (intent.pairs) {
    const issues = await fetchIssues(
      intent.pairs.map((p) => p.key),
      deps,
    );
    const personQueries = [...new Set(intent.pairs.map((p) => p.person))];
    const resolved = new Map<string, Resolution<PersonRef>>();
    for (const [i, r] of (await resolveEach(personQueries, actor, deps)).entries())
      resolved.set(personQueries[i]!, r);
    const pairs: NonNullable<BulkAssignPlan['pairs']> = [];
    for (const p of intent.pairs) {
      const issue = issues.byKey.get(p.key);
      if (issue) pairs.push({ issue, person: resolved.get(p.person)! });
    }
    return {
      ...base,
      distribution: 'pairs',
      issues: pairs.map((p) => p.issue),
      missingKeys: issues.missing,
      people: [...resolved.values()],
      pairs,
      problems,
    };
  }

  const found = await findIssues(intent, env, deps, problems);
  const people = await resolvePeopleNames(intent.people, actor, deps);
  const okCount = people.filter((p) => p.status === 'ok').length;
  return {
    ...base,
    ...found,
    distribution: people.length > 1 || okCount > 1 ? 'round-robin' : 'one',
    people,
    pairs: null,
    problems,
  };
}

async function fetchIssues(
  keys: readonly string[],
  deps: Pick<AssistantDeps, 'getIssue'>,
): Promise<{ byKey: Map<string, IssueDto>; missing: string[] }> {
  const got = await mapLimit(keys, 8, async (k) => ({ k, issue: await deps.getIssue(k) }));
  const byKey = new Map<string, IssueDto>();
  const missing: string[] = [];
  for (const { k, issue } of got) {
    if (issue) byKey.set(k, issue);
    else missing.push(k);
  }
  return { byKey, missing };
}

type Found = Pick<
  BulkAssignPlan,
  'issues' | 'missingKeys' | 'truncated' | 'filterJql' | 'filterNotes'
>;

async function findIssues(
  intent: BulkAssignIntent,
  env: RespondEnv,
  deps: AssistantDeps,
  problems: string[],
): Promise<Found> {
  const empty: Found = {
    issues: [],
    missingKeys: [],
    truncated: false,
    filterJql: null,
    filterNotes: [],
  };
  const sel = intent.selector;
  if (!sel) return empty;
  if (sel.kind === 'keys') {
    const { byKey, missing } = await fetchIssues(sel.keys, deps);
    return {
      ...empty,
      issues: sel.keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])),
      missingKeys: missing,
    };
  }
  if (sel.kind === 'children') {
    const parent = await deps.getIssue(sel.parentKey);
    if (!parent)
      return {
        ...empty,
        missingKeys: [sel.parentKey],
        filterNotes: [`Việc con của ${sel.parentKey}`],
      };
    const all = await deps.getProjectIssues(parent.projectId);
    // Việc con của Epic nằm ở `epicId`, của việc thường ở `parentId`.
    const kids = all.filter((i) => i.parentId === parent.id || i.epicId === parent.id);
    return { ...empty, issues: kids, filterNotes: [`Việc con của ${parent.key}`] };
  }
  return findByFilter(sel.filter, env, deps, problems, empty);
}

async function findByFilter(
  f: Extract<NonNullable<BulkAssignIntent['selector']>, { kind: 'filter' }>['filter'],
  env: RespondEnv,
  deps: AssistantDeps,
  problems: string[],
  empty: Found,
): Promise<Found> {
  const notes: string[] = [];
  let epic: IssueDto | null = null;
  if (f.epicKey) {
    epic = await deps.getIssue(f.epicKey);
    if (!epic) {
      problems.push(`Không thấy Epic ${f.epicKey} (sai mã hoặc bạn không có quyền xem).`);
      return { ...empty, missingKeys: [f.epicKey] };
    }
    notes.push(`thuộc Epic ${epic.key}`);
  }
  // Dự án: nêu rõ → khớp; không nêu → dự án của Epic, rồi dự án đang xem. KHÔNG bao giờ quét cả tổ chức.
  let project: ProjectRef | null = null;
  if (f.project) {
    const r = resolveProject(f.project, env.projects.map(asProject));
    if (r.status === 'ok') project = r.value;
    else {
      problems.push(
        r.status === 'ambiguous'
          ? `“${f.project}” khớp nhiều dự án (${r.options.map((o) => o.key).join(', ')}) — hãy gõ mã dự án.`
          : `Không thấy dự án “${f.project}” trong các dự án bạn xem được.`,
      );
      return empty;
    }
  } else if (epic) {
    project = env.projects.map(asProject).find((p) => p.id === epic.projectId) ?? null;
  } else if (env.project) project = asProject(env.project);
  if (!project) {
    problems.push(
      'Bộ lọc cần một dự án — hãy nêu mã dự án (vd “của KYHOP”) hoặc mở dự án rồi gõ lại.',
    );
    return empty;
  }
  notes.unshift(`dự án ${project.key}`);
  if (f.type) notes.push(typeLabel(f.type));
  if (f.unassigned) notes.push('chưa giao cho ai');
  if (f.titlePrefix) notes.push(`tiêu đề bắt đầu bằng ${f.titlePrefix}`);

  if (epic) {
    // Epic không có trong JQL: lọc phía trình duyệt trên việc của dự án.
    const all = await deps.getProjectIssues(project.id);
    const meta = f.type ? await deps.getMeta(project.key).catch(() => null) : null;
    const typeKey = f.type ? TYPE_KEY[f.type] : null;
    const isSub = (i: IssueDto) =>
      meta?.issueTypes.find((t) => t.id === i.type.id)?.isSubtask === true;
    const items = all.filter(
      (i) =>
        (i.epicId === epic.id || i.parentId === epic.id) &&
        (!f.unassigned || !i.assignee) &&
        (!f.titlePrefix || titlePrefixMatches(i.summary, f.titlePrefix)) &&
        (!typeKey || (f.type === 'sub-task' ? isSub(i) : i.type.key === typeKey)),
    );
    return { ...empty, issues: items, filterNotes: notes, filterJql: null };
  }

  let typeName: string | undefined;
  if (f.type) {
    const meta = await deps.getMeta(project.key).catch(() => null);
    const found = meta?.issueTypes.find((t) =>
      f.type === 'sub-task' ? t.isSubtask : t.key === TYPE_KEY[f.type!],
    );
    typeName = found?.name ?? TYPE_NAME[f.type];
  }
  const jql = filterToJql({
    projectKey: project.key,
    typeName,
    unassigned: f.unassigned,
    titleContains: f.titlePrefix ? prefixKeyword(f.titlePrefix) : undefined,
  });
  const { items, hasMore } = await deps.searchJql(jql);
  const kept = f.titlePrefix
    ? items.filter((i) => titlePrefixMatches(i.summary, f.titlePrefix!))
    : items;
  return { ...empty, issues: kept, truncated: hasMore, filterJql: jql, filterNotes: notes };
}

/* ------------------------------ thêm / gỡ thành viên ------------------------------ */

async function resolveTargets(
  targets: { refs: string[]; group: string | null; groupLoose?: true },
  env: RespondEnv,
  deps: AssistantDeps,
  problems: string[],
): Promise<Pick<BulkMemberPlanBase, 'projects' | 'group' | 'groupProjects' | 'groupVsTeam'>> {
  const all = env.projects.map(asProject);
  const projects = resolveMany(
    targets.refs,
    (r) => resolveProject(r, all),
    (p) => p.id,
  );
  for (const p of projects) {
    if (p.status === 'none')
      problems.push(`Không thấy dự án “${p.query}” trong các dự án bạn xem được.`);
  }
  let group: Resolution<GroupRef> | null = null;
  let groupProjects: ProjectRef[] = [];
  let groupVsTeam: TeamRef | null = null;
  if (targets.group) {
    const mine = await deps.getMyGroups();
    group = resolveGroup(targets.group, mine);
    if (group.status === 'none')
      problems.push(
        `Bạn chưa có nhóm dự án tên “${targets.group}” (chỉ dùng được nhóm của chính bạn).`,
      );
    if (targets.groupLoose && group.status !== 'none') {
      const team = resolveTeam(targets.group, await deps.getTeams().catch(() => [] as TeamRef[]));
      if (team.status === 'ok') {
        groupVsTeam = team.value;
        problems.push(
          `“nhóm ${targets.group}” khớp cả nhóm dự án của bạn lẫn team “${team.value.name}” của tổ chức — hãy nói rõ: “nhóm ${targets.group} của tôi” (mọi dự án của nhóm dự án) hoặc “dự án KYHOP” (từng dự án).`,
        );
      }
    }
    if (group.status === 'ok') {
      const visible = new Map(all.map((p) => [p.id, p]));
      groupProjects = group.value.projects
        .filter((p) => !p.isArchived)
        .flatMap((p) => (visible.has(p.id) ? [visible.get(p.id)!] : []));
      if (groupProjects.length === 0)
        problems.push(
          `Nhóm “${group.value.name}” chưa có dự án nào đang hoạt động mà bạn xem được.`,
        );
    }
  }
  return { projects, group, groupProjects, groupVsTeam };
}

export async function planBulkAddMember(
  intent: BulkAddMemberIntent,
  env: RespondEnv,
  deps: AssistantDeps,
  actor: BulkActor,
): Promise<BulkAddMemberPlan> {
  const problems = [...intent.problems];
  const [people, targets, teams, roles] = await Promise.all([
    resolvePeopleNames(intent.people, actor, deps),
    resolveTargets(intent.targets, env, deps, problems),
    intent.teams.length > 0 ? deps.getTeams() : Promise.resolve([] as TeamRef[]),
    intent.role ? deps.getProjectRoles() : Promise.resolve([] as RoleRef[]),
  ]);
  const teamRes = resolveMany(
    intent.teams,
    (t) => resolveTeam(t, teams),
    (t) => t.id,
  );
  for (const t of teamRes) {
    if (t.status === 'none') problems.push(`Không thấy team “${t.query}” của tổ chức.`);
  }
  const candidates: MemberCandidate[] = [];
  const seen = new Set<string>();
  for (const p of people) {
    if (p.status === 'ok' && !seen.has(p.value.id)) {
      seen.add(p.value.id);
      candidates.push({ person: p.value, via: null });
    }
  }
  for (const t of teamRes) {
    if (t.status !== 'ok') continue;
    if (t.value.members.length === 0)
      problems.push(`Team “${t.value.name}” chưa có thành viên nào.`);
    for (const m of t.value.members) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      candidates.push({ person: m, via: { teamId: t.value.id, teamName: t.value.name } });
    }
  }
  const role = intent.role ? resolveRole(intent.role, roles) : null;
  if (role?.status === 'none')
    problems.push(`Không thấy vai trò “${role.query}” — hãy chọn vai trò trên thẻ.`);
  return {
    kind: 'bulk-add-member',
    people,
    teams: teamRes,
    candidates,
    role,
    ...targets,
    problems,
  };
}

export async function planBulkRemoveMember(
  intent: BulkRemoveMemberIntent,
  env: RespondEnv,
  deps: AssistantDeps,
  actor: BulkActor,
): Promise<BulkRemoveMemberPlan> {
  const problems = [...intent.problems];
  const [people, targets] = await Promise.all([
    resolvePeopleNames(intent.people, actor, deps),
    resolveTargets(intent.targets, env, deps, problems),
  ]);
  return { kind: 'bulk-remove-member', people, ...targets, problems };
}

/** Dự án đích cuối cùng của lệnh thành viên: dự án nêu tên (đã khớp) + dự án của nhóm; mỗi dự án một lần. */
export function targetProjects(plan: BulkMemberPlanBase): ProjectRef[] {
  const out = new Map<string, ProjectRef>();
  for (const p of plan.projects) if (p.status === 'ok') out.set(p.value.id, p.value);
  for (const p of plan.groupProjects) out.set(p.id, p);
  return [...out.values()];
}

/** Còn gì cần người dùng chọn / sửa trước khi xem trước được (tên mơ hồ, không thấy). */
export function planNeedsChoice(plan: BulkPlan): boolean {
  const lists: Resolution<unknown>[] = [];
  if (plan.kind === 'bulk-assign') {
    lists.push(...plan.people);
    for (const p of plan.pairs ?? []) lists.push(p.person);
  } else {
    lists.push(...plan.people, ...plan.projects);
    if (plan.group) lists.push(plan.group);
    if (plan.kind === 'bulk-add-member') {
      lists.push(...plan.teams);
      if (plan.role) lists.push(plan.role);
    }
  }
  if (plan.problems.length > 0) return true; // lỗi cú pháp / dải ngược / không rõ nhóm hay team: phải sửa lệnh trước
  if (plan.kind !== 'bulk-assign' && plan.groupVsTeam) return true;
  return lists.some((r) => r.status !== 'ok');
}

/** Mọi khớp `ok` nhưng GẦN ĐÚNG (chỉ một phần tên / tiền tố) — thẻ phải đánh dấu "kiểm tra lại". */
export function approximateMatches(plan: BulkPlan): Resolution<unknown>[] {
  const lists: Resolution<unknown>[] = [];
  if (plan.kind === 'bulk-assign') {
    lists.push(...plan.people);
    for (const p of plan.pairs ?? []) lists.push(p.person);
  } else {
    lists.push(...plan.people, ...plan.projects);
    if (plan.group) lists.push(plan.group);
    if (plan.kind === 'bulk-add-member') {
      lists.push(...plan.teams);
      if (plan.role) lists.push(plan.role);
    }
  }
  return lists.filter((r) => r.status === 'ok' && r.approx === true);
}

/**
 * Lệnh không khớp được GÌ cả (không việc, không người, không dự án, không team/nhóm): rất có thể câu thường dùng chữ "thêm … vào"
 * hay "giao … cho" — `respond` nhường lại ý định cũ thay vì trả lời "Không thấy người …".
 */
export function planResolvedNothing(plan: BulkPlan): boolean {
  const seen = (r: Resolution<unknown>) => r.status !== 'none';
  if (plan.kind === 'bulk-assign') {
    return (
      plan.issues.length === 0 &&
      !plan.people.some(seen) &&
      !(plan.pairs ?? []).some((p) => seen(p.person))
    );
  }
  return (
    !plan.people.some(seen) &&
    !plan.projects.some(seen) &&
    !(plan.group && seen(plan.group)) &&
    !(plan.kind === 'bulk-add-member' && plan.teams.some(seen))
  );
}

/** Điểm vào duy nhất cho `respond`: ý định hàng loạt → kế hoạch. */
export function planBulk(
  intent: BulkAssignIntent | BulkAddMemberIntent | BulkRemoveMemberIntent,
  env: RespondEnv,
  deps: AssistantDeps,
  actor: BulkActor,
): Promise<BulkPlan> {
  if (intent.kind === 'bulk-assign') return planBulkAssign(intent, env, deps, actor);
  if (intent.kind === 'bulk-add-member') return planBulkAddMember(intent, env, deps, actor);
  return planBulkRemoveMember(intent, env, deps, actor);
}
