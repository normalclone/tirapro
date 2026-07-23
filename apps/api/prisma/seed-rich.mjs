/**
 * Seed dữ liệu DEMO "thật chuẩn" để dễ theo dõi.
 * - Dọn issue cũ + user test, dựng lại bộ issue thực tế (web product) với phân bố hợp lý.
 * - Tạo issue qua API (đúng number/key/rank/workflow), set status/severity/sprint qua Prisma.
 * - Backdate lịch sử DONE để burndown giảm dần thật.
 * Chạy: API ở :4000 + DATABASE_URL trong env.   node prisma/seed-rich.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = 'http://127.0.0.1:4000/api/v1';
const DAY = 86_400_000;
let TOKEN = null;
const api = async (m, p, b) => {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};

// Bộ issue thực tế cho sản phẩm web TMĐT
const ISSUES = [
  { s: 'Thiết kế lại trang chủ', t: 'Story', p: 'High', pts: 8, st: 'In Progress', who: 'pm', sprint: true, due: 5 },
  { s: 'Tích hợp cổng thanh toán VNPay', t: 'Story', p: 'Highest', pts: 13, st: 'In Progress', who: 'dev', sprint: true, due: 8 },
  { s: 'Lỗi đăng nhập trên Safari iOS', t: 'Bug', p: 'High', sev: 'Major', pts: 3, st: 'In Review', who: 'dev', sprint: true, due: 2 },
  { s: 'Tối ưu tốc độ tải trang sản phẩm', t: 'Task', p: 'Medium', pts: 5, st: 'To Do', who: 'dev', sprint: true, due: 6 },
  { s: 'Viết tài liệu API public', t: 'Task', p: 'Low', pts: 3, st: 'Done', who: 'admin', sprint: true, doneDay: 8 },
  { s: 'Thêm xác thực 2 lớp (2FA)', t: 'Story', p: 'High', pts: 8, st: 'To Do', who: 'dev', sprint: true, due: 10 },
  { s: 'Giỏ hàng mất sản phẩm khi tải lại trang', t: 'Bug', p: 'Highest', sev: 'Critical', pts: 5, st: 'In Progress', who: 'dev', sprint: true, due: 1 },
  { s: 'Bộ lọc nâng cao cho trang quản trị', t: 'Story', p: 'Medium', pts: 5, st: 'Done', who: 'pm', sprint: true, doneDay: 6 },
  { s: 'Email xác nhận đơn hàng', t: 'Task', p: 'Medium', pts: 2, st: 'Done', who: 'admin', sprint: true, doneDay: 4 },
  { s: 'Đăng nhập bằng Google', t: 'Story', p: 'Medium', pts: 5, st: 'To Do', who: 'dev', sprint: true, due: 7 },
  { s: 'Chế độ tối (dark mode)', t: 'Task', p: 'Low', pts: 3, st: 'Done', who: 'dev', sprint: true, doneDay: 2 },
  { s: 'Giới hạn tần suất gọi API (rate limit)', t: 'Task', p: 'Medium', pts: 3, st: 'In Progress', who: 'dev', sprint: true, due: 3 },
  { s: 'Cải thiện SEO (meta tags & sitemap)', t: 'Task', p: 'Low', pts: 2, st: 'To Do', who: 'pm', sprint: false },
  { s: 'Sai phông tiếng Việt trên PDF hóa đơn', t: 'Bug', p: 'High', sev: 'Major', pts: 3, st: 'To Do', who: 'dev', sprint: false },
  { s: 'Bảng phân tích doanh thu', t: 'Epic', p: 'High', st: 'To Do', who: 'pm', sprint: false },
  { s: 'Trang trắng khi mạng chậm', t: 'Bug', p: 'High', sev: 'Major', st: 'To Do', who: 'dev', triage: 'PENDING', occ: 3 },
  { s: "Nút 'Đặt hàng' không phản hồi trên Android", t: 'Bug', p: 'Highest', sev: 'Critical', st: 'To Do', who: 'dev', triage: 'PENDING', occ: 2 },
];

const COMMENTS = {
  'Tích hợp cổng thanh toán VNPay': ['Đã có sandbox key từ VNPay, đang test luồng redirect.', 'Lưu ý xử lý callback IPN bất đồng bộ nhé.'],
  'Giỏ hàng mất sản phẩm khi tải lại trang': ['Tái hiện được: localStorage bị ghi đè khi token refresh.', 'Ưu tiên cao — ảnh hưởng nhiều khách.'],
  'Lỗi đăng nhập trên Safari iOS': ['Có vẻ do cookie SameSite. Đang thử Lax.'],
};

async function main() {
  TOKEN = (await api('POST', '/auth/login', { email: 'admin@projira.dev', password: 'Password123' })).json?.accessToken;
  if (!TOKEN) throw new Error('Không đăng nhập được — API chạy chưa?');

  const ws = await prisma.workspace.findFirst({ orderBy: { createdAt: 'asc' } });
  const project = await prisma.project.findFirst({ where: { key: 'DEMO', workspaceId: ws.id } });
  const statuses = await prisma.status.findMany({ where: { workflowId: project.defaultWorkflowId } });
  const types = await prisma.issueType.findMany({ where: { workspaceId: ws.id } });
  const prios = await prisma.priority.findMany({ where: { workspaceId: ws.id } });
  const sevs = await prisma.severity.findMany({ where: { workspaceId: ws.id } });
  const sid = (name) => statuses.find((s) => s.name === name).id;
  const catOf = (name) => statuses.find((s) => s.name === name).category;
  const tid = (name) => types.find((t) => t.name === name).id;
  const pid = (name) => prios.find((p) => p.name === name).id;
  const sevid = (name) => sevs.find((s) => s.name === name)?.id;

  const admin = await prisma.user.findFirst({ where: { email: 'admin@projira.dev' } });
  const dev = await prisma.user.findFirst({ where: { email: 'dev@projira.dev' } });
  const reporter = await prisma.user.findFirst({ where: { email: 'reporter@projira.dev' } });
  const who = { admin: admin.id, dev: dev?.id ?? admin.id, pm: reporter?.id ?? admin.id };

  // 1) Dọn: xoá issue cũ của DEMO + user test (e2e/diag/@x.test)
  const delIssues = await prisma.issue.deleteMany({ where: { projectId: project.id } });
  const delUsers = await prisma.user.deleteMany({ where: { OR: [{ email: { contains: 'e2e-' } }, { email: { contains: 'diag-' } }, { email: { endsWith: '@x.test' } }] } });
  console.log(`🧹 xoá ${delIssues.count} issue cũ, ${delUsers.count} user test`);

  // 2) Sprint ACTIVE: đặt khung thời gian để burndown trải ~14 ngày (bắt đầu 10 ngày trước)
  const active = await prisma.sprint.findFirst({ where: { projectId: project.id, state: 'ACTIVE', deletedAt: null } });
  const sprintStart = new Date(Date.now() - 10 * DAY);
  if (active) await prisma.sprint.update({ where: { id: active.id }, data: { startDate: sprintStart, endDate: new Date(Date.now() + 4 * DAY), goal: 'Hoàn thiện thanh toán & sửa lỗi giỏ hàng' } });

  // 3) Tạo issue qua API rồi set status/severity/sprint/triage qua Prisma
  const created = {};
  for (const it of ISSUES) {
    const body = {
      projectId: project.id, typeId: tid(it.t), summary: it.s,
      descriptionFormat: 'MARKDOWN',
      description: it.t === 'Bug' ? 'Các bước tái hiện:\n1. ...\n2. ...\nKết quả mong đợi: ...' : 'Mô tả & tiêu chí chấp nhận sẽ bổ sung.',
      priorityId: pid(it.p), assigneeId: who[it.who],
      ...(it.pts != null ? { storyPoints: it.pts } : {}),
      ...(it.due != null ? { dueDate: new Date(Date.now() + it.due * DAY).toISOString() } : {}),
    };
    const r = await api('POST', '/issues', body);
    if (r.status !== 201) { console.log('  ⚠ tạo lỗi', it.s, r.status, JSON.stringify(r.json).slice(0, 120)); continue; }
    const id = r.json.id;
    created[it.s] = { id, key: r.json.key };
    const data = { statusId: sid(it.st) };
    if (it.sev) data.severityId = sevid(it.sev);
    if (it.sprint && active) data.sprintId = active.id;
    if (it.due != null) data.dueDate = new Date(Date.now() + it.due * DAY);
    if (it.triage) { data.triageState = it.triage; data.occurrenceCount = it.occ ?? 1; }
    await prisma.issue.update({ where: { id }, data });

    // Backdate lịch sử DONE để burndown giảm dần
    if (it.st === 'Done' && it.sprint && active && it.doneDay) {
      await prisma.issueHistory.create({
        data: {
          issueId: id, projectId: project.id, sprintId: active.id, field: 'STATUS',
          oldValue: 'In Progress', newValue: 'Done', oldCategory: 'IN_PROGRESS', newCategory: 'DONE',
          actorId: who[it.who], occurredAt: new Date(Date.now() - it.doneDay * DAY),
        },
      });
    }
  }
  console.log(`📝 tạo ${Object.keys(created).length} issue thực tế`);

  // 4) Bình luận
  let nc = 0;
  for (const [summary, lines] of Object.entries(COMMENTS)) {
    const iss = created[summary];
    if (!iss) continue;
    for (const body of lines) { await api('POST', `/issues/${iss.id}/comments`, { body, bodyFormat: 'MARKDOWN' }); nc++; }
  }
  console.log(`💬 ${nc} bình luận`);

  // 5) Labels (đảm bảo tồn tại) + gắn
  const labelSpecs = [{ name: 'backend', color: '#2563eb' }, { name: 'frontend', color: '#16a34a' }, { name: 'urgent', color: '#dc2626' }, { name: 'thanh-toán', color: '#9333ea' }];
  const labelId = {};
  for (const ls of labelSpecs) {
    let l = await prisma.label.findFirst({ where: { projectId: project.id, name: ls.name } });
    if (!l) l = await prisma.label.create({ data: { projectId: project.id, ...ls } });
    labelId[ls.name] = l.id;
  }
  const attach = { 'Tích hợp cổng thanh toán VNPay': ['backend', 'thanh-toán'], 'Giỏ hàng mất sản phẩm khi tải lại trang': ['frontend', 'urgent'], 'Thiết kế lại trang chủ': ['frontend'] };
  for (const [summary, names] of Object.entries(attach)) {
    const iss = created[summary]; if (!iss) continue;
    for (const n of names) await prisma.issueLabel.create({ data: { issueId: iss.id, labelId: labelId[n] } }).catch(() => {});
  }
  console.log('🏷  labels + gắn');

  // 6) Components & Versions qua API (idempotent theo tên)
  const existComp = (await api('GET', `/projects/${project.id}/components`)).json ?? [];
  for (const c of ['Frontend', 'Backend', 'Thanh toán', 'Hạ tầng']) if (!existComp.find((x) => x.name === c)) await api('POST', `/projects/${project.id}/components`, { name: c });
  const existVer = (await api('GET', `/projects/${project.id}/versions`)).json ?? [];
  for (const v of [{ name: 'v1.0', status: 'RELEASED' }, { name: 'v1.1', status: 'UNRELEASED' }, { name: 'v2.0', status: 'UNRELEASED' }]) if (!existVer.find((x) => x.name === v.name)) await api('POST', `/projects/${project.id}/versions`, v);
  console.log('🧩 components + versions');

  // 7) Custom field "Môi trường" (SELECT) + set vài giá trị
  const cfList = (await api('GET', `/custom-fields?projectId=${project.id}`)).json ?? [];
  let envField = cfList.find((f) => f.name === 'Môi trường');
  if (!envField) {
    const r = await api('POST', '/custom-fields', { name: 'Môi trường', type: 'SELECT', projectId: project.id, options: [{ value: 'production' }, { value: 'staging' }, { value: 'dev' }] });
    envField = r.json;
  }
  if (envField?.id) {
    const opt = (envField.options ?? [])[0]?.id;
    if (opt) for (const s of ['Giỏ hàng mất sản phẩm khi tải lại trang', 'Lỗi đăng nhập trên Safari iOS']) {
      const iss = created[s]; if (iss) await api('PUT', `/issues/${iss.id}/custom-fields/${envField.id}`, { value: opt });
    }
  }
  console.log('🔧 custom field + giá trị');

  // 8) Saved filters (idempotent theo tên)
  const filters = (await api('GET', '/filters')).json ?? [];
  const wantFilters = [
    { name: 'Bug nghiêm trọng', jql: 'type = Bug AND priority IN (Highest, High) ORDER BY priority DESC' },
    { name: 'Việc của tôi', jql: 'assignee = currentUser() ORDER BY updated DESC' },
    { name: 'Chưa hoàn thành', jql: 'statusCategory != DONE ORDER BY created DESC' },
  ];
  for (const f of wantFilters) if (!filters.find((x) => x.name === f.name)) await api('POST', '/filters', { ...f, visibility: 'WORKSPACE' });
  console.log('🔎 saved filters');

  // 9) Watch + link
  for (const s of ['Giỏ hàng mất sản phẩm khi tải lại trang', 'Tích hợp cổng thanh toán VNPay']) { const iss = created[s]; if (iss) await api('POST', `/issues/${iss.id}/watch`); }
  const linkTypes = (await api('GET', '/link-types')).json ?? [];
  const blocker = created['Thêm xác thực 2 lớp (2FA)'], blocked = created['Đăng nhập bằng Google'];
  if (linkTypes[0] && blocker && blocked) await api('POST', `/issues/${blocker.id}/links`, { targetIssueId: blocked.id, linkTypeId: linkTypes[0].id });
  console.log('👁  watch + 🔗 link');

  // 10) Verify nhanh
  const issuesNow = (await api('GET', `/issues?projectId=${project.id}&limit=200`)).json?.data ?? [];
  const bd = active ? (await api('GET', `/reports/burndown?sprintId=${active.id}`)).json : null;
  const vel = (await api('GET', `/reports/velocity?projectId=${project.id}`)).json;
  console.log(`\n✅ DEMO: ${issuesNow.length} issue | burndown ${bd?.series?.length} ngày (committed ${bd?.committedPoints}, remaining cuối ${bd?.series?.at(-1)?.remaining}) | velocity ${vel?.sprints?.length} sprint`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
