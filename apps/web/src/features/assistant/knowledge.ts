import { normalizeVi } from '@/lib/text';
import { DOC_GROUPS, DOC_TOPICS, type DocEntry } from '@/features/docs/docsIndex';

/**
 * Kho tri thức của Trợ lý: các mục của trang Hướng dẫn (`docsIndex`) + vài mục bổ sung không có đoạn riêng trong Docs.
 * Chấm điểm bằng từ khoá + đồng nghĩa, không dấu, thuần hàm. Không nhân bản văn bản dài: câu trả lời chỉ trích tóm tắt
 * và dẫn tới `/documentation#anchor`.
 */
export interface KnowledgeEntry {
  id: string;
  title: string;
  summary: string;
  /** Anchor trong trang Hướng dẫn (`/documentation#anchor`). */
  anchor: string;
  keywords: string;
  /** Nút mở thẳng chỗ làm việc. `to` có thể chứa `:key` (mã dự án hiện tại) — không ở trong dự án thì bỏ nút. */
  open?: { label: string; to: string };
}

const fromDoc = (e: DocEntry): KnowledgeEntry => ({
  id: e.id,
  title: e.label,
  summary: e.summary,
  anchor: e.id,
  keywords: e.keywords,
});

/** Mục bổ sung: nội dung nằm rải trong Docs hoặc ở chính ứng dụng; `anchor` là mục Docs gần nhất. */
const EXTRA: KnowledgeEntry[] = [
  {
    id: 'nhap-excel',
    title: 'Nhập công việc từ Excel',
    summary:
      'Trong dự án: Cấu hình → Xuất / Nhập dữ liệu → Nhập từ Excel. Tải biểu mẫu .xlsx của dự án, điền, kéo-thả tệp để xem trước lỗi từng dòng rồi bấm Nhập (tối đa 1000 dòng mỗi lần).',
    anchor: 'tich-hop',
    keywords:
      'nhap excel nhap tu excel import excel xlsx bieu mau nhap hang loat nhap cong viec nhap du lieu upload tep',
    open: { label: 'Mở Nhập dữ liệu của dự án', to: '/p/:key/config/data' },
  },
  {
    id: 'go-nhanh',
    title: 'Gõ nhanh khi tạo việc',
    summary:
      'Trong tiêu đề gõ !ưu-tiên, @người, #sprint, ~điểm, ^hạn (vd !cao @an ^mai #sprint1 ~3); phần không khớp sẽ được báo lại. Nhấn c ở bất kỳ đâu để mở form tạo việc.',
    anchor: 'lam-viec-issue',
    keywords:
      'go nhanh cu phap tieu de token uu tien nguoi phu trach han diem story points tao nhanh tao task tao viec',
  },
  {
    id: 'tao-du-an',
    title: 'Tạo dự án',
    summary:
      'Bấm nút nổi + → Tạo dự án (màn nhỏ: tab Tạo → Tạo dự án), đặt tên và mã dự án. Dự án mới có Bảng việc, Việc chờ và cấu hình riêng.',
    anchor: 'khai-niem',
    keywords: 'tao du an du an moi them du an create project',
  },
  {
    id: 'bang-viec',
    title: 'Bảng việc (Board)',
    summary:
      'Xem công việc theo cột trạng thái, kéo-thả thẻ giữa các cột; ô "+ Thêm việc…" cuối cột để thêm nhanh; j/k di chuyển giữa các thẻ.',
    anchor: 'lam-viec-issue',
    keywords: 'bang viec board keo tha cot trang thai kanban the card chuyen trang thai',
  },
  {
    id: 'viec-cho',
    title: 'Việc chờ (backlog)',
    summary:
      'Danh sách việc chờ: xếp thứ tự ưu tiên, kéo việc vào sprint, tick nhiều việc để gán, đổi sprint, đặt điểm, đổi ưu tiên hàng loạt (có Hoàn tác).',
    anchor: 'lap-chay-sprint',
    keywords: 'viec cho backlog keo viec vao sprint chon nhieu hang loat uu tien thu tu',
  },
  {
    id: 'tro-ly',
    title: 'Trợ lý Tirapro',
    summary:
      'Hỏi theo màn hình đang đứng, tra việc của bạn, xem hướng dẫn, soạn nháp việc mới (bạn bấm Tạo mới có việc). Chạy ngay trong trình duyệt, không gửi nội dung ra dịch vụ AI bên ngoài.',
    anchor: 'gioi-thieu',
    keywords: 'tro ly chatbot chat bot hoi dap tro giup assistant',
  },
];

export const KNOWLEDGE: KnowledgeEntry[] = [
  ...DOC_TOPICS.map(fromDoc),
  ...EXTRA,
  ...DOC_GROUPS.flatMap((g) => g.items.map(fromDoc)),
];

/* ============================ Đồng nghĩa & từ dừng ============================ */

/** Cụm nhiều từ → từ chuẩn (áp trên chuỗi đã bỏ dấu, cụm dài trước). */
const PHRASES: [string, string][] = [
  ['cong viec', 'task'],
  ['phan quyen', 'quyen'],
  ['cap quyen', 'quyen'],
  ['phim tat', 'phimtat'],
  ['ban phim', 'phimtat'],
  ['tim kiem', 'tim'],
  ['thong bao', 'thongbao'],
  ['du an', 'duan'],
  ['bao cao', 'baocao'],
  ['viec cho', 'backlog'],
  ['bang viec', 'board'],
  ['thanh vien', 'member'],
  ['nguoi dung', 'member'],
  ['vai tro', 'quyen'],
  ['bat dau', 'batdau'],
  ['ket thuc', 'ketthuc'],
  ['bieu mau', 'excel'],
  ['bao loi', 'bug'],
  ['mat khau', 'matkhau'],
];

