import type {
  AssistantBulkAssignResult,
  AssistantBulkAssignRowInput,
  AssistantBulkMemberRowInput,
  AssistantBulkMembersResult,
} from '@tirapro/types';

/**
 * Mô hình THẺ XEM TRƯỚC của lệnh hàng loạt — dữ liệu thuần, serialize được (lưu sessionStorage) + các hàm thuần tính trạng
 * thái từng dòng, "có xác nhận được không", và dựng yêu cầu gửi máy chủ / yêu cầu Hoàn tác. Không có I/O ở đây: phần tải dữ
 * liệu nằm ở `bulkPreviewBuild.ts`, phần hiển thị ở `BulkCard.tsx`. Máy chủ vẫn kiểm quyền + OCC từng dòng lúc thực hiện;
 * cờ `allowed` ở đây chỉ là GỢI Ý để người dùng thấy trước dòng nào sẽ bị bỏ qua.
 */

export interface CardPerson {
  id: string;
  name: string;
  email: string | null;
}

/** Một tên người dùng đã gõ: khớp chắc (`person`), khớp gần đúng (`approx`), hoặc mơ hồ (`options` — bắt chọn). */
export interface PersonSlot {
  query: string;
  person: CardPerson | null;
  options: CardPerson[] | null;
  approx?: boolean;
  /** Thêm thành viên: người này đến từ team nào (thực hiện vẫn từng người). */
  via?: string | null;
}

export type AssignMode = 'one' | 'round-robin' | 'points' | 'pairs';

export const MODE_LABEL: Record<AssignMode, string> = {
  one: 'Tất cả cho một người',
  'round-robin': 'Chia đều lần lượt',
  points: 'Chia đều theo điểm',
  pairs: 'Theo cặp đã nêu',
};

/** Điểm tính cho việc chưa ước lượng khi chia theo điểm. */
const UNESTIMATED_POINTS = 1;

export interface AssignRowSrc {
  issueId: string;
  key: string;
  summary: string;
  /** Version lúc xem trước (OCC phía máy chủ). */
  version: number;
  projectId: string;
  projectKey: string;
  current: CardPerson | null;
  points: number | null;
  /** Gợi ý quyền (issue:assign + issue:edit) ở dự án của việc: false = chắc chắn bị bỏ qua. undefined = chưa biết. */
  allowed: boolean | undefined;
  /** Không đủ quyền vì chỉ có `issue:edit:own` (chỉ sửa được việc của mình) — để nói đúng lý do. */
  ownOnly?: boolean;
  /** Chỉ kiểu theo cặp: tên người đã gõ cho việc này (khớp với `PersonSlot.query`). */
  pairQuery?: string;
}

export interface AssignCard {
  kind: 'assign';
  rows: AssignRowSrc[];
  slots: PersonSlot[];
  /** Tên không có trong tổ chức — chặn xác nhận. */
  unmatched: string[];
  modes: AssignMode[];
  defaultMode: AssignMode;
  /** Điểm việc chưa xong đang giữ theo người (chia theo điểm). */
  loads: Record<string, number>;
  /** Bộ lọc đã hiểu (hiện cho người dùng kiểm). */
  filterNotes: string[];
  filterJql: string | null;
  truncated: boolean;
  missingKeys: string[];
  /** Ghi chú KHÔNG chặn (số bị bỏ qua…). */
  notes: string[];
  /** Lỗi CHẶN xác nhận (cú pháp, trùng việc cho hai người…). */
  problems: string[];
}

export interface AssignState {
  mode: AssignMode;
  /** Người nhận khi mode = one. */
  oneId: string | null;
  /** Lựa chọn cho tên mơ hồ: query → id người. */
  picks: Record<string, string>;
  /** Sửa từng dòng: issueId → id người, hoặc 'skip' = bỏ dòng. */
  overrides: Record<string, string>;
}

export const SKIP = 'skip';

