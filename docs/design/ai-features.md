# AI Features (Claude API)

Tôi đã nạp đầy đủ tham chiếu Claude API. Một điểm quan trọng cần làm rõ ngay từ đầu cho bản đặc tả: Anthropic **không có embeddings endpoint** — phần semantic search phải dùng provider embeddings bên ngoài (hoặc fallback). Tôi sẽ phản ánh điều này trong thiết kế. Giờ tôi viết bản đặc tả.

# Đặc tả Thiết kế Subsystem: AI Features (Claude API) — Tirapro

> **Subsystem owner:** AI Features. **Tech stack ràng buộc:** NestJS 10 + TypeScript, SDK `@anthropic-ai/sdk`, Prisma + PostgreSQL, Socket.io, React 18 + Vite + TanStack Query. **Model mặc định:** `claude-opus-4-8` (tác vụ chất lượng cao), `claude-sonnet-4-6` (tác vụ throughput cao/streaming nhanh). Mọi tính năng phải **degrade gracefully** khi thiếu `ANTHROPIC_API_KEY`.

---

## 0. Nguyên tắc nền tảng & các quyết định chốt trước

### 0.1. Model & SDK

| Model | Model ID | Dùng cho | Ghi chú |
|---|---|---|---|
| Claude Opus 4.8 | `claude-opus-4-8` | Sinh issue từ NL, sprint planning assistant, gợi ý assignee/priority/SP (tác vụ reasoning nặng) | Mặc định toàn hệ thống |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Tóm tắt issue/comment thread (throughput cao, latency thấp hơn) | Cân bằng tốc độ/chi phí |

- SDK: `@anthropic-ai/sdk` (chính thức cho TypeScript). **Không** dùng raw `fetch`/`axios` để gọi Anthropic.
- **Thinking:** Cả hai model dùng **adaptive thinking** — `thinking: { type: "adaptive" }`. **TUYỆT ĐỐI KHÔNG** dùng `budget_tokens` (trả 400 trên Opus 4.8). Khi cần stream reasoning cho UX (sprint planning), thêm `display: "summarized"`.
- **Effort:** đặt trong `output_config.effort` (không phải top-level). Mặc định `high` cho reasoning; `medium` cho tóm tắt.
- **KHÔNG dùng** `temperature` / `top_p` / `top_k` (bị remove, trả 400 trên Opus 4.8 / Sonnet 4.6 dùng adaptive). Điều khiển hành vi bằng prompt.
- **KHÔNG dùng assistant prefill** (last-assistant-turn prefill trả 400). Ép định dạng output bằng **structured outputs** (`output_config.format`) hoặc `client.messages.parse()`.
- `max_tokens`: mặc định `16000` cho non-streaming; `64000` cho streaming.

### 0.2. ⚠️ Embeddings — Quyết định kiến trúc bắt buộc

**Anthropic Claude API KHÔNG cung cấp embeddings endpoint.** Đây là điểm thường bị nhầm. Do đó semantic search **không** thể dùng `@anthropic-ai/sdk` để sinh vector. Phương án:

1. **Provider embeddings ngoài (production):** Voyage AI (`voyage-3` / `voyage-3-lite`) — đối tác embeddings được Anthropic khuyến nghị — hoặc OpenAI `text-embedding-3-small`. Cấu hình qua biến môi trường riêng (`EMBEDDINGS_PROVIDER`, `VOYAGE_API_KEY` / `OPENAI_API_KEY`).
2. **Lưu vector trong PostgreSQL bằng extension `pgvector`** (đã có sẵn trong Docker Compose image `pgvector/pgvector:pg16`).
3. **Degrade gracefully:** khi không có embeddings key → fallback sang **PostgreSQL full-text search** (`tsvector` + `ts_rank`) + trigram (`pg_trgm`). Vẫn cho kết quả "đủ tốt", chỉ mất ngữ nghĩa.

> Claude vẫn tham gia semantic search ở khâu **re-ranking/answer synthesis** (tùy chọn): sau khi pgvector trả top-K candidates, gọi Claude để re-rank và tóm tắt — đây là nơi Claude thực sự gia tăng giá trị, không phải ở khâu sinh vector.

### 0.3. An toàn — không lộ key ra Frontend

- `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`/`OPENAI_API_KEY` **chỉ tồn tại ở backend** (NestJS `ConfigService`, đọc từ `.env`/secrets). FE **không bao giờ** nhận key.
- FE gọi backend endpoint `/api/ai/*` (đã qua `JwtAuthGuard` + `RbacGuard`). Backend mới gọi Anthropic.
- Streaming tới FE qua **SSE** (`text/event-stream`) hoặc **Socket.io** — không proxy thẳng response Anthropic raw.
- Mọi endpoint AI bọc bởi **rate limiter** (xem §8).

---

## 1. Cấu trúc `AiModule`

