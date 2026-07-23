I now have everything needed. The Issue model has 14 indexes, PK is `id @default(cuid())` (single column — confirms the partitioning concern), and many low-selectivity single-column indexes (typeId, priorityId, severityId, reporterId, parentId, epicId). Writing the report now.

```markdown
# Kiến trúc Scale Dữ liệu cho Tirapro

> Stack: NestJS 10 + Prisma + PostgreSQL 16 (pgvector + pg_trgm) + Redis 7 + Socket.io (@socket.io/redis-adapter) + BullMQ. Multi-tenant theo `Workspace` (`workspaceId` trên mọi entity). Đã có: cursor + offset pagination, ReportCache + SprintSnapshot, IssueHistory append-only, tsvector FTS + pgvector HNSW, soft-delete (`deletedAt`).
>
> **Nguyên tắc xuyên suốt: Ease-of-use là ưu tiên SỐ 1.** Mỗi quyết định scale phải bảo toàn read-your-writes, một source-of-truth (Postgres), onboarding tức thì, và deploy migration một lần. Không đánh đổi sự đơn giản để lấy "scale phòng xa".

---

## 1. Nguyên tắc & Lộ trình scale theo giai đoạn

### 1.1 Bốn nguyên tắc nền

1. **Đo trước, tối ưu sau.** Không partition/shard/externalize theo linh cảm. Mỗi bước nâng cấp phải gắn một *ngưỡng tín hiệu* (số dòng, p95 latency, QPS, số socket) đo được bằng telemetry.
2. **Đòn bẩy rẻ trước, hạ tầng đắt sau.** Thứ tự ưu tiên cố định: *index khớp access pattern → autovacuum/bloat tuning → cache → pre-aggregation → pooling → partition → read replica → sharding*. Không nhảy cóc.
3. **Một source-of-truth.** Postgres là chân lý; Redis chỉ là read-cache (cache-aside, không write-behind); search ở trong Postgres cho tới khi chạm ngưỡng thật. Điều này giữ read-your-writes — yếu tố trực tiếp của ease-of-use.
4. **Chuẩn bị rẻ, thực thi đắt để sau.** Một số quyết định *phải chốt sớm vì đổi sau rất đắt* (đặc biệt: PK của bảng append-only, đưa `workspaceId` vào index/unique). Nhưng *việc thực thi* (bật partition, bật RLS) thì hoãn tới ngưỡng.

### 1.2 Lộ trình theo giai đoạn

| Giai đoạn | Quy mô | Việc CẦN làm | Việc KHÔNG làm (tránh over-engineer) |
|---|---|---|---|
| **MVP** | < ~100k issue/tenant, 1 instance | Index khớp access pattern (P0), partial index soft-delete (P0), tenant-aware index + leading `workspaceId` (P0), cache-aside chuẩn hóa (P0), cursor pagination có tiebreaker (P0), sticky session cho Socket.io (P0) | Partition, RLS, PgBouncer, MV, external search, read replica |
| **Tăng trưởng** | ~100k → vài triệu issue, nhiều instance NestJS/worker | Autovacuum/fillfactor per-table (P1), PgBouncer transaction-mode (P1), transactional outbox (P1), BullMQ multi-queue + rate-limit (P1), RLS làm lưới phòng thủ (P1), hybrid search RRF (P1), HNSW iterative_scan cho filtered-ANN (P0 nếu đã dùng semantic) | Sharding, schema/DB-per-tenant, TimescaleDB, Elasticsearch |
| **Scale lớn** | 10M+ dòng ở bảng nóng (IssueHistory/ActivityLog), report nặng | **Bật** range-partition theo thời gian (P2 — PK đã chốt sẵn), retention bằng DROP PARTITION (P2), Materialized View refresh theo lịch (P2), read replica cho report/MV refresh (P2), sharded Socket.io adapter (P2) | Citus/sharding, Silo per-tenant (chỉ khi có tín hiệu cụ thể) |
| **Trần 1 node** | Vượt khả năng vertical scaling + replica | Cân nhắc Citus (shard theo `workspaceId`) hoặc tách tenant VIP ra Silo | — |

**Thông điệp chính:** Tirapro hiện ở MVP/đầu Tăng trưởng. Phần lớn giá trị nằm ở các mục **P0 chi phí thấp** (index + cache + pagination + realtime config). Partition/RLS/MV là *chuẩn bị thiết kế bây giờ, kích hoạt sau*.

---

## 2. PostgreSQL: Indexing + Partitioning + Pooling

### 2.1 Indexing — đòn bẩy lớn nhất, rẻ nhất (P0)

**Hiện trạng `Issue` (bảng nóng nhất): 14 index**, trong đó nhiều index single-column low-selectivity (`typeId`, `priorityId`, `severityId`, `reporterId`, `parentId`, `epicId`) hiếm khi dùng riêng — vừa làm chậm INSERT/UPDATE, vừa tốn dung lượng/bloat, vừa phá HOT update.

**Việc cần làm:**

1. **Bỏ index thừa / low-selectivity đứng một mình.** `typeId`, `priorityId`, `severityId` hiếm khi là điều kiện lọc đơn lẻ. Gộp vào composite khớp truy vấn thật hoặc bỏ. Giữ `parentId`/`epicId` chỉ nếu thực sự có query "lấy con theo parent".
2. **Đổi index sang tenant-aware (leading `workspaceId`).** Hiện `Issue` lead bằng `projectId` nhưng search/JQL/dashboard cross-project/notification lọc theo `workspaceId`. Trong mô hình Pool, mọi query nên bắt đầu bằng tenant_id. Composite phải lead bằng `workspaceId` để pruning hiệu quả. Ví dụ:
   - `@@index([workspaceId, statusId])`, `@@index([workspaceId, updatedAt])` cho board/list/dashboard cross-project.
   - Giữ `@@index([projectId, statusId])` cho board theo project.
3. **Partial index khớp soft-delete + cờ thưa** (Prisma không hỗ trợ `WHERE` → raw SQL migration, theo đúng pattern `01_pgvector_fts.sql` đã có):
   - `CREATE INDEX ... ON "Issue" (...) WHERE "deletedAt" IS NULL` — đa số query luôn kèm điều kiện này; index nhỏ hơn nhiều, cache tốt hơn.
   - `... WHERE "triageState" = 'PENDING'` cho triage queue.
   - `Notification`: `... WHERE "readAt" IS NULL` cho badge unread.
   - **Điều kiện sống còn:** middleware/`$extends` soft-delete phải LUÔN thêm `deletedAt IS NULL` để predicate khớp, planner mới dùng partial index.
4. **Covering / INCLUDE cho index-only scan** (raw SQL — Prisma chưa hỗ trợ `INCLUDE` trong `@@index`): cho board/backlog list chỉ cần vài cột:
   ```sql
   CREATE INDEX issue_board_covering
     ON "Issue" ("workspaceId", "projectId", "statusId")
     INCLUDE ("key", "summary", "assigneeId", "rank")
     WHERE "deletedAt" IS NULL;
   ```
5. **GIN/HNSW: giữ nguyên kỷ luật.** tsvector GIN + `gin_trgm_ops` + HNSW đã đúng. **Chỉ** thêm GIN trên JSONB (`settings`, `payload`, customField config) khi *chứng minh* có query containment nóng; dùng `jsonb_path_ops` nếu chỉ cần `@>`. `btree_gin` đã cài → cân nhắc GIN tổng hợp `(workspaceId, searchVector)` khi FTS thành điểm nóng theo tenant. **Không** index JSONB "phòng xa" đại trà — GIN đắt khi ghi (pending-list flush gây spike).

### 2.2 Autovacuum / Bloat tuning per-table (P1, raw SQL `ALTER TABLE SET`)

Bảng triệu dòng để mặc định `scale_factor=0.2` sẽ chờ 20% dòng chết mới vacuum → bloat + mất index-only scan; append-only không vacuum sẽ dính TXID wraparound.

| Nhóm bảng | Cấu hình | Lý do |
|---|---|---|
| Append-only: `IssueHistory`, `ActivityLog`, `Notification`, `AiGenerationLog` | `autovacuum_vacuum_insert_scale_factor=0.02`, `autovacuum_vacuum_insert_threshold` hợp lý | Cập nhật Visibility Map cho index-only scan (report), freeze sớm chống wraparound |
| Update nhiều: `Issue` (đổi status/assignee/version liên tục) | `fillfactor=90`, `autovacuum_vacuum_scale_factor=0.05` | Bật HOT update, giữ dead tuple thấp. **HOT chỉ hiệu lực nếu cột bị update KHÔNG bị index** → liên hệ §2.1 (bỏ index cột hay đổi) |

Theo dõi `pg_stat_user_tables` (`n_dead_tup`, `n_live_tup`). Tránh chỉnh quá tay khiến autovacuum chạy liên tục.

### 2.3 Partitioning — bảng nào, theo gì (P1 chuẩn bị / P2 kích hoạt)

**Quyết định:** range partition theo **thời gian** cho **đúng 2 bảng append-only nóng nhất: `IssueHistory` (theo `occurredAt`) và `ActivityLog` (theo `createdAt`)**, partition theo **tháng**. KHÔNG partition toàn schema. KHÔNG list/hash-partition theo `workspaceId` (SaaS nhiều tenant nhỏ → quá nhiều partition, tăng planning time, phản tác dụng).

**Chốt NGAY (rẻ khi bảng còn nhỏ, rất đắt khi đã lớn):** đổi PK chứa cột thời gian.
- Hiện `IssueHistory`/`ActivityLog` (và cả `Issue`) dùng PK `id @default(cuid())` đơn → **ràng buộc partition: partition key PHẢI nằm trong mọi PK/UNIQUE.** Phải đổi sang `@@id([occurredAt, id])` / `@@id([createdAt, id])`.
- Quyết định này phải làm sớm vì đổi PK trên bảng nhiều triệu dòng về sau cực đắt.

**Khi BẬT (đạt ~10–20M dòng/bảng hoặc p95 report vượt mục tiêu):**
- Quản lý qua raw SQL + `prisma migrate dev --create-only`, model Prisma map vào **BẢNG CHA** (không khai báo partition con, nếu không migrate sau sẽ sinh `DROP PARTITION`). Lưu ý shadow DB và trùng tên index.
- Tự động hóa bằng **BullMQ repeatable job** (không dùng pg_partman — tránh phụ thuộc extension, giữ logic trong TS): tạo partition tháng kế tiếp + `DROP`/`DETACH` partition quá hạn.
- Giữ index lead `workspaceId` trên từng partition để vừa pruning theo thời gian vừa lọc tenant.

### 2.4 Pooling — PgBouncer transaction-mode (P1, khi lên nhiều instance)

Tirapro có nhiều nguồn kết nối (NestJS instances + Socket.io redis-adapter + BullMQ worker) → dễ cạn `max_connections` *trước khi* cạn CPU/RAM.

- Đặt **PgBouncer transaction mode** trước Postgres.
- `DATABASE_URL` = chuỗi pooled (PgBouncer ≥ 1.21 + `max_prepared_statements>0` → **không** cần `?pgbouncer=true`; nếu < 1.21 thì thêm flag, Prisma sẽ tắt named prepared statements).
- `DIRECT_URL` = kết nối trực tiếp cho `prisma migrate`.
- **Giữ `connection_limit` của Prisma ở mặc định** (`num_cpus*2+1`) — nâng vô tội vạ là nguyên nhân phổ biến gây quá tải DB.
- Transaction mode mất session state sau mỗi tx (SET, named prepared stmt, advisory lock, temp table) → đây cũng chính là điều kiện để RLS `SET LOCAL` hoạt động an toàn (§3.3).

---

## 3. Multi-tenancy: Isolation + chống Noisy-Neighbor

### 3.1 Giữ mô hình Pool (shared-DB + `workspaceId`) — KHÔNG đổi (P0)

Tirapro đã đúng: `workspaceId` trên mọi entity, `@@unique([workspaceId, key])`. Đây là lựa chọn tối ưu cho SaaS nhiều tenant data vừa/nhỏ (AWS/Crunchy/PlanetScale): onboard = chỉ INSERT, deploy migration 1 lần, cross-workspace reporting rẻ. **Không** chuyển schema-per-tenant (Prisma + schema động là điểm đau lớn, pg_catalog phình) hay DB-per-tenant (cạn connection ngay). Không có tín hiệu nào (số tenant, data size, compliance) buộc phải tách.

### 3.2 Enforce isolation tập trung (P0)

Vấn đề thực tế cần vá: isolation hiện chỉ dựa app-code → dễ rò nếu **quên 1 `where workspaceId`**.

- Dùng **Prisma `$extends`/middleware + AsyncLocalStorage** tự động chèn `where workspaceId` cho mọi đọc/ghi (lấy wsId từ request context), thay vì rải rác ở từng service.
- **Bắt buộc** áp cho cả **BullMQ worker** và **raw query** (pgvector/tsvector) — đây là nơi dễ quên nhất.
- Loại bỏ cả class lỗi "quên where workspaceId" + giữ code sạch.

### 3.3 RLS làm lưới phòng thủ thứ 2 (P1)

Defense-in-depth: nếu app guard sót, DB vẫn chặn rò cross-tenant.

- `ENABLE` + **`FORCE ROW LEVEL SECURITY`** cho các bảng nhạy cảm nhất: `Issue`, `Comment`, `Attachment`, `IssueHistory`, `ActivityLog`, `Notification`, `IssueEmbedding`.
- Policy: `USING ("workspaceId" = current_setting('app.current_workspace'))`.
- App connect bằng **role KHÔNG phải owner**.
- Set context qua Prisma `$extends $allOperations`: mở transaction → `set_config('app.current_workspace', wsId, true)` (LOCAL = chỉ sống trong tx) → chạy query. **Chỉ an toàn ở PgBouncer transaction-mode**, không phải statement-mode.
- P1 (không P0) vì phải kiểm thử kỹ tương tác pooler + raw SQL pgvector/tsvector + BullMQ context; cấu hình sai dễ silent-fail. RLS bổ sung chứ không thay app-level filtering.

### 3.4 Chống noisy-neighbor ở tầng rẻ (P1)

Pool không loại bỏ noisy-neighbor nhưng giảm mạnh bằng:
- `statement_timeout` (vd 100–300ms cho path tương tác, cao hơn cho job nền) + `idle_in_transaction_session_timeout`.
- Giới hạn concurrency/connection theo workspace ở app/PgBouncer.
- Đẩy report nặng sang **read replica** (tương lai) + tận dụng **ReportCache/SprintSnapshot/Redis** sẵn có.
- Cô lập job nặng (import/export/embedding) vào **BullMQ queue riêng concurrency thấp**.

### 3.5 Tín hiệu graduate (đừng tách theo cảm tính) (P2)

Tách 1 tenant ra Silo/DB riêng CHỈ khi: (i) tenant tiêu thụ tài nguyên áp đảo dù đã có timeout/limit; HOẶC (ii) yêu cầu compliance/KMS key riêng; HOẶC (iii) một bảng tiến gần trần (TOAST OID ~4 tỷ). Cân nhắc Citus chỉ khi 1 node hết đường sau khi đã vắt kiệt index + partition + replica + cache. Mô hình mục tiêu thực dụng: **Pool cho đa số + Silo cho vài tenant VIP** (đã có `Workspace.plan` để phân tier). *Lưu ý Citus:* nhiều `@@id`/`@@unique` hiện KHÔNG chứa `workspaceId` (vd `IssueLabel`, `BoardColumnStatus`, `RolePermission`, các unique cấp project) → phải refactor trước khi shard. Hành động rẻ NGAY mở đường: tập thói quen lọc `workspaceId` + đưa `workspaceId` vào index/unique chính.

---

## 4. History/Activity + Analytics

### 4.1 Validate ReportCache / SprintSnapshot — phân định rạch ròi (P1)

Hai cơ chế pre-aggregation đã tồn tại nhưng dễ dùng lẫn → dữ liệu báo cáo lệch. Định nghĩa rõ trong tài liệu module Analytics:

| Cơ chế | Vai trò | Cơ chế cập nhật |
|---|---|---|
| **ReportCache** | Payload báo cáo đã render theo request (`cacheKey`) | TTL qua `expiresAt` (đã có index `expiresAt`) + **BullMQ job dọn cache hết hạn** + invalidation khi sprint/issue đổi |
| **SprintSnapshot** | Chuỗi điểm burndown/scope theo thời gian, immutable, append theo `kind` | Sinh bởi **BullMQ repeatable job** (kind=DAILY) + tại sự kiện sprint START/CLOSE/SCOPE_CHANGE |
| **Materialized View** (tương lai) | Tổng hợp SQL-shaped tái dùng nhiều scope (velocity, throughput, lead/cycle time) | `REFRESH ... CONCURRENTLY` theo lịch BullMQ |

### 4.2 Light CQRS read model — mở rộng pre-aggregation (P0/P1)

Hợp thức hóa pattern đã có (write vào `Issue`, đọc report từ pre-aggregation):
- Thêm **bảng rollup cấp project/ngày** cho CFD và created-vs-resolved: group theo `newCategory`/ngày từ `IssueHistory`, **cập nhật incremental theo watermark** (`occurredAt > last_processed`) — chỉ chạm dòng MỚI, rẻ hơn refresh-all nhiều lần ở quy mô lớn.
- Tất cả refresh **chạy nền** → đường ghi `IssueHistory` giữ nhanh, không trigger đồng bộ.
- `IssueHistory` append-only = nguồn **replay** khi đổi công thức (backfill re-derive).
- Ranh giới: report đọc từ read model (eventual consistency OK); **board/issue detail đọc trực tiếp OLTP** (không chấp nhận trễ).

### 4.3 KHÔNG dùng (over-engineering ở giai đoạn này)

- **Full Event Sourcing:** Tirapro đã có "current-state model (`Issue`) + audit log replay được (`IssueHistory`/`ActivityLog`)" = điểm cân bằng đúng. Biến event log thành source-of-truth là over-engineering kinh điển.
- **pg_ivm:** làm chậm ghi base table (trigger mỗi insert) — mâu thuẫn ưu tiên ingest nhanh của bảng append-only; là extension bên thứ 3.
- **TimescaleDB:** `IssueHistory`/`ActivityLog` là *business audit events* (cần FK tới `Issue`, đa chiều theo project/sprint/field), không phải metrics thuần → lợi ích chunk/nén không tương xứng. Mô phỏng continuous aggregate bằng MV + rollup tự viết.

### 4.4 Partition + Retention/Archival (P2 — phụ thuộc §2.3)

- Retention chỉ rẻ & an toàn KHI đã partition: xóa cũ = `DROP TABLE partition` (tức thì) thay vì `DELETE` triệu dòng (bloat/lock/VACUUM).
- Gắn retention theo `Workspace.plan` (FREE/PRO/ENTERPRISE) — **không** xóa nhầm dữ liệu khách trả tiền.
- **Pre-aggregate + SprintSnapshot TRƯỚC khi archival** để report lịch sử vẫn đọc được sau khi raw history bị drop.
- **Tuyệt đối không** drop history của sprint chưa đóng / đang trong cửa sổ báo cáo.
- Dữ liệu cần giữ lạnh: `DETACH PARTITION CONCURRENTLY` (tránh giờ cao điểm) → export ra object storage (tái dùng `ExportJob` với `includeHistory`).

---

## 5. Search Scale + Ngưỡng Externalize

### 5.1 Giữ Postgres làm hệ search duy nhất (P0)

Ở quy mô Tirapro (vài trăm nghìn–vài triệu issue, multi-tenant lọc trước `workspaceId`, QPS khiêm tốn), Postgres FTS+pgvector phục vụ tốt (p50 ~45ms vs ES ~35ms — chênh không đáng đánh đổi vận hành + mất read-your-writes). **Không** thêm Elasticsearch/Meilisearch/Typesense lúc này.

### 5.2 Cứng hóa tsvector hiện có (P0)

- Đảm bảo là cột **`GENERATED ALWAYS AS (...) STORED` + GIN index**, KHÔNG `to_tsvector()` on-the-fly mỗi query.
- `setweight`: A=`summary`/`key`, B=`description`, C=comment.
- **Mọi search query BẮT BUỘC pre-filter `workspaceId` (+ structured JQL filter) và LIMIT sớm TRƯỚC `ts_rank`.** Đây là cú né hoàn toàn cú sập latency: `ts_rank` không có corpus-global stats (không phải BM25 thật), sort top-N trên 10M dòng không lọc có thể tới ~38s. Pre-filter theo tenant giữ tập rank nhỏ.

### 5.3 Sửa filtered-ANN cho pgvector multi-tenant (P0 nếu đang dùng semantic)

Cạm bẫy lớn nhất: HNSW lấy top-k TRƯỚC rồi mới áp `WHERE workspaceId` → kết quả đúng tenant bị loại, recall tụt **âm thầm không báo lỗi**.
- Index cột `workspaceId` (đã có `@@index([workspaceId])` trên `IssueEmbedding` — tốt).
- Bật `hnsw.iterative_scan` (`relaxed_order` cho recall, `strict_order` khi cần đúng thứ tự khoảng cách), HOẶC partial/partition index theo tenant.

### 5.4 HNSW tuning (P1)

- Khởi đầu `m=16`, `ef_construction=64` (phải ≥ `2*m`). Thiếu recall → tăng `ef_construction` trước, `m` sau.
- Per-query: `SET LOCAL hnsw.ef_search` (vd 80–100) để đổi recall/latency theo từng tính năng (Cmd+K latency-nhạy vs dedupe/RAG recall-nhạy dùng chung index) — đưa các `SET` này vào layer raw query của Prisma.
- Build: sau khi load data, `maintenance_work_mem` cao (4–8GB) + `max_parallel_maintenance_workers`; dùng **`halfvec`** giảm ~50% storage; đảm bảo index nằm trong RAM (1M vector ~8GB).

### 5.5 Hybrid search RRF (P1)

Cho global search/Cmd+K + AI retrieval (KHÔNG cho JQL filter thuần structured): mỗi nhánh (tsvector + pgvector) lấy top ~20 → `UNION ALL` → `SUM(1/(60+rank))` → `ORDER BY LIMIT`. Cân nhắc weighted RRF (lexical nặng hơn cho query có issue key; semantic nặng hơn cho ngôn ngữ tự nhiên). Nâng precision đáng kể (~62% → ~84% thực nghiệm) mà vẫn trong Postgres.

### 5.6 Lộ trình leo thang + ngưỡng (P2)

Telemetry cảnh báo: p95 search > ~300–500ms kéo dài; số doc cần rank sau filter chạm hàng triệu; QPS tiến hàng nghìn; typo-tolerance/faceting thành yêu cầu hạng nhất. Khi chạm → leo thang theo thứ tự:
**Postgres FTS → hybrid RRF → pg_search/ParadeDB (BM25 trong Postgres, nếu deploy cho cài extension) → Meilisearch/Typesense (khi instant-search là khác biệt sản phẩm) → Elasticsearch/OpenSearch (khi cần scale phân tán + analytics-search).** Nếu phải sync external, dùng **BullMQ** index bất đồng bộ, chấp nhận eventual consistency có chủ đích.

---

## 6. Caching / Realtime / Pagination / Async

### 6.1 Caching — cache-aside chuẩn hóa (P0)

- Một **`CacheService`/interceptor NestJS** duy nhất: cache-aside (lazy load) + **delete-on-write** invalidation. Postgres là source-of-truth.
- **Key LUÔN embed `workspaceId`** (chống rò cross-tenant) + **jittered TTL backstop** mọi key (missed invalidation tự lành).
- **Không bao giờ `KEYS`/`SCAN`-delete trên request path.**
- KHÔNG dùng write-behind (mâu thuẫn source-of-truth). Write-through chỉ cho vài key hot read-dominated.

**Versioned keys cho list/aggregate (P0):** một issue edit fan-out tới nhiều board/backlog/JQL/dashboard. Thay vì liệt kê & xóa từng key → **bump version counter** per-board/per-filter (`ws:{id}:board:{boardId}:v{n}`), key cũ age-out qua TTL (O(1) mass invalidation, zero-downtime). Giữ direct-delete cho key detail của chính entity.

**Stampede protection + Redis-down fallback (P1):** per-key lock ngắn hoặc recompute-ahead khi gần hết hạn; Redis down → degrade về Prisma trực tiếp thay vì lỗi.

### 6.2 Pagination — validate cursor (P0)

Tirapro đã đúng (cursor pagination). Cần audit:
1. **Mỗi keyset query có composite index khớp ĐÚNG ORDER BY tuple** (thiếu → silently fallback scan).
2. **Cursor LUÔN có tiebreaker unique** `(sort_col, id)`, không bao giờ chỉ `created_at` đơn (rows skip/duplicate giữa các trang).
3. Encode cursor base64 opaque. Offset/limit **chỉ** giữ cho admin/config list ngắn + UI numbered-page.

### 6.3 Realtime — Socket.io (P0 config)

Tirapro đã đúng (`@socket.io/redis-adapter`). Gap P0:
- **Sticky sessions BẮT BUỘC** ở LB/ingress (cookie- hoặc IP-hash affinity) — redis-adapter chỉ là messaging layer, KHÔNG bỏ yêu cầu này; thiếu affinity → client reconnect hit node lạ → HTTP 400.
- **Scope room hẹp:** `workspace:{id}`, `board:{id}`, `issue:{id}` → fan-out narrow.
- Reconnection/backoff phía client.
- **Sharded Redis adapter (Redis 7+) là P2 metrics-gated:** swap khi per-instance socket tiến ~10k–30k hoặc Pub/Sub cross-node traffic chiếm ưu thế. Không adopt sớm.

### 6.4 Async — Transactional Outbox + BullMQ (P1)

**Outbox (P1, cần trước khi integration ship):** notifications/Telegram/digest/Jira-sync là user-visible, không được drop. Ghi **outbox row trong CÙNG Prisma transaction** với domain mutation (hoặc tái dùng `IssueHistory` làm log) → **BullMQ repeatable polling-publisher** đọc row chưa publish → dispatch → mark sent. Consumer **idempotent** (dedupe theo event id, vì at-least-once); partial index trên row chưa publish. Dùng polling-publisher (không CDC/Debezium) cho stack này. **Direct emit fire-and-forget** chỉ cho ephemeral (typing/presence) — vạch rõ ranh giới lossy vs durable để tránh over-apply outbox.

**BullMQ multi-queue (P1):** tách queue theo domain `{outbox, reindex, reports, notifications, jira-import}` (không 1 mega-queue). Concurrency 100–300 cho IO-bound (reindex/notifications/outbox); concurrency thấp + nhiều worker instance cho CPU-bound recompute (raising concurrency chỉ giúp IO-bound). **Global rate limiter** (`max/duration`, job bị limit nằm `waiting` không `failed`) trên queue `notifications`/`jira-import` để tôn trọng giới hạn API bên thứ 3.

### 6.5 Eventual-consistency hygiene (P2)

Idempotency key trên consumer + write API; field `version`/`updatedAt` monotonic reject stale optimistic update (Issue đã có `version`); policy lossy (presence → direct emit) vs durable (→ outbox) viết thành tài liệu.

---

## 7. BẢNG KHUYẾN NGHỊ TỔNG HỢP

### 7.1 Ma trận hạng mục

| # | Hạng mục | Đã có? / Cần thêm | Khi nào áp dụng | Ưu tiên |
|---|---|---|---|---|
| 1 | Tinh gọn index `Issue` (bỏ single-col low-selectivity `typeId`/`priorityId`/`severityId`...) | Cần sửa (đang 14 index) | Ngay (schema còn hoàn thiện) | **P0** |
| 2 | Tenant-aware index (leading `workspaceId`) | Cần thêm | Ngay | **P0** |
| 3 | Partial index `WHERE deletedAt IS NULL` / `triageState='PENDING'` / `readAt IS NULL` | Cần thêm (raw SQL) | Ngay | **P0** |
| 4 | Covering/INCLUDE index cho board/backlog list | Cần thêm (raw SQL) | Ngay | **P0** |
| 5 | Enforce isolation tập trung (`$extends`/ALS, cả worker + raw SQL) | Cần thêm | Ngay | **P0** |
| 6 | Cache-aside chuẩn hóa + key embed `workspaceId` + TTL jitter | Cần chuẩn hóa | Ngay | **P0** |
| 7 | Versioned cache key cho list/aggregate | Cần thêm | Ngay | **P0** |
| 8 | Audit cursor pagination (index khớp ORDER BY + tiebreaker) | Đã có cursor — cần audit | Ngay | **P0** |
| 9 | Sticky session + scope room hẹp Socket.io | Đã có adapter — cần config | Ngay | **P0** |
| 10 | tsvector stored generated + GIN, pre-filter `workspaceId` + LIMIT sớm | Đã có FTS — cần cứng hóa | Ngay | **P0** |
| 11 | pgvector filtered-ANN: `iterative_scan` + index `workspaceId` | Cần thêm | Ngay (nếu dùng semantic) | **P0** |
| 12 | Đổi PK `IssueHistory`/`ActivityLog` → `([thời_gian, id])` | Cần sửa (đang `id` đơn) | Ngay (chốt sớm, đổi sau rất đắt) | **P0/P1** |
| 13 | Autovacuum/fillfactor per-table | Cần thêm (raw SQL) | Khi bảng tới triệu dòng | **P1** |
| 14 | PgBouncer transaction-mode + DATABASE_URL/DIRECT_URL | Cần thêm | Khi lên nhiều instance | **P1** |
| 15 | RLS lưới phòng thủ (FORCE, bảng nhạy cảm) | Cần thêm | Sau PgBouncer (cần tx-mode) | **P1** |
| 16 | Chống noisy-neighbor (statement_timeout, queue cô lập) | Một phần (BullMQ) | Khi có tenant nặng | **P1** |
| 17 | Transactional outbox + idempotent consumer | Cần thêm | Trước khi integration ship | **P1** |
| 18 | BullMQ multi-queue + rate limiter | Một phần | Khi có nhiều loại job | **P1** |
| 19 | Light CQRS rollup table (CFD/throughput, watermark) | Mở rộng từ SprintSnapshot | Khi report nặng xuất hiện | **P1** |
| 20 | Hybrid search RRF + HNSW per-query tuning | Cần thêm | Khi cần search "thông minh" | **P1** |
| 21 | Phân định ReportCache/SprintSnapshot/MV + dọn cache job | Cần tài liệu hóa + job | Sớm (rẻ) | **P1** |
| 22 | **Bật** range-partition theo thời gian (IssueHistory/ActivityLog) | Chuẩn bị PK ngay, bật sau | ~10–20M dòng/bảng | **P2** |
| 23 | Retention/archival bằng DROP/DETACH PARTITION theo plan | Cần thêm | Sau khi partition | **P2** |
| 24 | Materialized View + REFRESH CONCURRENTLY theo BullMQ | Cần thêm | Khi report tổng hợp nặng | **P2** |
| 25 | Read replica cho report/MV refresh | Cần thêm | Khi report cạnh tranh OLTP | **P2** |
| 26 | Sharded Socket.io adapter (Redis 7+) | Đã có Redis 7 — swap sau | ~10k–30k socket/instance | **P2** |
| 27 | Citus / Silo per-tenant | KHÔNG làm | Chỉ khi chạm trần 1 node / tín hiệu cụ thể | **P2** |
| 28 | GIN JSONB | KHÔNG đại trà | Chỉ khi chứng minh query containment nóng | **P2** |

### 7.2 Đề xuất chỉnh schema Prisma (cụ thể)

```prisma
// Issue: tinh gọn + tenant-aware (giữ unique sẵn có)
model Issue {
  // ... fields giữ nguyên ...
  @@unique([projectId, number])
  @@unique([workspaceId, key])
  @@index([workspaceId, statusId])      // THÊM: board/list cross-project
  @@index([workspaceId, updatedAt])     // THÊM: dashboard/activity cross-project
  @@index([projectId, statusId])        // GIỮ: board theo project
  @@index([projectId, deletedAt])       // GIỮ
  @@index([projectId, triageState])     // GIỮ
  @@index([sprintId])                   // GIỮ
  @@index([assigneeId])                 // GIỮ (lọc "của tôi")
  @@index([rank])                       // GIỮ (backlog order)
  @@index([fingerprint])                // GIỮ (dedupe)
  // BỎ: [reporterId] [parentId] [epicId] [typeId] [priorityId] [severityId]
  //     (low-selectivity / hiếm dùng riêng — gộp vào composite khi có query thật)
}

