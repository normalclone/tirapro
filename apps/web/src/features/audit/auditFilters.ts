import { AUDIT_ACTION_LABEL, type AuditAction } from '@tirapro/types';

/** Bộ lọc trang nhật ký quản trị — dạng giá trị ô nhập (chuỗi rỗng = không lọc). */
export interface AuditFilterInput {
  action: string;
  actorId: string;
  /** `dd/MM/yyyy` hoặc `yyyy-MM-dd` (ô chọn ngày của trình duyệt). */
  from: string;
  to: string;
}

/** Tham số gửi API `GET /audit` (chỉ gồm trường có giá trị). */
export interface AuditQuery {
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

/** Tách `dd/MM/yyyy` hoặc `yyyy-MM-dd` thành ngày-tháng-năm; sai định dạng hoặc ngày không có thật → null. */
export function parseDayInput(value: string): { y: number; m: number; d: number } | null {
  const v = value.trim();
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  const parts = vn
    ? { y: Number(vn[3]), m: Number(vn[2]), d: Number(vn[1]) }
    : iso
      ? { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) }
      : null;
  if (!parts) return null;
  const probe = new Date(parts.y, parts.m - 1, parts.d);
  const real =
    probe.getFullYear() === parts.y &&
    probe.getMonth() === parts.m - 1 &&
    probe.getDate() === parts.d;
  return real ? parts : null;
}

/** Đổi bộ lọc trên form thành tham số API: bỏ trường rỗng; `from` = đầu ngày, `to` = cuối ngày (giờ địa phương → ISO). */
export function toAuditQuery(f: AuditFilterInput): AuditQuery {
  const q: AuditQuery = {};
  if (f.action) q.action = f.action;
  if (f.actorId) q.actorId = f.actorId;
  const from = parseDayInput(f.from);
  if (from) q.from = new Date(from.y, from.m - 1, from.d, 0, 0, 0, 0).toISOString();
  const to = parseDayInput(f.to);
  if (to) q.to = new Date(to.y, to.m - 1, to.d, 23, 59, 59, 999).toISOString();
  return q;
}

/** Nhóm loại sự kiện theo tiền tố (`role.*`, `member.*`…) để danh sách dài dễ quét. Tiền tố khớp đầu tiên thắng. */
const AUDIT_ACTION_GROUPS: { label: string; prefixes: string[] }[] = [
  { label: 'Vai trò', prefixes: ['role.'] },
  { label: 'Thành viên', prefixes: ['member.'] },
  { label: 'Dự án', prefixes: ['project_member.', 'project.'] },
  { label: 'Tài khoản', prefixes: ['account.'] },
  { label: 'Tích hợp', prefixes: ['integration.'] },
  { label: 'Wiki', prefixes: ['wiki.'] },
];

export interface AuditActionOption {
  value: string;
  label: string;
  group?: string;
}

/**
 * Lựa chọn lọc loại sự kiện cho `SearchSelect`: mục "tất cả" (giá trị rỗng, không nhóm) rồi các sự kiện theo nhóm tiền tố.
 * Sự kiện không thuộc nhóm nào vào nhóm "Khác" — không mục nào bị rơi khỏi danh sách.
 */
export function groupedAuditActionOptions(allLabel: string): AuditActionOption[] {
  const actions = Object.keys(AUDIT_ACTION_LABEL) as AuditAction[];
  const used = new Set<AuditAction>();
  const out: AuditActionOption[] = [{ value: '', label: allLabel }];
  for (const g of AUDIT_ACTION_GROUPS) {
    for (const a of actions) {
      if (used.has(a) || !g.prefixes.some((p) => a.startsWith(p))) continue;
      used.add(a);
      out.push({ value: a, label: AUDIT_ACTION_LABEL[a], group: g.label });
    }
  }
  for (const a of actions) {
    if (!used.has(a)) out.push({ value: a, label: AUDIT_ACTION_LABEL[a], group: 'Khác' });
  }
  return out;
}