```
apps/api/src/modules/ai/
├── ai.module.ts
├── ai.controller.ts                 # REST + SSE endpoints, gắn guards
├── ai.gateway.ts                    # Socket.io namespace /ai cho streaming + presence
├── config/
│   └── ai.config.ts                 # registerAs('ai', ...) — đọc env, expose isEnabled flags
├── clients/
│   ├── anthropic.client.ts          # Wrapper @anthropic-ai/sdk (singleton, lazy)
│   └── embeddings.client.ts         # Wrapper Voyage/OpenAI (provider-agnostic)
├── core/
│   ├── ai-availability.service.ts   # Trung tâm quyết định enabled/degraded
│   ├── ai-usage.service.ts          # Ghi token usage + cost vào DB (audit/quota)
│   ├── prompt-cache.util.ts         # Helper đặt cache_control
│   └── claude.service.ts            # Lớp gọi Claude chung (create/stream/parse + retry)
├── features/
│   ├── issue-generation/
│   │   ├── issue-generation.service.ts
│   │   ├── issue-generation.heuristic.ts   # fallback khi no key
│   │   ├── dto/generate-issues.dto.ts
│   │   └── prompts/issue-generation.prompt.ts
│   ├── summarization/
│   │   ├── summarization.service.ts
│   │   ├── summarization.heuristic.ts
│   │   └── prompts/summarization.prompt.ts
│   ├── suggestion/                  # assignee / priority / story points
│   │   ├── suggestion.service.ts
│   │   ├── suggestion.heuristic.ts
│   │   └── prompts/suggestion.prompt.ts
│   ├── sprint-planning/
│   │   ├── sprint-planning.service.ts
│   │   ├── sprint-planning.heuristic.ts
│   │   └── prompts/sprint-planning.prompt.ts
│   └── semantic-search/
│       ├── semantic-search.service.ts
│       ├── embeddings-index.service.ts     # quản lý pgvector index + backfill
│       ├── semantic-search.fallback.ts     # FTS + trigram
│       └── prompts/rerank.prompt.ts
├── schemas/                         # JSON Schema dùng cho structured outputs
│   ├── generated-issues.schema.ts
│   └── suggestion.schema.ts
└── ai.constants.ts                  # MODEL_OPUS, MODEL_SONNET, BETA flags...
```

### 1.1. `ai.module.ts` (skeleton)

```ts
@Module({
  imports: [ConfigModule.forFeature(aiConfig)],
  controllers: [AiController],
  providers: [
    AiGateway,
    AnthropicClient,
    EmbeddingsClient,
    AiAvailabilityService,
    AiUsageService,
    ClaudeService,
    IssueGenerationService,
    SummarizationService,
    SuggestionService,
    SprintPlanningService,
    SemanticSearchService,
    EmbeddingsIndexService,
  ],
  exports: [SemanticSearchService, EmbeddingsIndexService], // các module khác (Issues, Comments) cần index lại
})
export class AiModule {}
```

### 1.2. `AnthropicClient` (lazy singleton, an toàn)

```ts
@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);
  private _client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return !!this.config.get<string>('ai.anthropicApiKey');
  }

  /** Trả về null nếu không có key — caller phải degrade. */
  get(): Anthropic | null {
    if (!this.isConfigured) return null;
    if (!this._client) {
      this._client = new Anthropic({
        apiKey: this.config.get<string>('ai.anthropicApiKey'),
        maxRetries: 2,         // SDK tự retry 429/5xx/connection
        timeout: 600_000,      // ms — đủ cho stream dài
      });
    }
    return this._client;
  }
}
```

### 1.3. `AiAvailabilityService` — trung tâm degrade

```ts
export interface AiCapabilities {
  llm: boolean;          // có ANTHROPIC_API_KEY
  embeddings: boolean;   // có VOYAGE/OPENAI key + pgvector
}

@Injectable()
export class AiAvailabilityService {
  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  capabilities(): AiCapabilities {
    return { llm: this.anthropic.isConfigured, embeddings: this.embeddings.isConfigured };
  }
}
```

FE gọi `GET /api/ai/capabilities` để bật/tắt UI tương ứng (ẩn nút "✨ AI Generate" nếu `llm=false`, hiển thị badge "Heuristic mode").

### 1.4. `ClaudeService` — lớp gọi chung

Đóng gói mọi call để: chọn model, gắn `thinking`/`effort`, ghi usage, xử lý `stop_reason: "refusal"`, prompt caching.

```ts
@Injectable()
export class ClaudeService {
  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly usage: AiUsageService,
  ) {}

  /** Non-streaming + structured output (parse theo Zod). */
  async parse<T>(opts: {
    model: string;
    system: Anthropic.TextBlockParam[];   // luôn array để gắn cache_control
    userContent: string | Anthropic.ContentBlockParam[];
    schema: z.ZodType<T>;
    effort?: 'low' | 'medium' | 'high';
    maxTokens?: number;
    context: { workspaceId: string; userId: string; feature: string };
  }): Promise<T> {
    const client = this.anthropic.get();
    if (!client) throw new AiUnavailableError();

    const res = await client.messages.parse({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 16000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: opts.effort ?? 'high',
        format: zodOutputFormat(opts.schema),
      },
      system: opts.system,
      messages: [{ role: 'user', content: opts.userContent }],
    });

    if (res.stop_reason === 'refusal') {
      throw new AiRefusalError(res.stop_details?.category ?? null);
    }
    await this.usage.record(opts.context, res.usage, opts.model);

    if (!res.parsed_output) throw new AiParseError();
    return res.parsed_output;
  }

  /** Streaming — trả async iterable text deltas + final usage. */
  async *stream(opts: {
    model: string;
    system: Anthropic.TextBlockParam[];
    userContent: string | Anthropic.ContentBlockParam[];
    effort?: 'low' | 'medium' | 'high';
    maxTokens?: number;
    context: { workspaceId: string; userId: string; feature: string };
  }): AsyncGenerator<{ type: 'delta'; text: string } | { type: 'done'; usage: Anthropic.Usage }> {
    const client = this.anthropic.get();
    if (!client) throw new AiUnavailableError();

    const stream = client.messages.stream({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 64000,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: opts.effort ?? 'medium' },
      system: opts.system,
      messages: [{ role: 'user', content: opts.userContent }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield { type: 'delta', text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    await this.usage.record(opts.context, final.usage, opts.model);
    yield { type: 'done', usage: final.usage };
  }
}
```

