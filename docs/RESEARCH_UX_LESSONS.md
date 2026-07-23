I have everything I need. The report is a synthesis deliverable, so I'll return it directly as markdown.

# Báo cáo Nghiên cứu UX & Function cho Tirapro
### Tổng hợp từ feedback thực tế người dùng Jira, Linear, ClickUp, Asana, Monday, Trello, GitHub Issues, Shortcut, Basecamp, Bugzilla, YouTrack, Sentry

> **Mục tiêu**: Biến nỗi đau thực tế của người dùng các công cụ PM/bug thành quyết định sản phẩm hành động được cho Tirapro. Tirapro đã chốt: config-driven, ease-of-use là ưu tiên SỐ 1, design impeccable (calm & focused). Báo cáo này đối chiếu với những gì đã có và chỉ ra khoảng trống.

---

## 1. Executive Summary — 7 insight lớn nhất

1. **Tốc độ cảm nhận là TÍNH NĂNG quyết định, không phải tối ưu phụ.** Đây là lý do số 1 dev rời Jira (load 2-3s, board 24MB/350 request) sang Linear (~50ms). Benchmark được trích: Linear nhanh hơn Jira ~3.7x → 34% ít họp status hơn. ClickUp có post "Slowness" 1.1k votes, có team bỏ sang Google Sheets. **Speed thay đổi hành vi**: friction thấp → người dùng cập nhật issue thường xuyên hơn. Tirapro phải biến optimistic UI từ "đã chốt" thành **cam kết đo lường được trong CI** (p95 < 100ms cho thao tác cục bộ).

2. **Sự phức tạp là nguyên nhân rời bỏ số 1.** Jira "feels like you need a project manager just to manage the project manager"; ClickUp learning curve 2-4 tuần; Bugzilla form "too sophisticated". Ngược lại Linear/Trello/Shortcut onboard trong vài phút. **Progressive disclosure** (đơn giản mặc định, mạnh khi cần) là chiến lược trung tâm — và config-driven của Tirapro là vũ khí để làm điều này tốt hơn cả Linear (vốn cứng nhắc) lẫn Jira (vốn rối).

3. **Notification firehose phá hủy lòng tin.** Phàn nàn cross-cutting bị trích nhiều nhất về Jira: "My inbox is drowning in Jira emails, I don't even read them anymore" (60 email/ngày, 3-4 cái relevant). Nguyên tắc bắt buộc: **im lặng theo mặc định, ồn theo lựa chọn** + batch/digest + coalesce multi-field edit thành 1 thông báo.

4. **Triage inbox tách biệt là khác biệt chức năng cốt lõi của Linear** mà các tool khác thiếu — chặn failure mode "issue chất đống không ai xử lý". Xử lý bằng phím (Accept/Duplicate/Decline/Snooze), AI auto-suggest để "confirm thay vì quyết định". Tirapro **chưa có** — đây là khoảng trống P0.

5. **Hierarchy thật (Epic/Story/Sub-task) là ranh giới giữa "dễ thương" và "không scale".** Phàn nàn gay gắt và lặp lại nhất với GitHub ("dealbreaker") và Trello. Bài học từ lỗi GitHub: cho phép **1 work item thuộc NHIỀU epic/parent**. Tirapro có Full Agile suite nhưng phải đảm bảo hiển thị progressive (card gọn như Trello, hierarchy chỉ hiện khi cần).

6. **Bug logging cần form lộ dần + tự thu metadata + severity TÁCH priority.** Jira gộp 1 field "Priority" bị chê là "severity wearing a priority costume". Sentry's "suspect commits" (git blame → tác giả gây lỗi → gợi ý assignee) là gia tốc triage mạnh nhất. Tirapro có GitHub/GitLab integration để làm điều này native.

7. **Phục vụ cả dev (như Linear) lẫn non-eng/enterprise (như Jira) là cơ hội lớn nhất.** Linear bị loại ở team lớn vì thiếu custom field/permission/automation/reporting sâu; Jira bị non-eng bỏ vì "too technical". Config-driven cho phép Tirapro **giữ default sắc bén kiểu Linear + mở khóa depth kiểu Jira theo nhu cầu** — "simple by default, powerful on demand".

---

## 2. TOP UX "NÊN LÀM" (Do's)