export interface MemberProjectCol {
  id: string;
  key: string;
  name: string;
  isPrivate: boolean;
  /** Gợi ý quyền project:admin của người gõ ở dự án này. */
  allowed: boolean | undefined;
  /** userId → trạng thái hiện tại. Vắng mặt = chưa là thành viên (chỉ có thể với dự án riêng tư). */
  members: Record<string, { roleIds: string[]; roleNames: string[]; isOverride: boolean }>;
}

export interface RoleOpt {
  id: string;
  name: string;
}

export interface MemberCard {
  kind: 'add-member' | 'remove-member';
  slots: PersonSlot[];
  unmatched: string[];
  projects: MemberProjectCol[];
  /** Nhóm dự án cá nhân dùng làm đích (chỉ để hiển thị). */
  groupName: string | null;
  /** Vai trò chọn được (thêm: ô chọn vai trò; luôn dùng để gọi tên vai trò). */
  roles: RoleOpt[];
  /** Id các vai trò mang `project:admin` (chặn tự bỏ quản trị / bỏ quản trị viên cuối). */
  adminRoleIds: string[];
  /** Người gõ + có phải quản trị tổ chức không (quản trị tổ chức không mất quyền khi đổi vai trò dự án). */
  actor: { id: string; orgAdmin: boolean };
  /**
   * Vai trò mặc định: chỉ khi lệnh NÊU vai trò (`parsed`, có thể gần đúng). Lệnh không nêu → `none`: bắt buộc chọn, KHÔNG tự
   * điền sẵn (bấm Xác nhận không chạm ô chọn sẽ không vô tình cấp quyền).
   */
  defaultRole: {
    id: string | null;
    source: 'parsed' | 'none';
    query?: string;
    approx?: boolean;
  };
  info: string[];
  notes: string[];
  problems: string[];
}

export interface MemberState {
  roleId: string | null;
  picks: Record<string, string>;
  /** Khoá dòng (`userId|projectId`) đã bỏ. */
  dropped: string[];
}

export type BulkCard = AssignCard | MemberCard;

/* ------------------------------ giao việc ------------------------------ */

type AssignRowStatus = 'ok' | 'same' | 'skip' | 'no-perm' | 'no-person';

export interface ComputedAssignRow {
  src: AssignRowSrc;
  target: CardPerson | null;
  status: AssignRowStatus;
  note?: string;
}

export interface AssignComputed {
  rows: ComputedAssignRow[];
  /** Người nhận khả dụng theo thứ tự đã gõ (gồm lựa chọn cho tên mơ hồ). */
  pool: CardPerson[];
  /** Tên mơ hồ chưa chọn. */
  unresolvedChoices: string[];
  /** Lý do chưa xác nhận được (hiện cho người dùng). */
  blocking: string[];
  canConfirm: boolean;
  counts: { ok: number; same: number; skip: number; noPerm: number; noPerson: number };
  /** Số việc + điểm mỗi người nhận (theo dòng sẽ ghi). */
  perPerson: Array<{ person: CardPerson; count: number; points: number }>;
}

/** Người của một ô tên: khớp chắc, hoặc lựa chọn đã chọn cho tên mơ hồ. */
function slotPerson(slot: PersonSlot, picks: Record<string, string>): CardPerson | null {
  if (slot.person) return slot.person;
  const id = picks[slot.query];
  return slot.options?.find((o) => o.id === id) ?? null;
}

export function initialAssignState(card: AssignCard): AssignState {
  const pool = card.slots.flatMap((s) => (s.person ? [s.person] : []));
  return {
    mode: card.defaultMode,
    oneId: pool[0]?.id ?? null,
    picks: {},
    overrides: {},
  };
}