> **Prompt caching:** `system` luôn là mảng `TextBlockParam`. Phần ổn định (system prompt định nghĩa schema, hướng dẫn, danh sách user/status/workflow của workspace) đặt `cache_control: { type: 'ephemeral' }` ở block cuối phần tĩnh; phần biến thiên (NL input, issue cụ thể) đặt trong `messages` (sau breakpoint). Xem §7.

---

## 2. Feature 1 — Sinh Issue từ Ngôn ngữ tự nhiên

### 2.1. Endpoint

| Method | Path | Guard | Mô tả |
|---|---|---|---|
| `POST` | `/api/ai/issues/generate` | `JwtAuthGuard`, `RbacGuard('issue:create')`, `AiRateLimitGuard` | Non-streaming, trả structured issues |
| `POST` | `/api/ai/issues/generate/stream` | như trên | SSE — stream thinking summary + kết quả từng phần (UX) |

### 2.2. Input DTO

```ts
export class GenerateIssuesDto {
  @IsUUID() projectId: string;
  @IsString() @MinLength(10) @MaxLength(8000) input: string;       // mô tả NL
  @IsOptional() @IsEnum(IssueType) preferredType?: IssueType;      // gợi ý loại gốc
  @IsOptional() @IsBoolean() decompose?: boolean;                  // tách thành Epic→Story→Task
  @IsOptional() @IsUUID() parentIssueId?: string;                  // nếu sinh sub-tasks
}
```

### 2.3. Output Schema (structured output — Zod)

```ts
export const GeneratedIssueSchema = z.object({
  title: z.string().describe('Tiêu đề ngắn gọn, dạng động từ-mệnh đề'),
  type: z.enum(['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK']),
  description: z.string().describe('Mô tả markdown: context, mục tiêu'),
  acceptanceCriteria: z.array(z.string()).describe('Tiêu chí nghiệm thu Given/When/Then'),
  storyPoints: z.number().int().nullable().describe('Fibonacci: 1,2,3,5,8,13; null nếu Epic'),
  priority: z.enum(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST']),
  labels: z.array(z.string()),
  childRefs: z.array(z.number().int()).describe('Index của issue con trong mảng (cho phân rã)'),
});

export const GeneratedIssuesResponseSchema = z.object({
  issues: z.array(GeneratedIssueSchema).min(1).max(30),
  summary: z.string().describe('Tóm tắt 1 dòng về những gì đã sinh'),
});
export type GeneratedIssuesResponse = z.infer<typeof GeneratedIssuesResponseSchema>;
```

> **Lưu ý JSON Schema giới hạn của structured outputs:** không hỗ trợ `minLength`/`maxLength`/`minimum`/`maximum`/recursive. SDK TypeScript tự strip các constraint không hỗ trợ và validate client-side qua Zod. Quan hệ cha-con biểu diễn **phẳng** bằng `childRefs` (mảng index), KHÔNG đệ quy.

### 2.4. Prompt template

```ts
export function buildIssueGenSystem(ctx: {
  projectName: string;
  issueTypes: string[];
  availableLabels: string[];
  workflowStatuses: string[];
}): Anthropic.TextBlockParam[] {
  return [
    {
      type: 'text',
      text: `Bạn là một Senior Agile Product Manager hỗ trợ tạo issue trong Tirapro.

NHIỆM VỤ: Chuyển mô tả ngôn ngữ tự nhiên của người dùng thành (các) issue có cấu trúc.

QUY TẮC:
- title: ngắn gọn, bắt đầu bằng động từ (vd "Triển khai xác thực OAuth2").
- type: chọn trong [${ctx.issueTypes.join(', ')}]. Nếu yêu cầu phân rã, tạo 1 EPIC + nhiều STORY/TASK con và liên kết qua childRefs (index trong mảng issues).
- acceptanceCriteria: dạng Given/When/Then, cụ thể, kiểm thử được. EPIC có thể để rỗng.
- storyPoints: thang Fibonacci (1,2,3,5,8,13). EPIC để null. Ước lượng theo độ phức tạp, KHÔNG theo thời gian.
- priority: suy ra từ ngôn ngữ (vd "khẩn cấp"→HIGHEST). Mặc định MEDIUM.
- labels: chỉ dùng từ [${ctx.availableLabels.join(', ')}], có thể rỗng.

Phân tích nội bộ trước, chỉ trả về kết quả cuối theo schema. KHÔNG bịa label hay type ngoài danh sách.`,
      cache_control: { type: 'ephemeral' }, // ổn định theo project → cache
    },
  ];
}
```

User turn: `input` (nếu `decompose=true` thêm chỉ thị "Hãy phân rã thành Epic và các Story/Task con.").

### 2.5. Luồng xử lý & giao tiếp subsystem khác

```
FE → POST /ai/issues/generate
  → IssueGenerationService.generate(dto, user)
    1. Load project context (ProjectService): issueTypes, labels, workflow statuses
       ← [Giao tiếp: Projects/Workflows subsystem]
    2. availability.capabilities().llm?
       - false → IssueGenerationHeuristic.generate() (xem 2.6)
       - true  → ClaudeService.parse({ model: OPUS, schema: GeneratedIssuesResponseSchema, ... })
    3. Validate type/label/status hợp lệ với workflow của project
    4. Trả PREVIEW (chưa ghi DB). FE hiển thị, user sửa/chấp nhận.
  → FE chấp nhận → POST /api/issues/bulk (IssuesService — KHÔNG thuộc AiModule)
       ← [Giao tiếp: Issues subsystem tạo bản ghi thật, gán key PROJ-123, emit realtime]
```

