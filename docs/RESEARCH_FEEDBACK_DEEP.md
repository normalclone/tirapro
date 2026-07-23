# Deep-dive Feedback Cộng đồng — Lời chê thật (đợt 2)

> **Phương pháp:** 7 agent fan-out theo nền tảng cộng đồng (Reddit, Hacker News, GitHub, StackOverflow,
> X/LinkedIn/dev.to, app-store + review 1–2★ + churn, bug-tracking community). **90 lời chê**, **~100 nguồn**.
> Tập trung lời chê VERBATIM + tần suất + **DELTA** (nỗi đau MỚI ngoài báo cáo đợt 1 `RESEARCH_UX_LESSONS.md`).
> (Báo cáo tổng hợp bởi main-loop vì agent synth chạm session limit; dữ liệu thô đầy đủ trong workflow output.)

## 1. Top nỗi đau lặp lại nhiều nhất (xuyên nền tảng)

1. **MẤT DỮ LIỆU — không có Recycle Bin / undo** *(very-common, NEW)* — Jira Cloud xóa issue là **vĩnh viễn**, mất luôn comment + attachment; feature request thùng rác (JRACLOUD-36415) treo nhiều năm, 120+ thread cầu cứu. Cũng gặp ở ClickUp (xóa attachment vĩnh viễn, 267 voters/6 năm), Monday (crash mất cell chưa lưu). → *Người dùng mất niềm tin vĩnh viễn.*
   > "Deleting an issue is permanent... gone for ever. Really, really stupid."

2. **Sự cố mất dữ liệu & downtime thảm hoạ** *(NEW)* — Atlassian 2022: ~400 công ty mất sạch quyền truy cập **13–29h tới "up to 2 weeks"**, không có snapshot khôi phục; >50% sự cố do khách tự phát hiện.
   > "Down since 0200... ~400 companies lost complete access; Atlassian could not provide even partial data snapshots."

3. **Tăng giá sốc + SSO/SAML tax** *(very-common, NEW)* — Enterprise +153%, app bên thứ ba +50–300% (ScriptRunner +233%) trái lời hứa "5–10%"; tính phí **SSO/2FA** như tính năng premium ("SSO Wall of Shame").
   > "$6000 a year just to let them login with Azure AD... charging 3× for an essential security feature — egregious. We've started moving to other products."

4. **Vendor lock-in + ép bỏ self-host lên Cloud** *(very-common, NEW)* — Server/Data Center EOL, ép Cloud giá "10–20×"; lo ngại **CLOUD Act / data sovereignty** (EU/regulated/defense). Động cơ rời bỏ rất mạnh trên HN.

5. **API breaking changes phá vỡ hệ sinh thái** *(NEW, intensity cao nhất với dev)* — Jira đổi `/rest/api/3/search` → `/search/jql`: **pagination vỡ** (nextPageToken loop, isLast never true), **bỏ `total` count** (ép full-pagination chỉ để đếm), làm sập ScriptRunner/Automation/python-jira/go-jira.

6. **Performance / chậm ở quy mô** *(very-common, xác nhận đợt 1 + số liệu 2025)* — mở 1 issue 1–4s, board 4–7s, chuyển tab 1–7s; ClickUp lag với 5.000+ task. Linear ~50ms là chuẩn kỳ vọng.

7. **Over-config / phức tạp** *(very-common, xác nhận)* — "I spend more time configuring Jira than writing code... 14 workflows, board so covered in swimlanes we called it 'the spreadsheet'."

8. **AI backlash — hallucinate "đã làm xong"** *(NEW)* — Rovo/Atlassian Intelligence báo cập nhật thành công nhưng **không thực thi**, conflate field types, ép bật không tắt được, thua giải pháp Claude/MCP tự dựng.
   > "It always said it did it, but never does it. Can't work with Atlassian Jira."