/** Nhóm đồng nghĩa: từ đầu tiên là từ chuẩn. */
const SYNONYMS: string[][] = [
  ['task', 'viec', 'issue', 'ticket', 'card'],
  ['tao', 'them', 'lap', 'new', 'create', 'add', 'moi'],
  ['quyen', 'role', 'permission', 'rbac'],
  ['phimtat', 'hotkey', 'shortcut', 'keyboard'],
  ['bug', 'loi', 'error'],
  ['excel', 'xlsx', 'csv'],
  ['nhap', 'import', 'upload'],
  ['xuat', 'export', 'download'],
  ['tim', 'search', 'loc', 'filter', 'find'],
  ['member', 'user', 'nhan', 'vien', 'nguoi'],
  ['baocao', 'report', 'thongke', 'chart', 'dashboard'],
  ['duan', 'project'],
  ['thongbao', 'notification', 'notify'],
  ['xoa', 'delete', 'remove', 'go'],
  ['board', 'kanban'],
  ['batdau', 'start', 'khoi'],
  ['ketthuc', 'complete', 'dong', 'finish'],
  ['matkhau', 'password'],
  ['gan', 'assign', 'giao'],
];

const CANON = new Map<string, string>();
for (const g of SYNONYMS) for (const w of g) CANON.set(w, g[0]!);

/** Từ vô nghĩa khi tra cứu ("làm sao", "ở đâu", "thế nào"…). */
const STOP = new Set(
  (
    'lam sao the nao o dau la gi co cho toi minh ban de va cua nhu huong dan duoc khong can muon xin hay voi trong ' +
    'tren mot nhung cac thi bi se da dang nay do nao vay a oi ah nhe nha giup chi biet xem man hinh'
  ).split(' '),
);

/** Chuẩn hoá thành danh sách từ chuẩn (đã gộp đồng nghĩa, bỏ từ dừng). */
export function tokenize(text: string, keepStop = false): string[] {
  let s = ` ${normalizeVi(text)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')} `;
  for (const [p, c] of [...PHRASES].sort((a, b) => b[0].length - a[0].length))
    s = s.split(` ${p} `).join(` ${c} `).split(` ${p} `).join(` ${c} `);
  const out: string[] = [];
  for (const w of s.split(' ')) {
    if (!w) continue;
    if (!keepStop && STOP.has(w)) continue;
    out.push(CANON.get(w) ?? w);
  }
  return out;
}

interface Indexed {
  entry: KnowledgeEntry;
  title: Set<string>;
  keywords: Set<string>;
  summary: Set<string>;
  titlePhrase: string;
  kwPhrase: string;
}

const INDEX: Indexed[] = KNOWLEDGE.map((entry) => ({
  entry,
  title: new Set(tokenize(entry.title)),
  keywords: new Set(tokenize(entry.keywords)),
  summary: new Set(tokenize(entry.summary)),
  titlePhrase: ` ${tokenize(entry.title).join(' ')} `,
  kwPhrase: ` ${tokenize(entry.keywords).join(' ')} `,
}));

/** Từ xuất hiện ở nhiều mục (tạo, task…) nặng ít hơn từ hiếm (sprint, excel…). */
const DF = new Map<string, number>();
for (const ix of INDEX)
  for (const t of new Set([...ix.title, ...ix.keywords, ...ix.summary]))
    DF.set(t, (DF.get(t) ?? 0) + 1);
const idf = (t: string) => Math.log(1 + INDEX.length / (DF.get(t) ?? 1));

export interface ScoredEntry {
  entry: KnowledgeEntry;
  score: number;
}

/** Điểm tối thiểu để coi là "khớp" — dưới ngưỡng này trợ lý nói không hiểu thay vì đoán bừa. */
export const MIN_SCORE = 2.2;

/**
 * Chấm điểm câu hỏi với từng mục: mỗi từ khớp tiêu đề ×3, từ khoá ×2, tóm tắt ×1 (nhân trọng số hiếm của từ),
 * cụm cả câu nằm nguyên trong tiêu đề/từ khoá +3. Cần ít nhất một từ khớp TIÊU ĐỀ hoặc TỪ KHOÁ (chỉ khớp tóm tắt = yếu).
 */
export function searchKnowledge(query: string, limit = 3): ScoredEntry[] {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0) return [];
  const phrase = q.length > 1 ? ` ${tokenize(query).join(' ')} ` : '';
  const scored: ScoredEntry[] = [];
  for (const ix of INDEX) {
    let score = 0;
    let strong = false;
    for (const t of q) {
      const w = idf(t);
      if (ix.title.has(t)) {
        score += 3 * w;
        strong = true;
      } else if (ix.keywords.has(t)) {
        score += 2 * w;
        strong = true;
      } else if (ix.summary.has(t)) score += w;
    }
    if (phrase && (ix.titlePhrase.includes(phrase) || ix.kwPhrase.includes(phrase))) score += 3;
    if (strong && score >= MIN_SCORE) scored.push({ entry: ix.entry, score });
  }
  // Điểm bằng nhau: mục con/bổ sung (cụ thể hơn) đứng trước mục lớn — thứ tự trong KNOWLEDGE đã như vậy, sort ổn định.
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Câu hỏi phổ biến — chip gợi ý khi không khớp (mỗi câu đều có kết quả trong kho; test kiểm). */
export const POPULAR_QUESTIONS: string[] = [
  'Làm sao tạo sprint?',
  'Phân quyền thế nào?',
  'Nhập Excel ở đâu?',
  'Phím tắt',
  'Báo lỗi thế nào?',
];