> **Quan trọng:** AI subsystem **không tự ghi issue vào DB**. Nó trả preview; việc persist do **Issues subsystem** đảm nhận (giữ nguyên RBAC, activity log, realtime emit, custom fields). Điều này tách bạch trách nhiệm và tránh trùng logic.

### 2.6. Degrade — heuristic khi không có key

```ts
// issue-generation.heuristic.ts
generate(input: string, preferredType?: IssueType): GeneratedIssuesResponse {
  // Tách câu/dòng thành các task thô; suy luận bằng từ khóa.
  const lines = input.split(/\n|(?<=[.;])\s+/).filter(l => l.trim().length > 3);
  const issues = lines.slice(0, 10).map(line => ({
    title: this.truncate(line.trim(), 80),
    type: preferredType ?? (/bug|lỗi|fix|sửa/i.test(line) ? 'BUG' : 'TASK'),
    description: line.trim(),
    acceptanceCriteria: [],
    storyPoints: null,
    priority: /khẩn|urgent|asap|critical/i.test(line) ? 'HIGHEST'
            : /thấp|nice to have|sau/i.test(line) ? 'LOW' : 'MEDIUM',
    labels: [],
    childRefs: [],
  }));
  return { issues, summary: `Tạo ${issues.length} issue (chế độ heuristic — không có AI).` };
}
```

Response luôn kèm cờ `degraded: true` để FE hiển thị badge.

---

## 3. Feature 2 — Tóm tắt Issue + toàn bộ Comment Thread

### 3.1. Endpoint

| Method | Path | Guard |
|---|---|---|
| `POST` | `/api/ai/issues/:issueId/summarize` | `JwtAuthGuard`, `RbacGuard('issue:read')`, `AiRateLimitGuard` |
| `GET` | `/api/ai/issues/:issueId/summarize/stream` | (SSE — stream summary token-by-token) |

### 3.2. Input / Output

```ts
export class SummarizeDto {
  @IsOptional() @IsEnum(['brief', 'detailed', 'action_items']) mode?: 'brief' | 'detailed' | 'action_items';
}

export const IssueSummarySchema = z.object({
  tldr: z.string(),                              // 1-2 câu
  keyPoints: z.array(z.string()),                // bullet
  decisions: z.array(z.string()),                // quyết định đã chốt trong thread
  openQuestions: z.array(z.string()),            // câu hỏi còn treo
  actionItems: z.array(z.object({
    text: z.string(),
    suggestedAssignee: z.string().nullable(),    // tên người được @ hoặc nhắc tới
  })),
  sentiment: z.enum(['blocked', 'on_track', 'at_risk', 'neutral']),
});
```

### 3.3. Prompt + caching chiến lược

Input có thể rất dài (thread trăm comment). Bố cục để **cache prefix**:

```
system (cache_control) → hướng dẫn tóm tắt cố định
user content:
  - block 1: issue metadata + description  (ổn định trong phiên → có thể cache nếu summarize nhiều mode)
  - block 2: toàn bộ comment thread đã serialize  ← phần lớn token
  - block 3: chỉ thị mode (brief/detailed/...)     ← biến thiên, KHÔNG cache
```

```ts
export function buildSummarizeSystem(): Anthropic.TextBlockParam[] {
  return [{
    type: 'text',
    text: `Bạn tóm tắt issue và thread thảo luận trong Tirapro cho thành viên team bận rộn.
- tldr: 1-2 câu nêu trạng thái hiện tại của issue.
- decisions: chỉ những điều đã CHỐT (không phải đề xuất).
- openQuestions: câu hỏi chưa ai trả lời.
- actionItems: việc cần làm; suggestedAssignee là tên người được @mention hoặc nhắc đích danh, null nếu không rõ.
- sentiment: blocked nếu có blocker chưa gỡ; at_risk nếu trễ hạn/rủi ro; on_track nếu tiến triển tốt.
Trung thực với nội dung, KHÔNG bịa. Trả về theo schema.`,
    cache_control: { type: 'ephemeral' },
  }];
}
```

Serialize comment: `[#index | author | ISO-time] nội dung` để Claude hiểu thứ tự & người nói.

### 3.4. Giao tiếp subsystem khác
- Đọc issue + comments từ **Issues/Comments subsystem** (qua service injection hoặc query Prisma read-only).
- Model: **Sonnet 4.6** (throughput, latency thấp), `effort: 'medium'`.
- Kết quả cache vào bảng `IssueSummary` (TTL theo `updatedAt` của issue) — tránh gọi lại khi thread chưa đổi.

### 3.5. Degrade
Heuristic: `tldr` = 2 câu đầu của description; `keyPoints` = N comment mới nhất rút gọn; `actionItems` = các comment chứa `@mention` + động từ; `sentiment` = `neutral`. Kèm `degraded: true`.

---

## 4. Feature 3 — Gợi ý Assignee / Priority / Story Points

### 4.1. Endpoint

| Method | Path | Guard |
|---|---|---|
| `POST` | `/api/ai/issues/suggest` | `JwtAuthGuard`, `RbacGuard('issue:read')`, `AiRateLimitGuard` |

Có thể chạy cho issue đã tồn tại (truyền `issueId`) hoặc draft (truyền `title`+`description`).

### 4.2. Input / Output

