import express, { type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { Tira } from './tira.js';

// 127.0.0.1 thay vì localhost: tránh Node/undici phân giải IPv6 ::1 (API chỉ nghe IPv4 ở dev Windows).
const API_URL = process.env.TIRAPRO_API_URL ?? 'http://127.0.0.1:4000/api/v1';
const PORT = Number(process.env.MCP_PORT ?? 4100);

/** Lấy API key từ header của client MCP. */
function keyFrom(req: Request): string | null {
  const x = req.headers['x-api-key'];
  if (typeof x === 'string' && x) return x;
  const a = req.headers['authorization'];
  if (typeof a === 'string' && a.startsWith('Bearer ')) return a.slice('Bearer '.length);
  return null;
}

const asText = (data: unknown) => ({
  content: [{ type: 'text' as const, text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});
const asError = (e: unknown) => ({
  content: [{ type: 'text' as const, text: `Lỗi: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});
/**
 * Lỗi cho tool GHI: 403 gần như chắc chắn do khoá chỉ có quyền đọc → nói rõ để AI/người
 * dùng biết cần tạo khoá có quyền ghi, thay vì đọc thông báo 403 chung chung.
 */
const asWriteError = (e: unknown) => {
  const status = (e as { status?: number } | null)?.status;
  if (status === 403) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Khoá chỉ có quyền đọc — không thể thực hiện thao tác ghi. Hãy tạo khoá có quyền ghi (bật "Cho phép ghi") trong mục API & MCP rồi thử lại.',
        },
      ],
      isError: true,
    };
  }
  return asError(e);
};
const norm = (s: string) => s.trim().toLowerCase();

const HELP_TEXT = [
  'Tirapro MCP — khai thác dữ liệu quản lý dự án của 1 workspace.',
  '',
  'Khái niệm:',
  '- Workspace: khoá API gắn cứng 1 workspace; mọi tool thao tác trong đó.',
  '- Issue key: {DỰ_ÁN}-{LOẠI}-{số}, vd DEMO-BUG-1. Xem/bình luận theo key.',
  '',
  'Quy trình gợi ý:',
  '1) get_context (kèm projectKey) để biết dự án, loại issue, độ ưu tiên, thành viên.',
  '2) list_issues / get_issue để đọc; search để lọc theo từ khoá.',
  '3) create_issue (projectKey + type tên loại + summary); add_comment; update_issue (tự xử lý version).',
  '',
  'Ghi chú: khoá chỉ-đọc chỉ đọc được; tool ghi (create_issue/update_issue/add_comment) sẽ báo rõ cần khoá có quyền ghi.',
].join('\n');

/** Tạo 1 MCP server (kèm tool) gắn với 1 API key cụ thể — stateless theo request. */
function buildServer(tira: Tira): McpServer {
  const server = new McpServer({ name: 'tirapro-mcp', version: '0.1.0' });

  const findProject = async (key: string) => {
    const projects: any[] = await tira.get('/projects');
    const p = projects.find((x) => norm(x.key) === norm(key));
    if (!p) throw new Error(`Không tìm thấy dự án "${key}"`);
    return p;
  };

  // ---- KHÁM PHÁ NGỮ CẢNH ----
  server.tool('help', 'Hướng dẫn dùng các tool Tirapro: khái niệm & quy trình nên theo.', {}, async () => asText(HELP_TEXT));

  server.tool(
    'get_context',
    'Khám phá ngữ cảnh workspace (dự án, thành viên; kèm loại issue & độ ưu tiên nếu truyền projectKey). Nên gọi TRƯỚC khi tạo/sửa.',
    { projectKey: z.string().optional().describe('Mã dự án để lấy loại issue/độ ưu tiên, vd DEMO') },
    async ({ projectKey }) => {
      try {
        const [projects, users] = await Promise.all([tira.get('/projects'), tira.get('/users')]);
        const ctx: any = {
          projects: projects.map((p: any) => ({ key: p.key, name: p.name })),
          members: users.map((u: any) => ({ displayName: u.displayName, email: u.email })),
          issueKeyFormat: '{DỰ_ÁN}-{LOẠI}-{số}, vd DEMO-BUG-1',
        };
        if (projectKey) {
          const meta = await tira.get(`/projects/${encodeURIComponent(projectKey)}/meta`);
          ctx.project = {
            key: projectKey,
            issueTypes: meta.issueTypes.map((t: any) => t.name),
            priorities: meta.priorities.map((p: any) => p.name),
          };
        }
        return asText(ctx);
      } catch (e) { return asError(e); }
    },
  );

  // ---- READ ----
  server.tool('list_projects', 'Liệt kê tất cả dự án trong workspace.', {}, async () => {
    try { return asText(await tira.get('/projects')); } catch (e) { return asError(e); }
  });

  server.tool(
    'list_issues',
    'Tìm/liệt kê issue (lọc theo dự án, từ khoá).',
    { projectKey: z.string().optional().describe('Mã dự án, vd DEMO'), search: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    async ({ projectKey, search, limit }) => {
      try {
        const qs = new URLSearchParams();
        if (projectKey) qs.set('projectId', (await findProject(projectKey)).id);
        if (search) qs.set('search', search);
        qs.set('limit', String(limit ?? 50));
        return asText(await tira.get(`/issues?${qs.toString()}`));
      } catch (e) { return asError(e); }
    },
  );

  server.tool('get_issue', 'Xem chi tiết 1 issue theo key (vd DEMO-BUG-4).', { key: z.string() }, async ({ key }) => {
    try { return asText(await tira.get(`/issues/${encodeURIComponent(key)}`)); } catch (e) { return asError(e); }
  });

  server.tool('list_sprints', 'Liệt kê sprint của một dự án.', { projectKey: z.string() }, async ({ projectKey }) => {
    try { return asText(await tira.get(`/sprints?projectId=${(await findProject(projectKey)).id}`)); } catch (e) { return asError(e); }
  });

  server.tool('list_members', 'Liệt kê người dùng/thành viên.', {}, async () => {
    try { return asText(await tira.get('/users')); } catch (e) { return asError(e); }
  });

  // ---- WRITE (cần API key có scope 'write') ----
  server.tool(
    'create_issue',
    'Tạo issue mới. type = tên loại (Bug/Task/Story…); priority/assigneeEmail tuỳ chọn.',
    {
      projectKey: z.string(), type: z.string(), summary: z.string(),
      description: z.string().optional(), priority: z.string().optional(), assigneeEmail: z.string().optional(),
    },
    async (a) => {
      try {
        const [proj, meta] = await Promise.all([
          findProject(a.projectKey),
          tira.get(`/projects/${encodeURIComponent(a.projectKey)}/meta`),
        ]);
        const t = meta.issueTypes.find((x: any) => norm(x.name) === norm(a.type) || norm(x.key ?? '') === norm(a.type));
        if (!t) throw new Error(`Loại không hợp lệ: ${a.type}`);
        let priorityId: string | undefined;
        if (a.priority) priorityId = meta.priorities.find((x: any) => norm(x.name) === norm(a.priority!))?.id;
        let assigneeId: string | undefined;
        if (a.assigneeEmail) {
          const users: any[] = await tira.get('/users');
          assigneeId = users.find((u) => norm(u.email) === norm(a.assigneeEmail!))?.id;
        }
        // clientMutationId: id sinh mỗi lần gọi để backend/realtime dedup (map vào field clientId đã hỗ trợ).
        const clientMutationId = randomUUID();
        return asText(await tira.post('/issues', {
          projectId: proj.id, typeId: t.id, summary: a.summary,
          description: a.description ?? null, descriptionFormat: 'MARKDOWN', priorityId, assigneeId,
          clientId: clientMutationId,
        }));
      } catch (e) { return asWriteError(e); }
    },
  );

  server.tool(
    'update_issue',
    'Cập nhật tiêu đề/mô tả một issue (theo key). Tự xử lý version (OCC).',
    { key: z.string(), summary: z.string().optional(), description: z.string().optional() },
    async (a) => {
      try {
        const issue = await tira.get(`/issues/${encodeURIComponent(a.key)}`);
        const patch: any = { version: issue.version };
        if (a.summary !== undefined) patch.summary = a.summary;
        if (a.description !== undefined) patch.description = a.description;
        return asText(await tira.patch(`/issues/${issue.id}`, patch));
      } catch (e) { return asWriteError(e); }
    },
  );

  server.tool('add_comment', 'Thêm bình luận (markdown) vào issue theo key.', { issueKey: z.string(), body: z.string() }, async (a) => {
    try {
      const issue = await tira.get(`/issues/${encodeURIComponent(a.issueKey)}`);
      return asText(await tira.post(`/issues/${issue.id}/comments`, { body: a.body, bodyFormat: 'MARKDOWN' }));
    } catch (e) { return asWriteError(e); }
  });

  return server;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, name: 'tirapro-mcp', apiUrl: API_URL });
});

// Streamable HTTP (stateless): mỗi request tạo server+transport riêng, auth bằng API key trong header.
app.post('/mcp', async (req, res) => {
  const key = keyFrom(req);
  if (!key) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Thiếu API key: Authorization: Bearer tira_…' }, id: null });
    return;
  }
  const server = buildServer(new Tira(API_URL, key));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { void transport.close(); void server.close(); });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: String(e) }, id: null });
  }
});

const methodNotAllowed = (_req: Request, res: express.Response) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Chỉ hỗ trợ POST (stateless).' }, id: null });
app.get('/mcp', methodNotAllowed);
app.delete('/mcp', methodNotAllowed);

app.listen(PORT, () => {
  console.log(`Tirapro MCP (Streamable HTTP) → http://localhost:${PORT}/mcp | API: ${API_URL}`);
});