// Chốt PK chứa cột thời gian NGAY (đổi sau rất đắt) — mở đường partition
model IssueHistory {
  id         String   @default(cuid())
  occurredAt DateTime @default(now())
  // ...
  @@id([occurredAt, id])   // thay cho @id đơn trên id
}
model ActivityLog {
  id        String   @default(cuid())
  createdAt DateTime @default(now())
  // ...
  @@id([createdAt, id])
}
```

Các thứ Prisma KHÔNG quản (partial/covering index, `ALTER TABLE SET`, MV, partition, RLS) → đặt trong **raw SQL migration** theo đúng pattern `prisma/sql/01_pgvector_fts.sql` đã có, kèm `prisma migrate dev --create-only`.

### 7.3 Đề xuất docker-compose / infra (cụ thể)

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16          # GIỮ (đã có pgvector)
    command:                                 # THÊM: nới mem cho build HNSW + autovacuum tốt hơn
      - "postgres"
      - "-c"
      - "maintenance_work_mem=2GB"
      - "-c"
      - "max_parallel_maintenance_workers=4"
      - "-c"
      - "shared_buffers=2GB"
    # ... giữ healthcheck/volumes ...

  pgbouncer:                                 # THÊM (P1, khi nhiều instance)
    image: edoburu/pgbouncer:latest          # hỗ trợ PgBouncer ≥1.21
    environment:
      DB_HOST: postgres
      POOL_MODE: transaction                 # bắt buộc cho RLS SET LOCAL + Prisma
      MAX_PREPARED_STATEMENTS: "200"         # ≥1.21 → KHÔNG cần ?pgbouncer=true
      AUTH_TYPE: scram-sha-256
    depends_on:
      postgres:
        condition: service_healthy
    ports: ["6432:6432"]

  redis:
    image: redis:7-alpine                    # GIỮ (Redis 7 → sẵn sàng sharded adapter sau)
```