```ts
export class SuggestDto {
  @IsUUID() projectId: string;
  @IsOptional() @IsUUID() issueId?: string;
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsArray() fields: ('assignee' | 'priority' | 'storyPoints')[];
}

export const SuggestionSchema = z.object({
  assignee: z.object({
    userId: z.string().nullable(),     // PHẢI là id trong candidates, hoặc null
    reasoning: z.string(),
    confidence: z.number(),            // 0..1
  }).nullable(),
  priority: z.object({
    value: z.enum(['LOWEST', 'LOW', 'MEDIUM', 'HIGH', 'HIGHEST']),
    reasoning: z.string(),
    confidence: z.number(),
  }).nullable(),
  storyPoints: z.object({
    value: z.number().int(),           // Fibonacci
    reasoning: z.string(),
    confidence: z.number(),
  }).nullable(),
});
```

### 4.3. Context cần cung cấp (để gợi ý chính xác)

Đây là nơi giao tiếp subsystem khác đậm nhất:

| Dữ liệu | Nguồn (subsystem) | Mục đích |
|---|---|---|
| Danh sách thành viên + role | Projects/RBAC | candidates cho assignee |
| Workload hiện tại mỗi người (số issue đang mở, tổng SP đang làm) | Issues + Sprints | cân bằng tải |
| Lịch sử: ai từng làm issue có label/component tương tự | Issues (query) | match chuyên môn |
| Velocity & SP lịch sử của issue tương tự | Reports/Sprints | hiệu chỉnh story points |

```ts
export function buildSuggestionSystem(ctx: {
  candidates: Array<{ userId: string; name: string; openIssues: number; openStoryPoints: number; expertiseLabels: string[] }>;
  spScale: number[];
}): Anthropic.TextBlockParam[] {
  return [{
    type: 'text',
    text: `Bạn là trợ lý phân công Agile. Dựa trên issue và bối cảnh team, gợi ý assignee/priority/storyPoints.

ỨNG VIÊN ASSIGNEE (chỉ chọn userId trong danh sách này, hoặc null nếu không chắc):
${ctx.candidates.map(c => `- ${c.userId} | ${c.name} | đang làm ${c.openIssues} issue (${c.openStoryPoints} SP) | giỏi: ${c.expertiseLabels.join(',') || 'n/a'}`).join('\n')}

QUY TẮC:
- assignee: ưu tiên người có expertise khớp; tránh người quá tải. reasoning ngắn gọn.
- priority: suy từ tác động & độ khẩn.
- storyPoints: thang Fibonacci [${ctx.spScale.join(',')}], theo độ phức tạp.
- confidence trong [0,1]. Nếu thiếu thông tin, trả null cho field đó thay vì đoán bừa.
Chỉ trả userId có trong danh sách ứng viên.`,
    cache_control: { type: 'ephemeral' },
  }];
}
```

> **Hậu kiểm bắt buộc:** sau khi parse, **verify `assignee.userId` thực sự nằm trong `candidates`**; nếu không → set null (chống hallucination id). Đây là rào chắn an toàn không thể bỏ.

- Model: **Opus 4.8**, `effort: 'high'`, non-streaming (`parse`).

### 4.4. Degrade — heuristic
- **assignee:** người có `openStoryPoints` nhỏ nhất trong candidates (load balancing), tie-break theo expertise khớp label.
- **priority:** keyword scan trên title/description (`crash|down|security` → HIGHEST).
- **storyPoints:** trung vị SP của ≤20 issue closed gần nhất cùng type/label trong project; làm tròn về Fibonacci gần nhất; mặc định `3` nếu không có dữ liệu.

---

## 5. Feature 4 — Sprint Planning Assistant

### 5.1. Endpoint

| Method | Path | Guard |
|---|---|---|
| `POST` | `/api/ai/sprints/plan` | `JwtAuthGuard`, `RbacGuard('sprint:manage')`, `AiRateLimitGuard` |
| `POST` | `/api/ai/sprints/plan/stream` | SSE — stream reasoning summary cho UX "đang phân tích..." |

### 5.2. Input / Output

```ts
export class SprintPlanDto {
  @IsUUID() projectId: string;
  @IsUUID() sprintId: string;                   // sprint đang plan
  @IsOptional() @IsInt() capacityOverride?: number; // SP capacity ép buộc
  @IsOptional() @IsString() goal?: string;          // mục tiêu sprint do user nêu
}

export const SprintPlanSchema = z.object({
  recommendedCapacity: z.number().int(),        // dựa velocity trung bình
  selectedIssues: z.array(z.object({
    issueId: z.string(),                         // PHẢI thuộc backlog đầu vào
    storyPoints: z.number().int(),
    rationale: z.string(),
    sequenceHint: z.number().int(),              // thứ tự đề xuất làm
  })),
  excludedIssues: z.array(z.object({
    issueId: z.string(),
    reason: z.string(),                          // vd "vượt capacity", "phụ thuộc chưa xong"
  })),
  totalStoryPoints: z.number().int(),
  goalAlignment: z.string(),                     // các issue chọn phục vụ goal thế nào
  risks: z.array(z.string()),
});
```

### 5.3. Context (giao tiếp subsystem)

| Dữ liệu | Nguồn |
|---|---|
| Velocity 3-5 sprint gần nhất | Reports/Sprints subsystem |
| Backlog issues (id, title, type, SP, priority, dependencies, labels) | Issues subsystem |
| Capacity team (số ngày làm việc, ngày nghỉ) | Projects (tùy chọn) |

Prompt nhấn mạnh: chỉ chọn `issueId` từ backlog đầu vào, tôn trọng dependency (không đưa issue có blocker chưa done), tổng SP ≤ capacity, ưu tiên theo priority + goal alignment.