| # | Bài học | Áp dụng cụ thể cho Tirapro | Ưu tiên |
|---|---------|---------------------------|---------|
| D1 | **Ngân sách hiệu năng cứng** — mọi tương tác cục bộ < 100ms, KHÔNG spinner cho inline edit/đổi status/quick-add | Mọi mutation render optimistic ngay rồi reconcile nền; chỉ skeleton khi tải lần đầu màn lớn. Thêm **perf budget vào CI** (đo p95 render board/list < 100ms, first-paint < 1s với 1.000 issue). Coi mọi tương tác > 200ms là bug | **P0** |
| D2 | **Đơn giản mặc định, lộ dần** — board mặc định chỉ title/status/assignee/priority | "Simple mode" làm default trong design system; story point/epic/sprint/custom field/automation/JQL ẩn sau "Add field"/panel Advanced, **opt-in per-project**. Mỗi màn tối đa 1 hành động chính + 1-2 phụ | **P0** |
| D3 | **Time-to-first-value tính bằng phút** — tạo issue đầu tiên < 2 phút, KHÔNG wizard config trước | Vào project mới đã có board + cột mặc định (To Do/In Progress/Done) + quick-add inline. Template theo persona (Scrum/Kanban/Bug). Dùng AI generate scaffold từ 1 câu mô tả. Cmd+K tạo được issue từ giây đầu | **P0** |
| D4 | **Notification im lặng theo mặc định** | Chỉ thông báo khi: được assign, được @mention, hoặc watch. Coalesce multi-field edit (debounce 30-60s) thành 1 thông báo "X updated 4 fields". Email = digest mặc định; chỉ Priority cao nhất/@mention đẩy instant. "Mute thread" 1-click mọi nơi | **P0** |
| D5 | **Cmd+K reach-everything** — navigator + action runner trong 2 keystroke, fuzzy, typo-tolerant | Hiện shortcut hint cạnh mỗi action (dạy phím thụ động); "recent/suggested" lên đầu; là cheat-sheet phím tắt; chạy lệnh trên selection hiện tại. Là "mặt tiền khám phá" duy nhất cho mọi hành động | **P0** (đã có, củng cố) |
| D6 | **Sort mặc định khớp trực giác** — overdue & cần làm ngay nổi lên TRÊN | Board/backlog/"My Work": default đẩy overdue lên đầu, chỉ báo màu rõ; cho đổi sort nhưng default phục vụ "cái gì làm trước". Tránh lỗi ClickUp (overdue hiện dưới task hôm nay) | **P1** |
| D7 | **Permission bằng ngôn ngữ con người** — preset rõ tên, không "scheme" trừu tượng | 3-4 role preset (Admin/Member/Viewer/Guest) với mô tả "người này làm được gì". Nút **"View as <role>"**. Màn **"Access overview"**: chọn user → thấy họ truy cập gì; chọn issue → thấy ai xem được. Cảnh báo trước khi mở rộng visibility | **P1** |
| D8 | **Dạy phím tắt lộ dần, không dump 30 phút day-one** | Sau khi user làm action bằng chuột vài lần → hint nhẹ "Tip: nhấn C lần sau". Không gate giá trị sau việc nhớ phím tắt (đây là friction day-one duy nhất của Linear) | **P1** (đã có hint, bổ sung trigger theo hành vi) |
| D9 | **Search forgiving cho mọi người, query nâng cao là lớp tùy chọn** | Cmd+K fuzzy/typo-tolerant/ranked instant-as-you-type xuyên issue/project/people/comment + recent/saved. Filter chip trực quan compile thành query. JQL là "switch to query mode" cho power user, có autocomplete + lỗi thân thiện + **AI tiếng Việt → query**. Index history queryable từ ngày 1 | **P1** (có JQL+filter builder, thêm fuzzy/AI/history) |
| D10 | **Calm & focused = "thuế tĩnh lặng"** cho mỗi tính năng mới | Mỗi feature mới phải qua câu hỏi: "nó làm màn chính ồn hơn không?" Nếu có → đẩy vào panel phụ. Hạn chế modal, ưu tiên inline edit, transition mượt không màu mè, ít chrome | **P1** (đã chốt, neo theo Linear) |
| D11 | **Mobile làm tốt vài việc tần suất cao, không clone desktop nửa vời** | Scope: xem my issues, search, comment, đổi status/assignee, tạo issue (chọn được epic/parent), nhận push. **Parity-or-block**: action không hỗ trợ thì nói rõ, KHÔNG fail save im lặng (lỗi Jira: epic assignment không lưu). Comment đầy đủ không cắt 2 dòng | **P2** |

---

## 3. TOP UX "NÊN TRÁNH" (Anti-patterns — đúc từ phàn nàn khiến người dùng rời tool)

