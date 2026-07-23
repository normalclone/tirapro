/* eslint-disable no-console */
/**
 * Seed Tirapro: permission catalog + system roles (gồm BA/Dev/Tester có phân quyền riêng),
 * rồi LÀM MỚI workspace demo (xoá data cũ) với dữ liệu "như thật": 4 tài khoản theo vai trò,
 * 3 sprint (đã đóng / đang chạy / sắp tới), và bộ sinh task/bug/story/epic mã theo loại
 * (BUG-1, TASK-3, STORY-2…) kèm comment, label, history, notification.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  SYSTEM_ROLE_SCOPE,
  SYSTEM_ROLE_META,
  type SystemRoleName,
  DEFAULT_ISSUE_TYPES,
  DEFAULT_PRIORITIES,
  DEFAULT_SEVERITIES,
  DEFAULT_RESOLUTIONS,
  DEFAULT_LINK_TYPES,
  DEFAULT_WORKFLOW_TEMPLATES,
} from '@tirapro/types';
import { initialRanks, issueTypePrefix } from '@tirapro/shared';

const prisma = new PrismaClient();
const day = 86_400_000;

/* ───────────────────────── Permissions & roles ───────────────────────── */
/** Toàn bộ danh mục vai trò hệ thống đến từ @tirapro/types (single source of truth). */

async function seedPermissionsAndRoles() {
  for (const def of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { key: def.key },
      update: { description: def.description, scope: def.scope as any },
      create: { key: def.key, description: def.description, scope: def.scope as any },
    });
  }
  const permByKey = new Map((await prisma.permission.findMany()).map((p) => [p.key, p.id]));

  const roleByName = new Map<string, string>();
  const names = Object.values(SYSTEM_ROLES) as SystemRoleName[];
  for (const name of names) {
    const scope = SYSTEM_ROLE_SCOPE[name];
    const meta = SYSTEM_ROLE_META[name];
    const found = await prisma.role.findFirst({
      where: { workspaceId: null, name, scope },
      select: { id: true },
    });
    const data = { isSystem: true, description: meta.description, color: meta.color };
    const role = found
      ? await prisma.role.update({ where: { id: found.id }, data })
      : await prisma.role.create({ data: { name, scope, ...data } });
    roleByName.set(name, role.id);
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    const rows = SYSTEM_ROLE_PERMISSIONS[name]
      .map((k) => permByKey.get(k))
      .filter((id): id is string => !!id)
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    if (rows.length) await prisma.rolePermission.createMany({ data: rows, skipDuplicates: true });
  }
  console.log(`  ✓ ${PERMISSION_CATALOG.length} permissions, ${names.length} roles (catalog đầy đủ: Lead/BA/PO/SM/Dev/Tester/Designer/DevOps/Reviewer/Stakeholder...)`);
  return roleByName;
}

/* ───────────────────────── Demo accounts (theo vai trò) ───────────────────────── */

const ACCOUNTS = [
  { email: 'admin@projira.dev', displayName: 'An Quản Trị', isSystemAdmin: true, role: 'admin' },
  { email: 'ba@tirapro.dev', displayName: 'Bình (BA)', isSystemAdmin: false, role: 'ba' },
  { email: 'dev@tirapro.dev', displayName: 'Dũng (Dev)', isSystemAdmin: false, role: 'dev' },
  { email: 'tester@tirapro.dev', displayName: 'Trang (Tester)', isSystemAdmin: false, role: 'tester' },
] as const;

async function seedDemoUsers() {
  const hash = await argon2.hash('Password123');
  const byRole: Record<string, string> = {};
  for (const u of ACCOUNTS) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { displayName: u.displayName, isSystemAdmin: u.isSystemAdmin, passwordHash: hash },
      create: { email: u.email, displayName: u.displayName, isSystemAdmin: u.isSystemAdmin, passwordHash: hash },
    });
    byRole[u.role] = row.id;
  }
  console.log(`  ✓ ${ACCOUNTS.length} tài khoản demo (mật khẩu: Password123)`);
  return byRole;
}

/* ───────────────────────── Bootstrap config ───────────────────────── */