```ts
export function buildSprintPlanSystem(ctx: {
  avgVelocity: number;
  recentVelocities: number[];
  goal?: string;
}): Anthropic.TextBlockParam[] {
  return [{
    type: 'text',
    text: `Bạn là Scrum Master hỗ trợ lập kế hoạch sprint trong Tirapro.

DỮ LIỆU VELOCITY: trung bình ${ctx.avgVelocity} SP/sprint (gần đây: ${ctx.recentVelocities.join(', ')}).
${ctx.goal ? `MỤC TIÊU SPRINT: ${ctx.goal}` : ''}

QUY TẮC:
- recommendedCapacity ≈ velocity trung bình (điều chỉnh nhẹ theo xu hướng).
- Chỉ chọn issueId CÓ trong backlog đầu vào (sẽ cung cấp ở message).
- KHÔNG chọn issue có dependency/blocker chưa hoàn thành — đưa vào excludedIssues với lý do.
- Tổng SP của selectedIssues ≤ recommendedCapacity (trừ khi user override).
- Ưu tiên: priority cao + phục vụ goal trước.
- sequenceHint: đề xuất thứ tự thực hiện (tôn trọng dependency).
Trả về theo schema. Giải thích ngắn gọn, hành động được.`,
    cache_control: { type: 'ephemeral' },
  }];
}
```

User turn: backlog serialize dạng bảng `[issueId | type | SP | priority | dependsOn[] | labels | title]`.

- Model: **Opus 4.8**, `effort: 'high'`.
- **Hậu kiểm:** lọc `selectedIssues` chỉ giữ id thuộc backlog; tính lại `totalStoryPoints` server-side (không tin số của model).
- Kết quả là **đề xuất** — FE cho user kéo-thả điều chỉnh rồi gọi **Sprints subsystem** để commit thật.

### 5.4. Degrade — heuristic
Greedy knapsack: sắp backlog theo `(priority desc, SP asc)`, bỏ qua issue có blocker chưa done, nhồi đến khi đạt `recommendedCapacity = avgVelocity`. `risks=[]`, `goalAlignment` rỗng. Hoàn toàn không cần AI.

---

## 6. Feature 5 — Semantic Search (Embeddings + pgvector)

### 6.1. Kiến trúc tổng thể

```
                  ┌──────────────── Indexing (async) ────────────────┐
Issue/Comment CRUD ─emit event─→ EmbeddingsIndexService.enqueue(entity)
                                  → EmbeddingsClient.embed(text)  [Voyage/OpenAI]
                                  → INSERT/UPDATE issue_embeddings (pgvector)

                  ┌──────────────── Query ────────────────┐
FE → POST /ai/search → SemanticSearchService.search(q)
   capabilities.embeddings?
     true  → embed(q) → pgvector ANN (<=> cosine) top-K
             → (tùy chọn) Claude re-rank/answer synthesis
     false → SemanticSearchFallback (PostgreSQL FTS + pg_trgm)
```

### 6.2. Schema Prisma + pgvector

```prisma
// pgvector cần migration thủ công: CREATE EXTENSION IF NOT EXISTS vector;
model IssueEmbedding {
  id          String   @id @default(cuid())
  issueId     String   @unique
  workspaceId String
  projectId   String
  contentHash String   // sha256(title+description) — bỏ qua re-embed nếu trùng
  // vector(1024) cho voyage-3, hoặc 1536 cho openai text-embedding-3-small
  // Prisma chưa hỗ trợ native pgvector → dùng Unsupported + raw query khi truy vấn
  embedding   Unsupported("vector(1024)")
  model       String
  updatedAt   DateTime @updatedAt

  @@index([workspaceId])
  @@map("issue_embeddings")
}
```

Migration bổ sung (raw SQL trong file migration):
```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX issue_embeddings_ann ON issue_embeddings
  USING hnsw (embedding vector_cosine_ops);
-- FTS fallback:
ALTER TABLE issues ADD COLUMN search_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,''))) STORED;
CREATE INDEX issues_search_tsv ON issues USING gin(search_tsv);
CREATE INDEX issues_title_trgm ON issues USING gin(title gin_trgm_ops);
```

### 6.3. Endpoint

| Method | Path | Guard |
|---|---|---|
| `POST` | `/api/ai/search` | `JwtAuthGuard`, `RbacGuard('issue:read')`, `AiRateLimitGuard` |
| `POST` | `/api/ai/admin/reindex` | `RbacGuard('admin')` — backfill embeddings |

```ts
export class SemanticSearchDto {
  @IsString() @MinLength(2) query: string;
  @IsUUID() projectId: string;             // bắt buộc — scope + RBAC
  @IsOptional() @IsInt() @Max(50) limit?: number;
  @IsOptional() @IsBoolean() synthesize?: boolean;   // bật Claude answer synthesis
}

export interface SearchResult {
  issueId: string;
  score: number;               // cosine similarity (vector) hoặc ts_rank (fallback)
  highlight: string;
  matchType: 'semantic' | 'lexical';
}
export interface SearchResponse {
  results: SearchResult[];
  answer?: string;             // nếu synthesize=true và có LLM
  degraded: boolean;           // true nếu dùng fallback lexical
}
```

### 6.4. Query — pgvector (raw SQL qua Prisma)

