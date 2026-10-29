/**
 * Mục lục của trang Hướng dẫn (`/documentation`) dưới dạng DỮ LIỆU — một nguồn cho cả trang Docs (thanh bên) lẫn Trợ lý
 * (kho tri thức). Văn bản đầy đủ vẫn nằm trong JSX của `DocumentationPage.tsx`; ở đây chỉ có tiêu đề, tóm tắt ngắn và
 * từ khoá để trợ lý chấm điểm. Mọi `id` phải có thật trong trang dưới dạng `id="…"` (test `docsIndex.test.ts` kiểm).
 * `keywords` viết không dấu, cách nhau bằng khoảng trắng (bộ chấm điểm bỏ dấu cả hai phía nên có dấu cũng được).
 */
export interface DocEntry {
  id: string;
  /** Nhãn ở thanh bên của trang Docs và tiêu đề trong câu trả lời của trợ lý. */
  label: string;
  /** Một–hai câu: trợ lý trích nguyên văn, KHÔNG thay cho trang đầy đủ. */
  summary: string;
  keywords: string;
}

export interface DocGroup {
  group: string;
  items: DocEntry[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    group: 'Bắt đầu',
    items: [
      {
        id: 'gioi-thieu',
        label: 'Giới thiệu',
        summary:
          'Tirapro quản lý công việc và dự án kiểu Jira, thêm AI, cập nhật realtime và báo cáo. Bắt đầu: đăng nhập, chọn dự án, mở phần vai trò của bạn.',
        keywords: 'tirapro la gi gioi thieu bat dau su dung huong dan co ban',
      },
      {
        id: 'khai-niem',
        label: 'Khái niệm cơ bản',
        summary:
          'Không gian làm việc, dự án, công việc, bảng việc (board), việc chờ (backlog), sprint, quy trình (workflow), epic và việc con.',
        keywords: 'khai niem thuat ngu workspace project board backlog sprint workflow epic viec con la gi',
      },
      {
        id: 'dang-nhap',
        label: 'Đăng nhập & tài khoản',
        summary:
          'Đăng nhập bằng email và mật khẩu được cấp; quên mật khẩu thì dùng liên kết đặt lại. Chuyển không gian làm việc và đăng xuất ở thanh bên và menu người dùng.',
        keywords: 'dang nhap dang xuat tai khoan mat khau quen mat khau doi mat khau chuyen khong gian lam viec',
      },
      {
        id: 'vai-tro',
        label: 'Hiểu về vai trò',
        summary:
          'Quyền thực tế là hợp của vai trò ở không gian làm việc và vai trò ở từng dự án. Có ma trận quyền cho Reporter, Developer, Quản trị dự án, Quản trị chung, Người xem.',
        keywords: 'vai tro phan quyen quyen han ma tran quyen role permission admin viewer reporter developer',
      },
    ],
  },
  {
    group: 'Ai cũng dùng',
    items: [
      {
        id: 'dieu-huong',
        label: 'Điều hướng & Cmd+K',
        summary:
          'Bảng lệnh ⌘K (Ctrl+K) tìm việc, nhảy tới dự án, chạy hành động; gõ thẳng mã công việc để mở. Thanh bên chuyển dự án; g rồi b tới Bảng việc, g rồi l tới Việc chờ.',
        keywords: 'dieu huong cmd k command palette bang lenh lenh nhanh thanh ben chuyen du an gan day',
      },
      {
        id: 'lam-viec-issue',
        label: 'Thao tác với công việc',
        summary:
          'Tạo nhanh bằng phím c (tiêu đề hiểu !ưu-tiên @người #sprint ~điểm ^hạn), xem nhanh, chuyển trạng thái, bình luận, liên kết, việc con, epic, mức nghiêm trọng, lịch sử.',
        keywords:
          'tao cong viec tao task tao viec tao issue sua cong viec chuyen trang thai binh luan lien ket viec con epic gan nguoi ghi nhanh',
      },
      {
        id: 'thong-bao',
        label: 'Thông báo & theo dõi',
        summary:
          'Trung tâm thông báo lọc Chưa đọc, Được nhắc, Được giao; theo dõi (watch) một việc để luôn nhận cập nhật. Người tạo và người được giao tự động theo dõi.',
        keywords: 'thong bao theo doi watch nhac ten mention chuong notification telegram',
      },
      {
        id: 'tim-kiem',
        label: 'Tìm kiếm & bộ lọc',
        summary:
          'Phím / mở ô tìm; chip lọc nhanh Của tôi, Quá hạn, Chưa gán; bộ lọc lưu; JQL nâng cao như assignee = currentUser() AND statusCategory != DONE.',
        keywords: 'tim kiem loc bo loc jql truy van filter search luu bo loc xuat csv',
      },
      {
        id: 'ca-nhan',
        label: 'Cá nhân hoá',
        summary: 'Đổi giao diện sáng/tối, cập nhật hồ sơ (tên, ảnh, múi giờ), đổi mật khẩu ở trang Tài khoản; trang tổng quan cá nhân.',
        keywords: 'ca nhan hoa giao dien sang toi theme ho so avatar mui gio tong quan ca nhan',
      },
    ],
  },
  {
    group: 'Theo vai trò',
    items: [
      {
        id: 'vt-reporter',
        label: 'Người báo cáo',
        summary:
          'Reporter tạo công việc, báo bug, bình luận, theo dõi; không tự chuyển trạng thái việc của người khác. Báo bug: ⌘K → Báo lỗi, nhập tiêu đề, gửi.',
        keywords: 'nguoi bao cao reporter bao bug bao loi gui yeu cau stakeholder',
      },
      {
        id: 'vt-developer',
        label: 'Lập trình viên',
        summary: 'Developer tạo và sửa mọi việc trong dự án, chuyển trạng thái, gán người, đặt story points, liên kết, tạo việc con, ghi thời gian.',
        keywords: 'lap trinh vien developer dev qa designer lam viec hang ngay log time worklog',
      },
      {
        id: 'vt-lead',
        label: 'Quản trị dự án',
        summary:
          'Quản trị dự án cấu hình dự án, bảng việc, quy trình; lập, bắt đầu, kết thúc sprint; xem mọi báo cáo; dùng AI lập kế hoạch sprint.',
        keywords: 'quan tri du an lead project admin cau hinh quy trinh sprint tao sprint bat dau sprint ket thuc sprint scrum master',
      },
      {
        id: 'vt-ws-admin',
        label: 'Quản trị chung',
        summary:
          'Quản trị chung thêm thành viên ở trang Thành viên, gán vai trò, tạo vai trò tuỳ biến ở Cài đặt → Vai trò, quản lý tích hợp và API key.',
        keywords:
          'quan tri chung workspace admin them thanh vien moi phan quyen vai tro tuy bien nguoi dung moi cap quyen',
      },
      {
        id: 'vt-viewer',
        label: 'Người xem',
        summary: 'Viewer chỉ xem bảng việc, việc chờ, công việc và báo cáo; không tạo, sửa, bình luận. Muốn thao tác nhiều hơn thì nhờ quản trị nâng vai trò.',
        keywords: 'nguoi xem viewer chi doc khach xem khong sua duoc',
      },
      {
        id: 'vt-sys-admin',
        label: 'Quản trị hệ thống',
        summary: 'Console /admin riêng cho chủ hệ thống: tổng quan và sức khoẻ dịch vụ, không gian làm việc, tài khoản, cấu hình và feature flags.',
        keywords: 'quan tri he thong system admin console workspace tai khoan feature flag cau hinh he thong suc khoe',
      },
    ],
  },
  {
    group: 'Nâng cao',
    items: [
      {
        id: 'quan-ly-nang-cao',
        label: 'Quản lý nâng cao',
        summary:
          'Lịch trình (đường găng), nhân lực, danh mục dự án, mục tiêu OKR, rủi ro, cam kết thời gian xử lý (SLA), wiki, tự động hoá, khách hàng và hợp đồng.',
        keywords:
          'quan ly nang cao lich trinh gantt duong gang nhan luc portfolio danh muc okr muc tieu rui ro sla wiki tu dong hoa khach hang hop dong',
      },
      {
        id: 'ai',
        label: 'AI hỗ trợ',
        summary:
          'AI dựng sẵn công việc từ lời mô tả, tóm tắt công việc và thảo luận, gợi ý người thực hiện/ưu tiên/điểm, lập kế hoạch sprint. Thiếu khoá AI thì chạy heuristic.',
        keywords: 'ai tri tue nhan tao goi y tom tat tao bang ai lap ke hoach sprint claude',
      },
      {
        id: 'bao-cao',
        label: 'Báo cáo & phân tích',
        summary:
          'Báo cáo sprint, Burndown, Velocity, CFD, tổng kết sprint, QA, bảng tổng quan tuỳ biến, sức khoẻ dự án, digest; xuất CSV và in/lưu PDF.',
        keywords: 'bao cao phan tich burndown velocity cfd tong ket sprint qa dashboard tong quan suc khoe digest xuat csv in pdf report',
      },
      {
        id: 'tich-hop',
        label: 'Tích hợp',
        summary:
          'Telegram (chỉ gửi tin), nhập từ Jira bằng CSV, nhập công việc hàng loạt, API key và MCP. Do quản trị chung bật và cấu hình.',
        keywords:
          'tich hop telegram jira nhap excel nhap csv nhap du lieu import api key mcp ket noi xlsx bieu mau',
      },
      {
        id: 'phim-tat',
        label: 'Phím tắt',
        summary:
          'Nhấn ? ở bất kỳ đâu để mở bảng phím tắt. Phổ biến: c tạo việc, / tìm kiếm, ⌘K bảng lệnh, g b Bảng việc, g l Việc chờ, j/k lên xuống danh sách.',
        keywords: 'phim tat ban phim hotkey shortcut keyboard',
      },
      {
        id: 'faq',
        label: 'Câu hỏi thường gặp',
        summary:
          'Không thấy nút sửa hay kéo-thả (thường do vai trò), không nhận được thông báo, quên mật khẩu, AI báo không khả dụng, chuyển không gian làm việc.',
        keywords: 'cau hoi thuong gap faq loi khong thay nut khong nhan duoc thong bao quen mat khau',
      },
    ],
  },
];