async function bootstrapWorkspaceConfig(workspaceId: string) {
  const issueTypes = new Map<string, { id: string; key: string | null }>();
  for (const t of DEFAULT_ISSUE_TYPES) {
    const row = await prisma.issueType.create({
      data: {
        workspaceId, name: t.name, key: t.key as any, color: t.color,
        hierarchyLevel: t.hierarchyLevel, isSubtask: !!t.isSubtask, isSystem: true,
      },
    });
    issueTypes.set(t.name, { id: row.id, key: (t.key as string) ?? null });
  }
  const priorities = new Map<string, string>();
  for (const p of DEFAULT_PRIORITIES) {
    const row = await prisma.priority.create({
      data: { workspaceId, name: p.name, iconKey: p.iconKey, color: p.color, rank: p.rank, isDefault: !!p.isDefault, isSystem: true },
    });
    priorities.set(p.name, row.id);
  }
  for (const s of DEFAULT_SEVERITIES) {
    await prisma.severity.create({
      data: { workspaceId, name: s.name, description: s.description, color: s.color, rank: s.rank, isDefault: !!s.isDefault, isSystem: true },
    });
  }
  for (const r of DEFAULT_RESOLUTIONS) {
    await prisma.resolution.create({
      data: { workspaceId, name: r.name, description: r.description, rank: r.rank, isDefault: !!r.isDefault, isSystem: true },
    });
  }
  for (const l of DEFAULT_LINK_TYPES) {
    await prisma.linkType.create({
      data: { workspaceId, name: l.name, outwardName: l.outwardName, inwardName: l.inwardName, isSystem: true },
    });
  }
  for (const tpl of DEFAULT_WORKFLOW_TEMPLATES) {
    const wf = await prisma.workflow.create({
      data: { workspaceId, projectId: null, isTemplate: true, isDefault: !!tpl.isDefault, name: tpl.name, description: tpl.description },
    });
    await createStatusesAndTransitions(wf.id, tpl);
  }
  console.log('  ✓ bootstrap config (issue types, priorities, severities, resolutions, link types, workflow)');
  return { issueTypes, priorities };
}

async function createStatusesAndTransitions(workflowId: string, tpl: (typeof DEFAULT_WORKFLOW_TEMPLATES)[number]) {
  const statusByName = new Map<string, string>();
  for (const s of tpl.statuses) {
    const st = await prisma.status.create({
      data: { workflowId, name: s.name, category: s.category as any, color: s.color, order: s.order, isInitial: !!s.isInitial },
    });
    statusByName.set(s.name, st.id);
  }
  let order = 0;
  for (const t of tpl.transitions) {
    await prisma.workflowTransition.create({
      data: { workflowId, name: t.name, fromStatusId: t.from ? statusByName.get(t.from) ?? null : null, toStatusId: statusByName.get(t.to)!, order: order++ },
    });
  }
  return statusByName;
}

/* ───────────────────────── Bộ sinh task/bug như thật ───────────────────────── */

type Cat = 'TODO' | 'IN_PROGRESS' | 'DONE';
interface GenSpec {
  type: 'Epic' | 'Story' | 'Task' | 'Bug' | 'Sub-task';
  summary: string;
  status: string; // tên status
  sprint: 'closed' | 'active' | null; // null = backlog
  assignee: 'ba' | 'dev' | 'tester' | 'admin' | null;
  reporter: 'ba' | 'dev' | 'tester' | 'admin';
  priority: 'Highest' | 'High' | 'Medium' | 'Low';
  points?: number;
  due?: number; // offset ngày so với hôm nay (âm = quá hạn)
  parentSummary?: string; // liên kết cha theo summary
  description?: string; // mô tả demo (gán theo summary ở cuối buildSpecs)
}

/** Ảnh "chụp màn hình" giả lập (SVG data URI) để demo ảnh trong mô tả — không cần mạng. */
function mockShot(title: string, bg = '#e0e7ff', fg = '#1e3a8a'): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="380">` +
    `<rect width="720" height="380" fill="${bg}"/>` +
    `<rect x="24" y="24" width="672" height="48" rx="8" fill="#ffffff" opacity="0.92"/>` +
    `<circle cx="52" cy="48" r="6" fill="#ef4444"/><circle cx="72" cy="48" r="6" fill="#f59e0b"/><circle cx="92" cy="48" r="6" fill="#22c55e"/>` +
    `<rect x="24" y="92" width="672" height="264" rx="8" fill="#ffffff" opacity="0.92"/>` +
    `<text x="360" y="232" font-family="sans-serif" font-size="26" font-weight="600" fill="${fg}" text-anchor="middle">${title}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/** Mô tả demo cho một số issue tiêu biểu (khớp theo summary). */
