import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, Bell, BookOpen, Bug, Building2, Check, ClipboardList, Code2, Command, Copy, Eye,
  Filter, GitBranch, History, KeyRound, LayoutGrid, Link2, ListPlus, MessageSquare, Moon,
  MousePointerClick, Palette, Plug, Search, ShieldCheck, Sparkles, Sun, TriangleAlert,
  UserPlus, Users,
} from 'lucide-react';
import { useTheme } from '@/stores/theme';
import { cn } from '@/lib/utils';
import { SHORTCUT_GROUPS, shortcutsOf, type ShortcutScope } from '@/lib/shortcuts';
import { SHOW_DEMO_ACCOUNTS } from '@/features/auth/demoLogin';
import { ScrollX } from '@/components/ui/ScrollX';

/* ============================ Khối trợ giúp UI ============================ */

function Cmd({ code }: { code: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative mb-3 overflow-hidden rounded-lg border border-border bg-surface-2">
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(code).then(() => { setDone(true); setTimeout(() => setDone(false), 1400); }).catch(() => undefined)}
        className={cn('absolute right-2 top-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
          done ? 'border-success/40 text-success' : 'border-border bg-surface text-muted hover:text-ink')}
      >
        {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{done ? 'Đã sao chép' : 'Sao chép'}
      </button>
      <pre className="overflow-x-auto px-4 py-3 pr-24 font-mono text-[13px] leading-relaxed text-ink">{code}</pre>
    </div>
  );
}
function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-block rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-ink-strong">{children}</kbd>;
}
function Mono({ children }: { children: ReactNode }) {
  return <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-ink-strong">{children}</code>;
}
function H2({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="mb-3 scroll-mt-6 border-b border-border pb-2 text-2xl font-semibold tracking-tight text-ink-strong">{children}</h2>;
}
function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-7 text-[15px] font-semibold text-ink-strong">{children}</h3>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[15px] leading-relaxed text-muted">{children}</p>;
}
function Note({ kind = 'tip', children }: { kind?: 'tip' | 'warn' | 'info'; children: ReactNode }) {
  const styles = {
    tip: 'border-[color:var(--border)] bg-primary-subtle text-primary',
    info: 'border-border bg-surface-2 text-muted',
    warn: 'border-warning/30 bg-warning/10 text-warning',
  }[kind];
  const icon = { tip: '✦', info: '⌁', warn: <TriangleAlert className="h-4 w-4" /> }[kind];
  return <div className={cn('mb-3 flex gap-2.5 rounded-lg border px-4 py-3 text-sm', styles)}><span className="shrink-0 font-bold">{icon}</span><span>{children}</span></div>;
}
function Cards({ children }: { children: ReactNode }) {
  return <div className="mb-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>;
}
function Card({ name, val, desc }: { name: string; val: string; desc?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-surface px-3.5 py-3">
      <span className="text-xs font-semibold text-muted">{name}</span>
      <span className="break-all text-[13px] text-ink-strong">{val}</span>
      {desc && <span className="text-xs text-faint">{desc}</span>}
    </div>
  );
}
function Feature({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5 border-b border-border py-3.5 last:border-none">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary">{icon}</span>
      <div className="min-w-0"><b className="mb-0.5 block text-[15px] text-ink-strong">{title}</b><p className="m-0 text-sm text-muted">{children}</p></div>
    </div>
  );
}
function Table({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <ScrollX className="mb-3 rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-border bg-surface-2 text-left text-xs text-muted">
          <th className="px-4 py-2.5 font-semibold">{head[0]}</th><th className="px-4 py-2.5 font-semibold">{head[1]}</th>
        </tr></thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => <tr key={i}><td className="whitespace-nowrap px-4 py-2.5 align-top">{r[0]}</td><td className="px-4 py-2.5 align-top text-muted">{r[1]}</td></tr>)}
        </tbody>
      </table>
    </ScrollX>
  );
}

/** Bảng phím của một nhóm, đọc từ kho `lib/shortcuts.ts` (cùng nguồn với bảng `?` và tooltip). */
function ShortcutTable({ scope }: { scope: ShortcutScope }) {
  return (
    <Table
      head={['Phím', 'Hành động']}
      rows={shortcutsOf(scope).map((s): [ReactNode, ReactNode] => [
        <span key={s.id} className="flex flex-wrap items-center gap-1">
          {(s.display ?? s.keys).map((k, i) => (
            <span key={i} className="flex items-center gap-1">
              {s.sequence && i > 0 && <span className="text-xs text-faint">rồi</span>}
              <Kbd>{k}</Kbd>
            </span>
          ))}
        </span>,
        s.label,
      ])}
    />
  );
}