| # | Anti-pattern | Nguồn gốc phàn nàn | Quy tắc cho Tirapro |
|---|-------------|--------------------|--------------------|
| A1 | **"A wall of workflows/filters/epics" chào đón user mới** | Jira: "incredibly easy to over-engineer with too many required fields" | Cấu hình nâng cao luôn sau "Advanced"; user mới làm việc được ngay |
| A2 | **"Click rồi chờ" + spinner nháy ngay** | Jira "every click brings the loading icon ~10s"; ClickUp "Everything view 90+ giây" | Đầu tư tốc độ để xong trước ngưỡng; spinner là fallback CÓ độ trễ (~300–500ms), không nháy; optimistic + skeleton khớp layout |
| A3 | **Notification "ping everyone for everything" + auto-watch rộng** | Jira 60 email/ngày → user bỏ đọc hẳn | Auto-watch tắt hoặc scope hẹp; 1 email/session sửa, không 1/field |
| A4 | **Bắt học cú pháp query cho việc cơ bản** | JQL/YouTrack "intimidating", "operators sound frightening" | Việc cơ bản (issue high-priority của tôi) = filter chip, không gõ cú pháp |
| A5 | **Permission scheme copy đến mức "no one knows who has access to what"** (50+ role cho 250 người) | Jira permission spiral, accidental exposure | Role-based không per-person; custom role là advanced opt-in; có audit |
| A6 | **Config bloat tích tụ** — hàng ngàn custom field/workflow chết làm chậm + onboarding lâu | Jira "enterprise-grade configuration creating debt" | Share field/workflow definition giữa project (không copy); report "unused config" + 1-click archive; cảnh báo khi role/field count tăng bất thường |
| A7 | **Form bug "too sophisticated"** dump full field lên reporter | Bugzilla intimidating, log bug chậm | Chỉ Title + description bắt buộc; phần còn lại inline-expand |
| A8 | **Gộp Severity vào Priority** | Jira single field bị chê "severity wearing a priority costume" | 2 field riêng + định nghĩa inline khi hover |
| A9 | **Crash/conflict khi 2 người sửa cùng issue** | Bugzilla crash khi concurrent edit → phá hủy lòng tin | Conflict-safe merge banner ("X cũng đổi field này"), không error |
| A10 | **Redesign navigation làm user lạc** | ClickUp 4.0 "where did my Spaces go?" — 1-2 tuần friction + làm lại SOP | IA điều hướng chốt sớm, giữ ổn định; nếu đổi → tooltip "X chuyển sang đây" tạm thời, không đổi im lặng |
| A11 | **Tính năng bị chôn = không tồn tại** | Monday user phát hiện knowledge base "sau 7 tháng" | Cmd+K + empty state + contextual hint lộ tính năng đúng lúc |
| A12 | **Ép 1-assignee cứng nhắc** | Asana "really needs assign to more than one person" → workaround bằng subtask | Assignee chính + reviewers/watchers, hoặc multi-assignee per config |
| A13 | **AI scheduling tự quyết, "wildly optimistic"** | ClickUp AI Planner không hiểu dependency/availability | AI luôn ở vai trợ lý: đề xuất để user confirm, hiển thị căn cứ, không áp đặt |
| A14 | **Khóa tính năng nền tảng sau paywall/tier đắt/seat-bucket** | Monday "Basic no automations", "need 7 pay for 10"; Trello khóa timeline; Shortcut khóa roadmap | Automation/integration cơ bản + timeline + custom field KHÔNG khóa sau cờ ẩn/paywall |
| A15 | **Grouping/dedupe quá tay** — over-group giấu bug, under-group ngập dashboard | Sentry "double-edged sword", SDK double-reporting | Dedupe phải assistive + reversible, không silently automatic; grouping bảo thủ mặc định |

---

## 4. FUNCTION — Must-haves & Differentiators

### 4.1 Must-haves (thiếu thì người dùng bỏ tool)
- **Hierarchy thật**: Epic/Initiative → Story → Sub-task, hiển thị progressive. Cho phép **1 work item thuộc nhiều parent/epic** (sửa lỗi GitHub sub-issue 1-parent). Board group-by parent/epic. Dependency (blocks/blocked-by) trực quan.
- **Sprint/Iteration + estimate** với velocity/burndown/cycle-time native — lý do dev rời Trello/GitHub. **Auto-rollover** task chưa xong sang cycle kế (đừng bắt dọn sprint thủ công). Bật được không cần admin, default hợp lý, ẩn cho team chưa cần.
- **Bulk operations mạnh** — multi-select (shift/cmd-click, shift+arrow) → 1 lệnh bulk-edit (status/assignee/label/priority/sprint) có undo. Biến điểm yếu Linear ("update 50 issue click từng cái") thành lợi thế.
- **Git integration 2 chiều tự động**: gen branch name từ issue ID; auto-link PR↔issue; state mapping cấu hình (PR open → In Progress, merge → Done, deploy → Released); hiển thị PR/CI status trên issue. Đổi status từ commit message ("Fixes PROJ-12").
- **Timeline/Roadmap + release/version tracking** native (KHÔNG add-on như Jira/Trello/Basecamp). Cơ hội vượt cả 4 đối thủ cùng lúc.
- **Time tracking nhẹ** (optional, không ép timesheet) + dependency — Basecamp mất điểm vì thiếu.
- **Cross-project view / unified backlog / portfolio** bật được khi org lớn — ẩn/optional cho team 1 project. Saved view chia sẻ được không cần admin.
- **Search nhanh ở project lớn** (index tốt, queryable history) — Jira chậm chỗ này.

### 4.2 Differentiators (tạo lợi thế cạnh tranh)
- **Triage inbox** (chi tiết ở mục 5) — Linear's biggest win, các tool khác thiếu.
- **AI giảm gõ tay đặt đúng chỗ "dễ thắng"**: tạo issue từ NL (gợi ý type/priority/assignee/estimate), tóm tắt thread dài, sinh draft AC, phân rã task, sinh query từ tiếng Việt, gợi ý workflow/automation template lúc setup. Luôn preview + sửa. → Biến nỗi đau "cần PM để quản PM" thành lợi thế.
- **Reporting sâu hơn Linear**: epic/initiative roll-up tự tổng hợp + dashboard tự dựng widget + portfolio view + **AI insight** ("sprint này có nguy cơ trễ vì...") — vượt Jira chứ không chỉ ngang.
- **Workflow/automation template dựng sẵn** ("Bug triage", "Approval 2 cấp", "Auto-assign theo component") + builder kéo-thả if-this-then-that low-code — giữ depth của Jira mà bỏ overhead.
- **Tắt module không dùng per-project** (Sprints/Backlog/Reports/Time tracking/Components) — Jira bị chê "không cho disable để nhẹ hơn".
- **Cộng tác người ngoài không cần seat**: shareable issue/feedback link read-or-comment cho client/stakeholder (lỗ hổng Asana).
- **Convert-to-bug 1-click từ kênh inbound** (Telegram/integration) giữ source link — Linear's gap.
- **Vocabulary đổi được theo persona** (Epic/Story → nhãn dễ hiểu cho marketing/ops) — phục vụ non-eng.