const DESCRIPTIONS: Record<string, string> = {
  'Giỏ hàng mất sản phẩm khi tải lại trang': `Các bước tái hiện:
1. Thêm 2–3 sản phẩm vào giỏ hàng.
2. Tải lại trang (F5) hoặc mở lại tab.
3. Mở lại giỏ hàng.

Kết quả hiện tại: Giỏ hàng trống, toàn bộ sản phẩm đã thêm bị mất.
Kết quả mong muốn: Giỏ hàng giữ nguyên sản phẩm sau khi tải lại (đồng bộ localStorage + server).

Ghi chú: Lặp lại ~3/5 lần khi mạng chậm. Ưu tiên cao vì ảnh hưởng trực tiếp doanh thu.

Ảnh minh hoạ:
![Giỏ hàng trống sau khi tải lại trang](${mockShot('Giỏ hàng trống sau khi F5', '#fee2e2', '#991b1b')})`,
  'Lỗi đăng nhập trên Safari iOS': `Các bước tái hiện:
1. Mở trang đăng nhập trên Safari iOS 17.
2. Nhập email + mật khẩu hợp lệ, bấm "Đăng nhập".

Kết quả hiện tại: Quay vòng loading rồi trả về màn đăng nhập, không có thông báo lỗi.
Kết quả mong muốn: Đăng nhập thành công như trên Chrome/Android.

Nghi ngờ: cookie SameSite=None thiếu Secure nên Safari chặn.

Ảnh minh hoạ:
![Màn đăng nhập quay về sau khi bấm](${mockShot('Safari iOS — quay lại màn đăng nhập', '#e0f2fe', '#075985')})`,
  'Nút "Đặt hàng" không phản hồi trên Android': `Các bước tái hiện:
1. Trên Chrome Android, vào bước thanh toán.
2. Bấm nút "Đặt hàng".

Kết quả hiện tại: Không có phản hồi, không tạo đơn.
Kết quả mong muốn: Tạo đơn và chuyển sang màn xác nhận.

Nghi ngờ: sự kiện touch bị chặn do overlay loading không được ẩn.`,
  'Đăng nhập bằng Google (OAuth)': `Bối cảnh: Cho phép người dùng đăng nhập nhanh bằng tài khoản Google, giảm ma sát đăng ký.

Tiêu chí hoàn thành:
- Nút "Đăng nhập với Google" ở màn đăng nhập/đăng ký.
- Lần đầu đăng nhập tự tạo tài khoản, ánh xạ email.
- Liên kết với tài khoản email/mật khẩu sẵn có (nếu trùng email).
- Xử lý huỷ giữa chừng và lỗi từ Google gọn gàng.`,
  'Giỏ hàng & thanh toán VNPay': `Bối cảnh: Hoàn thiện luồng mua hàng end-to-end với cổng VNPay.

Tiêu chí hoàn thành:
- Thêm/sửa/xoá sản phẩm trong giỏ, cập nhật tổng tiền tức thời.
- Tạo đơn và chuyển hướng sang VNPay.
- Nhận webhook kết quả, cập nhật trạng thái đơn (thành công/thất bại/huỷ).
- Trang xác nhận + gửi email hoá đơn.

Thiết kế luồng:
![Mockup luồng thanh toán VNPay](${mockShot('Mockup: Giỏ hàng → VNPay → Xác nhận', '#dcfce7', '#166534')})`,
  'Xác thực 2 lớp (2FA)': `Bối cảnh: Tăng bảo mật cho tài khoản bằng TOTP (Google Authenticator/Authy).

Tiêu chí hoàn thành:
- Bật/tắt 2FA trong phần cài đặt tài khoản.
- Hiển thị QR + secret khi thiết lập.
- Yêu cầu mã 6 số khi đăng nhập nếu đã bật.
- Sinh và cho tải mã khôi phục (recovery codes).`,
  'Tối ưu truy vấn danh sách sản phẩm': `Mục tiêu: Giảm thời gian tải danh sách sản phẩm từ ~1.2s xuống dưới 300ms ở p95.

Việc cần làm:
- Thêm index cho (category_id, created_at).
- Chuyển sang phân trang keyset thay cho OFFSET.
- Bỏ N+1 khi nạp ảnh & tồn kho (eager load).`,
  'Thanh toán & đơn hàng': `Epic gom nhóm toàn bộ luồng mua hàng: giỏ hàng, thanh toán VNPay, lịch sử & chi tiết đơn, xuất hoá đơn PDF và trang quản trị đơn hàng.`,
};