/** Chia các dòng cho người trong `pool` theo `mode` (chưa tính sửa tay từng dòng). */
function distribute(
  rows: AssignRowSrc[],
  pool: CardPerson[],
  card: AssignCard,
  state: AssignState,
  byQuery: (q: string) => CardPerson | null,
): Map<string, CardPerson | null> {
  const out = new Map<string, CardPerson | null>();
  if (pool.length === 0) {
    for (const r of rows) out.set(r.issueId, null);
    return out;
  }
  const active = rows.filter((r) => state.overrides[r.issueId] !== SKIP);
  switch (state.mode) {
    case 'one': {
      const one = pool.find((p) => p.id === state.oneId) ?? pool[0]!;
      for (const r of active) out.set(r.issueId, one);
      break;
    }
    case 'round-robin':
      active.forEach((r, i) => out.set(r.issueId, pool[i % pool.length]!));
      break;
    case 'points': {
      const total = new Map(pool.map((p) => [p.id, card.loads[p.id] ?? 0]));
      // Việc nhiều điểm trước (giữ thứ tự mã khi bằng điểm) → mỗi việc vào người đang nhẹ nhất (hoà → theo thứ tự đã gõ).
      const order = [...active].sort(
        (a, b) =>
          (b.points ?? UNESTIMATED_POINTS) - (a.points ?? UNESTIMATED_POINTS) ||
          rows.indexOf(a) - rows.indexOf(b),
      );
      for (const r of order) {
        let best = pool[0]!;
        for (const p of pool) if ((total.get(p.id) ?? 0) < (total.get(best.id) ?? 0)) best = p;
        out.set(r.issueId, best);
        total.set(best.id, (total.get(best.id) ?? 0) + (r.points ?? UNESTIMATED_POINTS));
      }
      break;
    }
    case 'pairs':
      for (const r of active) out.set(r.issueId, r.pairQuery ? byQuery(r.pairQuery) : null);
      break;
  }
  return out;
}

/**
 * Tính bảng xem trước giao việc từ thẻ + lựa chọn của người dùng. THUẦN: mọi lần đổi cách chia / người / bỏ dòng đều gọi lại.
 * Xác nhận chỉ được khi: không còn tên mơ hồ chưa chọn, không có tên không tìm thấy, không có lỗi chặn, có ≥ 1 dòng sẽ ghi.
 */
export function computeAssign(card: AssignCard, state: AssignState): AssignComputed {
  const pool = card.slots.flatMap((s) => {
    const p = slotPerson(s, state.picks);
    return p ? [p] : [];
  });
  const unresolvedChoices = card.slots
    .filter((s) => !s.person && s.options && !slotPerson(s, state.picks))
    .map((s) => s.query);
  const byQuery = (q: string): CardPerson | null => {
    const slot = card.slots.find((s) => s.query === q);
    return slot ? slotPerson(slot, state.picks) : null;
  };
  const auto = distribute(card.rows, pool, card, state, byQuery);
  const rows: ComputedAssignRow[] = card.rows.map((src) => {
    const ov = state.overrides[src.issueId];
    if (ov === SKIP) return { src, target: null, status: 'skip' };
    const target = ov ? (pool.find((p) => p.id === ov) ?? null) : (auto.get(src.issueId) ?? null);
    if (src.allowed === false)
      return {
        src,
        target,
        status: 'no-perm',
        note: src.ownOnly
          ? 'Bạn chỉ được sửa việc của mình — không đủ quyền giao việc.'
          : `Bạn không đủ quyền giao việc ở dự án ${src.projectKey}.`,
      };
    if (!target) return { src, target, status: 'no-person', note: 'Chưa có người nhận.' };
    if (src.current?.id === target.id)
      return { src, target, status: 'same', note: 'Đã là người phụ trách.' };
    return { src, target, status: 'ok' };
  });
  const counts = {
    ok: rows.filter((r) => r.status === 'ok').length,
    same: rows.filter((r) => r.status === 'same').length,
    skip: rows.filter((r) => r.status === 'skip').length,
    noPerm: rows.filter((r) => r.status === 'no-perm').length,
    noPerson: rows.filter((r) => r.status === 'no-person').length,
  };
  const blocking: string[] = [];
  if (unresolvedChoices.length > 0)
    blocking.push(`Chọn người cho: ${unresolvedChoices.map((q) => `“${q}”`).join(', ')}.`);
  for (const q of card.unmatched) blocking.push(`Không thấy người “${q}” trong tổ chức.`);
  blocking.push(...card.problems);
  if (state.mode === 'pairs' && !card.rows.some((r) => r.pairQuery))
    blocking.push('Lệnh không nêu cặp việc – người nên không dùng được cách chia “Theo cặp”.');
  if (pool.length === 0 && card.unmatched.length === 0 && unresolvedChoices.length === 0)
    blocking.push('Chưa có người nhận.');
  if (counts.ok === 0 && blocking.length === 0) blocking.push('Không có dòng nào cần ghi.');
  const perPerson = pool.map((person) => {
    const mine = rows.filter((r) => r.status === 'ok' && r.target?.id === person.id);
    return {
      person,
      count: mine.length,
      points: mine.reduce((s, r) => s + (r.src.points ?? UNESTIMATED_POINTS), 0),
    };
  });
  return {
    rows,
    pool,
    unresolvedChoices,
    blocking,
    canConfirm: blocking.length === 0 && counts.ok > 0,
    counts,
    perPerson,
  };
}