```ts
async search(dto: SemanticSearchDto, user: AuthUser): Promise<SearchResponse> {
  if (this.availability.capabilities().embeddings) {
    const [vec] = await this.embeddings.embed([dto.query]);
    const literal = `[${vec.join(',')}]`;
    // RBAC: chỉ project user có quyền (đã qua guard) — vẫn scope projectId
    const rows = await this.prisma.$queryRaw<Array<{ issueId: string; score: number }>>`
      SELECT "issueId", 1 - (embedding <=> ${literal}::vector) AS score
      FROM issue_embeddings
      WHERE "projectId" = ${dto.projectId}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${dto.limit ?? 20}`;
    let answer: string | undefined;
    if (dto.synthesize && this.availability.capabilities().llm) {
      answer = await this.synthesizeAnswer(dto.query, rows); // Claude re-rank + tóm tắt
    }
    return { results: rows.map(r => ({ ...r, matchType: 'semantic', highlight: '' })), answer, degraded: false };
  }
  return this.fallback.search(dto); // FTS + trigram
}
```

### 6.5. Embeddings client (provider-agnostic)

```ts
@Injectable()
export class EmbeddingsClient {
  get isConfigured(): boolean {
    const p = this.config.get('ai.embeddingsProvider');
    return p === 'voyage' ? !!this.config.get('ai.voyageApiKey')
         : p === 'openai' ? !!this.config.get('ai.openaiApiKey')
         : false;
  }
  // embed(texts: string[]): Promise<number[][]> — gọi REST của Voyage/OpenAI.
  // KHÔNG dùng @anthropic-ai/sdk vì Anthropic không có embeddings endpoint.
}
```

### 6.6. Re-ranking với Claude (tùy chọn, nơi Claude gia tăng giá trị)
Sau khi pgvector trả top-K, gọi `claude.parse` với schema `{ rankedIssueIds: string[], answer: string }`, system prompt: "Cho truy vấn và danh sách issue candidate, sắp xếp lại theo độ liên quan thực sự và tổng hợp câu trả lời ngắn." Chỉ dùng khi `synthesize=true` → tránh chi phí mỗi search.

### 6.7. Degrade hai cấp
1. **Không có embeddings key** → FTS (`ts_rank` trên `search_tsv`) + trigram similarity, gộp điểm. `degraded: true`, `matchType: 'lexical'`.
2. **Có embeddings nhưng không có Anthropic key** → vẫn semantic search vector, chỉ tắt `answer` synthesis.

### 6.8. Indexing — giao tiếp subsystem
- **Issues/Comments subsystem** emit domain event (`issue.created`, `issue.updated`, `issue.deleted`) → `EmbeddingsIndexService` lắng nghe (NestJS `EventEmitter2` hoặc BullMQ queue) → embed bất đồng bộ, không chặn request CRUD.
- So `contentHash` để skip re-embed khi nội dung không đổi (tiết kiệm chi phí).
- `POST /ai/admin/reindex` để backfill (seed data hoặc khi đổi model embeddings).

---

## 7. Prompt Caching — chiến lược chung

- **Render order:** `tools` → `system` → `messages`. Đặt `cache_control: { type: 'ephemeral' }` ở **block cuối của phần ổn định**.
- **Ổn định (cache được):** system prompt cố định theo feature, context theo project (danh sách members/labels/statuses/velocity) — thường tái dùng nhiều request trong phiên.
- **Biến thiên (KHÔNG cache, đặt sau breakpoint):** NL input cụ thể, nội dung issue/thread, mode.
- **Silent invalidator phải tránh:** KHÔNG nhúng `new Date()`, UUID request, `JSON.stringify` không sort key vào phần prefix. Serialize context deterministic (sort theo userId/issueId).
- **Min cacheable prefix:** Opus 4.8 = 4096 tokens, Sonnet 4.6 = 2048 tokens. Prompt ngắn hơn sẽ không cache (không lỗi, chỉ `cache_creation_input_tokens: 0`).
- Verify qua `usage.cache_read_input_tokens` (ghi vào `AiUsageService`).

---

## 8. An toàn, Rate limit, Quota

### 8.1. Rate limit
- `AiRateLimitGuard` dùng `@nestjs/throttler` backed bởi Redis, key theo `userId` + `workspaceId` + `feature`.
- Đề xuất: 20 req/phút/user cho generate/suggest/plan; 60 req/phút cho search; 10 req/phút cho summarize (token nặng).
- Khi Anthropic trả 429 → SDK tự retry (maxRetries=2); nếu vẫn fail → trả `503` kèm `Retry-After` cho FE.

### 8.2. Quota & cost tracking
```prisma
model AiUsage {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  feature     String   // 'issue_generation' | 'summarization' | ...
  model       String
  inputTokens Int
  outputTokens Int
  cacheReadTokens Int
  estimatedCostUsd Decimal @db.Decimal(10, 6)
  createdAt   DateTime @default(now())
  @@index([workspaceId, createdAt])
}
```
- `AiUsageService.record()` tính cost theo bảng giá (Opus 4.8: $5/$25 per 1M in/out; Sonnet 4.6: $3/$15). Cache read ≈ 0.1× input.
- Quota theo workspace/tháng → chặn trước khi gọi nếu vượt.

### 8.3. Không lộ key & input safety
- Key chỉ ở backend (§0.3).
- Validate độ dài input (DTO `@MaxLength`) chống abuse token.
- Xử lý `stop_reason: 'refusal'` → trả lỗi thân thiện, không retry cùng prompt; log `request_id` (qua `response._request_id`) để hỗ trợ.
- Scope mọi truy vấn dữ liệu theo `workspaceId`/`projectId` của user (RBAC) trước khi đưa vào prompt — chống rò rỉ dữ liệu chéo workspace.

---