9. **Support tệ** *(very-common, NEW)* — chờ 7h–7 ngày, chatbot AI làm tường chặn người thật, ticket bị tự đóng / "Cannot Reproduce".

10. **Export / migration-OUT mất fidelity** *(NEW)* — export native mất comment/attachment/history/relationship; không có UI export toàn bộ attachment → **khó rời bỏ**.

11. **Notification firehose** *(xác nhận)* — "My inbox is drowning in Jira emails." Bugmail 1/4–1/2 là trùng.

12. **Accessibility kém** *(NEW)* — screen reader không đọc được Jira (Bloomberg 9/2025); có người **bỏ việc** vì lý do này.

## 2. DELTA — nỗi đau MỚI (ngoài đợt 1) & cách Tirapro xử lý

| Nỗi đau mới | Tần suất | Guardrail/Feature cho Tirapro | Trạng thái | Ưu tiên |
|---|---|---|---|---|
| Không có thùng rác / xóa vĩnh viễn / mất comment+attachment | very-common | **Recycle Bin + Restore + retention cấu hình** (đã có soft-delete `deletedAt`); confirm khi purge thật; autosave draft | Có nền (soft-delete) — thêm Trash UI/API | **P0** |
| Mất dữ liệu khi outage; không tự backup | recurring | **One-click full export** (issue+comment+attachment+history) + point-in-time/restore; **self-host = bạn sở hữu DB** | Cần thêm export; self-host sẵn | **P0** |
| Export/migration-OUT mất fidelity (lock-in) | recurring | Export **round-trippable** (export ↔ import khớp nhau), gồm attachment+history+links. "Dễ rời" làm điểm bán | Cần thêm `ExportJob` | **P0** |
| API breaking phá integrations; bỏ `total` count | recurring (dev) | **Versioning cộng dồn** (`/api/v1` đã có), giữ `total` ở offset pagination (đã có `totalItems`), sunset song song, **contract tests trong CI**, official SDK | Có nền — thêm contract test + giữ total | **P1** |
| AI hallucinate "done" trên write | recurring | **Verify-before-claim**: AI write hiển thị **diff + xác nhận**, không bao giờ báo done khi chưa verify; **AI opt-in, tắt được**; ground vào field model thật | Có nguyên tắc (#16) — siết + làm tắt được | **P0** |
| SSO/2FA/audit tính phí (SSO tax) | very-common | **SSO/2FA/SCIM/audit-log có ở MỌI gói**, không paywall; audit-log đã có (ActivityLog) | Audit có; SSO là auth tương lai (no-tax) | P1 (positioning) |
| Vendor lock-in / ép cloud / data sovereignty | very-common | **Self-host hạng nhất** (docker compose đã có), export mở, region/EU residency; không deadline ép buộc | Self-host sẵn — quảng bá | P1 (positioning) |
| Tăng giá sốc / billing mờ ám / overcharge ghế | very-common | Giá minh bạch, trần tăng/năm, grandfather, không bẫy seat-bucket; core (automation/script) không tính phí riêng | Positioning | P2 |
| Support tệ / chatbot làm tường | very-common | SLA phản hồi (gói trả phí <4h), không chatbot chặn người thật, in-app support context-aware | Ops/positioning | P2 |
| Offline mode / mất việc khi mạng kém | recurring | **Offline-tolerant**: PWA cache đọc, optimistic + **queue write offline** reconcile khi online, autosave | Có PWA+optimistic — thêm offline queue | P2 |
| Mobile auth gãy (SSO white screen, đổi account) | recurring | Auth mobile chắc: SSO fallback, multi-account switch, chấp nhận password manager | Cần thêm khi làm mobile | P2 |
| Self-host vận hành phức tạp (7+ container, 200 env, perm vỡ) | recurring (OSS) | **AIO/compose đơn giản, <20 env, boot-time config validation fail-fast** (đã có zod env validate), upgrade smoke test | Đã tốt — giữ kỷ luật | P1 |
| Accessibility/screen reader kém | isolated nhưng nghiêm trọng | WCAG AA (đã cam kết) + **test screen reader thật** trước release | Có cam kết — thêm test | P1 |
| Migration-IN gây bão email notification | recurring | **Silent-import mode**: import không bắn notification | Cần thêm khi làm import | P1 |
| Automation đòi code (JS) chặn non-dev | recurring | **Builder no-code** if-this-then-that + template (đã có trong backlog) | Backlog | P1 |
| Communication-to-issue ingestion thiếu | recurring | Email/Slack/Telegram → issue (đã có Telegram; thêm email-to-issue) | Có Telegram — mở rộng | P2 |

## 3. Pain catalog theo theme (tóm tắt)
- **Data-loss/Reliability** (mới & mạnh nhất): no trash, permanent delete, outage data deletion, lost edits on navigation, data disappearing on sync, no offline → **thùng rác + export + autosave + restore + self-host**.
- **Lock-in/Portability**: forced cloud, EOL self-host, export mất fidelity, data sovereignty → **self-host + export mở + import sạch**.
- **Pricing/Billing**: price shock, SSO tax, seat-bucket, overcharge → **minh bạch + no-SSO-tax**.
- **API/Integration**: breaking changes, removed total, magic field constants → **versioning cộng dồn + contract test + SDK**.
- **AI**: hallucinate-success, forced, low-value → **opt-in + verify-before-claim + diff + grounded**.
- **Perf**: slow at scale → **perf budget + optimistic + virtualize** (đã chốt).
- **Complexity/Notif/Search/Mobile**: xác nhận đợt 1.

## 4. Bug/triage deep insights (bổ sung đợt 1)
- **Error-grouping noise** (Sentry): under-group (1 bug → nhiều issue) + over-group (nhiều bug gộp 1) → dedupe phải **assistive + reversible**, grouping bảo thủ, cho tách/gộp thủ công.
- **Event-quota billing tàn nhẫn**: 1 deploy lỗi đốt quota → **mất bug mới im lặng**. Tirapro không metering kiểu đó → không bao giờ drop bug.
- **Bugmail firehose**: 1/4–1/2 mail trùng → coalesce (đã chốt).
- **No-code triage rules** + **multi-channel ingestion** (email/Slack/Telegram → triage).

## 5. Đề xuất bổ sung `docs/UX_CONVENTIONS.md`
- **Mục mới #17 — Data ownership & an toàn dữ liệu:** Recycle Bin + restore (retention cấu hình, mặc định 30–90 ngày); confirm khi xóa vĩnh viễn; one-click full export (issue+comment+attachment+history) round-trippable; autosave draft mọi nơi; không thao tác nào mất dữ liệu không khôi phục được.
- **Mục mới #18 — API/Integration ổn định:** versioning cộng dồn, không phá pagination, GIỮ `total` count; sunset song song khi đổi; contract tests trong CI; field name ổn định (không "magic constant").
- **Điều chỉnh #16 (AI):** AI **opt-in & tắt được** per-workspace; write luôn hiển thị **diff + xác nhận**; **không bao giờ báo "done" khi chưa verify**; ground vào field model thật.
- **Bổ sung mục 10 (responsive/a11y):** test screen reader thật; offline-tolerant (queue write + cache đọc).

*Dữ liệu thô per-complaint (90 mục) + URL trong workflow output. Nguồn chính bên dưới.*


---

## Nguồn tham khảo (93, đã đọc)

- [Scoop: Inside the Longest Atlassian Outage of All Time (Pragmatic Engineer) — quote khách hàng Reddit/HN về data loss & downtime](https://newsletter.pragmaticengineer.com/p/scoop-atlassian)
- [Massive Price Increase for Jira Cloud Enterprise and Apps? (Atlassian Community, 10k+ views)](https://community.atlassian.com/forums/Jira-questions/Massive-Price-Increase-for-Jira-Cloud-Enterprise-and-Apps/qaq-p/2969785)
- [Why is Atlassian Support so bad? (Atlassian Community)](https://community.atlassian.com/forums/Jira-questions/Why-is-Atlassian-Support-so-bad/qaq-p/1297436)
- [SAML now a paid feature — SSO tax complaints (Atlassian Community, 12 answers)](https://community.atlassian.com/forums/Confluence-questions/SAML-now-a-paid-feature/qaq-p/669548)
- [Does anyone else feel like Rovo is just A, not AI? (Atlassian Community, 4.8k views)](https://community.atlassian.com/forums/Rovo-questions/Does-anyone-else-feel-like-Rovo-is-just-A-not-AI/qaq-p/3215367)
- [Experiencing Slow Performance in Jira Cloud: Long Load Times for Issues and Boards (Atlassian Community, 7.3k views)](https://community.atlassian.com/forums/Jira-questions/Experiencing-Slow-Performance-in-Jira-Cloud-Long-Load-Times-for/qaq-p/3046265)
- [Missing Attachments - JIRA Migration (Atlassian Community) — export/lock-in](https://community.atlassian.com/forums/Jira-questions/Missing-Attachments-JIRA-Migration/qaq-p/856073)
- [Linear vs Jira: We Migrated 2,000 Issues. Here's What Happened. (Cotera) — quote 'configuring Jira', mất JQL/workflow/time-tracking khi migrate](https://cotera.co/articles/linear-vs-jira-comparison)
- [ClickUp Review: 'Everything App' or Just Overwhelming? — tổng hợp quote G2/Reddit (slow 5000+ tasks, feature overload)](https://stackverdict.com/clickup-review/)
- [Monday.com Pricing 2026 (CostBench) — seat-bucket/min-seat billing, Trustpilot 2.7/5](https://costbench.com/software/project-management/monday/)
- [Notification overload? Best practices to decrease notifications (Asana Forum)](https://forum.asana.com/t/notification-overload-best-practices-to-decrease-notifications/854073)
- [The SSO Wall of Shame (sso.tax)](https://sso.tax/)
- [Atlassian moving to cloud-only, will stop selling server licenses | Hacker News](https://news.ycombinator.com/item?id=24805748)
- [The next chapter for Atlassian and our customers | Hacker News](https://news.ycombinator.com/item?id=45177959)
- [What are good self-hosted alternatives to Jira? (Ask HN) | Hacker News](https://news.ycombinator.com/item?id=30987059)
- [Ask HN: Looking for an Alternative to Jira | Hacker News](https://news.ycombinator.com/item?id=20807328)
- [Why Jira Sucks | Hacker News](https://news.ycombinator.com/item?id=25590846)
- [Jira Is a Microcosm of What's Broken in Software Development | Hacker News](https://news.ycombinator.com/item?id=24145665)
- [Jira Is Turing-Complete | Hacker News](https://news.ycombinator.com/item?id=48263253)
- [Jira can't stop people from using it incorrectly (fractal snowflake / API) | Hacker News](https://news.ycombinator.com/item?id=48263975)
- [Why is JIRA so slow? | Hacker News](https://news.ycombinator.com/item?id=23807583)
- [90% of my issues with Jira is that it's slow as balls (comment) | Hacker News](https://news.ycombinator.com/item?id=36381111)
- [Jira + Confluence Clouds Performance Problems #1 reason to leave (comment) | Hacker News](https://news.ycombinator.com/item?id=18103542)
- [Linear – A fast issue tracker (Show HN) | Hacker News](https://news.ycombinator.com/item?id=23693029)
- [Issue Tracking Is Dead (Linear / AI backlash) | Hacker News](https://news.ycombinator.com/item?id=47507253)
- [REST: The new /rest/api/3/search/jql endpoint is a complete disaster (Atlassian Community)](https://community.atlassian.com/forums/Jira-questions/REST-The-new-rest-api-3-search-jql-endpoint-is-a-complete/qaq-p/3101716)
- [API Endpoint Deprecated - Migration to /rest/api/3/search/jql Required (pycontribs/jira #2369)](https://github.com/pycontribs/jira/issues/2369)
- [[Bug][Jira] V2 API removed (apache/incubator-devlake #8563)](https://github.com/apache/incubator-devlake/issues/8563)
- [[bug]: Lost data pages after update (makeplane/plane #7670)](https://github.com/makeplane/plane/issues/7670)
- [[bug]: Lost Issues Content After Reinstalling Makeplane (makeplane/plane #6455)](https://github.com/makeplane/plane/issues/6455)
- [[feature]: Comprehensive Data Recovery Mechanism for Plane (makeplane/plane #4129)](https://github.com/makeplane/plane/issues/4129)
- [[bug]: VERY BAD SELF HOSTING EXPERIENCE (makeplane/plane #8708)](https://github.com/makeplane/plane/issues/8708)
- [[bug]: Migrator script is looping due to an error (makeplane/plane #8176)](https://github.com/makeplane/plane/issues/8176)
- [Good-Bye Data Center (Atlassian Community — DC EOL reactions)](https://community.atlassian.com/forums/Data-Center-discussions/Good-Bye-Data-Center/td-p/3105754)
- [Is Rovo Becoming the First Tool We Open Instead of Jira? (Atlassian Community)](https://community.atlassian.com/forums/Jira-Cloud-Admins-discussions/Is-Rovo-Becoming-the-First-Tool-We-Open-Instead-of-Jira/td-p/3243726)
- [Hierarchy: Sub-issues (github/roadmap #927)](https://github.com/github/roadmap/issues/927)
- [Project kanban view improvements (go-gitea/gitea #27037)](https://github.com/go-gitea/gitea/issues/27037)
- [Project boards / kanban: org-level boards (go-gitea/gitea #13405)](https://github.com/go-gitea/gitea/issues/13405)
- [Slow general performance after update (OpenProject Community #9910)](https://community.openproject.org/topics/9910)
- [18 Best Redmine Alternatives Reviewed 2026 (Redmine 'slow, archaic' complaints)](https://thedigitalprojectmanager.com/tools/best-redmine-alternatives/)
- [Get total on search API for issues using JQL (total field removed)](https://community.atlassian.com/forums/Jira-questions/Get-total-on-search-API-for-issues-using-JQL/qaq-p/3115617)
- [Your Jira Scripts and Automations May Break if they use JQL Search APIs](https://community.atlassian.com/forums/Jira-articles/Your-Jira-Scripts-and-Automations-May-Break-if-they-use-JQL/ba-p/3001235)
- [Deleted Work Items in Jira: The Complete Guide (no recycle bin / unrecoverable)](https://community.atlassian.com/forums/App-Central-articles/Deleted-Work-Items-in-Jira-The-Complete-Guide/ba-p/3113452)
- [About this week's forced rollout of Rovo](https://community.atlassian.com/forums/Jira-questions/About-this-week-s-forced-rollout-of-Rovo/qaq-p/3109430)
- [Why Atlassian Rovo Failed Us (and What We Built Instead) — dev.to](https://dev.to/mitkotschimev/why-atlassian-rovo-failed-us-and-what-we-built-instead-2e19)
- [Jira Cloud to Data Center after June 2025 and reasons to go back? (Data Center sunset / pricing)](https://community.atlassian.com/forums/Data-Center-discussions/Jira-Cloud-to-Data-Center-after-June-2025-and-reasons-to-go-back/td-p/3100869)
- [How to copy or export/import issues between Jira projects while retaining all fields](https://community.atlassian.com/forums/Jira-questions/How-to-copy-or-export-import-issues-between-Jira-projects-while/qaq-p/2766520)
- [Not equals operator (!=) excludes results with empty values (JRACLOUD-23030)](https://jira.atlassian.com/browse/JRACLOUD-23030)
- [Issue with JQL Query when use 'empty' criteria on fix version](https://support.atlassian.com/jira/kb/issue-with-jql-query-when-use-empty-criteria-on-fix-version/)
- [What file size limit are there for Jira? (attachment limits / upload failures)](https://community.atlassian.com/forums/Jira-questions/What-file-size-limit-are-there-for-Jira/qaq-p/1298605)
- [Factors contributing to JQL performance in Jira Server and Data Center](https://support.atlassian.com/jira/kb/factors-contributing-to-jql-performance-in-jira-server-and-data-center/)
- [Why Does Jira Suck and What to Do About It — Chris Dwan (Medium)](https://chrisdwan.medium.com/why-does-jira-suck-and-what-to-do-about-it-a699cf31b40f)
- [7 reasons why use of Jira can be frustrating — Dzmitry Hryb (LinkedIn)](https://www.linkedin.com/pulse/7-reasons-why-use-jira-can-frustrating-dzmitry-hryb)
- [7 reasons why use of Jira can be frustrating — Krzysztof Skoropada (Medium)](https://medium.com/@kskoropada/why-use-of-jira-can-be-frustrating-77620c61ffd2)
- [Mistakenly Deleted a Ticket — no recycle bin / no undo (Atlassian Community)](https://community.atlassian.com/forums/Jira-questions/Mistakenly-Deleted-a-Ticket/qaq-p/3200344)
- [Anyone else hate the new jira experience? (Atlassian Community, 54 answers)](https://community.atlassian.com/forums/Jira-questions/Anyone-else-hate-the-new-jira-experience/qaq-p/684161)
- [The Jira Cloud Struggle Nobody Talks About: Too Many Notifications (Atlassian Community)](https://community.atlassian.com/forums/Jira-Cloud-Admins-articles/The-Jira-Cloud-Struggle-Nobody-Talks-About-Too-Many/ba-p/3110559)
- [Jira Cloud by Atlassian — App Store reviews (mobile complaints)](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087?see-all=reviews&platform=iphone)
- [Atlassian reviews — Trustpilot (support / billing rants)](https://www.trustpilot.com/review/atlassian.com)
- [Atlassian Jira Pricing 2025: the price increases nobody warned you about (Software Pricing Guide)](https://softwarepricingguide.com/atlassian-jira-pricing-2025-every-plan-the-data-center-vs-cloud-cost-decision-and-the-price-increases-nobody-warned-you-about/)
- [What gets migrated with the Jira Cloud Migration Assistant (Atlassian Support — export/lock-in pain)](https://support.atlassian.com/migration/docs/what-gets-migrated-with-the-jira-cloud-migration-assistant/)
- [Linear Reviews — Product Hunt (switch-from-Jira + Linear gaps)](https://www.producthunt.com/products/linear/reviews)
- [Jira Sucks!! (Rant) — Blind](https://www.teamblind.com/post/jira-sucks-rant-KW0WqGcw)
- [PowerPoint, Jira Still Have Accessibility Obstacles for Blind Workers — Bloomberg](https://www.bloomberg.com/news/features/2025-09-12/powerpoint-jira-still-have-accessibility-obstacles-for-blind-workers)
- [BUG: 'We couldn't save your comment' — Atlassian Community (12+ users, Mar-Jun 2026)](https://community.atlassian.com/forums/Jira-questions/BUG-quot-We-couldn-t-save-your-comment-quot-message-doesn-t/qaq-p/3201135)
- [JRACLOUD-72289 — Unsaved changes lost when you get back to edit (24 votes)](https://jira.atlassian.com/browse/JRACLOUD-72289)
- [Critical issue-management flaws in Jira mobile app — Fibery Openion](https://fibery.io/openion/jira-cloud-112/critical-issue-management-flaws-in-jira-mobile-app-382894)
- [JIRA Android App blocked by SSO / blank screen — Atlassian Community](https://community.atlassian.com/forums/Jira-questions/JIRA-Android-App-blocked-by-SSO/qaq-p/1117891)
- [JRACLOUD-78201 — Offline mode for mobile apps ('Not Being Considered', 31 votes)](https://jira.atlassian.com/browse/JRACLOUD-78201)
- [Jira Cloud by Atlassian — App Store reviews (can't save epic, 'avoid using this app')](https://apps.apple.com/us/app/jira-cloud-by-atlassian/id1006972087)
- [Jira Pros and Cons — G2 (slow support, 2GB limit, hidden automation costs)](https://www.g2.com/products/jira/reviews?qs=pros-and-cons)
- [Atlassian Data Center end-of-life / forced cloud migration risks — Easy8](https://www.easy8.com/blog/jira-end-data-center)
- [Recover deleted attachments from tasks — ClickUp feedback (267 voters, lost resume)](https://feedback.clickup.com/feature-requests/p/recover-deleted-attachments-from-tasks)
- [Bug? Subtasks are disappearing — ClickUp feedback](https://feedback.clickup.com/feature-requests/p/bug-subtasks-are-disappearing)
- [monday.com Reviews — Trustpilot (overcharge £1,200, crash data loss, locked out)](https://www.trustpilot.com/review/www.monday.com)
- [Atlassian Increasing DC prices again — The Jira Guy](https://thejiraguy.com/2025/01/15/atlassian-increasing-dc-prices-again/)
- [Reducing noise by improving Issue grouping · getsentry/sentry · Discussion #66319](https://github.com/getsentry/sentry/discussions/66319)
- [The Hidden Costs of Sentry's Poor Error Grouping — Decipher](https://getdecipher.com/blog/the-hidden-costs-of-sentry-s-poor-error-grouping)
- [Sentry Pricing: Full Breakdown, Real Cost Examples & How to Save — Last9](https://last9.io/blog/sentry-pricing/)
- [I gave up on self-hosted Sentry (2024) — Hacker News](https://news.ycombinator.com/item?id=43725815)
- [Saving Costs on Sentry at Scale — Bugsink](https://www.bugsink.com/blog/saving-costs-on-sentry/)
- [Sentry Data Retention Periods — docs.sentry.io](https://docs.sentry.io/security-legal-pii/security/data-retention-periods/)
- [Is there a setting to decrease data retention in sentry from 90 days · Issue #14729 · getsentry/sentry](https://github.com/getsentry/sentry/issues/14729)
- [Bugzilla Reviews — Capterra (Pros & Cons)](https://www.capterra.com/p/119057/Bugzilla/reviews/)
- [HN: Bugzilla 'very ugly and directly out of the 1990s but it does work'](https://news.ycombinator.com/item?id=9190736)
- [Mozilla Bug 83245 — bugmail overload / duplicate notifications](https://bugzilla.mozilla.org/show_bug.cgi?id=83245)
- [JRASERVER-2889 — Disable notifications during Bugzilla import](https://jira.atlassian.com/browse/JRASERVER-2889)
- [T618 — Avoid massive wave of email notifications after Bugzilla migration (Wikimedia)](https://phabricator.wikimedia.org/T618)
- [YouTrack Reviews 2026 — G2 (cons / learning curve)](https://www.g2.com/products/youtrack/reviews)
- [YouTrack Reviews — JoinSecret (Pros & Cons)](https://www.joinsecret.com/youtrack/reviews)
- [YouTrack Workflows (JavaScript) — JetBrains docs](https://www.jetbrains.com/help/youtrack/cloud/workflow-guide.html)
- [Is Linear Worth It? Honest Review for Engineering Teams (2026) — Alfred](https://get-alfred.ai/blog/is-linear-worth-it)
- [Triage — Linear Docs](https://linear.app/docs/triage)