/** Yêu cầu gửi máy chủ: chỉ các dòng `ok` (dòng bị bỏ / không quyền / đã đúng KHÔNG BAO GIỜ được gửi). */
export function assignInputs(c: AssignComputed): AssistantBulkAssignRowInput[] {
  return c.rows.flatMap((r) =>
    r.status === 'ok' && r.target
      ? [{ issueId: r.src.issueId, version: r.src.version, assigneeId: r.target.id }]
      : [],
  );
}

/* ------------------------------ thành viên ------------------------------ */

type MemberRowStatus = 'ok' | 'already' | 'no-perm' | 'blocked' | 'nothing' | 'skip';

export interface ComputedMemberRow {
  /** `userId|projectId` */
  key: string;
  person: CardPerson;
  via: string | null;
  project: { id: string; key: string; name: string };
  status: MemberRowStatus;
  /** Hiện tại → sau (hiển thị). */
  current: string;
  after: string;
  /** Lý do khi không ghi (hoặc cảnh báo khi ghi). */
  note?: string;
  /** Bộ vai trò sẽ đặt khi `status = ok` (`null` = gỡ vai trò riêng). */
  set?: string[] | null;
}

export interface MemberComputed {
  rows: ComputedMemberRow[];
  unresolvedChoices: string[];
  blocking: string[];
  canConfirm: boolean;
  counts: {
    ok: number;
    already: number;
    skip: number;
    noPerm: number;
    blocked: number;
    nothing: number;
  };
  role: RoleOpt | null;
}

const memberRowKey = (userId: string, projectId: string): string => `${userId}|${projectId}`;

export function initialMemberState(card: MemberCard): MemberState {
  return { roleId: card.defaultRole.id, picks: {}, dropped: [] };
}

const roleText = (names: string[]): string => (names.length ? names.join(', ') : '—');

const SELF_LOCK =
  'Bạn đang tự bỏ quyền quản trị của chính mình ở dự án này — hãy nhờ một quản trị viên khác làm.';
const LAST_ADMIN =
  'Dự án riêng tư này sẽ không còn quản trị viên nào — hãy chỉ định quản trị viên khác trước.';

/**
 * Tính bảng xem trước thêm / gỡ thành viên. "Thêm" là HỢP: bộ vai trò đặt = vai trò người này đang có ở dự án (vai trò riêng, hoặc
 * vai trò mặc định nếu chưa có ghi đè) + vai trò đã chọn — KHÔNG BAO GIỜ làm mất vai trò đang có (đổi/bớt vai trò là việc khác).
 * "Gỡ" bỏ toàn bộ vai trò RIÊNG. Hai luật chặn (máy chủ cũng chặn): tự bỏ quyền quản trị của chính mình, và làm dự án riêng tư
 * không còn quản trị viên nào (cộng dồn theo thứ tự dòng).
 */