/** Danh mục nội dung thật cho 1 sản phẩm thương mại điện tử demo. */
function buildSpecs(): GenSpec[] {
  const specs: GenSpec[] = [];
  const epics = ['Thanh toán & đơn hàng', 'Đăng nhập & bảo mật', 'Hiệu năng & ổn định'];
  for (const e of epics) {
    specs.push({ type: 'Epic', summary: e, status: 'To Do', sprint: null, assignee: 'ba', reporter: 'ba', priority: 'High' });
  }

  // Story: gắn epic, phần lớn ở Sprint active / backlog
  const stories: Array<[string, string, Cat, GenSpec['sprint'], number]> = [
    ['Đăng nhập bằng email + mật khẩu', 'Đăng nhập & bảo mật', 'DONE', 'closed', 5],
    ['Đăng nhập bằng Google (OAuth)', 'Đăng nhập & bảo mật', 'IN_PROGRESS', 'active', 5],
    ['Xác thực 2 lớp (2FA)', 'Đăng nhập & bảo mật', 'TODO', 'active', 8],
    ['Giỏ hàng & thanh toán VNPay', 'Thanh toán & đơn hàng', 'IN_PROGRESS', 'active', 8],
    ['Lịch sử & chi tiết đơn hàng', 'Thanh toán & đơn hàng', 'TODO', 'active', 5],
    ['Xuất hoá đơn PDF', 'Thanh toán & đơn hàng', 'TODO', null, 3],
    ['Tìm kiếm & lọc sản phẩm', 'Hiệu năng & ổn định', 'DONE', 'closed', 5],
    ['Thông báo realtime', 'Hiệu năng & ổn định', 'IN_PROGRESS', 'active', 5],
    ['Trang quản trị đơn hàng', 'Thanh toán & đơn hàng', 'TODO', null, 8],
    ['Chế độ tối (dark mode)', 'Hiệu năng & ổn định', 'DONE', 'closed', 3],
    ['Đa ngôn ngữ (i18n)', 'Hiệu năng & ổn định', 'TODO', null, 5],
    ['Onboarding người dùng mới', 'Đăng nhập & bảo mật', 'TODO', null, 3],
  ];
  const sPrio: GenSpec['priority'][] = ['High', 'Medium', 'High', 'Highest', 'Medium', 'Low', 'Medium', 'High', 'Medium', 'Low', 'Medium', 'Low'];
  stories.forEach(([summary, epic, cat, sprint, points], i) => {
    specs.push({
      type: 'Story', summary, status: catToStatus(cat), sprint, parentSummary: epic,
      assignee: cat === 'DONE' ? 'dev' : i % 2 ? 'dev' : 'ba', reporter: 'ba', priority: sPrio[i] ?? 'Medium', points,
      due: sprint === 'active' && cat !== 'DONE' ? [1, -2, 5, 3][i % 4] : undefined,
    });
  });

  const tasks: Array<[string, Cat, GenSpec['sprint'], number]> = [
    ['Thiết lập CI/CD pipeline', 'DONE', 'closed', 3],
    ['Cấu hình ESLint + Prettier', 'DONE', 'closed', 2],
    ['Tối ưu truy vấn danh sách sản phẩm', 'IN_PROGRESS', 'active', 5],
    ['Cache danh mục bằng Redis', 'TODO', 'active', 3],
    ['Viết tài liệu API public', 'IN_PROGRESS', 'active', 2],
    ['Thiết lập monitoring (Sentry)', 'TODO', 'active', 2],
    ['Tối ưu ảnh & lazy-load', 'TODO', null, 3],
    ['Thiết lập E2E Playwright', 'TODO', null, 5],
    ['Backup DB định kỳ', 'TODO', null, 2],
    ['Dọn dẹp dead code', 'DONE', 'closed', 1],
  ];
  tasks.forEach(([summary, cat, sprint, points], i) => {
    specs.push({
      type: 'Task', summary, status: catToStatus(cat), sprint,
      assignee: 'dev', reporter: i % 3 === 0 ? 'admin' : 'ba',
      priority: (['Medium', 'Low', 'High', 'Medium'] as const)[i % 4], points,
    });
  });

  const bugs: Array<[string, Cat, GenSpec['sprint'], number, number | undefined]> = [
    ['Card nhảy vị trí khi kéo nhanh', 'DONE', 'closed', 2, undefined],
    ['Lỗi đăng nhập trên Safari iOS', 'IN_PROGRESS', 'active', 3, -1],
    ['Sai phông tiếng Việt trên PDF hoá đơn', 'TODO', 'active', 2, 2],
    ['Giỏ hàng mất sản phẩm khi tải lại trang', 'IN_PROGRESS', 'active', 5, -3],
    ['Thông báo trùng khi sửa nhiều field', 'TODO', 'active', 1, undefined],
    ['Tràn layout trên màn hình nhỏ', 'TODO', null, 2, undefined],
    ['Timeout khi tải báo cáo lớn', 'TODO', null, 3, undefined],
    ['Sai múi giờ ở hạn chót', 'DONE', 'closed', 1, undefined],
    ['Nút "Đặt hàng" không phản hồi trên Android', 'TODO', 'active', 3, 1],
    ['Rò rỉ bộ nhớ ở trang board', 'TODO', null, 5, undefined],
  ];
  bugs.forEach(([summary, cat, sprint, points, due], i) => {
    specs.push({
      type: 'Bug', summary, status: catToStatus(cat), sprint,
      assignee: cat === 'TODO' && !sprint ? null : i % 2 ? 'dev' : 'tester',
      reporter: 'tester', priority: (['High', 'Highest', 'Medium', 'High'] as const)[i % 4], points, due,
    });
  });

  // Sub-task gắn vào vài story đang làm
  const subs: Array<[string, string, Cat]> = [
    ['Viết unit test cho luồng OAuth', 'Đăng nhập bằng Google (OAuth)', 'IN_PROGRESS'],
    ['Tích hợp SDK VNPay', 'Giỏ hàng & thanh toán VNPay', 'IN_PROGRESS'],
    ['Xử lý webhook kết quả thanh toán', 'Giỏ hàng & thanh toán VNPay', 'TODO'],
    ['Kiểm thử hồi quy đăng nhập', 'Đăng nhập bằng Google (OAuth)', 'TODO'],
    ['Thiết kế socket presence', 'Thông báo realtime', 'IN_PROGRESS'],
    ['Cập nhật tài liệu i18n', 'Đa ngôn ngữ (i18n)', 'TODO'],
  ];
  subs.forEach(([summary, parent, cat], i) => {
    specs.push({
      type: 'Sub-task', summary, status: catToStatus(cat), sprint: 'active', parentSummary: parent,
      assignee: i % 2 ? 'dev' : 'tester', reporter: 'dev', priority: 'Medium', points: i % 2 ? 2 : 1,
    });
  });

  // Gán mô tả demo cho các issue có trong DESCRIPTIONS (khớp theo summary).
  for (const s of specs) {
    const d = DESCRIPTIONS[s.summary];
    if (d) s.description = d;
  }

  return specs;
}

