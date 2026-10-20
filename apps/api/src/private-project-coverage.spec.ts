import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Chống rò rỉ dự án riêng tư — kiểm TĨNH bằng AST, KHÔNG dựa danh sách tay các file.
 *
 *  R1. Mọi phương thức CÔNG KHAI của service/gateway đọc dữ liệu theo dự án (`prisma.<model>.findMany/findFirst/count/groupBy/aggregate`)
 *      phải — trong CÙNG phương thức hoặc phương thức `this.x()` nó gọi (bắc cầu trong class) — dùng quyết định chung
 *      (`visibleWhere` / `visibleProjectIds` / `canSee` / `assertCanSee` / …), HOẶC nằm trong `READ_ALLOWLIST` kèm lý do.
 *      Loại lý do được KIỂM TỰ ĐỘNG (xem `READ_KINDS`), không chỉ là lời tuyên bố.
 *  R2. Mọi route controller nhận `@CurrentUser()` phải truyền người dùng đó vào TỪNG lời gọi service (kiểm theo đúng lời gọi,
 *      không phải "đâu đó trong file có user.id"), HOẶC nằm trong `CONTROLLER_ALLOWLIST` kèm lý do đã kiểm tự động.
 *  R3. Chỉ `NotificationsService` được tạo dòng Notification / phát `NOTIFICATION_CREATED` (chốt lọc người nhận xem được việc).
 *  R4. Các điểm gửi ra ngoài đã khoá phải còn tham chiếu đúng thành phần khoá (Telegram, digest cấp workspace).
 *
 * Thêm service đọc chéo dự án mới ⇒ test này tự bắt; sửa bằng cách dùng `ProjectAccessService` (kèm test "người ngoài không
 * thấy" + "thành viên thấy") chứ không phải thêm vào allowlist.
 */

const SRC = __dirname;
const MODULES = join(SRC, 'modules');

/** Model có dữ liệu thuộc dự án (trực tiếp hoặc qua issue/sprint/dự án cha). */
const PROJECT_MODELS = new Set([
  'issue',
  'project',
  'sprint',
  'wikiPage',
  'wikiPageVersion',
  'notification',
  'reportSubscription',
  'slaPolicy',
  'issueSla',
  'workflow',
  'customField',
  'codeRepository',
  'contract',
  'raidItem',
  'objective',
  'keyResult',
  'program',
  'savedFilter',
  'issueHistory',
  'workLog',
  'milestone',
  'allocation',
  'comment',
  'commentReaction',
  'issueLink',
  'issueWatcher',
  'issueDevLink',
  'board',
  'client',
  'planBaseline',
  'issueTemplate',
  'recurringIssue',
  'automationRule',
  'automationTemplate',
  'label',
  'component',
  'version',
  'attachment',
  'checklistItem',
]);
const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'count',
  'groupBy',
  'aggregate',
]);
/** Tên (định danh, không tính chú thích/chuỗi) chứng tỏ phương thức đã áp quyết định xem dự án chung. */
const ACCESS_IDENTIFIERS = new Set([
  'visibleWhere',
  'visibleProjectIds',
  'canSee',
  'assertCanSee',
  'assertProjectVisible',
  'projectVisibilityMode',
  'seesAll',
  'assertProjectVisibleTo', // SearchService: bọc assertCanSee (định nghĩa của nó được R4 kiểm)
]);

/* --------------------------------- tiện ích AST --------------------------------- */