export function computeMembers(card: MemberCard, state: MemberState): MemberComputed {
  const adding = card.kind === 'add-member';
  const role = adding ? (card.roles.find((r) => r.id === state.roleId) ?? null) : null;
  const unresolvedChoices = card.slots
    .filter((s) => !s.person && s.options && !slotPerson(s, state.picks))
    .map((s) => s.query);
  const people = card.slots.flatMap((s) => {
    const p = slotPerson(s, state.picks);
    return p ? [{ person: p, via: s.via ?? null }] : [];
  });
  const adminIds = new Set(card.adminRoleIds);
  const holdsAdmin = (ids: readonly string[]) => ids.some((id) => adminIds.has(id));
  const seen = new Set<string>();
  const rows: ComputedMemberRow[] = [];
  for (const proj of card.projects) {
    // Người đang giữ quản trị dự án (chỉ cần cho dự án riêng tư: thành viên = các dòng có mặt trong danh sách).
    const holders = new Set(
      Object.entries(proj.members)
        .filter(([, m]) => holdsAdmin(m.roleIds))
        .map(([id]) => id),
    );
    for (const { person, via } of people) {
      const key = memberRowKey(person.id, proj.id);
      if (seen.has(key)) continue;
      seen.add(key);
      const m = proj.members[person.id];
      const base = { key, person, via, project: { id: proj.id, key: proj.key, name: proj.name } };
      const current = m
        ? `${roleText(m.roleNames)}${m.isOverride ? '' : ' (mặc định theo tổ chức)'}`
        : 'Chưa là thành viên';
      if (state.dropped.includes(key)) {
        rows.push({ ...base, status: 'skip', current, after: '—' });
        continue;
      }
      if (proj.allowed === false) {
        rows.push({
          ...base,
          status: 'no-perm',
          current,
          after: '—',
          note: `Bạn không phải quản trị của dự án ${proj.key}.`,
        });
        continue;
      }
      let row: ComputedMemberRow;
      if (adding) {
        const have = m?.roleIds ?? [];
        if (!role)
          row = { ...base, status: 'nothing', current, after: '—', note: 'Chưa chọn vai trò.' };
        else if (have.includes(role.id))
          row = {
            ...base,
            status: 'already',
            current,
            after: roleText(m!.roleNames),
            note: 'Đã có vai trò này.',
          };
        else {
          const set = [...have, role.id];
          const names = [...(m?.roleNames ?? []), role.name];
          row = {
            ...base,
            status: 'ok',
            current,
            after: roleText(names),
            set,
            note: !m
              ? 'Thêm vào dự án riêng tư.'
              : m.isOverride
                ? `Giữ nguyên ${roleText(m.roleNames)}, thêm ${role.name}.`
                : `Giữ vai trò mặc định ${roleText(m.roleNames)}, thêm ${role.name} (đặt vai trò riêng cho dự án này).`,
          };
        }
      } else if (m?.isOverride)
        row = {
          ...base,
          status: 'ok',
          current,
          after: proj.isPrivate ? 'Rời dự án' : 'Về vai trò mặc định của tổ chức',
          set: null,
          note: proj.isPrivate
            ? 'Dự án riêng tư: gỡ vai trò riêng = gỡ khỏi dự án.'
            : 'Chỉ gỡ được vai trò riêng của dự án; người này vẫn thuộc dự án theo vai trò tổ chức.',
        };
      else
        row = {
          ...base,
          status: 'nothing',
          current,
          after: '—',
          note: m
            ? 'Không có vai trò riêng để gỡ — người này vẫn thuộc dự án theo vai trò mặc định của tổ chức (không gỡ được từ đây).'
            : 'Chưa là thành viên của dự án này.',
        };
      if (row.status === 'ok') {
        const before = m?.roleIds ?? [];
        const loses = holdsAdmin(before) && !(row.set && holdsAdmin(row.set));
        const blockReason = !loses
          ? null
          : person.id === card.actor.id && !card.actor.orgAdmin
            ? SELF_LOCK
            : proj.isPrivate && holders.size <= 1 && holders.has(person.id)
              ? LAST_ADMIN
              : null;
        if (blockReason)
          row = { ...row, status: 'blocked', after: '—', note: blockReason, set: undefined };
        else if (row.set && holdsAdmin(row.set)) holders.add(person.id);
        else holders.delete(person.id);
      }
      rows.push(row);
    }
  }
  const count = (s: MemberRowStatus) => rows.filter((r) => r.status === s).length;
  const counts = {
    ok: count('ok'),
    already: count('already'),
    skip: count('skip'),
    noPerm: count('no-perm'),
    blocked: count('blocked'),
    nothing: count('nothing'),
  };
  const blocking: string[] = [];
  if (unresolvedChoices.length > 0)
    blocking.push(`Chọn người cho: ${unresolvedChoices.map((q) => `“${q}”`).join(', ')}.`);
  for (const q of card.unmatched) blocking.push(`Không thấy người “${q}” trong tổ chức.`);
  blocking.push(...card.problems);
  if (adding && !role) blocking.push('Chọn vai trò cho người được thêm.');
  if (people.length === 0 && card.unmatched.length === 0 && unresolvedChoices.length === 0)
    blocking.push('Chưa có người nào.');
  if (counts.ok === 0 && blocking.length === 0) blocking.push('Không có dòng nào cần ghi.');
  return {
    rows,
    unresolvedChoices,
    blocking,
    canConfirm: blocking.length === 0 && counts.ok > 0,
    counts,
    role,
  };
}