function catToStatus(c: Cat): string {
  return c === 'DONE' ? 'Done' : c === 'IN_PROGRESS' ? 'In Progress' : 'To Do';
}

/* ───────────────────────── Teams (nhóm thành viên) ───────────────────────── */

async function seedTeams(workspaceId: string, u: Record<string, string>) {
  const teams = [
    { name: 'Frontend', key: 'frontend', color: '#16a34a', description: 'Giao diện web & trải nghiệm người dùng', leadId: u.dev, memberIds: [u.dev, u.tester] },
    { name: 'Backend', key: 'backend', color: '#2563eb', description: 'API, dữ liệu & tích hợp', leadId: u.dev, memberIds: [u.dev, u.admin] },
    { name: 'QA & Kiểm thử', key: 'qa', color: '#a855f7', description: 'Kiểm thử, chất lượng & hồi quy', leadId: u.tester, memberIds: [u.tester, u.ba] },
  ];
  for (const t of teams) {
    await prisma.team.create({
      data: {
        workspaceId, name: t.name, key: t.key, color: t.color, description: t.description, leadId: t.leadId,
        createdById: u.admin, updatedById: u.admin,
        members: { create: [...new Set(t.memberIds)].map((userId) => ({ userId })) },
      },
    });
  }
  console.log(`  ✓ ${teams.length} nhóm (team) — tổ chức thành viên (không gắn vào issue)`);
}

/* ───────────────────────── Main: làm mới & seed ───────────────────────── */