const cache = new Map<string, ts.SourceFile>();
const parse = (file: string): ts.SourceFile => {
  let sf = cache.get(file);
  if (!sf) {
    sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    cache.set(file, sf);
  }
  return sf;
};
const listFiles = (dir: string, pred: (f: string) => boolean, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFiles(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
};
const isSource = (f: string): boolean =>
  f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.int-spec.ts');
const rel = (f: string): string => relative(MODULES, f);
const decoratorsOf = (n: ts.Node): readonly ts.Decorator[] =>
  ts.canHaveDecorators(n) ? (ts.getDecorators(n) ?? []) : [];
const decoratorName = (d: ts.Decorator): string => {
  const e = d.expression;
  return ts.isCallExpression(e) ? e.expression.getText() : e.getText();
};
const classes = (sf: ts.SourceFile): ts.ClassDeclaration[] =>
  sf.statements.filter(ts.isClassDeclaration);
const methodsOf = (cls: ts.ClassDeclaration): ts.MethodDeclaration[] =>
  cls.members.filter((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && !!m.body);
const walk = (node: ts.Node, visit: (n: ts.Node) => void): void => {
  visit(node);
  ts.forEachChild(node, (c) => walk(c, visit));
};
/** Kiểu tham số constructor (`private readonly x: Foo`) → { x: 'Foo' }. */
const ctorProps = (cls: ts.ClassDeclaration): Map<string, string> => {
  const props = new Map<string, string>();
  for (const m of cls.members)
    if (ts.isConstructorDeclaration(m))
      for (const p of m.parameters) if (p.type) props.set(p.name.getText(), p.type.getText());
  return props;
};

/* ------------------------------ R1: đọc theo dự án ------------------------------ */

const REQUIRES_PROJECT = /if\s*\(\s*!projectId\s*\)\s*throw/;

interface MethodInfo {
  key: string; // 'file::Class.method'
  file: string;
  cls: string;
  name: string;
  isPublic: boolean;
  selfCalls: Set<string>;
  reads: string[];
  identifiers: Set<string>;
  /** Có `if (!projectId) throw …` — projectId bắt buộc, không để Prisma bỏ qua điều kiện `undefined`. */
  requiresProjectId: boolean;
}

function collectServiceMethods(): MethodInfo[] {
  const out: MethodInfo[] = [];
  const files = listFiles(
    MODULES,
    (f) => isSource(f) && (f.endsWith('.service.ts') || f.endsWith('.gateway.ts')),
  );
  for (const file of files) {
    for (const cls of classes(parse(file))) {
      for (const m of methodsOf(cls)) {
        const selfCalls = new Set<string>();
        const reads: string[] = [];
        const identifiers = new Set<string>();
        walk(m.body!, (n) => {
          if (ts.isIdentifier(n)) identifiers.add(n.text);
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
            const callee = n.expression;
            if (callee.expression.kind === ts.SyntaxKind.ThisKeyword)
              selfCalls.add(callee.name.text);
            const target = callee.expression;
            if (
              READ_OPS.has(callee.name.text) &&
              ts.isPropertyAccessExpression(target) &&
              PROJECT_MODELS.has(target.name.text)
            )
              reads.push(`${target.name.text}.${callee.name.text}`);
          }
        });
        const flags = ts.getCombinedModifierFlags(m);
        out.push({
          key: `${rel(file)}::${cls.name?.text ?? '?'}.${m.name.getText()}`,
          file,
          cls: cls.name?.text ?? '?',
          name: m.name.getText(),
          isPublic: (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0,
          selfCalls,
          reads,
          identifiers,
          requiresProjectId: REQUIRES_PROJECT.test(m.body!.getText()),
        });
      }
    }
  }
  return out;
}

/** Phương thức (hoặc phương thức `this.x()` nó gọi, bắc cầu trong cùng class) có dùng quyết định xem dự án chung không. */
function usesAccess(
  m: MethodInfo,
  all: Map<string, MethodInfo>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(m.key)) return false;
  seen.add(m.key);
  for (const id of m.identifiers) if (ACCESS_IDENTIFIERS.has(id)) return true;
  for (const callee of m.selfCalls) {
    const next = all.get(`${rel(m.file)}::${m.cls}.${callee}`);
    if (next && usesAccess(next, all, seen)) return true;
  }
  return false;
}

/** Lời gọi `this.<prop>.<method>()` của route controller → { service class, method, route }. */
interface ControllerCall {
  file: string;
  controller: string;
  route: string;
  prop: string;
  serviceClass: string;
  method: string;
  /** `@ProjectRef` (route hoặc class) — PermissionsGuard đã 404 người ngoài trước khi vào route. */
  hasProjectRef: boolean;
  /** Loại `@ProjectRef` (resource: 'issue' | …, hoặc 'param' | 'body' | 'query'); '' nếu không có. */
  projectRefKind: string;
  /** Route/class có `@Permissions` — không có thì PermissionsGuard bỏ qua hoàn toàn (không kiểm dự án). */
  hasPermissions: boolean;
  /** Đường dẫn đầy đủ chứa `:projectId` — guard lấy `req.params.projectId`, kiểm tồn tại + quyền xem (404 người ngoài). */
  pathHasProjectId: boolean;
  /** Route ghi (không phải GET) và đường dẫn KHÔNG có tham số — guard dùng `req.body.projectId`. */
  bodyProject: boolean;
  /** Route tự ném lỗi khi thiếu `projectId` (query bắt buộc). */
  requiresProjectId: boolean;
  /** Route chỉ dành cho quản trị: `@Permissions(WORKSPACE_ADMIN…)` hoặc tự kiểm `isSystemAdmin`/`assertSysAdmin`. */
  adminOnly: boolean;
  userParams: string[];
  passesUser: boolean;
}

const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete']);

function collectControllerCalls(): ControllerCall[] {
  const out: ControllerCall[] = [];
  const files = listFiles(MODULES, (f) => isSource(f) && f.endsWith('.controller.ts'));
  for (const file of files) {
    for (const cls of classes(parse(file))) {
      const props = ctorProps(cls);
      const classDecos = decoratorsOf(cls);
      for (const m of methodsOf(cls)) {
        const decos = [...decoratorsOf(m), ...classDecos];
        if (!decoratorsOf(m).some((d) => ROUTE_DECORATORS.has(decoratorName(d)))) continue;
        const userParams = m.parameters
          .filter((p) => decoratorsOf(p).some((d) => decoratorName(d) === 'CurrentUser'))
          .map((p) => p.name.getText());
        const refDeco = decos.find((d) => decoratorName(d) === 'ProjectRef');
        const hasProjectRef = !!refDeco;
        const projectRefKind =
          refDeco && ts.isCallExpression(refDeco.expression)
            ? (refDeco.expression.arguments[0]?.getText().replace(/['"]/g, '') ?? '')
            : '';
        const hasPermissions = decos.some((d) => decoratorName(d) === 'Permissions');
        const routeDeco = decoratorsOf(m).find((d) => ROUTE_DECORATORS.has(decoratorName(d)))!;
        const routeArg = ts.isCallExpression(routeDeco.expression)
          ? (routeDeco.expression.arguments[0]?.getText() ?? '')
          : '';
        const prefixDeco = classDecos.find((d) => decoratorName(d) === 'Controller');
        const prefix =
          prefixDeco && ts.isCallExpression(prefixDeco.expression)
            ? (prefixDeco.expression.arguments[0]?.getText() ?? '')
            : '';
        const fullPath = `${prefix}/${routeArg}`;
        const pathHasProjectId = /:projectId\b/.test(fullPath);
        const bodyProject = decoratorName(routeDeco) !== 'Get' && !fullPath.includes(':');
        const bodyText = m.body!.getText();
        const adminOnly =
          decos.some(
            (d) =>
              decoratorName(d) === 'Permissions' &&
              /WORKSPACE_ADMIN|SYSTEM_ADMIN/.test(d.getText()),
          ) || /\bassertSysAdmin\b|\bisSystemAdmin\b/.test(bodyText);
        walk(m.body!, (n) => {
          if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
          const callee = n.expression;
          const recv = callee.expression;
          if (
            !ts.isPropertyAccessExpression(recv) ||
            recv.expression.kind !== ts.SyntaxKind.ThisKeyword
          )
            return;
          const type = props.get(recv.name.text);
          if (!type || !/Service$/.test(type)) return;
          const args = n.arguments.map((a) => a.getText()).join(',');
          out.push({
            file,
            controller: cls.name?.text ?? '?',
            route: m.name.getText(),
            prop: recv.name.text,
            serviceClass: type,
            method: callee.name.text,
            hasProjectRef,
            projectRefKind,
            hasPermissions,
            pathHasProjectId,
            bodyProject,
            requiresProjectId: REQUIRES_PROJECT.test(bodyText),
            adminOnly,
            userParams,
            passesUser: userParams.some((u) => new RegExp(`\\b${u}\\b`).test(args)),
          });
        });
      }
    }
  }
  return out;
}

/**
 * Loại lý do được kiểm TỰ ĐỘNG:
 *  - ROUTE_GUARDED: mọi route controller gọi thẳng phương thức này đều có `@Permissions` VÀ (`@ProjectRef` hoặc `:projectId`
 *    trong đường dẫn) — PermissionsGuard 404 người ngoài dự án trước khi vào route;
 *  - BODY_PROJECT: như trên nhưng dự án nằm ở `req.body.projectId` (route ghi, đường dẫn không tham số, có `@Permissions`);
 *  - REQUIRED_PROJECT: `@ProjectRef('query'|'body')` + `@Permissions` và `projectId` BẮT BUỘC (route hoặc phương thức service ném lỗi
 *    khi thiếu) — nếu để trống thì guard không kiểm dự án nào và Prisma bỏ qua điều kiện `undefined`;
 *  - ADMIN_ONLY: mọi route gọi nó đều chỉ dành cho quản trị (`WORKSPACE_ADMIN`/quản trị hệ thống);
 *  - INTERNAL: KHÔNG route nào gọi trực tiếp (cron/sự kiện/được service khác gọi sau khi đã kiểm quyền);
 *  - REVIEWED: đã xem xét thủ công — dữ liệu không thuộc dự án hoặc đã lọc theo cách khác (lý do phải cụ thể).
 */
type Kind =
  | 'ROUTE_GUARDED'
  | 'BODY_PROJECT'
  | 'REQUIRED_PROJECT'
  | 'ADMIN_ONLY'
  | 'INTERNAL'
  | 'REVIEWED';
const READ_KINDS: Kind[] = [
  'ROUTE_GUARDED',
  'BODY_PROJECT',
  'REQUIRED_PROJECT',
  'ADMIN_ONLY',
  'INTERNAL',
  'REVIEWED',
];

/** Route được PermissionsGuard khoá theo dự án (404 người ngoài). */
const routeGuarded = (c: ControllerCall): boolean =>
  c.hasPermissions &&
  // `@ProjectRef('query'|'body')` cho phép bỏ trống projectId (khi đó guard KHÔNG kiểm dự án nào) nên không đủ để coi là khoá.
  ((c.hasProjectRef && !['query', 'body'].includes(c.projectRefKind)) || c.pathHasProjectId);
const bodyGuarded = (c: ControllerCall): boolean => c.hasPermissions && c.bodyProject;
const requiredProject = (c: ControllerCall, m: MethodInfo): boolean =>
  c.hasPermissions &&
  ['query', 'body'].includes(c.projectRefKind) &&
  (c.requiresProjectId || m.requiresProjectId);

const R_ROUTE_GUARDED =
  'route có @Permissions + @ProjectRef(tài nguyên)/:projectId — PermissionsGuard 404 người ngoài dự án trước khi vào service';
const R_BODY_PROJECT =
  'route ghi có projectId ở body — PermissionsGuard kiểm dự án (404 người ngoài) trước khi vào service';
const R_REQUIRED_PROJECT =
  'projectId query BẮT BUỘC (ném lỗi khi thiếu) + @ProjectRef query — guard 404 người ngoài dự án';
const R_ADMIN_ONLY =
  'route chỉ dành cho quản trị workspace/hệ thống — người đó đã xem được mọi dự án';

/** Khoá: `file::Class.method`. Loại + lý do; ROUTE_GUARDED/BODY_PROJECT/REQUIRED_PROJECT/ADMIN_ONLY/INTERNAL được kiểm tự động. */
const READ_ALLOWLIST: Record<string, [Kind, string]> = {
  // ---- ROUTE_GUARDED (55)
  'activity/activity.service.ts::ActivityService.listForIssue': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'activity/activity.service.ts::ActivityService.getOne': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'activity/activity.service.ts::ActivityService.listForProject': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'ai/ai.service.ts::AiService.summarizeIssue': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'attachments/attachments.service.ts::AttachmentsService.list': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'automation/automation.service.ts::AutomationService.getTemplate': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'automation/automation.service.ts::AutomationService.getRecurring': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'automation/automation.service.ts::AutomationService.runNow': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'automation/rules.service.ts::RulesService.runs': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'automation/rules.service.ts::RulesService.require': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'boards/boards.service.ts::BoardsService.get': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'boards/boards.service.ts::BoardsService.listIssues': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'comments/comments.service.ts::CommentsService.list': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'components/components.service.ts::ComponentsService.listComponents': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'components/components.service.ts::ComponentsService.attachComponent': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'components/components.service.ts::ComponentsService.detachComponent': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'components/components.service.ts::ComponentsService.listVersions': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'components/components.service.ts::ComponentsService.attachVersion': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'components/components.service.ts::ComponentsService.detachVersion': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'custom-fields/custom-fields.service.ts::CustomFieldsService.listIssueValues': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'dev-links/dev-links.service.ts::DevLinksService.removeRepository': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'dev-links/dev-links.service.ts::DevLinksService.listIssueDevLinks': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'export/export.service.ts::ExportService.exportProject': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'issue-extras/issue-extras.service.ts::IssueExtrasService.listChecklist': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'issue-extras/issue-extras.service.ts::IssueExtrasService.addChecklistItem': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'issue-extras/issue-extras.service.ts::IssueExtrasService.updateChecklistItem': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'issue-links/issue-links.service.ts::IssueLinksService.remove': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'issues/issues.service.ts::IssuesService.retract': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'issues/issues.service.ts::IssuesService.restore': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'issues/issues.service.ts::IssuesService.getDtosByIdsForSystem': [
    'INTERNAL',
    'ngữ cảnh hệ thống có chủ đích (L28): chỉ dựng DTO để phát realtime sau khi nghiệp vụ tự gán việc đã kiểm quyền; không route nào gọi',
  ],
  'issues/trash.service.ts::TrashService.list': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'labels/labels.service.ts::LabelsService.list': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'labels/labels.service.ts::LabelsService.attach': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'planning/planning.service.ts::PlanningService.listMilestones': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'planning/planning.service.ts::PlanningService.updateMilestone': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'planning/planning.service.ts::PlanningService.removeMilestone': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'planning/planning.service.ts::PlanningService.listBaselines': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'planning/planning.service.ts::PlanningService.createBaseline': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'planning/planning.service.ts::PlanningService.getBaseline': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'planning/planning.service.ts::PlanningService.schedule': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'projects/projects.service.ts::ProjectsService.getByKey': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'projects/projects.service.ts::ProjectsService.update': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'projects/projects.service.ts::ProjectsService.setAvatar': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'projects/projects.service.ts::ProjectsService.clearAvatar': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'projects/projects.service.ts::ProjectsService.meta': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'rbac/issue-ownership.service.ts::IssueOwnershipService.assertOwnsIssue': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'rbac/issue-ownership.service.ts::IssueOwnershipService.assertOwnsAttachment': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'rbac/issue-ownership.service.ts::IssueOwnershipService.assertOwnsLinkSource': [
    'ROUTE_GUARDED',
    R_ROUTE_GUARDED,
  ],
  'sla/sla.service.ts::SlaService.getForIssue': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'sprints/sprints.service.ts::SprintsService.start': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'sprints/sprints.service.ts::SprintsService.complete': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'sprints/sprints.service.ts::SprintsService.update': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'sprints/sprints.service.ts::SprintsService.remove': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'watchers/watchers.service.ts::WatchersService.list': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'watchers/watchers.service.ts::WatchersService.isWatching': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  'worklogs/worklogs.service.ts::WorklogsService.list': ['ROUTE_GUARDED', R_ROUTE_GUARDED],
  // ---- BODY_PROJECT (9)
  'ai/ai.service.ts::AiService.generateIssues': ['BODY_PROJECT', R_BODY_PROJECT],
  'ai/assignee-suggest.service.ts::AssigneeSuggestService.suggest': [
    'BODY_PROJECT',
    R_BODY_PROJECT,
  ],
  'ai/sprint-assistant.service.ts::SprintAssistantService.plan': ['BODY_PROJECT', R_BODY_PROJECT],
  'dev-links/dev-links.service.ts::DevLinksService.createRepository': [
    'BODY_PROJECT',
    R_BODY_PROJECT,
  ],
  'import/import.service.ts::ImportService.importCsv': ['BODY_PROJECT', R_BODY_PROJECT],
  'import/import.service.ts::ImportService.importJson': ['BODY_PROJECT', R_BODY_PROJECT],
  'import/jira/jira-import.service.ts::JiraImportService.run': ['BODY_PROJECT', R_BODY_PROJECT],
  'projects/projects.service.ts::ProjectsService.create': ['BODY_PROJECT', R_BODY_PROJECT],
  'sprints/sprints.service.ts::SprintsService.create': ['BODY_PROJECT', R_BODY_PROJECT],
  // ---- REQUIRED_PROJECT (7)
  'analytics/analytics.service.ts::AnalyticsService.projectReport': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  'analytics/analytics.service.ts::AnalyticsService.burndown': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  'analytics/analytics.service.ts::AnalyticsService.sprintSummary': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  'analytics/analytics.service.ts::AnalyticsService.velocity': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  'analytics/qa-report.service.ts::QaReportService.report': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  'boards/boards.service.ts::BoardsService.listForProject': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  'sprints/sprints.service.ts::SprintsService.listForProject': [
    'REQUIRED_PROJECT',
    R_REQUIRED_PROJECT,
  ],
  // ---- ADMIN_ONLY (5)
  'admin/admin-overview.service.ts::AdminOverviewService.overview': ['ADMIN_ONLY', R_ADMIN_ONLY],
  'guides/onboarding.service.ts::OnboardingService.get': ['ADMIN_ONLY', R_ADMIN_ONLY],
  'import/jira/jira-import.service.ts::JiraImportService.targets': ['ADMIN_ONLY', R_ADMIN_ONLY],
  'workflow-admin/workflow-admin.service.ts::WorkflowAdminService.removeWorkflow': [
    'ADMIN_ONLY',
    R_ADMIN_ONLY,
  ],
  'workflow-admin/workflow-admin.service.ts::WorkflowAdminService.removeStatus': [
    'ADMIN_ONLY',
    R_ADMIN_ONLY,
  ],
  // ---- INTERNAL (9)
  'automation/rule-engine.service.ts::RuleEngineService.runScheduled': [
    'INTERNAL',
    'cron quy tắc theo lịch chạy bằng người dùng hệ thống trên mọi dự án (không có người xem); hành động ghi qua IssuesService',
  ],
  'integrations/integrations.service.ts::IntegrationsService.onIssuesBulkUpdated': [
    'INTERNAL',
    'bộ lắng nghe sự kiện (không phải route): chỉ tra khoá dự án để ghi vào tin gộp rồi gửi qua fanout — fanout loại dự án riêng tư khỏi kênh cấp workspace',
  ],
  'integrations/integrations.service.ts::IntegrationsService.onCommentAdded': [
    'INTERNAL',
    'bộ lắng nghe sự kiện (không phải route): chỉ tra khoá/tiêu đề việc rồi gửi qua fanout — fanout loại dự án riêng tư khỏi kênh cấp workspace',
  ],
  'issues/rank.service.ts::RankService.rankOf': [
    'INTERNAL',
    'tính thứ hạng nội bộ do IssuesService/BoardsService gọi sau khi đã kiểm quyền; không trả dữ liệu cho client',
  ],
  'issues/wip.service.ts::WipService.enforceWip': [
    'INTERNAL',
    'kiểm giới hạn WIP nội bộ trong chuyển trạng thái đã qua guard; chỉ đếm, không trả dữ liệu',
  ],
  'rbac/rbac.service.ts::RbacService.assertProjectInWorkspace': [
    'INTERNAL',
    'kiểm dự án thuộc workspace (nền tảng của guard); không trả dữ liệu dự án',
  ],
  'sla/sla.service.ts::SlaService.onCommentAdded': [
    'INTERNAL',
    'bộ lắng nghe sự kiện cập nhật đồng hồ SLA của việc (ngữ cảnh hệ thống, không trả dữ liệu)',
  ],
  'sla/sla.service.ts::SlaService.onIssueTransitioned': [
    'INTERNAL',
    'bộ lắng nghe sự kiện cập nhật đồng hồ SLA của việc (ngữ cảnh hệ thống, không trả dữ liệu)',
  ],
  'sprints/sprints.service.ts::SprintsService.snapshot': [
    'INTERNAL',
    'chụp số liệu burndown nội bộ do cron/complete gọi (ngữ cảnh hệ thống); không phải route',
  ],
  'watchers/watchers.service.ts::WatchersService.onCommentAdded': [
    'INTERNAL',
    'bộ lắng nghe sự kiện: báo người theo dõi qua NotificationsService.publish (chốt lọc người nhận xem được việc)',
  ],
  // ---- REVIEWED (1)
  'dev-links/dev-links.service.ts::DevLinksService.handleWebhook': [
    'REVIEWED',
    'webhook công khai xác thực bằng bí mật của kho mã (không phải người dùng); chỉ ghi liên kết, không trả dữ liệu dự án',
  ],
};

describe('dự án riêng tư — R1: service/gateway đọc dữ liệu theo dự án phải dùng quyết định xem chung', () => {
  const methods = collectServiceMethods();
  const byKey = new Map(methods.map((m) => [m.key, m]));
  const controllerCalls = collectControllerCalls();
  const callersOf = (m: MethodInfo): ControllerCall[] =>
    controllerCalls.filter((c) => c.serviceClass === m.cls && c.method === m.name);
  const flagged = methods.filter((m) => m.isPublic && m.reads.length > 0 && !usesAccess(m, byKey));

  it('quét được đủ số phương thức (chống quét rỗng)', () => {
    expect(methods.length).toBeGreaterThan(400);
    expect(methods.filter((m) => m.reads.length > 0).length).toBeGreaterThan(150);
    expect(controllerCalls.length).toBeGreaterThan(300);
    // Các đường đọc chéo dự án đã khoá ở P13-P16 PHẢI được nhận diện là "đã dùng quyết định chung".
    for (const k of [
      'triage/triage.service.ts::TriageService.inbox',
      'workflow-admin/workflow-admin.service.ts::WorkflowAdminService.listWorkflows',
      'sla/sla.service.ts::SlaService.board',
      'wiki/wiki.service.ts::WikiService.tree',
      'digests/digests.service.ts::DigestsService.list',
      'notifications/notifications.service.ts::NotificationsService.listMine',
      'issues/issues.service.ts::IssuesService.list',
    ]) {
      const m = byKey.get(k);
      expect(m, `không tìm thấy ${k}`).toBeDefined();
      expect(m!.reads.length, `${k} không còn truy vấn dữ liệu dự án?`).toBeGreaterThan(0);
      expect(usesAccess(m!, byKey), `${k} không còn dùng quyết định xem dự án chung`).toBe(true);
    }
  });

  it('mọi phương thức công khai đọc dữ liệu theo dự án đều dùng quyết định chung hoặc có trong allowlist', () => {
    const missing = flagged
      .filter((m) => !(m.key in READ_ALLOWLIST))
      .map((m) => `${m.key}  [${[...new Set(m.reads)].join(', ')}]`);
    expect(
      missing,
      'Phương thức đọc dữ liệu theo dự án mà không dùng ProjectAccessService.visibleWhere/visibleProjectIds/canSee/assertCanSee ' +
        '(trong cùng phương thức hoặc phương thức this.x() nó gọi). Sửa bằng cách lọc theo người xem; chỉ thêm vào READ_ALLOWLIST ' +
        'khi thật sự an toàn và nêu lý do.',
    ).toEqual([]);
  });

  it('allowlist không chứa mục thừa (đã khoá hoặc đã xoá) và mọi lý do hợp lệ', () => {
    const flaggedKeys = new Set(flagged.map((m) => m.key));
    const stale = Object.keys(READ_ALLOWLIST).filter((k) => !flaggedKeys.has(k));
    expect(stale, 'mục allowlist không còn cần (xoá đi)').toEqual([]);
    for (const [k, [kind, reason]] of Object.entries(READ_ALLOWLIST)) {
      expect(READ_KINDS, k).toContain(kind);
      expect(reason.length, `${k}: lý do quá ngắn`).toBeGreaterThanOrEqual(20);
    }
  });

  it('lý do trong allowlist được kiểm thật (ROUTE_GUARDED / ADMIN_ONLY / INTERNAL)', () => {
    const problems: string[] = [];
    for (const [k, [kind]] of Object.entries(READ_ALLOWLIST)) {
      const m = byKey.get(k);
      if (!m) continue;
      const callers = callersOf(m);
      if (kind === 'INTERNAL' && callers.length > 0)
        problems.push(
          `${k}: khai INTERNAL nhưng route ${callers.map((c) => `${c.controller}.${c.route}`).join(', ')} gọi thẳng`,
        );
      if (kind === 'ROUTE_GUARDED' || kind === 'BODY_PROJECT' || kind === 'REQUIRED_PROJECT') {
        if (callers.length === 0)
          problems.push(`${k}: khai ${kind} nhưng không route nào gọi (dùng INTERNAL)`);
        for (const c of callers) {
          const ok =
            kind === 'ROUTE_GUARDED'
              ? routeGuarded(c)
              : kind === 'BODY_PROJECT'
                ? bodyGuarded(c)
                : requiredProject(c, m);
          if (!ok) problems.push(`${k}: route ${c.controller}.${c.route} không thoả ${kind}`);
        }
      }
      if (kind === 'ADMIN_ONLY') {
        if (callers.length === 0) problems.push(`${k}: khai ADMIN_ONLY nhưng không route nào gọi`);
        for (const c of callers)
          if (!c.adminOnly)
            problems.push(`${k}: route ${c.controller}.${c.route} không giới hạn quản trị`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('wiki không tự tính "thấy dự án" bằng project:view cấp workspace (một hàm quyết định duy nhất)', () => {
    const ids = new Set<string>();
    walk(parse(join(MODULES, 'wiki/wiki.service.ts')), (n) => {
      if (ts.isIdentifier(n)) ids.add(n.text);
    });
    expect(ids.has('getEffectivePermissions')).toBe(false);
  });

  it('ProjectAccessService có sẵn toàn cục để mọi module inject (typecheck không bắt thiếu provider)', () => {
    const src = readFileSync(join(MODULES, 'rbac/rbac.module.ts'), 'utf8');
    expect(src).toMatch(/@Global\(\)/);
    expect(src).toMatch(/exports:\s*\[[^\]]*ProjectAccessService/);
  });
});

/* --------------------------- R2: controller truyền người xem --------------------------- */

/** Khoá: `file::Controller.route -> prop.method`. Loại lý do dùng cùng `Kind` (kiểm theo route). */
const CONTROLLER_ALLOWLIST: Record<string, [Kind, string]> = {
  'admin/admin-console.controller.ts::AdminConsoleController.overview -> overviewSvc.overview': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'admin/admin-console.controller.ts::AdminConsoleController.config -> overviewSvc.configStatus': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'admin/admin-console.controller.ts::AdminConsoleController.setFlags -> settings.setFlags': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'admin/admin-console.controller.ts::AdminConsoleController.workspaces -> workspacesSvc.list': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'admin/admin-console.controller.ts::AdminConsoleController.patchWorkspace -> workspacesSvc.patch':
    ['ADMIN_ONLY', 'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service'],
  'admin/admin-console.controller.ts::AdminConsoleController.health -> systemSvc.health': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'admin/admin-console.controller.ts::AdminConsoleController.audit -> systemSvc.audit': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'admin/admin.controller.ts::AdminController.list -> admin.list': [
    'ADMIN_ONLY',
    'console quản trị hệ thống — tự kiểm assertSysAdmin trước khi gọi service',
  ],
  'attachments/attachments.controller.ts::AttachmentsController.remove -> attachments.remove': [
    'ROUTE_GUARDED',
    'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
  ],
  'automation/rules.controller.ts::RulesController.test -> rules.require': [
    'ROUTE_GUARDED',
    'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
  ],
  'custom-fields/custom-fields.controller.ts::CustomFieldsController.setIssueValue -> customFields.setIssueValue':
    [
      'ROUTE_GUARDED',
      'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
    ],
  'health/health.controller.ts::HealthController.check -> redis.isAvailable': [
    'REVIEWED',
    'kiểm tra sức khoẻ hạ tầng (Redis), không đọc dữ liệu dự án; người dùng chỉ để quyết định chi tiết hiển thị cho quản trị',
  ],
  'issue-extras/issue-extras.controller.ts::IssueExtrasController.setParticipants -> extras.setParticipants':
    [
      'ROUTE_GUARDED',
      'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
    ],
  'issue-extras/issue-extras.controller.ts::IssueExtrasController.addChecklist -> extras.addChecklistItem':
    [
      'ROUTE_GUARDED',
      'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
    ],
  'issue-extras/issue-extras.controller.ts::IssueExtrasController.updateChecklist -> extras.updateChecklistItem':
    [
      'ROUTE_GUARDED',
      'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
    ],
  'issue-extras/issue-extras.controller.ts::IssueExtrasController.removeChecklist -> extras.removeChecklistItem':
    [
      'ROUTE_GUARDED',
      'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
    ],
  'labels/labels.controller.ts::LabelsController.attach -> labels.attach': [
    'ROUTE_GUARDED',
    'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
  ],
  'labels/labels.controller.ts::LabelsController.detach -> labels.detach': [
    'ROUTE_GUARDED',
    'ghi theo id tài nguyên: @Permissions + @ProjectRef(tài nguyên) — guard 404 người ngoài; user được dùng ở phân quyền, service nhận id đã được guard xác thực',
  ],
  'users/users.controller.ts::UsersController.changePassword -> config.get': [
    'REVIEWED',
    'đọc cấu hình ConfigService (không phải dữ liệu dự án); đổi mật khẩu của chính người dùng đi qua lời gọi service khác đã truyền user',
  ],
};

describe('dự án riêng tư — R2: route controller truyền người dùng vào từng lời gọi service', () => {
  const calls = collectControllerCalls().filter((c) => c.userParams.length > 0);
  const keyOf = (c: ControllerCall): string =>
    `${rel(c.file)}::${c.controller}.${c.route} -> ${c.prop}.${c.method}`;
  const bad = calls.filter((c) => !c.passesUser);

  it('kiểm không rỗng: có đủ route nhận người dùng và các route đọc đã khoá THẬT SỰ truyền người dùng', () => {
    expect(calls.length).toBeGreaterThan(200);
    const passes = (k: string): boolean => calls.some((c) => keyOf(c) === k && c.passesUser);
    for (const k of [
      'triage/triage.controller.ts::TriageController.inbox -> triage.inbox',
      'triage/triage.controller.ts::TriageController.count -> triage.count',
      'workflow-admin/workflow-admin.controller.ts::WorkflowAdminController.list -> workflows.listWorkflows',
      'sla/sla.controller.ts::SlaController.board -> sla.board',
      'digests/digests.controller.ts::DigestsController.list -> digests.list',
      'dev-links/dev-links.controller.ts::DevLinksController.listRepositories -> devLinks.listRepositories',
      'custom-fields/custom-fields.controller.ts::CustomFieldsController.list -> customFields.listDefinitions',
      // 077: danh sách bình luận cần người xem (`reactions[].mine`); route thả/bỏ cảm xúc truyền người thả
      'comments/comments.controller.ts::CommentsController.list -> comments.list',
      'comments/comments.controller.ts::CommentsController.react -> comments.setReaction',
      'comments/comments.controller.ts::CommentsController.unreact -> comments.setReaction',
    ])
      expect(passes(k), `route đọc đã khoá không còn truyền người dùng: ${k}`).toBe(true);
  });

  it('mọi lời gọi service trong route có @CurrentUser đều truyền người dùng, hoặc có trong allowlist', () => {
    const missing = bad.filter((c) => !(keyOf(c) in CONTROLLER_ALLOWLIST)).map(keyOf);
    expect(
      missing,
      'Route nhận @CurrentUser nhưng KHÔNG truyền nó vào lời gọi service — service không biết ai đang xem nên không lọc ' +
        'được dự án riêng tư. Truyền user/user.id; chỉ allowlist khi route không đọc dữ liệu dự án (nêu lý do).',
    ).toEqual([]);
  });

  it('allowlist controller không thừa và lý do được kiểm thật', () => {
    const badKeys = new Set(bad.map(keyOf));
    const problems: string[] = [];
    for (const [k, [kind, reason]] of Object.entries(CONTROLLER_ALLOWLIST)) {
      if (!badKeys.has(k))
        problems.push(`${k}: mục thừa (đã truyền người dùng hoặc route không còn)`);
      if (reason.length < 20) problems.push(`${k}: lý do quá ngắn`);
      const c = bad.find((x) => keyOf(x) === k);
      if (!c) continue;
      if (kind === 'ROUTE_GUARDED' && !routeGuarded(c))
        problems.push(`${k}: thiếu @Permissions + @ProjectRef/:projectId`);
      if (kind === 'BODY_PROJECT' && !bodyGuarded(c))
        problems.push(`${k}: không phải route ghi có body.projectId + @Permissions`);
      if (kind === 'ADMIN_ONLY' && !c.adminOnly) problems.push(`${k}: không giới hạn quản trị`);
    }
    expect(problems).toEqual([]);
  });
});

/* ---------------------- R3: chốt tạo thông báo duy nhất ---------------------- */

describe('dự án riêng tư — R3: chỉ NotificationsService được tạo thông báo / phát notification.created', () => {
  const files = listFiles(SRC, isSource);
  const CHOKE = 'notifications/notifications.service.ts';
  /** realtime.gateway chỉ LẮNG NGHE sự kiện (OnEvent) để đẩy tới đúng người nhận — không tự tạo. */
  const LISTENERS = new Set(['realtime/realtime.gateway.ts']);

  it('không nơi nào khác ghi prisma.notification.create/createMany/upsert (automation `notify` từng ghi thẳng)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f) === CHOKE) continue;
      walk(parse(f), (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        const callee = n.expression;
        const t = callee.expression;
        if (
          ['create', 'createMany', 'createManyAndReturn', 'upsert'].includes(callee.name.text) &&
          ts.isPropertyAccessExpression(t) &&
          t.name.text === 'notification'
        )
          offenders.push(`${relative(SRC, f)}: ${n.getText().slice(0, 60)}`);
      });
    }
    expect(
      offenders,
      'Tạo thông báo phải đi qua NotificationsService.publish (lọc người nhận xem được việc, cài đặt, gộp 60s).',
    ).toEqual([]);
  });

  it('không nơi nào khác phát NOTIFICATION_CREATED (payload mang khoá + tiêu đề việc tới room người nhận)', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (rel(f) === CHOKE || LISTENERS.has(rel(f))) continue;
      walk(parse(f), (n) => {
        if (
          ts.isPropertyAccessExpression(n) &&
          n.name.text === 'NOTIFICATION_CREATED' &&
          n.expression.getText() === 'DOMAIN_EVENTS'
        )
          offenders.push(relative(SRC, f));
      });
    }
    expect(offenders).toEqual([]);
  });
});

/* ------------------ R4: các điểm gửi ra ngoài đã khoá còn nguyên ------------------ */

describe('dự án riêng tư — R4: điểm gửi ra kênh chung giữ thành phần khoá', () => {
  const idsOf = (file: string, cls: string, method: string): Set<string> => {
    const sf = parse(join(MODULES, file));
    const c = classes(sf).find((x) => x.name?.text === cls);
    const m = c && methodsOf(c).find((x) => x.name.getText() === method);
    expect(m, `${cls}.${method} không còn`).toBeDefined();
    const ids = new Set<string>();
    walk(m!.body!, (n) => {
      if (ts.isIdentifier(n)) ids.add(n.text);
    });
    return ids;
  };

  it.each([
    // Telegram: tin của dự án riêng tư chỉ tới kênh gắn đúng dự án.
    ['integrations/integrations.service.ts', 'IntegrationsService', 'fanout', 'isPrivate'],
    // Digest gửi ra kênh chung (cron, sự kiện sprint, "Chạy ngay" đều qua `deliver`): người xem do `channelViewer` chọn —
    // PUBLIC_VIEWER (chỉ dự án công khai) trừ dự án riêng tư được người tạo bật tường minh `allowPrivateToChannel`.
    ['digests/digests.service.ts', 'DigestsService', 'deliver', 'channelViewer'],
    ['digests/digests.service.ts', 'DigestsService', 'channelViewer', 'PUBLIC_VIEWER'],
    ['digests/digests.service.ts', 'DigestsService', 'channelViewer', 'isPrivate'],
    ['digests/digests.service.ts', 'DigestsService', 'channelViewer', 'allowPrivateToChannel'],
    // Báo cáo gắn dự án ẩn: update/remove/run đều qua requireSubscription → assertCanSee (404).
    ['digests/digests.service.ts', 'DigestsService', 'requireSubscription', 'assertCanSee'],
    // Tạo digest cho dự án ẩn bị chặn.
    ['digests/digests.service.ts', 'DigestsService', 'create', 'assertCanSee'],
    // Automation notify chỉ báo người xem được việc.
    ['automation/actions/notify.ts', null, 'runNotify', 'filterCanSee'],
  ] as const)('%s %s.%s tham chiếu %s', (file, cls, method, ident) => {
    if (cls === null) {
      const fn = parse(join(MODULES, file)).statements.find(
        (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === method,
      );
      expect(fn).toBeDefined();
      const ids = new Set<string>();
      walk(fn!.body!, (n) => {
        if (ts.isIdentifier(n)) ids.add(n.text);
      });
      expect(ids.has(ident)).toBe(true);
      return;
    }
    expect(idsOf(file, cls, method).has(ident)).toBe(true);
  });
});