---

## 5. Bug Logging & Triage — Đặc tả form/luồng

### 5.1 Form tạo Bug (progressive disclosure — chống "Bugzilla wall")
**Bắt buộc tối thiểu**: `Title` + `Description` (rich). Enter để submit, không field nào chặn việc capture.

**Hàng "More details" (inline-expand, optional)**:
- `Steps to reproduce` — widget danh sách đánh số
- `Expected` / `Actual`
- **`Severity`** (technical impact — reporter/QA đặt) — TÁCH KHỎI **`Priority`** (business urgency — PM đặt). Tooltip định nghĩa từng mức + ví dụ ("Critical severity ở feature đã ngừng vẫn có thể Low priority")
- `Environment` — field có nút **"use my current session info"** tự điền app version/browser/OS/URL/viewport
- `Attachments` — paste/annotate screenshot ngay trong issue; optional screen recording

**AI pre-fill (confirm thay vì gõ)**: từ description tự draft steps-to-reproduce có cấu trúc, gợi ý severity+priority kèm justification 1 dòng, gợi ý label/component, gợi ý assignee (từ code ownership / bug tương tự). Tất cả dạng accept/edit chip.

### 5.2 Auto-dedupe tại thời điểm tạo
- Khi user gõ Title/description (hoặc paste stack trace) → AI/similarity check hiện panel **"Possible duplicates"** inline TRƯỚC submit.
- Lựa chọn: "This is a duplicate of #123" (merge) hoặc "Create anyway". **Merge phải undoable.**
- **Merge mang theo**: attachments, comments, watchers, integration/customer links sang issue canonical; ghi nhận để future report tương tự auto-suggest cùng canonical; hiện "merged from #N" trail. (Sửa lỗi Sentry: merge không update future grouping nên duplicate vẫn đến.)

### 5.3 Suspect commits (gia tốc triage mạnh nhất — từ Sentry)
- Nếu bug có stack trace + code mapping → chạy git blame trên frame trong app → hiện **"Suspect commits"** (commit, author, PR), deep-link mỗi frame tới đúng dòng source ở version lỗi, pre-suggest author làm assignee. Mở rộng GitHub/GitLab integration đã có.

### 5.4 Triage inbox (P0 — khoảng trống lớn nhất)
- **Triage view per project/team**. Mọi issue tạo từ ngoài (Jira import, Telegram bot, GitHub/GitLab, AI, non-team reporter) đổ vào Triage **thay vì thẳng backlog**.
- **One-key actions**: Accept `1` (→ default status/backlog), Mark Duplicate `2` (merge), Decline `3` (cancel + lý do), **Snooze** `H`. Tự hiện issue kế sau mỗi action.
- **Snooze thông minh**: trở lại theo timer HOẶC khi có activity mới (comment/event/duplicate) — cái nào tới trước. Snoozed ẩn với người khác, có view toggle.
- **Triage Intelligence (AI)**: auto-suggest assignee/label/project + surface duplicate → "confirmation thay vì decision".
- **Command-style bulk** cho power triager: multi-select + command bar (Cmd+K scoped to selection) áp status/assignee/label/severity hàng loạt, autocomplete, cùng UI hiện đại (không tách "Classic" như lỗi YouTrack). Cũng expose qua right-click cho non-power user.

### 5.5 Chống double-reporting từ nguồn tự động
- Fingerprint (hash stack/title/source) report đến từ integration/webhook/Telegram; collapse report giống nhau trong cửa sổ thời gian thành 1 issue + occurrence counter, không tạo duplicate. (Sửa lỗi Sentry SDK double-reporting.)

---

## 6. Onboarding / Notification / Search / Mobile / Performance

**Onboarding**
- Time-to-first-value < vài phút; first issue < 2 phút, **không block bởi config**.
- Template/vai trò: chọn "Scrum team" / "Kanban-bug team" → seed board + sprint + issue mẫu để tương tác ngay.
- Empty state có CTA tạo mẫu, gợi ý hành động kế ("Chưa có sprint? Tạo sprint đầu tiên").
- Chọn "ngôn ngữ" theo persona (eng vs product) để vocabulary không xa lạ non-eng.
- Tour per-màn lộ 1-2 tính năng ẩn mỗi lần, không dump hết.