**Biến môi trường ứng dụng (khi bật PgBouncer):**
```
DATABASE_URL=postgresql://app_user:...@pgbouncer:6432/tirapro   # role NON-OWNER cho RLS
DIRECT_URL=postgresql://tirapro:...@postgres:5432/tirapro        # cho prisma migrate
```

**Infra bổ sung theo giai đoạn:** LB/ingress bật **sticky session** (cookie/IP-hash) cho Socket.io (P0); read replica Postgres khi report cạnh tranh OLTP (P2); object storage cho archival export (P2).

---

## Nguồn

**PostgreSQL core:** [Ch.11 Indexes](https://www.postgresql.org/docs/current/indexes.html), [11.8 Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html), [5.12 Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html), [24.1 Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html), [REFRESH MATERIALIZED VIEW](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html), [12.9 Text Search Index Types](https://www.postgresql.org/docs/current/textsearch-indexes.html).

**Index/vacuum/GIN:** pganalyze [GIN indexes](https://pganalyze.com/blog/gin-index), [covering/multicolumn benchmarking](https://pganalyze.com/blog/5mins-postgres-benchmarking-indexes); Crunchy [insert-only autovacuum](https://www.crunchydata.com/blog/insert-only-tables-and-autovacuum-issues-prior-to-postgresql-13); Cybertec [autovacuum insert-only](https://www.cybertec-postgresql.com/en/postgresql-autovacuum-insert-only-tables/); Tiger [when to partition](https://www.tigerdata.com/learn/when-to-consider-postgres-partitioning).

**Prisma/pooling:** [PgBouncer config](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer); Crunchy [prepared stmt tx-mode](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer); pganalyze [PgBouncer 1.21](https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode); Prisma partition issues [#13407](https://github.com/prisma/prisma/issues/13407), [#28940](https://github.com/prisma/prisma/issues/28940).

**Multi-tenancy:** AWS [partitioning models](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/partitioning-models.html), [decision matrix](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/matrix.html), [RLS isolation](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/); Crunchy [multi-tenancy design](https://www.crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy); PlanetScale [Postgres tenancy](https://planetscale.com/blog/approaches-to-tenancy-in-postgres); Prisma [RLS extension](https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security); Neon [noisy neighbor](https://neon.com/blog/noisy-neighbor-multitenant); Citus [distribution column](https://docs.citusdata.com/en/stable/sharding/data_modeling.html), [multi-tenant sharding](https://docs.citusdata.com/en/stable/articles/sharding_mt_app.html).

**History/analytics:** pg_ivm [repo](https://github.com/sraoss/pg_ivm) & [pganalyze](https://pganalyze.com/blog/5mins-postgres-15-beta1-incremental-materialized-views-pg-ivm); Citus [incremental aggregation](https://www.citusdata.com/blog/2018/06/14/scalable-incremental-data-aggregation/); Crunchy [pg_incremental](https://www.crunchydata.com/blog/pg_incremental-incremental-data-processing-in-postgres); Tiger [continuous aggregates](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates); Azure [Event Sourcing pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing); [CQRS without ES](https://medium.com/@mbue/some-thoughts-on-using-cqrs-without-event-sourcing-938b878166a2); AWS RDS [pg_partman](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_Partitions.html).

**Search:** Neon [Postgres vs ES vs pg_search](https://neon.com/blog/postgres-full-text-search-vs-elasticsearch); [PostgreSQL FTS replaced ES](https://msezer.dev/articles/postgresql-full-text-search); Crunchy [HNSW + pgvector](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector); [pgvector](https://github.com/pgvector/pgvector); Google Cloud [pgvector index perf](https://cloud.google.com/blog/products/databases/faster-similarity-search-performance-with-pgvector-indexes/); ParadeDB [hybrid search manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual); [RRF hybrid for RAG](https://dev.to/lpossamai/building-hybrid-search-for-rag-combining-pgvector-and-full-text-search-with-reciprocal-rank-fusion-6nk); Meilisearch [vs Typesense](https://www.meilisearch.com/blog/elasticsearch-vs-typesense); Tiger [10 ES issues Postgres avoids](https://www.tigerdata.com/blog/10-elasticsearch-production-issues-how-postgres-avoids-them).

**Cache/realtime/async:** AWS [Redis caching patterns](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html); Azure [cache-aside](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside); Redis [cache invalidation](https://redis.io/glossary/cache-invalidation/), [consistency](https://redis.io/blog/three-ways-to-maintain-cache-consistency/); Sequin [keyset cursors](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/); Citus [five ways to paginate](https://www.citusdata.com/blog/2016/03/30/five-ways-to-paginate/); Socket.IO [Redis adapter](https://socket.io/docs/v4/redis-adapter/); Ably [scaling Socket.IO](https://ably.com/topic/scaling-socketio); microservices.io [transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html); AWS [outbox pattern](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html); BullMQ [parallelism/concurrency](https://docs.bullmq.io/guide/parallelism-and-concurrency), [rate limiting](https://docs.bullmq.io/guide/rate-limiting).
```

---

## Nguồn (67)

- [PostgreSQL Documentation: 5.12. Table Partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [PostgreSQL Documentation: 11.8. Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html)
- [PostgreSQL Documentation: Chapter 11. Indexes](https://www.postgresql.org/docs/current/indexes.html)
- [PostgreSQL Documentation: 24.1. Routine Vacuuming](https://www.postgresql.org/docs/current/routine-vacuuming.html)
- [pganalyze: Understanding Postgres GIN Indexes — The Good and the Bad](https://pganalyze.com/blog/gin-index)
- [pganalyze: Benchmarking multi-column, covering and hash indexes in Postgres](https://pganalyze.com/blog/5mins-postgres-benchmarking-indexes)
- [pganalyze: PgBouncer 1.21 adds prepared statement support in transaction mode](https://pganalyze.com/blog/5mins-postgres-pgbouncer-prepared-statements-transaction-mode)
- [Crunchy Data: Insert-Only Tables and Autovacuum Issues Prior to PostgreSQL 13](https://www.crunchydata.com/blog/insert-only-tables-and-autovacuum-issues-prior-to-postgresql-13)
- [Crunchy Data: Prepared Statements in Transaction Mode for PgBouncer](https://www.crunchydata.com/blog/prepared-statements-in-transaction-mode-for-pgbouncer)
- [Prisma Docs: Configure Prisma Client with PgBouncer](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer)
- [Prisma GitHub #28940: Official support for PostgreSQL partitioned tables](https://github.com/prisma/prisma/issues/28940)
- [Prisma GitHub #13407: Prisma migrate drops manually created partitioned tables](https://github.com/prisma/prisma/issues/13407)
- [Citus Data: Understanding partitioning and sharding in Postgres and Citus](https://www.citusdata.com/blog/2023/08/04/understanding-partitioning-and-sharding-in-postgres-and-citus/)
- [Citus Data: Sharding a multi-tenant app with Postgres](https://www.citusdata.com/blog/2016/08/10/sharding-for-a-multi-tenant-app-with-postgres/)
- [Tiger Data (Timescale): When to Consider Postgres Partitioning](https://www.tigerdata.com/learn/when-to-consider-postgres-partitioning)
- [Cybertec: PostgreSQL v13 — tuning autovacuum on insert-only tables](https://www.cybertec-postgresql.com/en/postgresql-autovacuum-insert-only-tables/)
- [AWS Prescriptive Guidance — Multi-tenant SaaS partitioning models for PostgreSQL](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/partitioning-models.html)
- [AWS Prescriptive Guidance — Decision matrix (silo vs bridge-db vs bridge-schema vs pool)](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/matrix.html)
- [AWS Database Blog — Multi-tenant data isolation with PostgreSQL Row Level Security](https://aws.amazon.com/blogs/database/multi-tenant-data-isolation-with-postgresql-row-level-security/)
- [AWS Well-Architected SaaS Lens — Silo, Pool, and Bridge Models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html)
- [Citus — Sharding a Multi-Tenant App with Postgres (tenant_id distribution & co-location)](https://docs.citusdata.com/en/stable/articles/sharding_mt_app.html)
- [Citus — Choosing the Distribution Column](https://docs.citusdata.com/en/stable/sharding/data_modeling.html)
- [Crunchy Data — Designing Your Postgres Database for Multi-tenancy](https://www.crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy)
- [PlanetScale — Approaches to tenancy in Postgres (tenant-aware indexing, RLS caveats)](https://planetscale.com/blog/approaches-to-tenancy-in-postgres)
- [Prisma Client Extensions — Row-Level Security example (set_config LOCAL in transaction)](https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security)
- [Neon — The Noisy Neighbor Problem in Multitenant Architectures](https://neon.com/blog/noisy-neighbor-multitenant)
- [Rico Fritzsche — Mastering PostgreSQL Row-Level Security (RLS) for Multi-Tenancy (SET LOCAL + pgbouncer)](https://ricofritzsche.me/mastering-postgresql-row-level-security-rls-for-rock-solid-multi-tenancy/)
- [Prisma — Limitations and known issues (Prisma Migrate)](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues)
- [PostgreSQL Documentation — REFRESH MATERIALIZED VIEW (CONCURRENTLY semantics)](https://www.postgresql.org/docs/current/sql-refreshmaterializedview.html)
- [PostgreSQL Wiki — Incremental View Maintenance (IVM)](https://wiki.postgresql.org/wiki/Incremental_View_Maintenance)
- [pg_ivm — Incremental View Maintenance extension (sraoss), PG13–18; IMMV slows base-table writes](https://github.com/sraoss/pg_ivm)
- [pganalyze — Incremental Materialized Views with pg_ivm](https://pganalyze.com/blog/5mins-postgres-15-beta1-incremental-materialized-views-pg-ivm)
- [AWS RDS — Managing PostgreSQL partitions with pg_partman](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL_Partitions.html)
- [Tiger Data (Timescale) — About continuous aggregates (incremental refresh, real-time aggregate)](https://www.tigerdata.com/docs/use-timescale/latest/continuous-aggregates/about-continuous-aggregates)
- [Tiger Data (Timescale) — Understand hypertables (auto-chunking vs native partitioning)](https://www.tigerdata.com/docs/use-timescale/latest/hypertables)
- [Timescale — Testing Your Chunk Size (chunk ~25% RAM sizing rule)](https://www.tigerdata.com/blog/timescale-cloud-tips-testing-your-chunk-size)
- [Microsoft Azure Architecture Center — Event Sourcing pattern (when to use / when not)](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing)
- [Marco Bürckel — Some thoughts on using CQRS without Event Sourcing (light CQRS)](https://medium.com/@mbue/some-thoughts-on-using-cqrs-without-event-sourcing-938b878166a2)
- [Citus Data — Scalable incremental data aggregation on Postgres (watermark/incremental rollup)](https://www.citusdata.com/blog/2018/06/14/scalable-incremental-data-aggregation/)
- [Crunchy Data — pg_incremental: Incremental Data Processing in Postgres](https://www.crunchydata.com/blog/pg_incremental-incremental-data-processing-in-postgres)
- [Comparing Native Postgres, ElasticSearch, and pg_search for Full-Text Search — Neon](https://neon.com/blog/postgres-full-text-search-vs-elasticsearch)
- [PostgreSQL Full Text Search: Why We Replaced Elasticsearch — Mehmet Sezer](https://msezer.dev/articles/postgresql-full-text-search)
- [PostgreSQL Documentation 18: 12.9 Preferred Index Types for Text Search](https://www.postgresql.org/docs/current/textsearch-indexes.html)
- [HNSW Indexes with Postgres and pgvector — Crunchy Data](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector)
- [pgvector — Open-source vector similarity search for Postgres (GitHub README)](https://github.com/pgvector/pgvector)
- [Faster similarity search performance with pgvector indexes — Google Cloud Blog](https://cloud.google.com/blog/products/databases/faster-similarity-search-performance-with-pgvector-indexes/)
- [Hybrid Search in PostgreSQL: The Missing Manual — ParadeDB](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)
- [Building Hybrid Search for RAG: pgvector + Full-Text Search with RRF — DEV](https://dev.to/lpossamai/building-hybrid-search-for-rag-combining-pgvector-and-full-text-search-with-reciprocal-rank-fusion-6nk)
- [Elasticsearch vs Typesense: A definitive comparison — Meilisearch](https://www.meilisearch.com/blog/elasticsearch-vs-typesense)
- [Comparison with Alternatives — Typesense](https://typesense.org/docs/overview/comparison-with-alternatives.html)
- [10 Elasticsearch Production Issues, How Postgres Avoids Them — Tiger Data](https://www.tigerdata.com/blog/10-elasticsearch-production-issues-how-postgres-avoids-them)
- [Full-text search engine with PostgreSQL (part 2): Postgres vs Elasticsearch — Xata](https://xata.io/blog/postgres-full-text-search-postgres-vs-elasticsearch)
- [Database Caching Strategies Using Redis — Caching patterns (AWS Whitepaper)](https://docs.aws.amazon.com/whitepapers/latest/database-caching-strategies-using-redis/caching-patterns.html)
- [Cache-Aside Pattern — Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside)
- [How to Implement Cache Invalidation with Redis (delete-on-write, versioned keys, tag-based)](https://oneuptime.com/blog/post/2026-01-25-redis-cache-invalidation/view)
- [Understanding cache invalidation for fast apps — Redis](https://redis.io/glossary/cache-invalidation/)
- [Three Ways to Maintain Cache Consistency — Redis](https://redis.io/blog/three-ways-to-maintain-cache-consistency/)
- [Keyset Cursors, Not Offsets, for Postgres Pagination — Sequin](https://blog.sequinstream.com/keyset-cursors-not-offsets-for-postgres-pagination/)
- [PostgreSQL Keyset Pagination vs Offset — Stacksync](https://www.stacksync.com/blog/keyset-cursors-postgres-pagination-fast-accurate-scalable)
- [Five ways to paginate in Postgres, from the basic to the exotic — Citus Data](https://www.citusdata.com/blog/2016/03/30/five-ways-to-paginate/)
- [Redis adapter — Socket.IO official docs (Pub/Sub, sticky sessions, sharded adapter)](https://socket.io/docs/v4/redis-adapter/)
- [Scaling Socket.IO: real-world challenges and proven strategies — Ably](https://ably.com/topic/scaling-socketio)
- [Pattern: Transactional outbox — microservices.io (Chris Richardson)](https://microservices.io/patterns/data/transactional-outbox.html)
- [Transactional outbox pattern — AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [Parallelism and Concurrency — BullMQ docs](https://docs.bullmq.io/guide/parallelism-and-concurrency)
- [Rate limiting — BullMQ docs](https://docs.bullmq.io/guide/rate-limiting)
- [Handling 2 Million Background Jobs a Day in NestJS with BullMQ and Rate-Limited Queues](https://medium.com/@connect.hashblock/handling-2-million-background-jobs-a-day-in-nestjs-with-bullmq-and-rate-limited-queues-d059f8c69681)