async function main() {
  console.log('🌱 Seeding Tirapro (làm mới demo)...');
  const roleByName = await seedPermissionsAndRoles();
  const u = await seedDemoUsers();

  // ── LÀM MỚI: xoá workspace demo cũ rồi tạo lại ──
  // Issue.typeId/statusId là ON DELETE RESTRICT → phải xoá issue trước, phần còn lại cascade theo workspace.
  const old = await prisma.workspace.findUnique({ where: { slug: 'demo' }, select: { id: true } });
  if (old) {
    await prisma.issue.deleteMany({ where: { workspaceId: old.id } });
    await prisma.workspace.delete({ where: { id: old.id } });
    console.log('  ✓ Đã xoá workspace demo cũ (issues + cascade)');
  }

  const ws = await prisma.workspace.create({
    data: { name: 'Tirapro Demo', slug: 'demo', ownerId: u.admin, plan: 'PRO' },
  });
  const rid = (name: SystemRoleName) => roleByName.get(name)!;
  // Gán NHIỀU vai trò: roleId = vai trò chính (roleNames[0]), join giữ toàn bộ.
  const addWsMember = (userId: string, roleNames: SystemRoleName[]) =>
    prisma.workspaceMembership.create({
      data: {
        workspaceId: ws.id, userId, roleId: rid(roleNames[0]!), joinedAt: new Date(),
        roles: { create: roleNames.map((n) => ({ roleId: rid(n) })) },
      },
    });
  await addWsMember(u.admin, [SYSTEM_ROLES.WORKSPACE_ADMIN]);
  await addWsMember(u.ba, [SYSTEM_ROLES.WORKSPACE_MEMBER]);
  await addWsMember(u.dev, [SYSTEM_ROLES.WORKSPACE_MEMBER]);
  await addWsMember(u.tester, [SYSTEM_ROLES.WORKSPACE_MEMBER]);

  const { issueTypes, priorities } = await bootstrapWorkspaceConfig(ws.id);

  const project = await prisma.project.create({
    data: { workspaceId: ws.id, key: 'DEMO', name: 'Demo App', type: 'SCRUM', description: 'Sản phẩm thương mại điện tử mẫu để khám phá Tirapro', leadId: u.admin },
  });
  // Cấp dự án: demo multi-role thực tế (1 người kiêm nhiều vai trò).
  const addProjMember = (userId: string, roleNames: SystemRoleName[]) =>
    prisma.projectMembership.create({
      data: {
        projectId: project.id, userId, roleId: rid(roleNames[0]!),
        roles: { create: roleNames.map((n) => ({ roleId: rid(n) })) },
      },
    });
  await addProjMember(u.admin, [SYSTEM_ROLES.PROJECT_ADMIN]);
  await addProjMember(u.ba, [SYSTEM_ROLES.BUSINESS_ANALYST, SYSTEM_ROLES.PRODUCT_OWNER]);
  // Dev kiêm Scrum Master → quyền hợp nhất (Developer ∪ Scrum Master: thêm sprint/board/workflow).
  await addProjMember(u.dev, [SYSTEM_ROLES.DEVELOPER, SYSTEM_ROLES.SCRUM_MASTER]);
  await addProjMember(u.tester, [SYSTEM_ROLES.TESTER, SYSTEM_ROLES.REVIEWER]);

  const scrumTpl = DEFAULT_WORKFLOW_TEMPLATES.find((t) => t.boardType === 'SCRUM')!;
  const projectWf = await prisma.workflow.create({
    data: { workspaceId: ws.id, projectId: project.id, isTemplate: false, isDefault: true, name: scrumTpl.name, description: scrumTpl.description },
  });
  const statusByName = await createStatusesAndTransitions(projectWf.id, scrumTpl);
  await prisma.project.update({ where: { id: project.id }, data: { defaultWorkflowId: projectWf.id } });

  const board = await prisma.board.create({ data: { projectId: project.id, name: 'Demo Board', type: 'SCRUM' } });
  let colOrder = 0;
  for (const s of scrumTpl.statuses) {
    const col = await prisma.boardColumn.create({ data: { boardId: board.id, name: s.name, order: colOrder++ } });
    await prisma.boardColumnStatus.create({ data: { columnId: col.id, statusId: statusByName.get(s.name)! } });
  }

  const now = new Date();
  const sprintClosed = await prisma.sprint.create({
    data: {
      projectId: project.id, boardId: board.id, name: 'Sprint 1 — Nền tảng', state: 'CLOSED', sequence: 1,
      goal: 'Hạ tầng đăng nhập, CI/CD, tìm kiếm', startDate: new Date(now.getTime() - 28 * day),
      endDate: new Date(now.getTime() - 14 * day), completeDate: new Date(now.getTime() - 14 * day),
    },
  });
  const sprintActive = await prisma.sprint.create({
    data: {
      projectId: project.id, boardId: board.id, name: 'Sprint 2 — Thanh toán', state: 'ACTIVE', sequence: 2,
      goal: 'Hoàn thiện giỏ hàng, thanh toán VNPay, realtime', startDate: new Date(now.getTime() - 4 * day),
      endDate: new Date(now.getTime() + 10 * day),
    },
  });
  await prisma.sprint.create({
    data: { projectId: project.id, boardId: board.id, name: 'Sprint 3 — Quản trị', state: 'FUTURE', sequence: 3, goal: 'Trang quản trị & báo cáo' },
  });

  // Snapshots cho Sprint đã đóng (velocity/burndown)
  for (const s of [
    { kind: 'START', at: 28, committedPoints: 18, completedPoints: 0, remainingPoints: 18, committedCount: 5, completedCount: 0 },
    { kind: 'CLOSE', at: 14, committedPoints: 18, completedPoints: 16, remainingPoints: 2, committedCount: 5, completedCount: 4 },
  ] as const) {
    await prisma.sprintSnapshot.create({
      data: {
        sprintId: sprintClosed.id, kind: s.kind as any, snapshotAt: new Date(now.getTime() - s.at * day),
        committedPoints: s.committedPoints, completedPoints: s.completedPoints, remainingPoints: s.remainingPoints,
        committedCount: s.committedCount, completedCount: s.completedCount,
      },
    });
  }

  // ── Sinh issue mã theo loại ──
  const userId = (r: GenSpec['assignee']) => (r ? u[r] : null);
  const prioId = (n: GenSpec['priority']) => priorities.get(n)!;
  const sprintId = (s: GenSpec['sprint']) => (s === 'closed' ? sprintClosed.id : s === 'active' ? sprintActive.id : null);

  const specs = buildSpecs();
  // Phân bổ một phần "In Progress" của sprint đang chạy sang "In Review" (dev xong, chờ QA) cho thật.
  let rev = 0;
  for (const s of specs) {
    if (s.status === 'In Progress' && s.sprint === 'active' && rev++ % 2 === 1) s.status = 'In Review';
  }
  const ranks = initialRanks(specs.length);
  const typeSeq: Record<string, number> = {};
  const idBySummary = new Map<string, string>();
  let number = 0;

  // Tạo theo thứ tự: Epic → Story → Task → Bug → Sub-task (để cha có trước con).
  const order: GenSpec['type'][] = ['Epic', 'Story', 'Task', 'Bug', 'Sub-task'];
  const sorted = [...specs].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));

  for (let i = 0; i < sorted.length; i++) {
    const spec = sorted[i]!;
    const t = issueTypes.get(spec.type)!;
    const prefix = issueTypePrefix(t.key, spec.type);
    typeSeq[prefix] = (typeSeq[prefix] ?? 0) + 1;
    // Mã = {mã dự án}-{loại}-{identity}, identity riêng theo loại trong dự án.
    const key = `${project.key}-${prefix}-${typeSeq[prefix]}`;
    number += 1;
    const isDone = spec.status === 'Done';
    const statusCat = scrumTpl.statuses.find((s) => s.name === spec.status)!.category;
    const parentId = spec.parentSummary ? idBySummary.get(spec.parentSummary) ?? null : null;

    const issue = await prisma.issue.create({
      data: {
        workspaceId: ws.id, projectId: project.id, number, key,
        typeId: t.id, statusId: statusByName.get(spec.status)!, priorityId: prioId(spec.priority),
        summary: spec.summary, description: spec.description ?? null,
        reporterId: userId(spec.reporter), assigneeId: userId(spec.assignee),
        parentId, sprintId: sprintId(spec.sprint), storyPoints: spec.points ?? null, rank: ranks[i]!,
        dueDate: spec.due != null ? new Date(now.getTime() + spec.due * day) : null,
        resolvedAt: isDone ? new Date(now.getTime() - 2 * day) : null,
        createdById: userId(spec.reporter), createdAt: spec.sprint === 'closed' ? new Date(now.getTime() - 24 * day) : new Date(now.getTime() - 3 * day),
      },
    });
    idBySummary.set(spec.summary, issue.id);

    // History trạng thái (nguồn report). DONE có thêm mốc lùi để burndown giảm thật.
    await prisma.issueHistory.create({
      data: {
        issueId: issue.id, projectId: project.id, sprintId: sprintId(spec.sprint),
        field: 'STATUS', newValue: spec.status, newCategory: statusCat as any,
        actorId: userId(spec.reporter) ?? u.admin,
        occurredAt: isDone ? new Date(now.getTime() - 2 * day) : new Date(now.getTime() - 3 * day),
      },
    });
  }
  await prisma.project.update({ where: { id: project.id }, data: { issueSequence: number } });
  console.log(`  ✓ ${number} issue (mã {dự án}-{loại}-{identity}: DEMO-BUG-1, DEMO-TASK-1…)`);

  // ── Labels + đính ──
  const labelByName = new Map<string, string>();
  for (const l of [
    { name: 'backend', color: '#2563eb' }, { name: 'frontend', color: '#16a34a' },
    { name: 'urgent', color: '#dc2626' }, { name: 'tech-debt', color: '#a16207' },
  ]) {
    const row = await prisma.label.create({ data: { projectId: project.id, name: l.name, color: l.color } });
    labelByName.set(l.name, row.id);
  }
  const allIssues = await prisma.issue.findMany({ where: { projectId: project.id }, select: { id: true, key: true, summary: true, type: { select: { key: true } } } });
  for (const iss of allIssues) {
    const labels: string[] = [];
    if (iss.type.key === 'BUG') labels.push('urgent');
    if (/API|CI|Redis|webhook|backup|query|truy vấn/i.test(iss.summary)) labels.push('backend');
    if (/dark|i18n|layout|onboarding|board|UI|tìm kiếm/i.test(iss.summary)) labels.push('frontend');
    if (/dead code|tech|monitoring|backup/i.test(iss.summary)) labels.push('tech-debt');
    for (const name of [...new Set(labels)]) {
      await prisma.issueLabel.create({ data: { issueId: iss.id, labelId: labelByName.get(name)! } });
    }
  }

  // ── Comments như thật (BA hỏi → Dev trả lời → Tester xác nhận) ──
  const find = (kw: RegExp) => allIssues.find((i) => kw.test(i.summary));
  const commentSpecs: Array<{ kw: RegExp; author: string; body: string }> = [
    { kw: /VNPay/i, author: u.ba, body: 'Cần làm rõ luồng hoàn tiền (refund) khi đơn bị huỷ. @Dũng xem giúp spec nhé.' },
    { kw: /VNPay/i, author: u.dev, body: 'OK, mình tách webhook xử lý refund thành sub-task riêng. Đang tích hợp SDK.' },
    { kw: /Safari/i, author: u.tester, body: 'Tái hiện trên iOS 17 Safari: bấm đăng nhập không có phản hồi. Đính kèm video.' },
    { kw: /Safari/i, author: u.dev, body: 'Do cookie SameSite, mình đã chỉnh sang Lax. Nhờ @Trang verify lại bản staging.' },
    { kw: /Giỏ hàng mất/i, author: u.tester, body: 'Lặp lại 3/5 lần khi mạng chậm. Ưu tiên cao vì ảnh hưởng doanh thu.' },
    { kw: /realtime/i, author: u.ba, body: 'Phạm vi v1: chỉ cần presence + badge số. Bảng thông báo đầy đủ để Sprint sau.' },
    { kw: /2FA/i, author: u.dev, body: 'Dùng TOTP (Google Authenticator). Cần thêm màn cấu hình + mã khôi phục.' },
  ];
  for (const c of commentSpecs) {
    const iss = find(c.kw);
    if (iss) await prisma.comment.create({ data: { issueId: iss.id, authorId: c.author, bodyFormat: 'MARKDOWN', body: c.body } });
  }

  // ── Notifications cho admin (chuông) ──
  for (const n of [
    { kw: /VNPay/i, type: 'COMMENT_ADDED', actor: u.ba },
    { kw: /Safari/i, type: 'STATUS_CHANGED', actor: u.dev },
    { kw: /2FA/i, type: 'ISSUE_ASSIGNED', actor: u.ba },
  ]) {
    const iss = find(n.kw);
    if (iss) {
      await prisma.notification.create({
        data: {
          recipientId: u.admin, workspaceId: ws.id, type: n.type as any, issueId: iss.id, actorId: n.actor,
          payload: { key: iss.key, summary: iss.summary } as unknown as Prisma.InputJsonValue, readAt: null,
        },
      });
    }
  }

  console.log(`  ✓ labels, comments, notifications`);

  await seedTeams(ws.id, u);

  console.log('✅ Seed xong.');
  console.log('   Đăng nhập (mật khẩu Password123):');
  console.log('     admin@projira.dev  · Quản trị');
  console.log('     ba@tirapro.dev     · BA');
  console.log('     dev@tirapro.dev    · Developer');
  console.log('     tester@tirapro.dev · Tester');
}

main()
  .catch((e) => {
    console.error('❌ Seed lỗi:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