**Notification**
- Default quiet & relevant: chỉ assigned-to-me / @mention / state-change-affecting-me. Auto-watch off hoặc scope hẹp.
- Per-event matrix (In-app / Email / Telegram / off) sửa được < 30s, có preview "bạn sẽ nhận thông báo khi...".
- Coalesce edit cùng session thành 1 notification + 1 activity-log entry (debounce 30-60s, expandable per-field).
- Cadence per (user, event-type, channel): default email=daily digest, in-app=instant, Telegram=mention/urgent. Tận dụng Telegram + digest backbone đã có. "Mute issue/thread" 1-click mọi nơi.

**Search**
- Cmd+K = primary find path: fuzzy, typo-tolerant, ranked, instant-as-you-type xuyên issue/project/people/comment + recent/saved.
- Filter chip trực quan compile thành query; JQL là "switch to query mode" optional với autocomplete + lỗi thân thiện; AI tiếng Việt → query.
- Index health check + reindex tooling; change-history queryable từ ngày 1 (Jira mặc định không search được history).

**Mobile**
- Thin client trên cùng NestJS API + optimistic pattern. Scope triage essentials làm tốt.
- **Parity-or-block**: action không hỗ trợ → disable + tooltip giải thích, KHÔNG partial save. Queue write offline, reconcile khi reconnect, surface conflict.
- Comment đầy đủ, không cắt 2 dòng. Test create/edit round-trip trên thiết bị thật trước release.

**Performance**
- Optimistic uniform mọi mutation (status/assign/comment/drag-reorder) + auto rollback + undo.
- Virtualize board/backlog; lazy-load issue detail/history; reserve space chống layout shift; payload nhỏ.
- KHÔNG bao giờ làm view kiểu "Everything" load toàn workspace (lỗi ClickUp 90s). Budget first-paint < 1s; mọi tương tác > 200ms là bug.
- Config bloat là rủi ro hạng nhất: share definition, report unused config + archive.

---

## 7. BACKLOG ƯU TIÊN cho Tirapro

| Hạng mục | Loại | Trạng thái | Ưu tiên |
|----------|------|-----------|---------|
| Optimistic UI mọi mutation + perf budget trong CI (p95<100ms) | UX | Đã có (optimistic) — bổ sung đo lường CI | **P0** |
| Triage inbox (one-key Accept/Dup/Decline/Snooze + AI suggest) | Function | **Cần bổ sung** | **P0** |
| Severity TÁCH Priority trong bug schema + định nghĩa inline | Function | **Cần bổ sung** | **P0** |
| Bug create form progressive disclosure (Title+desc bắt buộc) | UX | **Cần bổ sung** | **P0** |
| Notification quiet-by-default + matrix per-event + coalesce | UX/Function | **Cần bổ sung** (có Telegram/digest backbone) | **P0** |
| Conflict-safe concurrent edit (merge banner, không crash) | UX/Function | **Cần bổ sung** (có realtime layer) | **P0** |
| Simple mode mặc định + Advanced opt-in per-project | UX | Đã có nguyên tắc — chuẩn hóa trong design system | **P0** |
| Template/persona onboarding + seed sample data, first issue<2ph | UX | Đã có (guides/tours/seed) — thêm template theo vai trò | **P0** |
| Cmd+K reach-everything + fuzzy/typo-tolerant + shortcut hint | UX | Đã có — củng cố fuzzy/recent/suggested | **P1** |
| Auto-dedupe tại creation + merge mang attachments, reversible | Function | **Cần bổ sung** | **P1** |
| Suspect commits (git blame → assignee) | Function | **Cần bổ sung** (mở rộng GitHub/GitLab) | **P1** |
| Auto-capture environment (browser ext / web widget / session info) | Function | **Cần bổ sung** | **P1** |
| Git 2-chiều: gen branch, auto-link PR, state mapping, PR/CI trên issue | Function | Đã có integration — đảm bảo 2-chiều đầy đủ | **P1** |
| Hierarchy: multi-parent epic + dependency + board group-by-epic | Function | Đã có Agile suite — bổ sung multi-parent | **P1** |
| Auto-rollover cycle/sprint + view cycle đơn giản | Function | Đã có sprint — thêm auto-rollover | **P1** |
| Bulk operations multi-select + command bar có undo | Function | Đã có bulk actions — thêm command-bar scoped | **P1** |
| Reporting roll-up + dashboard tự dựng widget + AI insight | Function | Đã có analytics — bổ sung roll-up/widget/AI | **P1** |
| Permission preset + "View as role" + Access overview screen | UX/Function | Đã có RBAC foundation — bổ sung UI dễ hiểu + audit | **P1** |
| Search fuzzy + history queryable + AI tiếng Việt→query | Function | Đã có JQL+filter — bổ sung fuzzy/history/AI | **P1** |
| Sort default đẩy overdue lên đầu | UX | **Cần bổ sung** | **P1** |
| Roadmap/Timeline + release/version tracking native | Function | **Cần bổ sung** (hoặc xác nhận có) | **P1** |
| Workflow/automation template library + builder low-code | Function | Config-driven nền tảng — bổ sung template + builder | **P1** |
| Tắt module per-project (progressive feature flags) | Function | Config-driven — bổ sung UI tắt/bật module | **P1** |
| Dạy phím tắt theo hành vi ("Tip: nhấn C lần sau") | UX | Đã có hint tooltip — thêm trigger theo hành vi | **P2** |
| Mobile triage essentials + parity-or-block + offline queue | UX/Function | **Cần bổ sung** | **P2** |
| Convert-to-bug 1-click từ Telegram/integration giữ source | Function | **Cần bổ sung** | **P2** |
| Shareable feedback link cho client (no seat) | Function | **Ý tưởng mới** (có RBAC nền) | **P2** |
| Cross-project / portfolio view + unified backlog | Function | **Cần bổ sung** | **P2** |
| Time tracking nhẹ optional (không ép timesheet) | Function | **Cần bổ sung / xác nhận** | **P2** |
| Vocabulary đổi được theo persona (Epic/Story → nhãn) | UX/Function | **Ý tưởng mới** | **P2** |
| Report "unused config" + 1-click archive + cảnh báo bloat | Function | **Ý tưởng mới** | **P2** |
| Double-report fingerprint từ nguồn tự động | Function | **Cần bổ sung** | **P2** |