/**
 * Mục con có `id` riêng bên trong một mục lớn (tiêu đề cấp 3 trang Docs) — trỏ thẳng tới đúng đoạn hướng dẫn thay vì
 * đầu mục. Không hiện ở thanh bên.
 */
export const DOC_TOPICS: DocEntry[] = [
  {
    id: 'lap-chay-sprint',
    label: 'Lập & chạy một sprint',
    summary:
      'Vào Việc chờ, kéo các việc ưu tiên vào sprint mới; bấm Bắt đầu sprint, đặt thời hạn và mục tiêu; theo dõi Burndown; kết thúc sprint để chốt số liệu và chuyển việc dở sang sprint sau.',
    keywords: 'tao sprint lap sprint bat dau sprint chay sprint ket thuc sprint sprint moi viec cho backlog',
  },
  {
    id: 'them-nguoi-phan-quyen',
    label: 'Thêm người mới & phân quyền',
    summary:
      'Vào trang Thành viên, chọn người có sẵn hoặc tạo tài khoản, đặt vai trò chung. Cần vai trò khác ở một dự án thì vào dự án → Cấu hình → Thành viên. Bộ quyền riêng: Cài đặt → Vai trò.',
    keywords: 'them nguoi them thanh vien phan quyen vai tro cap quyen gan vai tro tao vai tro tuy bien moi nguoi',
  },
  {
    id: 'bao-mot-bug',
    label: 'Báo một bug',
    summary:
      'Mở ⌘K → Báo lỗi (hoặc nút Báo lỗi ở Bảng việc), nhập tiêu đề, gửi. Có bug tương tự thì hệ thống gợi ý thêm ghi chú vào bug đó.',
    keywords: 'bao bug bao loi tao bug report bug loi moi gui loi',
  },
  {
    id: 'cu-phap-jql',
    label: 'Cú pháp JQL (nâng cao)',
    summary:
      'Ô tìm kiếm nâng cao hỗ trợ JQL để lọc chính xác; me hoặc currentUser() là chính bạn. Kết quả dạng bảng: chọn cột, Xuất CSV, Lưu truy vấn.',
    keywords: 'jql cu phap truy van nang cao loc chinh xac currentuser luu truy van',
  },
];

/** Cấu trúc thanh bên của trang Docs: `[id, nhãn]` theo nhóm. */
export const DOC_NAV: { group: string; items: [string, string][] }[] = DOC_GROUPS.map((g) => ({
  group: g.group,
  items: g.items.map((i): [string, string] => [i.id, i.label]),
}));