## 9. Giao tiếp Realtime & SSE tới Frontend

### 9.1. SSE (cho generate/summarize/plan streaming)
Controller dùng `@Sse()` hoặc trả `Observable<MessageEvent>`:
```ts
@Sse('issues/generate/stream')
@UseGuards(JwtAuthGuard, RbacGuard, AiRateLimitGuard)
streamGenerate(@Query() dto: GenerateIssuesDto, @CurrentUser() user): Observable<MessageEvent> {
  return new Observable(sub => {
    (async () => {
      for await (const chunk of this.issueGen.streamGenerate(dto, user)) {
        sub.next({ data: chunk } as MessageEvent); // { type: 'delta'|'done'|'error', ... }
      }
      sub.complete();
    })().catch(err => sub.error(err));
  });
}
```
FE: TanStack Query không trực tiếp cho SSE → dùng `EventSource` (hoặc `fetch` + `ReadableStream`) trong custom hook, ghép vào Zustand store; optimistic UI hiển thị từng issue khi parse xong.

### 9.2. Socket.io (`AiGateway`, namespace `/ai`)
- Dùng khi cần broadcast: vd sprint planning chạy nền, kết quả gửi tới mọi member đang xem board → emit `ai:sprint-plan:ready`.
- Presence "X đang dùng AI..." có thể đi qua gateway này, đồng bộ với **Realtime collaboration subsystem**.
- Auth socket bằng JWT trong handshake (`auth.token`), tái dùng cùng guard logic.

---

## 10. Bảng tổng hợp Endpoints & Degrade

| Feature | Endpoint | Model | Streaming | No-key fallback |
|---|---|---|---|---|
| Sinh issue NL | `POST /ai/issues/generate(/stream)` | Opus 4.8 | SSE | Heuristic split + keyword |
| Tóm tắt thread | `POST /ai/issues/:id/summarize(/stream)` | Sonnet 4.6 | SSE | Câu đầu + comment mới + @mention |
| Gợi ý assignee/priority/SP | `POST /ai/issues/suggest` | Opus 4.8 | Không | Load-balance + keyword + median SP |
| Sprint planning | `POST /ai/sprints/plan(/stream)` | Opus 4.8 | SSE | Greedy knapsack theo velocity |
| Semantic search | `POST /ai/search` | (embeddings ngoài) + Opus 4.8 re-rank | Không | PostgreSQL FTS + pg_trgm |
| Capabilities | `GET /ai/capabilities` | — | — | luôn có |

---

## 11. Điểm giao tiếp với các subsystem khác (tóm tắt)

| Subsystem | AI subsystem cần gì | Chiều |
|---|---|---|
| **Issues** | Đọc issue/comment, danh sách backlog; persist issue sau khi user chấp nhận preview; emit event để index | 2 chiều |
| **Projects / RBAC** | Members, roles, labels, permission check (mọi guard) | đọc |
| **Workflows** | issueTypes, statuses, transitions hợp lệ (validate output) | đọc |
| **Sprints** | Sprint hiện tại, capacity; commit plan đã duyệt | 2 chiều |
| **Reports** | Velocity lịch sử cho suggestion & sprint planning | đọc |
| **Realtime (Socket.io)** | Broadcast kết quả AI nền, presence | ghi |
| **Comments** | Nội dung thread cho summarize; index embeddings | đọc + event |

> Nguyên tắc tách trách nhiệm: **AiModule không tự ghi dữ liệu nghiệp vụ** (issue, sprint). Nó sinh **đề xuất/preview**; subsystem chủ quản persist để giữ nguyên RBAC, activity log, custom fields, realtime emit.

---

## 12. Biến môi trường

```env
# Anthropic (LLM) — thiếu → toàn bộ tính năng LLM degrade
ANTHROPIC_API_KEY=
AI_MODEL_PRIMARY=claude-opus-4-8
AI_MODEL_FAST=claude-sonnet-4-6

# Embeddings — provider ngoài (Anthropic KHÔNG có embeddings)
EMBEDDINGS_PROVIDER=voyage          # voyage | openai | none
VOYAGE_API_KEY=
VOYAGE_MODEL=voyage-3
OPENAI_API_KEY=
OPENAI_EMBEDDINGS_MODEL=text-embedding-3-small

# Quota / rate limit
AI_MONTHLY_TOKEN_QUOTA_PER_WORKSPACE=5000000
REDIS_URL=redis://redis:6379
```

`docker-compose.yml`: dùng image `pgvector/pgvector:pg16` cho service `postgres` để có sẵn extension `vector` + `pg_trgm`.

---

## 13. Checklist chất lượng production

- [ ] Mọi call Claude qua `ClaudeService` (tập trung retry, usage, refusal handling).
- [ ] `adaptive` thinking, không `budget_tokens`, không sampling params.
- [ ] Structured output qua `messages.parse()` + Zod; hậu kiểm id/label/status hợp lệ (chống hallucination).
- [ ] Hậu kiểm tổng SP / id thuộc tập đầu vào ở suggestion & sprint planning (không tin số liệu model).
- [ ] Degrade graceful đã test cho cả 5 feature khi gỡ `ANTHROPIC_API_KEY` và embeddings key.
- [ ] Prompt caching verify `cache_read_input_tokens > 0` trên request lặp.
- [ ] Key không bao giờ xuất hiện trong response/log/FE.
- [ ] Rate limit + quota enforced trước khi gọi API ngoài.
- [ ] pgvector migration + HNSW index + FTS fallback index có trong migration.
- [ ] Seed data: backfill embeddings qua `/ai/admin/reindex` sau seed issues.