---

## 8. Đề xuất BỔ SUNG vào `docs/UX_CONVENTIONS.md`

> File hiện có 10 mục + Definition of Done. Đề xuất dưới đây là **điều khoản mới/điều chỉnh**, đánh dấu mục tương ứng.

**Mục 1 (Tốc độ) — điều chỉnh + thêm:**
- Thêm: "**Perf budget đo trong CI**: p95 render < 100ms cho board/list interaction; first-paint < 1s với 1.000 issue. Mọi tương tác > 200ms coi là bug."
- Thêm: "**Cấm view load-toàn-workspace** (kiểu 'Everything'). Reserve space chống layout shift."

**Mục 3 (Nhập liệu) — thêm:**
- "**Bug form progressive**: chỉ Title + description bắt buộc; Steps/Severity/Environment/Attachments inline-expand. Nút 'dùng session hiện tại' tự điền browser/OS/URL/viewport."
- "**Severity TÁCH Priority** — 2 field riêng, định nghĩa inline khi hover, kèm ví dụ."

**Mục 5 (Tha thứ lỗi) — thêm:**
- "**Conflict-safe concurrent edit**: khi 2 người sửa cùng field → merge banner non-destructive ('X cũng đổi field này'), KHÔNG error/crash."
- "**Merge/dedupe luôn reversible** + mang theo attachments/comments/watchers/links sang canonical."

**Mục 6 (Tìm & thấy) — điều chỉnh:**
- "Global search **fuzzy + typo-tolerant + ranked + instant-as-you-type**; **change-history queryable từ ngày 1**; JQL có autocomplete + lỗi thân thiện + **AI tiếng Việt → query**."

**Mục 8 (Hướng dẫn) — thêm:**
- "Template onboarding **theo persona/vai trò** (Scrum/Kanban/Bug); first issue < 2 phút, không block bởi config."
- "**Vocabulary đổi được theo persona** (Epic/Story → nhãn dễ hiểu cho non-eng)."

**Mục mới #11 — Notification (im lặng theo mặc định):**
- "Default chỉ thông báo: assigned-to-me / @mention / state-change-affecting-me. Auto-watch off hoặc scope hẹp."
- "Coalesce edit cùng session thành 1 notification + 1 activity entry (debounce 30-60s)."
- "Matrix per (user, event, channel) sửa < 30s, có preview; email default = digest. 'Mute thread' 1-click mọi nơi."

**Mục mới #12 — Permission dễ hiểu & auditable:**
- "3-4 role preset ngôn ngữ người; custom role là advanced opt-in. Nút 'View as role'. Màn 'Access overview'. Cảnh báo trước khi mở rộng visibility."

**Mục mới #13 — Progressive power & chống config bloat:**
- "Simple mode mặc định; tính năng enterprise opt-in per-project; tắt được module không dùng."
- "Share field/workflow definition giữa project (không copy per-project). Report 'unused config' + 1-click archive; cảnh báo khi role/field count tăng bất thường."

**Mục mới #14 — IA ổn định:**
- "IA điều hướng chốt sớm, giữ ổn định. Nếu đổi layout → tooltip 'X chuyển sang đây' tạm thời, không đổi im lặng. Dùng `data-tour` anchor ổn định."

**Mục mới #15 — Triage-first cho input ngoài:**
- "Mọi issue từ nguồn ngoài (import/Telegram/GitHub/AI) vào **Triage**, không thẳng backlog. One-key Accept/Duplicate/Decline/Snooze; Snooze trở lại theo timer HOẶC activity mới."

**Mục mới #16 — AI là trợ lý, không tự quyết:**
- "AI luôn dạng đề xuất user confirm/sửa (accept/edit chip), hiển thị căn cứ (dependency/capacity/code-ownership). Không tự áp lịch/estimate. Suspect commits gợi ý assignee từ git blame."

**Definition of Done (UX) — thêm checklist:**
- [ ] Concurrent edit: conflict hiển thị merge banner, không crash.
- [ ] Notification của màn tuân quiet-by-default + coalesce.
- [ ] Nếu màn nhận input ngoài → đi qua Triage, không thẳng backlog.
- [ ] Bug/issue form: field nâng cao inline-expand, không dump.
- [ ] Tính năng mới qua "thuế tĩnh lặng" (không làm màn chính ồn hơn).