/** Danh sách bước có đánh số — dùng cho hướng dẫn thao tác tuần tự. */
function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mb-3 space-y-2.5">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-muted">
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-ink-strong">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** Hai cột "Làm được / Không làm được" — bóc tách ranh giới quyền của một vai trò. */
function CanDo({ can, cant }: { can: ReactNode[]; cant?: ReactNode[] }) {
  return (
    <div className={cn('mb-4 grid gap-2.5', cant && 'sm:grid-cols-2')}>
      <div className="rounded-lg border border-border bg-surface p-4">
        <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-success"><Check className="h-4 w-4" /> Làm được</p>
        <ul className="space-y-2 text-sm text-muted">
          {can.map((c, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-success/80" /><span>{c}</span></li>)}
        </ul>
      </div>
      {cant && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <p className="mb-2.5 flex items-center gap-1.5 text-[13px] font-semibold text-faint">Không làm được</p>
          <ul className="space-y-2 text-sm text-muted">
            {cant.map((c, i) => <li key={i} className="flex gap-2"><span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" /><span>{c}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Tiêu đề khối vai trò: biểu tượng + tên + một dòng mô tả persona. */
function RoleHead({ id, icon, title, persona }: { id: string; icon: ReactNode; title: string; persona: string }) {
  return (
    <div id={id} className="mb-4 scroll-mt-6 border-b border-border pb-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary-subtle text-primary">{icon}</span>
        <h2 className="text-2xl font-semibold tracking-tight text-ink-strong">{title}</h2>
      </div>
      <p className="mt-1.5 text-sm text-muted">{persona}</p>
    </div>
  );
}

/** Ô trong ma trận quyền. */
function Perm({ v }: { v: 'yes' | 'own' | 'view' | 'cfg' | 'no' }) {
  const map = {
    yes: ['Có', 'text-success'],
    own: ['Của mình', 'text-primary'],
    view: ['Xem', 'text-muted'],
    cfg: ['Tuỳ', 'text-warning'],
    no: ['—', 'text-faint'],
  } as const;
  const [label, cls] = map[v];
  return <span className={cn('text-xs font-medium', cls)}>{label}</span>;
}
function Matrix({ cols, rows }: { cols: string[]; rows: [string, ...ReactNode[]][] }) {
  return (
    <ScrollX className="mb-3 rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2 text-left text-xs text-muted">
            <th className="px-4 py-2.5 font-semibold">{cols[0]}</th>
            {cols.slice(1).map((c) => <th key={c} className="px-3 py-2.5 text-center font-semibold">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2.5 align-top text-muted">{r[0]}</td>
              {r.slice(1).map((cell, j) => <td key={j} className="px-3 py-2.5 text-center align-top">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
function Legend() {
  return (
    <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
      <span><span className="font-medium text-success">Có</span> = toàn quyền</span>
      <span><span className="font-medium text-primary">Của mình</span> = chỉ mục do mình tạo/được giao</span>
      <span><span className="font-medium text-muted">Xem</span> = chỉ đọc</span>
      <span><span className="font-medium text-warning">Tuỳ</span> = tuỳ quyền được cấp</span>
      <span><span className="font-medium">—</span> = không</span>
    </p>
  );
}

/* ============================ Cấu trúc điều hướng ============================ */

const NAV: { group: string; items: [string, string][] }[] = [
  { group: 'Bắt đầu', items: [['gioi-thieu', 'Giới thiệu'], ['khai-niem', 'Khái niệm cơ bản'], ['dang-nhap', 'Đăng nhập & tài khoản'], ['vai-tro', 'Hiểu về vai trò']] },
  { group: 'Ai cũng dùng', items: [['dieu-huong', 'Điều hướng & Cmd+K'], ['lam-viec-issue', 'Thao tác với công việc'], ['thong-bao', 'Thông báo & theo dõi'], ['tim-kiem', 'Tìm kiếm & bộ lọc'], ['ca-nhan', 'Cá nhân hoá']] },
  { group: 'Theo vai trò', items: [['vt-reporter', 'Người báo cáo'], ['vt-developer', 'Lập trình viên'], ['vt-lead', 'Quản trị dự án'], ['vt-ws-admin', 'Quản trị chung'], ['vt-viewer', 'Người xem'], ['vt-sys-admin', 'Quản trị hệ thống']] },
  { group: 'Nâng cao', items: [['quan-ly-nang-cao', 'Quản lý nâng cao'], ['ai', 'AI hỗ trợ'], ['bao-cao', 'Báo cáo & phân tích'], ['tich-hop', 'Tích hợp'], ['phim-tat', 'Phím tắt'], ['faq', 'Câu hỏi thường gặp']] },
];
const ALL_IDS = NAV.flatMap((g) => g.items.map((i) => i[0]));
const LABEL = (id: string) => NAV.flatMap((g) => g.items).find((i) => i[0] === id)?.[1];

/* ============================ Trang ============================ */

export function DocumentationPage() {
  const { theme, toggle } = useTheme();
  const [active, setActive] = useState(ALL_IDS[0]);

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-8% 0px -70% 0px', threshold: 0 },
    );
    ALL_IDS.forEach((id) => { const el = document.getElementById(id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <div className="mx-auto flex max-w-[1200px]">
        {/* ---------------- Sidebar riêng ---------------- */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface lg:flex">
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-fg">T</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-ink-strong">Tirapro</div>
              <div className="text-xs text-faint">Hướng dẫn sử dụng</div>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {NAV.map((g) => (
              <div key={g.group} className="mb-4">
                <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{g.group}</p>
                {g.items.map(([id, label]) => (
                  <a key={id} href={`#${id}`} onClick={() => setActive(id)}
                    className={cn('block rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
                      active === id ? 'bg-primary-subtle text-primary' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
                    {label}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
            <Link to="/" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">Mở ứng dụng <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            <button type="button" onClick={toggle} aria-label="Đổi giao diện" className="grid h-8 w-8 place-items-center rounded-md text-faint transition-colors hover:bg-surface-2 hover:text-ink">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </aside>

        {/* ---------------- Nội dung ---------------- */}
        <main className="min-w-0 flex-1 px-5 py-8 sm:px-10 sm:py-12">
          {/* Header mobile */}
          <div className="mb-6 flex items-center justify-between lg:hidden">
            <div className="flex items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-fg">T</div>
              <span className="font-semibold text-ink-strong">Tirapro · Hướng dẫn</span>
            </div>
            <Link to="/" className="text-sm font-medium text-primary hover:underline">Mở ứng dụng →</Link>
          </div>

          <div className="mx-auto max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary"><BookOpen className="h-4 w-4" /> Hướng dẫn sử dụng</div>
            <h1 className="mb-3 text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">Dùng Tirapro theo vai trò</h1>
            <p className="mb-8 text-[16px] leading-relaxed text-muted">
              Hướng dẫn dành cho người dùng — không phải tài liệu cài đặt. Nắm nhanh các khái niệm, rồi tìm đúng phần <strong>vai trò của bạn</strong> để biết mình làm được gì và làm thế nào. Quyền thực tế = <em>hợp</em> của vai trò ở không gian làm việc và ở từng dự án.
            </p>

            {/* mobile TOC chips */}
            <div className="mb-10 flex flex-wrap gap-1.5 lg:hidden">
              {['gioi-thieu', 'vai-tro', 'vt-reporter', 'vt-developer', 'vt-lead', 'vt-ws-admin', 'phim-tat', 'faq'].map((id) => (
                <a key={id} href={`#${id}`} className="rounded-full border border-border bg-surface px-3 py-1 text-[13px] text-muted">{LABEL(id)}</a>
              ))}
            </div>

            {/* ============== BẮT ĐẦU ============== */}
            <section className="mb-14">
              <H2 id="gioi-thieu">Giới thiệu</H2>
              <P>Tirapro là công cụ quản lý công việc &amp; dự án kiểu Jira, bổ sung <strong>AI</strong> (viết sẵn công việc, tóm tắt, gợi ý), cập nhật <strong>realtime</strong> và <strong>báo cáo</strong>. Mỗi người dùng thấy và thao tác khác nhau tuỳ vai trò được cấp — tài liệu này chia theo vai trò để bạn tìm đúng phần của mình.</P>
              <H3>Bắt đầu trong 3 bước</H3>
              <Steps items={[
                <><strong className="text-ink-strong">Đăng nhập</strong> bằng tài khoản được cấp (hoặc tài khoản dùng thử ở phần dưới).</>,
                <><strong className="text-ink-strong">Chọn dự án</strong> trong mục Dự án để mở Bảng việc / Việc chờ của dự án đó.</>,
                <>Mở phần <strong className="text-ink-strong">vai trò của bạn</strong> trong tài liệu này để xem việc mình làm được và cách làm.</>,
              ]} />
              <Note kind="tip">Không chắc mình có vai trò nào? Xem mục <a href="#vai-tro" className="font-medium underline">Hiểu về vai trò</a> để biết cách tra vai trò của bản thân.</Note>
            </section>

            <section className="mb-14">
              <H2 id="khai-niem">Khái niệm cơ bản</H2>
              <P>Vài thuật ngữ xuất hiện xuyên suốt ứng dụng:</P>
              <Table head={['Thuật ngữ', 'Ý nghĩa']} rows={[
                [<strong className="text-ink-strong">Không gian làm việc</strong>, 'Nơi riêng của một công ty hoặc phòng ban, chứa nhiều dự án và thành viên. Một người có thể thuộc nhiều nơi khác nhau.'],
                [<strong className="text-ink-strong">Dự án (Project)</strong>, 'Nơi chứa công việc, có Bảng việc, Việc chờ, Sprint và cấu hình riêng.'],
                [<strong className="text-ink-strong">Công việc</strong>, <>Một đầu việc cần làm — có thể là lỗi cần sửa, việc mới, hay một yêu cầu lớn. Mỗi việc có mã riêng như <Mono>DEMO-12</Mono> để nhắc tới cho gọn.</>],
                [<strong className="text-ink-strong">Bảng việc (Board)</strong>, 'Xem công việc theo cột trạng thái, kéo-thả card giữa các cột.'],
                [<strong className="text-ink-strong">Việc chờ (backlog)</strong>, 'Danh sách việc chờ, xếp thứ tự ưu tiên và đưa vào sprint.'],
                [<strong className="text-ink-strong">Sprint</strong>, 'Chu kỳ làm việc có thời hạn (thường 1–2 tuần).'],
                [<strong className="text-ink-strong">Quy trình (Workflow)</strong>, 'Tập trạng thái và các đường chuyển tiếp hợp lệ giữa chúng.'],
                [<strong className="text-ink-strong">Epic / Việc con</strong>, 'Epic gom nhiều công việc liên quan thành một khối lớn; việc con là phần nhỏ tách ra từ một công việc.'],
              ]} />
            </section>

            <section className="mb-14">
              <H2 id="dang-nhap">Đăng nhập &amp; tài khoản</H2>
              <P>Mở ứng dụng và đăng nhập bằng email + mật khẩu được cấp. Quên mật khẩu thì dùng liên kết đặt lại ở màn đăng nhập, hoặc nhờ quản trị chung cấp lại.</P>
              {/* Chỉ bản dev / build demo (VITE_SHOW_DEMO_ACCOUNTS) — production công khai không nêu mật khẩu demo. */}
              {SHOW_DEMO_ACCOUNTS && (<>
              <H3>Tài khoản dùng thử</H3>
              <P>Bản demo có sẵn các tài khoản dưới đây (mật khẩu chung <Mono>Password123</Mono>), mỗi tài khoản đại diện một vai trò để bạn trải nghiệm nhanh:</P>
              <div className="mb-3 rounded-lg border border-border bg-surface px-4">
                {[['A', 'var(--primary)', 'admin@projira.dev', 'Quản trị hệ thống + Quản trị chung'],
                  ['B', '#7048b6', 'ba@tirapro.dev', 'Phân tích nghiệp vụ (làm rõ yêu cầu, xem báo cáo)'],
                  ['D', 'var(--success)', 'dev@tirapro.dev', 'Lập trình viên'],
                  ['T', 'var(--warning)', 'tester@tirapro.dev', 'Tester (báo & kiểm thử)']].map(([av, bg, em, ro]) => (
                  <div key={em} className="flex items-center gap-3 border-b border-border py-2.5 last:border-none">
                    <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-bold text-white" style={{ background: bg }}>{av}</span>
                    <span className="font-mono text-[13px] text-ink-strong">{em}</span>
                    <span className="ml-auto text-right text-xs text-muted">{ro}</span>
                  </div>
                ))}
              </div>
              </>)}
              <H3>Chuyển không gian làm việc &amp; đăng xuất</H3>
              <P>Nếu bạn thuộc nhiều nơi, dùng bộ chọn không gian làm việc ở đầu thanh bên để chuyển. Đăng xuất ở menu người dùng góc phải trên (cũng có sẵn liên kết mở lại tài liệu này).</P>
            </section>

            <section className="mb-14">
              <H2 id="vai-tro">Hiểu về vai trò</H2>
              <P><strong>Thành viên tính trên cả không gian làm việc</strong>: ai đã có tên ở đây là tự động tham gia <em>mọi dự án công khai</em> bên trong — không cần thêm người vào từng dự án. <strong>Dự án riêng tư</strong> (bật ở dự án → Cấu hình → Chung) là ngoại lệ: chỉ những người được thêm riêng ở Cấu hình → Thành viên (cùng quản trị không gian làm việc) mới thấy dự án đó. Vai trò trong dự án <strong>mặc định</strong> suy từ vai trò chung (Quản trị chung → Quản trị dự án · Thành viên → Lập trình viên · Người xem → chỉ đọc), và có thể <strong>đặt riêng</strong> cho từng người ở từng dự án khi cần.</P>
              <Cards>
                <Card name="Vai trò cấp không gian làm việc" val="Quản trị chung · Thành viên · Người xem" desc="Quyền áp dụng cho toàn tổ chức" />
                <Card name="Vai trò cấp Dự án" val="Quản trị · Developer · Reporter" desc="Mặc định suy từ vai trò chung; đặt riêng khi cần" />
              </Cards>
              <H3>Ai làm được gì — ở phạm vi cả tổ chức</H3>
              <Matrix cols={['Hành động', 'Quản trị hệ thống', 'Quản trị chung', 'Thành viên', 'Người xem']} rows={[
                ['Xem không gian làm việc & dự án được phép', <Perm v="yes" />, <Perm v="yes" />, <Perm v="yes" />, <Perm v="view" />],
                ['Tạo dự án', <Perm v="yes" />, <Perm v="yes" />, <Perm v="cfg" />, <Perm v="no" />],
                ['Lưu trữ / xoá dự án', <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />],
                ['Thêm / gỡ thành viên của tổ chức', <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />],
                ['Tạo vai trò & phân quyền', <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />],
                ['Cấu hình chung / gói dịch vụ', <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />],
                ['Dùng AI', <Perm v="yes" />, <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />],
                ['Quản trị nền tảng (nhiều không gian làm việc)', <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />, <Perm v="no" />],
              ]} />
              <H3>Ai làm được gì — phạm vi Dự án</H3>
              <Matrix cols={['Hành động', 'Quản trị DA', 'Developer', 'Reporter', 'Viewer']} rows={[
                ['Xem bảng việc / công việc / báo cáo', <Perm v="yes" />, <Perm v="yes" />, <Perm v="yes" />, <Perm v="view" />],
                ['Tạo công việc', <Perm v="yes" />, <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />],
                ['Sửa công việc', <Perm v="yes" />, <Perm v="yes" />, <Perm v="own" />, <Perm v="no" />],
                ['Chuyển trạng thái', <Perm v="yes" />, <Perm v="yes" />, <Perm v="own" />, <Perm v="no" />],
                ['Gán người thực hiện', <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />],
                ['Xoá công việc', <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />, <Perm v="no" />],
                ['Kéo-thả trên bảng việc', <Perm v="yes" />, <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />],
                ['Quản lý sprint / quy trình / bảng việc', <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />, <Perm v="no" />],
                ['Đặt vai trò riêng trong dự án', <Perm v="yes" />, <Perm v="no" />, <Perm v="no" />, <Perm v="no" />],
              ]} />
              <Legend />
              <Note kind="info">Xem vai trò của mình: vào trang <strong>Thành viên</strong> của không gian làm việc hoặc trang <strong>Cấu hình dự án → Thành viên</strong>. Không thấy một nút (sửa, kéo-thả, cấu hình)? Gần như chắc chắn do vai trò của bạn chưa có quyền đó.</Note>
            </section>

            {/* ============== AI CŨNG DÙNG ============== */}
            <section className="mb-14">
              <H2 id="dieu-huong">Điều hướng &amp; Command palette</H2>
              <P>Mọi người dùng đã đăng nhập đều có các cách di chuyển nhanh sau:</P>
              <div className="border-t border-border">
                <Feature icon={<Command className="h-4 w-4" />} title="Bảng lệnh — ⌘K (Ctrl+K)">Tìm công việc, nhảy tới dự án/màn hình, chạy hành động, đổi giao diện; có nhóm “Gần đây”. Gõ thẳng mã công việc (vd <Mono>DEMO-12</Mono>) để mở ngay. Có sẵn lệnh tạo / bắt đầu / kết thúc sprint, mở Báo cáo · Lịch trình · Việc mới vào · Wiki và <em>Báo lỗi</em> (bắt đầu gõ tên lệnh là lọc, không cần dấu).</Feature>
                <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Thanh bên & bộ chọn dự án">Chuyển giữa các dự án, mở Bảng việc / Việc chờ / Lịch trình / Báo cáo / Cây việc.</Feature>
                <Feature icon={<History className="h-4 w-4" />} title="Xem gần đây">Công việc vừa mở hiện lại trong ⌘K và trên Trang tổng quan để quay lại nhanh.</Feature>
              </div>
              <Note kind="tip">Gõ <Kbd>g</Kbd> rồi <Kbd>b</Kbd> để tới Bảng việc, <Kbd>g</Kbd> <Kbd>l</Kbd> tới Việc chờ. Xem đầy đủ ở mục <a href="#phim-tat" className="font-medium underline">Phím tắt</a>.</Note>
            </section>

            <section className="mb-14">
              <H2 id="lam-viec-issue">Thao tác với công việc</H2>
              <P>Công việc là trung tâm của mọi thứ trong Tirapro. Những thao tác dưới đây có hay không tuỳ vai trò của bạn trong dự án (xem <a href="#vai-tro" className="font-medium underline">ma trận quyền</a>).</P>
              <div className="border-t border-border">
                <Feature icon={<ListPlus className="h-4 w-4" />} title="Tạo & sửa nhanh">Nhấn <Kbd>c</Kbd> ở bất kỳ đâu để tạo công việc; sửa tại chỗ nhiều trường ngay trên trang chi tiết. Ô tiêu đề hiểu cú pháp gõ nhanh (người <Mono>@</Mono>, ưu tiên, điểm, sprint, hạn như <Mono>^15/8</Mono>) và báo khi một phần không khớp; <Kbd>⌘</Kbd> <Kbd>Enter</Kbd> luôn tạo ngay. Mọi ô ngày nhập theo <Mono>dd/MM/yyyy</Mono> (giờ <Mono>HH:mm</Mono>), gõ liền <Mono>0508</Mono> hoặc chọn từ lịch.</Feature>
                <Feature icon={<Eye className="h-4 w-4" />} title="Xem nhanh hay mở trang đầy đủ">Bấm một dòng ở Việc chờ, Việc mới vào hoặc thẻ trên Bảng việc để mở <strong>khung xem nhanh</strong> bên phải (<Kbd>Esc</Kbd> đóng, nút <em>Mở trang</em> để vào trang đầy đủ). <Kbd>⌘</Kbd>/<Kbd>Ctrl</Kbd> + bấm, hoặc bấm vào mã công việc, mở thẳng trang đầy đủ.</Feature>
                <Feature icon={<GitBranch className="h-4 w-4" />} title="Chuyển trạng thái">Đổi trạng thái theo quy trình của dự án; xem sơ đồ quy trình ngay trên công việc.</Feature>
                <Feature icon={<MessageSquare className="h-4 w-4" />} title="Bình luận & @nhắc tên">Thảo luận bằng markdown (có danh sách tick được, bảng); gõ <Mono>@</Mono> để chọn đồng đội (tìm không dấu) — cả trong bình luận lẫn mô tả, họ nhận thông báo “X nhắc đến bạn” kèm trích đoạn. Đính kèm hoặc dán ảnh (<Kbd>Ctrl</Kbd> <Kbd>V</Kbd>), bấm ảnh để xem lớn.</Feature>
                <Feature icon={<Link2 className="h-4 w-4" />} title="Liên kết & phân cấp">Liên kết các công việc liên quan (tìm theo mã hoặc tiêu đề không dấu; loại liên kết giữ tiếng Anh như <Mono>blocks</Mono>, <Mono>is caused by</Mono>, <Mono>is tested by</Mono>), tạo việc con, gắn vào epic bằng ô <em>Epic / Việc cha</em>. Ở Việc chờ có khung Epic để lọc và kéo công việc vào epic.</Feature>
                <Feature icon={<Bug className="h-4 w-4" />} title="Mức nghiêm trọng & cách giải quyết">Bug có <strong>Mức nghiêm trọng</strong> (Severity) riêng, tách khỏi mức ưu tiên. Chuyển sang nhóm <em>Done</em> thì được hỏi <strong>cách giải quyết</strong> (Resolution, mặc định Done); <em>Mở lại</em> / <em>Trả lại</em> ghi kèm lý do vào bình luận.</Feature>
                <Feature icon={<History className="h-4 w-4" />} title="Lịch sử & theo dõi">Xem toàn bộ thay đổi; theo dõi (watch) để nhận cập nhật; log thời gian làm việc.</Feature>
              </div>
              <Note kind="tip">Trên trang chi tiết: <Kbd>i</Kbd> gán công việc cho tôi, <Kbd>y</Kbd> sao chép liên kết. Nút “Gán cho tôi” và nút sao chép mã cũng nằm ngay trên thanh công cụ.</Note>
            </section>

            <section className="mb-14">
              <H2 id="thong-bao">Thông báo &amp; theo dõi</H2>
              <div className="border-t border-border">
                <Feature icon={<Bell className="h-4 w-4" />} title="Trung tâm thông báo">Mỗi thông báo ghi rõ <em>ai</em> làm <em>gì</em> (kèm giá trị mới / trích đoạn bình luận), các thay đổi liên tiếp trên một công việc được gộp lại. Trang <Mono>Thông báo</Mono> lọc <em>Chưa đọc · Được nhắc · Được giao</em> và có nút <em>Đánh dấu đã đọc tất cả</em>.</Feature>
                <Feature icon={<Eye className="h-4 w-4" />} title="Theo dõi">Bấm theo dõi một công việc để luôn nhận cập nhật kể cả khi không phải người thực hiện. Người tạo và người được giao được tự động theo dõi.</Feature>
              </div>
              <Note kind="info">Muốn nhận thông báo qua Telegram? Xem mục <a href="#tich-hop" className="font-medium underline">Tích hợp</a> — cần quản trị chung bật kết nối trước.</Note>
            </section>

            <section className="mb-14">
              <H2 id="tim-kiem">Tìm kiếm &amp; bộ lọc</H2>
              <div className="border-t border-border">
                <Feature icon={<Search className="h-4 w-4" />} title="Tìm nhanh">Nhấn <Kbd>/</Kbd> để mở ô tìm kiếm; tìm theo mã, tiêu đề, nội dung.</Feature>
                <Feature icon={<Filter className="h-4 w-4" />} title="Lọc nhanh & bộ lọc lưu">Chip lọc nhanh <em>Của tôi · Quá hạn · Chưa gán</em> trên Bảng việc &amp; Việc chờ; lưu bộ lọc cá nhân để dùng lại.</Feature>
                <Feature icon={<Sparkles className="h-4 w-4" />} title="Tìm kiếm ngữ nghĩa (AI)">Tìm theo ý nghĩa gần đúng thay vì đúng từ khoá; tự giảm về tìm toàn văn khi chưa bật embedding.</Feature>
              </div>
              <H3>Cú pháp JQL (nâng cao)</H3>
              <P>Ô tìm kiếm nâng cao hỗ trợ JQL để lọc chính xác, ví dụ:</P>
              <Cmd code={`assignee = me AND status != "Done" ORDER BY priority DESC`} />
              <P>Ô soạn truy vấn tự gợi ý trường và giá trị khi gõ; <Mono>me</Mono> (hoặc <Mono>currentUser()</Mono>) là chính bạn. Giá trị sai được báo kèm gợi ý “ý bạn là…”. Kết quả hiện dạng bảng — chọn cột hiển thị, bấm <em>Xuất CSV</em>, hoặc <em>Lưu truy vấn</em> ngay cạnh nút Chạy để dùng lại.</P>
            </section>

            <section className="mb-14">
              <H2 id="ca-nhan">Cá nhân hoá</H2>
              <div className="border-t border-border">
                <Feature icon={<Palette className="h-4 w-4" />} title="Giao diện sáng / tối">Đổi theme trong menu người dùng hoặc từ ⌘K — áp dụng ngay, nhớ lựa chọn.</Feature>
                <Feature icon={<UserPlus className="h-4 w-4" />} title="Hồ sơ cá nhân">Cập nhật tên hiển thị, ảnh đại diện, múi giờ, ngôn ngữ; đổi mật khẩu trong trang Tài khoản.</Feature>
                <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Trang tổng quan cá nhân">Việc được giao, việc mình báo, công việc đang theo dõi và các mục vừa mở — tất cả ở một nơi.</Feature>
              </div>
            </section>

            {/* ============== THEO VAI TRÒ ============== */}
            <section className="mb-14">
              <RoleHead id="vt-reporter" icon={<Bug className="h-5 w-5" />} title="Người báo cáo" persona="Reporter / Stakeholder — người báo bug, đề xuất yêu cầu, theo dõi tiến độ. Ví dụ: CS, khách hàng nội bộ, tester." />
              <CanDo
                can={[
                  <>Tạo công việc để <strong>báo lỗi</strong> hoặc <strong>đề xuất yêu cầu</strong>.</>,
                  <>Sửa công việc <em>do mình tạo hoặc được giao</em>.</>,
                  'Bình luận, @nhắc tên, đính kèm tệp, theo dõi công việc.',
                  'Xem bảng việc, việc chờ, công việc và báo cáo (chỉ đọc).',
                ]}
                cant={[
                  'Tự ý chuyển trạng thái công việc của người khác.',
                  'Gán người thực hiện, xoá công việc của người khác.',
                  'Cấu hình dự án, bảng việc hay quy trình.',
                ]}
              />
              <H3>Báo một bug</H3>
              <Steps items={[
                <>Mở <Kbd>⌘</Kbd> <Kbd>K</Kbd> → <em>Báo lỗi</em> (hoặc nút <em>Báo lỗi</em> ở đầu Bảng việc / nút nổi).</>,
                'Nhập tiêu đề ngắn gọn; chế độ Cơ bản chỉ bắt buộc tiêu đề (mô tả ngắn là tuỳ chọn; môi trường và mức nghiêm trọng mặc định tự điền), chế độ Nâng cao có mẫu tái hiện, mức nghiêm trọng, môi trường (trình duyệt / hệ điều hành / bản build / URL) và ảnh dán trực tiếp.',
                'Nếu có bug tương tự, hệ thống gợi ý: chọn “Thêm ghi chú vào <mã bug cũ>” (bạn thành người theo dõi bug đó) hoặc “Vẫn tạo mới”.',
                <>Gửi. Bạn được tự động <strong>theo dõi</strong> công việc đó và sẽ nhận thông báo khi có cập nhật.</>,
              ]} />
            </section>

            <section className="mb-14">
              <RoleHead id="vt-developer" icon={<Code2 className="h-5 w-5" />} title="Lập trình viên" persona="Developer / QA / Designer — người trực tiếp xử lý công việc trong dự án." />
              <CanDo
                can={[
                  'Tạo & sửa mọi công việc trong dự án; đặt story points / ước lượng.',
                  'Chuyển trạng thái theo quy trình, gán người, liên kết & tạo việc con.',
                  'Kéo-thả thẻ trên bảng việc (cập nhật tức thì), xếp ưu tiên việc chờ (nếu được cấp).',
                  'Bình luận, đính kèm, ghi nhận thời gian; dùng AI & tìm kiếm theo ý nghĩa.',
                ]}
                cant={[
                  'Quản lý bảng việc / quy trình / sprint.',
                  'Xoá công việc, quản lý thành viên hay cấu hình dự án.',
                ]}
              />
              <H3>Nhận &amp; hoàn thành một công việc</H3>
              <Steps items={[
                <>Mở Bảng việc, tìm việc của mình (chip <em>Của tôi</em>) hoặc bấm <Kbd>i</Kbd> trên công việc để <strong>gán cho tôi</strong>.</>,
                'Kéo thẻ sang cột đang làm, cập nhật story points / ghi nhận thời gian khi cần.',
                'Xong việc thì kéo sang cột hoàn tất — người theo dõi được thông báo ngay.',
              ]} />
            </section>

            <section className="mb-14">
              <RoleHead id="vt-lead" icon={<ClipboardList className="h-5 w-5" />} title="Quản trị dự án" persona="Trưởng dự án / điều phối — chịu trách nhiệm cấu hình và vận hành một dự án." />
              <CanDo
                can={[
                  'Toàn bộ quyền của Lập trình viên, cộng thêm:',
                  'Cấu hình bảng việc (cột ↔ trạng thái, giới hạn việc đang làm, làn ngang) và quy trình.',
                  'Tạo/sửa trường thông tin thêm cấp dự án, nhãn / thành phần / phiên bản.',
                  'Quản lý thành viên & gán vai trò trong dự án.',
                  'Quản lý sprint: tạo, bắt đầu, kết thúc (sinh báo cáo); xoá công việc.',
                  'Dùng trợ lý AI lập kế hoạch sprint; xem mọi báo cáo dự án.',
                ]}
              />
              <H3>Lập &amp; chạy một sprint</H3>
              <Steps items={[
                'Vào Việc chờ, kéo các công việc ưu tiên vào sprint mới (hoặc nhờ AI gợi ý phạm vi).',
                <>Bấm <strong>Bắt đầu sprint</strong>, đặt thời hạn và mục tiêu.</>,
                <>Theo dõi tiến độ qua <a href="#bao-cao" className="font-medium underline">Burndown</a>; kết thúc sprint để chốt số liệu và chuyển việc dở sang sprint sau.</>,
              ]} />
            </section>

            <section className="mb-14">
              <RoleHead id="vt-ws-admin" icon={<Building2 className="h-5 w-5" />} title="Quản trị chung" persona="Trưởng phòng / quản trị tổ chức — đứng trên tất cả dự án trong một không gian làm việc." />
              <CanDo
                can={[
                  'Tạo / sửa / lưu trữ / xoá dự án trong không gian làm việc.',
                  'Thêm trực tiếp thành viên (không có lời mời — người được thêm vào ngay), gỡ thành viên, tạo tài khoản mới, khoá / mở khoá, đặt lại mật khẩu, gán vai trò.',
                  'Tạo dự án từ mẫu (Scrum / Kanban / Quản lý yêu cầu); đặt dự án riêng tư; xem Cài đặt → Nhật ký quản trị.',
                  'Tạo vai trò tuỳ biến và trộn bộ quyền (RBAC).',
                  'Cấu hình chung (tên, đường dẫn, gói dịch vụ), trường thông tin thêm & loại công việc dùng cho mọi dự án.',
                  'Tạo bảng tổng quan & bộ lọc chia sẻ cho toàn tổ chức.',
                  'Quản lý tích hợp (Telegram, nhập từ Jira) và API key.',
                  'Kế thừa quyền Quản trị dự án ở mọi dự án.',
                ]}
              />
              <H3>Thêm người mới &amp; phân quyền</H3>
              <Steps items={[
                <>Vào trang <strong>Thành viên</strong> của không gian làm việc, chọn người có sẵn hoặc tạo tài khoản mới, rồi chọn vai trò chung cho họ.</>,
                <>Xong! Họ đã tham gia mọi dự án công khai (dự án riêng tư cần thêm họ riêng). Chỉ khi cần vai trò khác mặc định ở một dự án, vào <strong>dự án → Cấu hình → Thành viên</strong> để <em>đặt vai trò riêng</em>.</>,
                'Cần bộ quyền riêng? Tạo vai trò tuỳ biến trong Cài đặt → Vai trò rồi gán cho người dùng.',
              ]} />
            </section>

            <section className="mb-14">
              <RoleHead id="vt-viewer" icon={<Eye className="h-5 w-5" />} title="Người xem" persona="Viewer — khách nội bộ, quản lý cấp trên chỉ cần theo dõi mà không chỉnh sửa." />
              <CanDo
                can={[
                  'Xem bảng việc, việc chờ, công việc, bình luận, báo cáo và trang tổng quan được chia sẻ.',
                  'Dùng tìm kiếm, bộ lọc và chuyển giữa các dự án được phép.',
                ]}
                cant={[
                  'Tạo / sửa / xoá bất cứ thứ gì.',
                  'Bình luận, gán việc hay dùng hành động ghi của AI.',
                ]}
              />
              <Note kind="info">Nếu cần thao tác nhiều hơn, hãy đề nghị quản trị chung nâng vai trò của bạn lên Thành viên hoặc một vai trò dự án phù hợp.</Note>
            </section>

            <section className="mb-14">
              <RoleHead id="vt-sys-admin" icon={<ShieldCheck className="h-5 w-5" />} title="Quản trị hệ thống" persona="Chủ hệ thống — đứng trên mọi không gian làm việc. Vào trang quản trị tại /admin." />
              <P>Console quản trị có giao diện riêng, không gắn với không gian làm việc nào. Đăng nhập tài khoản có cờ quản trị hệ thống (vd <Mono>admin@projira.dev</Mono>) rồi mở menu người dùng → <strong>Admin hệ thống</strong>.</P>
              <div className="border-t border-border">
                <Feature icon={<ShieldCheck className="h-4 w-4" />} title="Tổng quan & sức khoẻ">Số liệu toàn hệ thống và trạng thái degrade từng dịch vụ (DB · Redis · AI · Embedding · Lưu trữ).</Feature>
                <Feature icon={<Building2 className="h-4 w-4" />} title="Không gian làm việc">Quản lý mọi nơi làm việc trong hệ thống: đổi gói, lưu trữ / khôi phục, xem chủ sở hữu.</Feature>
                <Feature icon={<Users className="h-4 w-4" />} title="Tài khoản">Tạo người dùng, cấp/thu quyền lập không gian làm việc mới và quyền quản trị hệ thống.</Feature>
                <Feature icon={<Sparkles className="h-4 w-4" />} title="Cấu hình & Feature flags">Bật/tắt runtime: đăng ký công khai, kill-switch AI, tích hợp, banner bảo trì; xem nhật ký audit.</Feature>
              </div>
            </section>

            {/* ============== NÂNG CAO ============== */}
            <section className="mb-14">
              <H2 id="quan-ly-nang-cao">Quản lý nâng cao</H2>
              <P>Ngoài Scrum/Kanban, Tirapro hỗ trợ các mô hình quản lý sau — tất cả nằm trong mục Danh mục của thanh điều hướng.</P>
              <div className="border-t border-border">
                <Feature icon={<GitBranch className="h-4 w-4" />} title="Lịch trình dự án">Khai báo việc nào phải xong trước việc nào, hệ thống tự tìm <strong>đường găng</strong> (chuỗi việc quyết định ngày kết thúc — trễ một việc là trễ cả dự án). Có cột mốc và <strong>kế hoạch gốc</strong> để đối chiếu kế hoạch với thực tế. Vào dự án → tab <Mono>Lịch trình</Mono>.</Feature>
                <Feature icon={<Users className="h-4 w-4" />} title="Nhân lực">Khai báo mỗi người dành bao nhiêu phần trăm thời gian cho dự án nào, cùng ngày nghỉ và ngày lễ. Bảng theo tuần tô màu cảnh báo ai đang quá tải.</Feature>
                <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Danh mục dự án">Gom nhiều dự án thành một chương trình để xem tiến độ chung và lịch trình tổng theo thời gian.</Feature>
                <Feature icon={<Sparkles className="h-4 w-4" />} title="Mục tiêu & kết quả then chốt">Đặt mục tiêu theo quý kèm các kết quả then chốt đo được bằng số. Kết quả then chốt có thể <strong>tự đo</strong> (số bug đang mở, % điểm hoàn tất của sprint, hoặc số công việc theo một câu JQL): hệ thống ghi lại giá trị mỗi ngày và vẽ đường tiến độ; vẫn nhập tay và check-in kèm ghi chú được.</Feature>
                <Feature icon={<TriangleAlert className="h-4 w-4" />} title="Rủi ro & vướng mắc">Ghi nhận bốn nhóm: rủi ro (có thể xảy ra), giả định (đang tin là đúng), vấn đề (đang xảy ra), phụ thuộc (chờ bên khác). Mỗi mục chấm điểm khả năng xảy ra × mức ảnh hưởng để biết cái nào đáng lo nhất.</Feature>
                <Feature icon={<Bell className="h-4 w-4" />} title="Cam kết thời gian xử lý">Đặt hạn phải phản hồi và phải xử lý xong. Hệ thống tự bấm giờ khi công việc được tạo, hiện đếm ngược ngay trên công việc và cảnh báo khi sắp trễ.</Feature>
                <Feature icon={<BookOpen className="h-4 w-4" />} title="Wiki nội bộ">Trang tài liệu dạng cây cho cả công ty hoặc riêng từng dự án, có tìm kiếm theo nội dung, <strong>lịch sử phiên bản</strong> (xem và khôi phục bản cũ) và nhúng / liên kết công việc (công việc hiện lại mục <em>Tài liệu liên quan</em>). Quyền viết wiki cấp <strong>theo từng dự án</strong> (mặc định: quản trị dự án, phân tích nghiệp vụ, chủ sản phẩm, điều phối sprint, lập trình viên, kiểm thử); thiếu quyền thì màn hình nói rõ nên nhờ ai.</Feature>
                <Feature icon={<Plug className="h-4 w-4" />} title="Tự động hoá">Lưu mẫu công việc để tạo nhanh, và đặt lịch tự tạo công việc lặp lại theo ngày/tuần/tháng.</Feature>
                <Feature icon={<Building2 className="h-4 w-4" />} title="Khách hàng & hợp đồng">Quản lý khách hàng, hợp đồng (giá trị, thời hạn) và gắn dự án theo khách hàng.</Feature>
                <Feature icon={<Check className="h-4 w-4" />} title="Trong mỗi công việc">Thêm <strong>người tham gia</strong> (nhiều người cùng theo dõi một việc) và <strong>danh sách việc nhỏ</strong> để tích dần theo tiến độ.</Feature>
              </div>
            </section>

            <section className="mb-14">
              <H2 id="ai">AI hỗ trợ</H2>
              <P>AI giúp giảm thao tác gõ tay. Cần quyền <Mono>ai:use</Mono> (Member trở lên); thiếu khoá AI thì tự giảm về heuristic — vẫn dùng được, chỉ kém “thông minh” hơn.</P>
              <div className="border-t border-border">
                <Feature icon={<Sparkles className="h-4 w-4" />} title="Tạo công việc từ lời mô tả">Mô tả việc cần làm bằng lời, AI dựng sẵn tiêu đề, mô tả, loại và gợi ý trường.</Feature>
                <Feature icon={<MessageSquare className="h-4 w-4" />} title="Tóm tắt công việc & thảo luận">Tóm tắt nhanh một công việc dài hoặc chuỗi bình luận.</Feature>
                <Feature icon={<Sparkles className="h-4 w-4" />} title="Gợi ý & lập kế hoạch">Gợi ý người thực hiện / mức ưu tiên / story points; trợ lý lập kế hoạch sprint (dành cho quản trị dự án).</Feature>
              </div>
            </section>

            <section className="mb-14">
              <H2 id="bao-cao">Báo cáo &amp; phân tích</H2>
              <P>Reporter trở lên đều xem được báo cáo; quản trị dự án cấu hình. <strong>Xuất CSV</strong> (kết quả bộ lọc / JQL, Việc chờ, bug, sprint, Danh mục, rủi ro, nhân lực — mở bằng Excel được) và <strong>In / Lưu PDF</strong> cho Tổng quan và báo cáo sprint khi cần chia sẻ ngoài.</P>
              <Table head={['Báo cáo', 'Cho biết điều gì']} rows={[
                ['Báo cáo Sprint — tab đầu của Báo cáo', 'Chọn một sprint: Burndown có vạch “hôm nay”, Velocity và tóm tắt cam kết / hoàn thành / phát sinh.'],
                ['Burndown', 'Khối lượng còn lại theo ngày trong sprint — có kịp hạn không.'],
                ['Velocity', 'Năng suất trung bình qua các sprint để dự báo phạm vi.'],
                ['CFD (Cumulative Flow)', 'Luồng công việc qua các trạng thái — phát hiện nghẽn.'],
                ['Tổng kết sprint — hiện sau khi Kết thúc sprint', 'Những gì hoàn tất / dở dang và việc dở được chuyển đi đâu.'],
                ['QA', 'Bug đang mở theo mức nghiêm trọng, tỷ lệ mở lại, thời gian đóng trung bình, theo phiên bản.'],
                ['Bảng tổng quan tuỳ biến — Tổng quan → bộ chọn bảng tổng quan', 'Bộ chọn ở đầu Tổng quan (mặc định “Tổng quan chung”): chọn “Tạo bảng tổng quan mới…” để ghép widget kéo-thả. Chia sẻ: Chỉ mình tôi · Cả không gian làm việc · Thành viên dự án · Thành viên nhóm. Chỉ chủ bảng tổng quan được sửa.'],
              ]} />
              <H3>Dành cho lãnh đạo</H3>
              <div className="border-t border-border">
                <Feature icon={<TriangleAlert className="h-4 w-4" />} title="Sức khoẻ dự án">Mỗi dự án có mức sức khoẻ tự tính từ tiến độ, việc quá hạn và rủi ro; quản trị dự án có thể ghi đè kèm ghi chú (thẻ đầu tab Tổng quan của Báo cáo). Mức này hiện thành cột Sức khoẻ trên Tổng quan và Danh mục.</Feature>
                <Feature icon={<LayoutGrid className="h-4 w-4" />} title="Thẻ trên Tổng quan">Ba thẻ <em>Top rủi ro</em> (5 rủi ro mở điểm cao nhất), <em>OKR chậm</em> (so với thời gian đã trôi) và <em>Người quá tải</em> (theo bảng nhân lực).</Feature>
                <Feature icon={<Bell className="h-4 w-4" />} title="Báo cáo định kỳ (Digest)">Ở <Mono>Kết nối → Tích hợp → Báo cáo định kỳ</Mono>: chọn thứ, giờ, múi giờ (hoặc tự gửi khi kết thúc sprint), khối nội dung, xem trước; gửi qua Email và Telegram theo người nhận. Dự án riêng tư chỉ lên kênh chung khi bật rõ.</Feature>
              </div>
            </section>

            <section className="mb-14">
              <H2 id="tich-hop">Tích hợp</H2>
              <P>Kết nối Tirapro với công cụ khác. Do quản trị chung bật và cấu hình. Thiếu cấu hình thì tính năng tắt êm, app vẫn chạy.</P>
              <div className="border-t border-border">
                <Feature icon={<Plug className="h-4 w-4" />} title="Telegram">Hệ thống chỉ <strong>gửi</strong> tin (thông báo, digest) — không nhận lệnh tạo việc. Quản trị chung làm theo trình hướng dẫn 4 bước: nhập token bot → thêm bot vào nhóm → gõ <Mono>/link@tên_bot MÃ</Mono> trong nhóm để liên kết nhóm với không gian làm việc → gửi thử. Trạng thái kết nối hiện thật trên trang.</Feature>
                <Feature icon={<ArrowUpRight className="h-4 w-4" />} title="Nhập từ Jira">Nhập từ tệp CSV xuất từ Jira (công việc, bình luận, tệp đính kèm); tự khớp loại, mức ưu tiên và trạng thái, chạy nền có hiển thị tiến độ. Công việc nhập mang <strong>đúng mã gốc</strong> (vd <Mono>JRA-1</Mono>); việc tạo mới sau đó vẫn theo mã Tirapro. Nhập lại bỏ qua việc đã có mã. Người phụ trách chưa là thành viên sẽ tự được gán khi được thêm vào không gian làm việc.</Feature>
                <Feature icon={<KeyRound className="h-4 w-4" />} title="API key & MCP">Tạo API key ở <strong>Cài đặt → API &amp; kết nối lập trình</strong> cho phần mềm ngoài hoặc trợ lý AI (MCP) truy cập dữ liệu — chọn chỉ-đọc hoặc đọc-ghi, thu hồi bất cứ lúc nào.</Feature>
              </div>
              <Note kind="info">Chi tiết kỹ thuật REST/MCP (endpoint, ví dụ code) nằm trong tài liệu kỹ thuật của repo, không thuộc hướng dẫn sử dụng này.</Note>
            </section>

            <section className="mb-14">
              <H2 id="phim-tat">Phím tắt</H2>
              <P>Nhấn <Kbd>?</Kbd> ở bất kỳ đâu để mở bảng này ngay trong ứng dụng — hai nơi cùng đọc một nguồn nên luôn khớp.</P>
              {SHORTCUT_GROUPS.map((g) => (
                <div key={g.scope}>
                  <H3>{g.title}</H3>
                  <ShortcutTable scope={g.scope} />
                </div>
              ))}
              <Note kind="tip">Trên danh sách: <Kbd>j</Kbd> / <Kbd>k</Kbd> xuống / lên, <Kbd>Enter</Kbd> mở xem nhanh; trên công việc: <Kbd>a</Kbd> gán cho người khác, <Kbd>e</Kbd> sửa tiêu đề, <Kbd>m</Kbd> viết bình luận. Rê chuột vào nút để thấy phím tắt tương ứng.</Note>
              <div className="border-t border-border">
                <Feature icon={<MousePointerClick className="h-4 w-4" />} title="Chọn nhiều & thao tác hàng loạt">Ở Việc chờ, tick nhiều công việc để Gán cho tôi · Đổi người · Chuyển sprint · Đặt điểm · Đổi ưu tiên · Gắn nhãn · Gắn epic · Đổi trạng thái — có nút Hoàn tác. Điểm và ưu tiên cũng sửa được ngay trên từng dòng.</Feature>
                <Feature icon={<ListPlus className="h-4 w-4" />} title="Thêm nhanh">Ô “+ Thêm việc…” cuối mỗi cột Bảng việc / nhóm Việc chờ — nhấn Enter là tạo ngay đúng cột/sprint.</Feature>
              </div>
            </section>

            <section className="mb-6">
              <H2 id="faq">Câu hỏi thường gặp</H2>
              <H3>Tôi không thấy nút sửa / kéo-thả / cấu hình?</H3>
              <P>Gần như luôn do vai trò. Đối chiếu <a href="#vai-tro" className="font-medium underline">ma trận quyền</a>; nếu cần thêm quyền, đề nghị quản trị chung hoặc quản trị dự án nâng vai trò cho bạn.</P>
              <H3>Tôi không nhận được thông báo?</H3>
              <P>Kiểm tra bạn có đang <strong>theo dõi</strong> công việc đó không, và thông báo Telegram cần được quản trị bật và nhóm Telegram đã được liên kết (<Mono>/link@tên_bot MÃ</Mono>); dự án riêng tư chỉ gửi lên kênh khi quản trị bật rõ. Người được giao và người tạo được theo dõi tự động.</P>
              <H3>Quên mật khẩu?</H3>
              <P>Dùng liên kết đặt lại ở màn đăng nhập, hoặc nhờ quản trị chung cấp lại.</P>
              <H3>AI báo không khả dụng?</H3>
              <P>Có thể quản trị hệ thống chưa cấu hình khoá AI, hoặc đã bật kill-switch. Các tính năng vẫn chạy ở chế độ heuristic; hỏi quản trị nếu cần bật đầy đủ.</P>
              <H3>Chuyển sang không gian làm việc khác thế nào?</H3>
              <P>Dùng bộ chọn không gian làm việc ở đầu thanh bên (chỉ hiện khi bạn thuộc nhiều nơi).</P>
            </section>

            <footer className="border-t border-border pt-6 text-sm text-faint">
              Tirapro · hướng dẫn sử dụng. Cần trợ giúp thêm? Liên hệ quản trị chung của bạn. <Link to="/" className="text-primary hover:underline">Mở ứng dụng →</Link>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