/** Yêu cầu gửi máy chủ: chỉ dòng `ok`. `expect` = vai trò RIÊNG máy chủ phải đang thấy (null = chưa có). */
export function memberInputs(
  card: MemberCard,
  computed: MemberComputed,
): AssistantBulkMemberRowInput[] {
  const projects = new Map(card.projects.map((p) => [p.id, p]));
  return computed.rows.flatMap((r) => {
    if (r.status !== 'ok' || r.set === undefined) return [];
    const m = projects.get(r.project.id)?.members[r.person.id];
    const expect = m?.isOverride ? m.roleIds : null;
    return [{ projectId: r.project.id, userId: r.person.id, expect, set: r.set }];
  });
}

/* ------------------------------ kết quả + Hoàn tác ------------------------------ */

type OutcomeStatus = 'ok' | 'skipped' | 'failed';

export interface OutcomeRow {
  label: string;
  detail: string;
  status: OutcomeStatus;
  reason?: string;
}

/** Dữ liệu Hoàn tác: các yêu cầu đảo ngược CHỈ của dòng đã đổi thật (gửi lại đúng hai API cũ). */
export type BulkUndo =
  | { kind: 'assign'; rows: AssistantBulkAssignRowInput[]; labels: Record<string, string> }
  | { kind: 'members'; rows: AssistantBulkMemberRowInput[]; labels: Record<string, string> };

export interface BulkOutcome {
  title: string;
  rows: OutcomeRow[];
  counts: { ok: number; skipped: number; failed: number };
  undo: BulkUndo | null;
}

const tally = (rows: OutcomeRow[]) => ({
  ok: rows.filter((r) => r.status === 'ok').length,
  skipped: rows.filter((r) => r.status === 'skipped').length,
  failed: rows.filter((r) => r.status === 'failed').length,
});

const tail = (c: { skipped: number; failed: number }): string =>
  [c.skipped ? `bỏ qua ${c.skipped}` : '', c.failed ? `lỗi ${c.failed}` : '']
    .filter(Boolean)
    .join(', ');

/** Kết quả giao việc: dòng nào máy chủ không trả coi như lỗi (không im lặng). */
export function assignOutcome(
  sent: ComputedAssignRow[],
  result: AssistantBulkAssignResult,
): BulkOutcome {
  const byId = new Map(result.results.map((r) => [r.issueId, r]));
  const rows: OutcomeRow[] = [];
  const undoRows: AssistantBulkAssignRowInput[] = [];
  const labels: Record<string, string> = {};
  for (const s of sent) {
    const r = byId.get(s.src.issueId);
    const label = `${s.src.key} · ${s.src.summary}`;
    const detail = `→ ${s.target?.name ?? '—'}`;
    if (!r) {
      rows.push({
        label,
        detail,
        status: 'failed',
        reason: 'Máy chủ không trả kết quả cho dòng này.',
      });
      continue;
    }
    rows.push({ label, detail, status: r.status, ...(r.reason ? { reason: r.reason } : {}) });
    if (r.status === 'ok' && r.version !== null) {
      undoRows.push({ issueId: r.issueId, version: r.version, assigneeId: r.previousAssigneeId });
      labels[r.issueId] = label;
    }
  }
  const counts = tally(rows);
  const extra = tail(counts);
  return {
    title: `Đã giao ${counts.ok} việc${extra ? ` (${extra})` : ''}`,
    rows,
    counts,
    undo: undoRows.length > 0 ? { kind: 'assign', rows: undoRows, labels } : null,
  };
}

