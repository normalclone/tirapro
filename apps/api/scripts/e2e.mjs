/**
 * Tirapro — e2e verification runner (kiểm thử toàn bộ API trên DB seed).
 * Chạy:  node apps/api/scripts/e2e.mjs   (API phải đang chạy ở :4000)
 * Thoát 0 nếu tất cả PASS, 1 nếu có FAIL. Dùng cho #11 (tích hợp e2e).
 */
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:4000/api/v1';
const CREDS = { email: 'admin@projira.dev', password: 'Password123' };

let pass = 0, fail = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

let TOKEN = null;
async function call(method, path, body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function main() {
  // wait for health
  let ready = false;
  for (let i = 0; i < 40; i++) { try { if ((await call('GET', '/health')).status === 200) { ready = true; break; } } catch {} await new Promise((r) => setTimeout(r, 1000)); }
  if (!ready) { console.log('❌ API không sẵn sàng'); process.exit(1); }

  console.log('\n— Nền tảng —');
  const ver = await call('GET', '/health/version');
  check('health/version', ver.status === 200 && ver.json?.apiVersion === 'v1', ver.json?.apiVersion);
  const login = await call('POST', '/auth/login', CREDS);
  TOKEN = login.json?.accessToken;
  check('auth/login', login.status === 200 && !!TOKEN);
  const me = await call('GET', '/auth/me');
  check('auth/me', me.status === 200 && (me.json?.user?.email ?? me.json?.email) === CREDS.email);

  const projects = await call('GET', '/projects');
  const demo = (projects.json ?? []).find((p) => p.key === 'DEMO');
  check('projects/list', projects.status === 200 && !!demo);
  const meta = await call('GET', '/projects/DEMO/meta');
  check('projects/meta', meta.status === 200 && meta.json?.issueTypes?.length > 0 && meta.json?.priorities?.length > 0);
  const pid = demo.id;

  console.log('\n— Issues / Search —');
  const list = await call('GET', `/issues?projectId=${pid}&limit=200`);
  const issues = list.json?.data ?? [];
  check('issues/list', list.status === 200 && issues.length > 0, `${issues.length} issue`);
  const typeId = meta.json.issueTypes.find((t) => !t.isSubtask)?.id ?? meta.json.issueTypes[0].id;
  const createdIssue = await call('POST', '/issues', { projectId: pid, typeId, summary: '[e2e] issue tạm', descriptionFormat: 'MARKDOWN' });
  check('issues/create', createdIssue.status === 201 && !!createdIssue.json?.key, createdIssue.json?.key);
  const sr1 = await call('GET', `/search?jql=${encodeURIComponent('assignee IS EMPTY')}`);
  const sr2 = await call('GET', `/search?jql=${encodeURIComponent('assignee IS NOT EMPTY')}`);
  check('search/jql complement', sr1.status === 200 && sr2.status === 200);
  const sval = await call('POST', '/search/validate', { jql: 'status = ' });
  check('search/validate (bắt lỗi)', sval.json?.valid === false && typeof sval.json?.position === 'number');

  console.log('\n— AI (degrade-graceful) —');
  const cap = await call('GET', '/ai/capabilities');
  check('ai/capabilities', cap.status === 200 && typeof cap.json?.available === 'boolean');
  const gen = await call('POST', '/ai/generate-issues', { projectId: pid, text: 'Thêm 2FA. Sửa lỗi rò rỉ bộ nhớ.' });
  check('ai/generate-issues', gen.status === 201 && gen.json?.issues?.length > 0, `${gen.json?.source}/${gen.json?.issues?.length}`);
  const sum = await call('POST', `/ai/issues/${issues[0].id}/summary`);
  check('ai/summary', sum.status === 201 && !!sum.json?.summary);
  const sug = await call('POST', `/ai/issues/${issues[0].id}/suggest`);
  check('ai/suggest', sug.status === 201 && !!sug.json?.rationale);

  console.log('\n— Analytics —');
  const sprints = await call('GET', `/sprints?projectId=${pid}`);
  const sprint = (sprints.json ?? []).find((s) => s.state === 'ACTIVE') ?? (sprints.json ?? [])[0];
  const bd = await call('GET', `/reports/burndown?sprintId=${sprint.id}`);
  check('reports/burndown (multi-day)', bd.status === 200 && bd.json?.series?.length > 1, `${bd.json?.series?.length} ngày`);
  const vel = await call('GET', `/reports/velocity?projectId=${pid}`);
  check('reports/velocity', vel.status === 200 && vel.json?.sprints?.length >= 1);
  const cfd = await call('GET', `/reports/cfd?projectId=${pid}`);
  check('reports/cfd', cfd.status === 200 && cfd.json?.series?.length > 0);
  const cr = await call('GET', `/reports/created-resolved?projectId=${pid}`);
  check('reports/created-resolved', cr.status === 200 && cr.json?.series?.length > 0);

  console.log('\n— Core domain —');
  const labels = await call('GET', `/projects/${pid}/labels`);
  check('labels/list', labels.status === 200 && labels.json?.length >= 3);
  const notifs = await call('GET', '/notifications?limit=20');
  check('notifications/list', notifs.status === 200 && Array.isArray(notifs.json?.data));
  const prefs = await call('GET', '/notifications/preferences');
  check('notifications/preferences (quiet default)', prefs.status === 200 && prefs.json?.defaults?.ISSUE_UPDATED === false && prefs.json?.defaults?.MENTIONED === true);
  const act = await call('GET', `/issues/${issues[0].id}/activity`);
  check('activity/issue', act.status === 200 && Array.isArray(act.json));
  const cf = await call('POST', '/custom-fields', { name: '[e2e] Env', type: 'TEXT', projectId: pid });
  check('custom-fields/create', cf.status === 201 && !!cf.json?.id);
  if (cf.json?.id) {
    const setv = await call('PUT', `/issues/${issues[0].id}/custom-fields/${cf.json.id}`, { value: 'prod' });
    check('custom-fields/set-value', setv.status === 200);
    await call('DELETE', `/custom-fields/${cf.json.id}`);
  }

  console.log('\n— Triage / Intake —');
  const inbox = await call('GET', `/triage?projectId=${pid}&limit=50`);
  check('triage/inbox', inbox.status === 200 && Array.isArray(inbox.json?.data));
  const dupSummary = `[e2e] báo lỗi trùng ${Date.now()}`;
  const r1 = await call('POST', '/intake/report', { projectId: pid, summary: dupSummary });
  const r2 = await call('POST', '/intake/report', { projectId: pid, summary: dupSummary });
  check('intake/report + dedupe', r1.status === 201 && r2.status === 201 && r2.json?.deduped === true && r2.json?.occurrenceCount >= 2, `dup occ=${r2.json?.occurrenceCount}`);

  console.log('\n— Config catalog —');
  const sevs = await call('GET', '/severities');
  check('severities/list', sevs.status === 200 && Array.isArray(sevs.json));
  const prios = await call('GET', '/priorities');
  check('priorities/list', prios.status === 200 && Array.isArray(prios.json));

  console.log('\n— Guides —');
  const guides = await call('GET', `/guides?screen=${encodeURIComponent('/p/:key/board')}`);
  check('guides/board-intro', guides.status === 200 && guides.json?.some((g) => g.key === 'board-intro'));

  console.log('\n— Data portability (export → import round-trip) —');
  const exp = await call('GET', `/export/project/${pid}`);
  check('export/project', exp.status === 200 && Array.isArray(exp.json?.issues) && exp.json?.schemaVersion >= 1, `${exp.json?.issues?.length} issue`);
  if (exp.json) {
    const slice = { ...exp.json, issues: exp.json.issues.slice(0, 2).map((i) => ({ ...i, summary: `[rt] ${i.summary}` })) };
    const imp = await call('POST', '/import/json', { projectId: pid, data: slice });
    check('import/json round-trip', imp.status === 201 && imp.json?.created >= 1, `created=${imp.json?.created}`);
  }

  console.log('\n— Integrations —');
  const intg = await call('POST', '/integrations/telegram', { name: '[e2e] tg' });
  check('integrations/telegram create', intg.status === 201);
  if (intg.json?.id) {
    const test = await call('POST', `/integrations/${intg.json.id}/test`);
    check('integrations/test (degrade no-token)', test.status === 201 && test.json?.enabled === false);
    const repo = await call('POST', '/dev/repositories', { integrationId: intg.json.id, provider: 'GITHUB', externalId: `e2e${Date.now()}`, name: 'acme/web', url: 'https://github.com/acme/web', webhookSecret: 's' });
    if (repo.json?.id) {
      const wh = await call('POST', `/dev/webhook/${repo.json.id}`, { ref: 'refs/heads/main', commits: [{ id: 'sha1', message: `${issues[0].key} fix`, url: 'http://x', author: { name: 'A' } }] }, { 'x-webhook-secret': 's' });
      check('dev/webhook smart-commit', wh.status === 201 && wh.json?.linked >= 1, `matched=${JSON.stringify(wh.json?.matched)}`);
      await call('DELETE', `/dev/repositories/${repo.json.id}`);
    }
    const dg = await call('POST', '/digests', { name: '[e2e] digest', schedule: 'WEEKLY', projectId: pid });
    if (dg.json?.id) {
      const run = await call('POST', `/digests/${dg.json.id}/run`);
      check('digests/run', run.status === 201 && typeof run.json?.summaryText === 'string');
      await call('DELETE', `/digests/${dg.json.id}`);
    }
    await call('DELETE', `/integrations/${intg.json.id}`);
  }

  console.log('\n— Tầm nhìn #17 (workflow/components/filters/watchers/links/auth) —');
  const wf = await call('GET', `/workflows?projectId=${pid}`);
  check('workflows/list', wf.status === 200 && Array.isArray(wf.json) && wf.json.length >= 1);
  const comp = await call('POST', `/projects/${pid}/components`, { name: `[e2e] comp ${Date.now()}` });
  check('components/create', comp.status === 201 && !!comp.json?.id);
  const verc = await call('POST', `/projects/${pid}/versions`, { name: `[e2e] v ${Date.now()}` });
  check('versions/create', verc.status === 201 && !!verc.json?.id);

  const filt = await call('POST', '/filters', { name: `[e2e] filter ${Date.now()}`, jql: 'project = DEMO ORDER BY created DESC' });
  const runF = filt.json?.id ? await call('GET', `/filters/${filt.json.id}/run?limit=5`) : { status: 0, json: null };
  check('saved-filters create+run', filt.status === 201 && runF.status === 200 && Array.isArray(runF.json?.data));

  const watchOn = await call('POST', `/issues/${issues[0].id}/watch`);
  const watchGet = await call('GET', `/issues/${issues[0].id}/watch`);
  await call('DELETE', `/issues/${issues[0].id}/watch`);
  check('watchers watch/unwatch', watchOn.status === 201 && watchGet.json?.watching === true);

  const lt = await call('GET', '/link-types');
  let linkOk = lt.status === 200 && Array.isArray(lt.json);
  if (lt.json?.length && issues.length >= 2) {
    const link = await call('POST', `/issues/${issues[0].id}/links`, { targetIssueId: issues[1].id, linkTypeId: lt.json[0].id });
    const links = await call('GET', `/issues/${issues[0].id}/links`);
    linkOk = (link.status === 201 || link.status === 422) && links.status === 200 && Array.isArray(links.json);
    check('issue-links create+list', linkOk, `${links.json?.length} link`);
  } else {
    check('issue-links (link-types)', linkOk, 'không có link-type seed — chỉ kiểm tra list');
  }

  const wss = await call('GET', '/auth/workspaces');
  const sw = wss.json?.[0]?.id ? await call('POST', '/auth/switch-workspace', { workspaceId: wss.json[0].id }) : { status: 0, json: null };
  check('auth/workspaces + switch', wss.status === 200 && Array.isArray(wss.json) && sw.status < 400 && !!sw.json?.accessToken);
  const inv = await call('POST', '/auth/invite', { email: `e2e-${Date.now()}@x.test`, displayName: 'E2E Invitee' });
  check('auth/invite', inv.status < 400 && inv.json?.invited === true);

  console.log(`\n=== E2E: ${pass} PASS / ${fail} FAIL ===`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