---

*Toàn bộ khuyến nghị rút từ feedback thực tế trong 6 cụm nguồn (Jira, Linear, ClickUp/Asana/Monday, Trello/GitHub/Shortcut/Basecamp, Bugzilla/YouTrack/Sentry/Linear-triage, cross-cutting). File liên quan: `D:\Code\ql-du-an\docs\UX_CONVENTIONS.md` (mục 8 để cập nhật), `D:\Code\ql-du-an\docs\MASTER_PLAN.md`, `D:\Code\ql-du-an\docs\FEATURES_BY_ACTOR.md`.*

---

## Nguồn tham khảo (đã đọc)

- [Why I Switched from Jira: 15 Jira Alternatives That Actually Worked — ClickUp](https://clickup.com/blog/jira-alternatives/)
- [Jira Too Complicated? 5 Simpler Alternatives — Kuberns (Medium)](https://kuberns.medium.com/jira-too-complicated-5-simpler-alternatives-your-team-will-actually-use-7d2842d7cf38)
- [7 reasons why use of Jira can be frustrating (Part 1) — Atlassian Community](https://community.atlassian.com/forums/Jira-articles/7-reasons-why-use-of-Jira-can-be-frustrating-part-1/ba-p/1013802)
- [The Jira Cloud Struggle Nobody Talks About: Too Many Notifications — Atlassian Community](https://community.atlassian.com/forums/Jira-Cloud-Admins-articles/The-Jira-Cloud-Struggle-Nobody-Talks-About-Too-Many/ba-p/3110559)
- [Why is Atlassian's Jira so slow regardless of environment? — Quora](https://www.quora.com/Why-is-Atlassians-Jira-so-slow-regardless-of-the-environment-or-company-Every-click-brings-the-loading-icon-and-would-last-for-a-couple-of-seconds)
- [Jira Pros and Cons | User Likes & Dislikes — G2](https://www.g2.com/products/jira/reviews?qs=pros-and-cons)
- [Atlassian Jira Reviews & Ratings 2026 — TrustRadius](https://www.trustradius.com/products/atlassian-jira/reviews)
- [Jira Reviews 2026 — Capterra](https://www.capterra.com/p/19319/JIRA/reviews/)
- [3 Strategies to Manage Jira email Notifications without Getting Overwhelmed — Idalko](https://idalko.com/blog/jira-email-notifications)
- [Is Linear Worth It? Honest Review for Engineering Teams (2026) — alfred_](https://get-alfred.ai/blog/is-linear-worth-it)
- [Best Linear Alternatives 2026: 7 Beyond Engineering Teams — alfred_](https://get-alfred.ai/blog/best-linear-alternatives)
- [Linear Project Management: A PM's High-Velocity Guide — Aakash Gupta](https://www.aakashg.com/linear-project-management/)
- [Linear App Review: Features, Pricing, Pros & Cons (2026) — siit.io](https://www.siit.io/tools/trending/linear-app-review)
- [Linear Review 2026: Pros, Cons, Pricing & Verdict — Efficient App](https://efficient.app/apps/linear)
- [Linear Reviews — G2 (pros and cons)](https://www.g2.com/products/linear/reviews?qs=pros-and-cons)
- [Linear Review 2026: Pros, Cons, Pricing — work-management.org](https://work-management.org/software-development/linear-review/)
- [Linear Guide: Setup, Best Practices & Pro Tips — Morgen](https://www.morgen.so/blog-posts/linear-project-management)
- [Triage — Linear Docs](https://linear.app/docs/triage)
- [Parent and sub-issues — Linear Docs](https://linear.app/docs/parent-and-sub-issues)
- [ClickUp 'Slowness' — official feedback forum (1.1k votes, verbatim complaints)](https://feedback.clickup.com/feature-requests/p/slowness)
- [ClickUp 4.0 Review: What 200+ Teams Actually Think — ZenPilot](https://www.zenpilot.com/blog/clickup-4-review/)
- [ClickUp performance complaints — feedback forum](https://feedback.clickup.com/feature-requests/p/performance)
- [5 Reasons Why Bug Tracking with Asana Sucks (and How to Fix it) — Marker.io](https://marker.io/blog/asana-bug-tracking)
- [Asana Review 2025: Features, Pricing, Pros, Cons — AWS in Plain English](https://aws.plainenglish.io/asana-review-2025-features-pricing-pros-cons-best-alternatives-01b91776bb00)
- [Monday.com Pricing, Reviews, Pros & Cons (2026) — Prospeo](https://prospeo.io/s/mondaycom-pricing-reviews-pros-and-cons)
- [My Honest Review of Monday.com — tl;dv](https://tldv.io/blog/monday-review/)
- [I Tested All 3: ClickUp vs Monday vs Asana — Theo James (Medium)](https://medium.com/@theo-james/i-tested-all-3-clickup-vs-monday-vs-asana-26869c26cd4b)
- [GitHub Issues Vs. Jira — Nira](https://nira.com/github-issues-vs-jira/)
- [GitHub Issues vs Jira: 11 Key Differences (2026) — IdeaPlan](https://www.ideaplan.io/compare/github-issues-vs-jira)
- [Feature Request: Hierarchical Issues in Projects · GitHub community Discussion #5714](https://github.com/orgs/community/discussions/5714)
- [Evolving GitHub Issues and Projects (GA) · GitHub community Discussion #154148](https://github.com/orgs/community/discussions/154148)
- [Adding sub-issues — GitHub Docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)
- [Why our dev team moved from Trello to Clubhouse — Geckoboard (Tom Randle, Medium)](https://medium.com/geckoboard-under-the-hood/why-our-dev-team-moved-from-trello-to-clubhouse-b1422e6a2c60)
- [Clubhouse vs Jira — Why I Choose The First in 2021 — Silicon Roundabout](https://siliconroundabout.tech/clubhouse-vs-jira-why-i-choose-the-first-in-2021/)
- [Gone, but not Forgotten: A Trello obituary — Superthread](https://superthread.com/blog/trello-for-teams-is-dead/)
- [Trello Alternatives: Top Picks for Businesses in 2026 — Bitrix24](https://www.bitrix24.com/articles/trello-alternatives-top-picks-for-businesses.php)
- [Trello Review: Simple Kanban for Teams That Value Simplicity — Vact](https://vact.com/trello-project-management-review/)
- [Basecamp Review: Is It Worth It in 2026? [In-Depth] — SmartSuite](https://www.smartsuite.com/blog/basecamp-review)
- [Basecamp Review 2026: Features, Pricing, Pros & Cons — ProofHub](https://www.proofhub.com/articles/basecamp-review)
- [Basecamp Review 2026 — Cloudwards](https://www.cloudwards.net/basecamp-review/)
- [Bugzilla Reviews — Capterra](https://www.capterra.com/p/119057/Bugzilla/reviews/)
- [Bugzilla Reviews, Pros and Cons — Software Advice](https://www.softwareadvice.com/project-management/bugzilla-profile/reviews/)
- [YouTrack Reviews — Capterra](https://www.capterra.com/p/123548/YouTrack/reviews/)
- [YouTrack Review 2026 — Research.com](https://research.com/software/reviews/youtrack)
- [Apply Commands to Issues — YouTrack Cloud Documentation](https://www.jetbrains.com/help/youtrack/cloud/apply-commands-to-issues.html)
- [The Hidden Costs of Sentry's Poor Error Grouping — Decipher](https://getdecipher.com/blog/the-hidden-costs-of-sentry-s-poor-error-grouping)
- [Using a transformer-based text embeddings model to reduce Sentry alerts by 40% — Sentry Blog](https://blog.sentry.io/how-sentry-decreased-issue-noise-with-ai/)
- [Consider deduping errors caught by exception handlers and loggers — getsentry/sentry-java Issue #2886](https://github.com/getsentry/sentry-java/issues/2886)
- [Suspect Commits — Sentry Docs](https://docs.sentry.io/product/issues/suspect-commits/)
- [Bug Severity vs Priority — Bird Eats Bug](https://birdeatsbug.com/blog/bug-severity-vs-priority)
- [Bug severity vs. priority in testing — Plane Blog](https://plane.so/blog/bug-severity-vs-priority-in-testing-key-differences)
- [How to Create a Bug Report Template — Bird Eats Bug](https://birdeatsbug.com/blog/how-to-create-bug-report-template)
- [Frustrated with Jira's complexity? Slow performance, steep learning curve — DEV Community](https://dev.to/pratham_naik_project_manager/frustrated-with-jiras-complexity-slow-performance-steep-learning-curve-and-expensive-pricing-11cf)
- [Happy 20th birthday Jira! You suck so bad — DEV Community](https://dev.to/rida/happy-20th-birthday-jira-you-suck-so-bad-bno)
- [Jira Cloud by Atlassian — iOS App Store Ratings & Reviews](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087?see-all=reviews&platform=iphone)
- [REST: The new /rest/api/3/search/jql endpoint is a complete disaster — Atlassian Community](https://community.atlassian.com/forums/Jira-questions/REST-The-new-rest-api-3-search-jql-endpoint-is-a-complete/qaq-p/3101716)
- [Why Your Jira is Slow: Understanding Bloat and How to Fix It — Atlassian Community](https://community.atlassian.com/forums/Jira-articles/quot-Why-Your-Jira-is-Slow-Understanding-Bloat-and-How-to-Fix-It/ba-p/3040249)
- [How to Simplify Permission Management in Jira: Challenges and Add-On Recommendations — Atlassian Community](https://community.atlassian.com/forums/Jira-questions/How-to-Simplify-Permission-Management-in-Jira-Challenges-and/qaq-p/2872139)
- [Turned On, Tuned Out: The PM Features Teams Stop Using — The Digital Project Manager](https://thedigitalprojectmanager.com/project-management/the-pm-features-teams-stop-using/)
- [What Project Management Tools Get Wrong — And Teams Feel Every Day — Medium (Analyst's Corner)](https://medium.com/analysts-corner/what-project-management-tools-get-wrong-and-teams-feel-every-day-ce630be24e56)
- [Linear vs Jira: Why 30% of Teams Switched [2026] — Tech Insider](https://tech-insider.org/linear-vs-jira-2026/)