export function membersOutcome(
  card: MemberCard,
  sent: ComputedMemberRow[],
  result: AssistantBulkMembersResult,
): BulkOutcome {
  const byKey = new Map(result.results.map((r) => [memberRowKey(r.userId, r.projectId), r]));
  const rows: OutcomeRow[] = [];
  const undoRows: AssistantBulkMemberRowInput[] = [];
  const labels: Record<string, string> = {};
  for (const s of sent) {
    const r = byKey.get(s.key);
    const label = `${s.person.name} · ${s.project.key}`;
    const detail = card.kind === 'add-member' ? `→ ${s.after}` : '→ gỡ vai trò riêng';
    if (!r) {
      rows.push({
        label,
        detail,
        status: 'failed',
        reason: 'Máy chủ không trả kết quả cho dòng này.',
      });
      continue;
    }
    rows.push({ label, detail, status: r.status, ...(r.reason ? { reason: r.reason } : {}) });
    if (r.status === 'ok') {
      // Đảo ngược: mong đợi đúng trạng thái SAU, đặt lại trạng thái TRƯỚC.
      undoRows.push({ projectId: r.projectId, userId: r.userId, expect: r.after, set: r.before });
      labels[s.key] = label;
    }
  }
  const counts = tally(rows);
  const extra = tail(counts);
  const verb = card.kind === 'add-member' ? 'Đã đặt vai trò cho' : 'Đã gỡ vai trò riêng của';
  return {
    title: `${verb} ${counts.ok} dòng${extra ? ` (${extra})` : ''}`,
    rows,
    counts,
    undo: undoRows.length > 0 ? { kind: 'members', rows: undoRows, labels } : null,
  };
}

/** Kết quả Hoàn tác (cùng dạng; không có Hoàn tác lần nữa). */
export function undoOutcome(
  undo: BulkUndo,
  result: AssistantBulkAssignResult | AssistantBulkMembersResult,
): BulkOutcome {
  const rows: OutcomeRow[] = [];
  if (undo.kind === 'assign') {
    const byId = new Map((result as AssistantBulkAssignResult).results.map((r) => [r.issueId, r]));
    for (const u of undo.rows) {
      const r = byId.get(u.issueId);
      rows.push({
        label: undo.labels[u.issueId] ?? u.issueId,
        detail: '→ người phụ trách cũ',
        status: r?.status ?? 'failed',
        reason: r ? r.reason : 'Máy chủ không trả kết quả cho dòng này.',
      });
    }
  } else {
    const byKey = new Map(
      (result as AssistantBulkMembersResult).results.map((r) => [
        memberRowKey(r.userId, r.projectId),
        r,
      ]),
    );
    for (const u of undo.rows) {
      const k = memberRowKey(u.userId, u.projectId);
      const r = byKey.get(k);
      rows.push({
        label: undo.labels[k] ?? k,
        detail: '→ như trước',
        status: r?.status ?? 'failed',
        reason: r ? r.reason : 'Máy chủ không trả kết quả cho dòng này.',
      });
    }
  }
  const counts = tally(rows);
  const extra = tail(counts);
  return {
    title: `Đã hoàn tác ${counts.ok} dòng${extra ? ` (${extra}${counts.skipped ? ' — đã bị sửa sau đó nên không đụng vào' : ''})` : ''}`,
    rows: rows.map((r) =>
      r.reason === undefined ? { label: r.label, detail: r.detail, status: r.status } : r,
    ),
    counts,
    undo: null,
  };
}
