import type { GuideContent, TourStepDef } from './guides';

/**
 * Hướng dẫn mặc định (Guide TOÀN CỤC, `organizationId = null`) — nạp lúc khởi động API (`GuidesBootstrapService`), mọi
 * tổ chức (mới và cũ) thấy ngay. Nội dung nằm ở code để sửa qua review; muốn đổi thì TĂNG `version` (bản trong DB cũ
 * hơn sẽ được cập nhật). `selector` trỏ tới thuộc tính `data-tour` ở giao diện web — test `tourSelectors` giữ chúng khớp.
 */
export interface GuideSeed {
  key: string;
  type: 'TOUR' | 'CHECKLIST';
  /** Mẫu route (cùng dạng `routeToScreen` của web), vd `/p/:key/board`. */
  screen: string;
  title: string;
  description: string;
  content: GuideContent;
  order: number;
  version: number;
}

const sel = (name: string): string => `[data-tour="${name}"]`;

type Placement = NonNullable<TourStepDef['placement']>;
/** [tên data-tour (null = popover giữa màn), tiêu đề, nội dung, vị trí] — `order` tự đánh 0..n-1. */
type StepRow = readonly [name: string | null, title: string, body: string, placement: Placement];

/** Dựng tour một-màn: type TOUR, order 0, version 1, không tự chạy (người dùng bấm "?"). */
function tour(
  key: string,
  screen: string,
  title: string,
  description: string,
  rows: readonly StepRow[],
): GuideSeed {
  return {
    key,
    type: 'TOUR',
    screen,
    title,
    description,
    order: 0,
    version: 1,
    content: {
      steps: rows.map(([name, stepTitle, body, placement], order) => ({
        ...(name ? { selector: sel(name) } : {}),
        title: stepTitle,
        body,
        placement,
        order,
      })),
    },
  };
}

/**
 * Tour cho các màn ngoài 5 màn chính. Quy ước: bước 0 trỏ vào phần tử LUÔN có của màn (đầu trang/khung trang, không
 * phụ thuộc dữ liệu hay quyền); nút chỉ hiện theo quyền, hoặc khối chỉ có khi đã có dữ liệu, đặt ở bước sau (bước không
 * thấy trên màn thì bị bỏ khi chạy). Nhãn lấy đúng chữ trên giao diện.
 */
const SCREEN_TOURS: GuideSeed[] = [
  // ----- Cá nhân & chung -----
  tour('tour-me', '/me', 'Trang Của tôi', 'Việc, bug và điểm của riêng bạn.', [
    [
      'me-header',
      'Của tôi',
      'Việc được giao, bug liên quan đến bạn và điểm đã xong — trong các dự án bạn xem được.',
      'bottom',
    ],
    [
      'me-stats',
      'Bốn con số cần xem trước',
      'Việc chưa xong, Quá hạn, Đến hạn trong 7 ngày và Điểm xong tuần này. Rê chuột vào từng ô để biết cách tính.',
      'bottom',
    ],
    [
      'me-issues',
      'Việc của tôi',
      'Việc giao cho bạn mà chưa xong, xếp theo hạn. Có việc ở nhiều dự án thì bấm mã dự án để lọc; "Xem tất cả" mở danh sách đầy đủ ở Bộ lọc đã lưu.',
      'top',
    ],
    [
      'me-bugs',
      'Bug liên quan đến tôi',
      'Chia ba nhóm: Chờ test lại, Mở lại và Giao cho tôi. Con số cạnh tên nhóm là số bug đang có.',
      'top',
    ],
    [
      'me-weekly',
      'Điểm đã xong theo tuần',
      '8 tuần gần nhất, tuần bắt đầu từ Thứ Hai. Chỉ tính việc không có việc con mà bạn đã chuyển sang Xong.',
      'top',
    ],
  ]),
  tour('tour-projects', '/projects', 'Danh sách dự án', 'Tìm dự án, mở nhanh và tạo dự án mới.', [
    [
      'projects-toolbar',
      'Tìm và sắp xếp',
      'Gõ tên, mã hoặc người phụ trách để tìm. Đổi giữa Danh sách và Theo nhóm; sắp xếp theo Gần nhất, Tên hay Ngày tạo; bật "Hiện đã lưu trữ" để thấy dự án đã lưu trữ.',
      'bottom',
    ],
    [
      'projects-list',
      'Mở dự án',
      'Bấm tên dự án để mở, hoặc dùng liên kết Bảng việc / Việc chờ ngay trên dòng. Dự án bạn mở gần nhất được đánh dấu "Gần nhất" và ghim lên đầu.',
      'top',
    ],
    [
      'projects-manage-groups',
      'Nhóm của tôi',
      'Gom các dự án thành nhóm riêng cho dễ tìm. Nhóm này chỉ mình bạn thấy, không ảnh hưởng người khác.',
      'bottom',
    ],
    [
      'projects-create',
      'Tạo dự án',
      'Tạo dự án mới ở đây. Nút này chỉ hiện khi bạn có quyền tạo dự án.',
      'bottom',
    ],
  ]),
  tour(
    'tour-notifications',
    '/notifications',
    'Thông báo',
    'Xem lại thông báo và đánh dấu đã đọc.',
    [
      [
        'notifications-tabs',
        'Lọc thông báo',
        'Chọn Tất cả, Chưa đọc, Được nhắc hoặc Được giao để chỉ xem loại bạn cần.',
        'bottom',
      ],
      [
        'notifications-list',
        'Danh sách thông báo',
        'Bấm một thông báo để mở công việc liên quan; thông báo đó tự được đánh dấu đã đọc. Còn nữa thì bấm Tải thêm ở cuối danh sách.',
        'top',
      ],
      [
        'notifications-mark-all',
        'Đánh dấu đã đọc tất cả',
        'Một lần bấm đánh dấu mọi thông báo chưa đọc của bạn là đã đọc, không chỉ ở tab đang xem.',
        'bottom',
      ],
      [
        'notifications-settings',
        'Chọn loại thông báo nhận',
        'Muốn nhận ít hoặc nhiều hơn, vào Cài đặt thông báo qua đường dẫn ở cuối trang.',
        'top',
      ],
    ],
  ),
  tour('tour-account', '/account', 'Tài khoản', 'Hồ sơ và mật khẩu của bạn.', [
    [
      'account-header',
      'Tài khoản của bạn',
      'Hồ sơ và mật khẩu dùng chung cho mọi tổ chức bạn tham gia.',
      'bottom',
    ],
    [
      'account-profile',
      'Hồ sơ của tôi',
      'Đổi múi giờ và ngôn ngữ. Họ tên, email và ảnh đại diện chỉ quản trị hệ thống đổi được. Sửa xong, bấm Lưu ở thanh "Có thay đổi chưa lưu".',
      'top',
    ],
    [
      'account-password',
      'Đổi mật khẩu',
      'Nhập mật khẩu hiện tại để xác minh đúng là bạn, rồi đặt mật khẩu mới.',
      'top',
    ],
  ]),
  tour('tour-my-teams', '/account/teams', 'Nhóm của tôi', 'Xem nhóm bạn thuộc và ai ở trong đó.', [
    [
      'my-teams-header',
      'Nhóm của tôi',
      'Các nhóm bạn đang thuộc. Ai cũng xem được trang này, kể cả khi bạn không có quyền quản lý thành viên.',
      'bottom',
    ],
    [
      'my-teams-list',
      'Xem thành viên',
      'Bấm một nhóm để mở danh sách người trong nhóm. Trưởng nhóm có ghi chú "Trưởng nhóm" bên cạnh.',
      'top',
    ],
    [
      null,
      'Muốn vào nhóm khác?',
      'Nhờ quản trị viên thêm bạn: họ làm ở trang Thành viên, tab Nhóm.',
      'over',
    ],
  ]),
  tour(
    'tour-filters',
    '/filters',
    'Bộ lọc đã lưu',
    'Tìm công việc bằng JQL và lưu lại để dùng lại.',
    [
      [
        'filters-header',
        'Bộ lọc đã lưu',
        'Chọn một bộ lọc đã lưu để xem kết quả, hoặc chạy nhanh một truy vấn JQL. Tên bộ lọc đang xem hiện ở tiêu đề trang.',
        'bottom',
      ],
      [
        'filters-jql',
        'Chạy nhanh truy vấn JQL',
        'Gõ truy vấn rồi bấm Chạy JQL (hoặc ⌘/Ctrl+Enter). Muốn giữ lại, bấm Lưu truy vấn nếu bạn có quyền tạo bộ lọc.',
        'bottom',
      ],
      [
        'filters-saved',
        'Bộ lọc của bạn và được chia sẻ',
        'Hai nhóm: Của tôi và Được chia sẻ với tôi. Bấm một bộ lọc để chạy ngay.',
        'right',
      ],
      [
        'filters-results',
        'Kết quả',
        'Bấm một dòng để xem nhanh công việc. Nút Cột chọn cột hiển thị; Xuất lấy đủ mọi kết quả ra CSV.',
        'top',
      ],
    ],
  ),
  tour('tour-wiki', '/wiki', 'Wiki', 'Tài liệu nội bộ xếp thành cây trang.', [
    ['wiki-header', 'Wiki', 'Tài liệu nội bộ viết bằng Markdown, xếp thành cây trang.', 'bottom'],
    [
      'wiki-search',
      'Tìm và chọn phạm vi',
      'Gõ để tìm trong tài liệu. Ô bên dưới đổi phạm vi: Tất cả tài liệu, Dùng chung cho mọi dự án hoặc riêng từng dự án.',
      'right',
    ],
    [
      'wiki-tree',
      'Cây trang',
      'Bấm tên trang để đọc; mũi tên bên trái mở hoặc thu gọn trang con. Người có quyền viết còn có nút đổi chỗ và thêm trang con khi rê chuột vào dòng.',
      'right',
    ],
    [
      'wiki-page',
      'Nội dung trang',
      'Trang đang chọn hiện ở đây. Nút Lịch sử cho xem các phiên bản cũ; người có quyền viết có thêm Sửa trang và Thêm trang con.',
      'left',
    ],
    [
      'wiki-create',
      'Tạo trang mới',
      'Thêm một trang ở cấp đầu của phạm vi đang chọn. Nút chỉ hiện khi bạn có quyền viết ở phạm vi đó.',
      'right',
    ],
  ]),
  tour('tour-issue', '/issue/:key', 'Chi tiết công việc', 'Đọc, sửa và theo dõi một công việc.', [
    [
      'issue-header',
      'Tiêu đề và thuộc tính chính',
      'Loại, mức nghiêm trọng và tiêu đề; bấm vào tiêu đề để sửa tại chỗ nếu bạn được sửa. Dòng dưới là Sprint, độ khó, điểm và nhãn.',
      'bottom',
    ],
    [
      'issue-toolbar',
      'Thao tác nhanh',
      'Bình luận đưa bạn xuống ô viết bình luận; menu Thêm có các thao tác khác như sao chép liên kết. Trạng thái và bước chuyển kế tiếp nằm bên phải khi bạn được chuyển.',
      'bottom',
    ],
    [
      'issue-description',
      'Mô tả',
      'Ghi rõ việc cần làm; bấm vào mô tả để sửa nếu bạn được sửa. Các mục khác như tiêu chí chấp nhận, tệp đính kèm nằm ngay bên dưới.',
      'right',
    ],
    [
      'issue-sidebar',
      'Người, ngày và thời gian làm',
      'Người liên quan, các mốc ngày, Epic / Việc cha và phần Thời gian đã làm. Trên màn hẹp, cột này nằm xuống dưới phần chính.',
      'left',
    ],
  ]),
  tour(
    'tour-dashboard',
    '/dashboards/:id',
    'Bảng tổng quan',
    'Bảng số liệu tuỳ chỉnh của bạn hoặc của nhóm.',
    [
      [
        'dashboard-header',
        'Bảng tổng quan',
        'Tên bảng, ai xem được và dữ liệu lấy từ đâu. Ô chọn bên phải để chuyển sang bảng khác.',
        'bottom',
      ],
      [
        'dashboard-grid',
        'Các ô số liệu',
        'Mỗi ô là một số liệu, biểu đồ hoặc danh sách việc, tính theo phạm vi ghi ở nhãn "Dữ liệu".',
        'top',
      ],
      [
        'dashboard-edit',
        'Chỉnh sửa',
        'Sửa bảng của bạn bằng Chỉnh sửa; bảng của người khác thì Tạo bản sao để chỉnh sửa. Nút chỉ hiện khi bạn có quyền.',
        'bottom',
      ],
    ],
  ),

  // ----- Trong một dự án -----
  tour(
    'tour-triage',
    '/p/:key/triage',
    'Việc mới vào',
    'Duyệt công việc do người ngoài dự án báo lên.',
    [
      [
        'triage-header',
        'Việc mới vào',
        'Nơi tiếp nhận công việc do người ngoài dự án báo lên. Khi có yêu cầu chờ duyệt, số lượng hiện ngay cạnh tên.',
        'bottom',
      ],
      [
        'triage-list',
        'Duyệt từng yêu cầu',
        'Bấm một dòng để đọc mô tả và người gửi. Nhận đưa việc vào Việc chờ; Từ chối cần ghi lý do để người gửi biết; Tạm hoãn để xử lý sau.',
        'top',
      ],
      [
        'board-backlog',
        'Việc đã nhận',
        'Việc được nhận nằm ở Việc chờ — mở tab này để xếp vào Sprint.',
        'bottom',
      ],
    ],
  ),
  tour('tour-trash', '/p/:key/trash', 'Thùng rác', 'Khôi phục công việc bị xoá nhầm.', [
    [
      'trash-header',
      'Thùng rác',
      'Công việc bị xoá được giữ lại ở đây. Chỉ quản trị dự án xem được trang này.',
      'bottom',
    ],
    [
      'trash-list',
      'Khôi phục',
      'Mỗi dòng cho biết ai xoá và lúc nào. Bấm Khôi phục để đưa công việc trở lại dự án.',
      'top',
    ],
    [
      'project-more',
      'Lối vào các màn phụ',
      'Hoạt động, Mục tiêu, Rủi ro & vướng mắc, Thùng rác và Cấu hình nằm trong menu Thêm; mục nào hiện còn tuỳ quyền của bạn.',
      'bottom',
    ],
  ]),
  tour(
    'tour-activity',
    '/p/:key/activity',
    'Hoạt động của dự án',
    'Xem ai đã làm gì trong dự án.',
    [
      [
        'activity-header',
        'Hoạt động',
        'Dòng thời gian của cả dự án: ai đã làm gì, trên công việc nào.',
        'bottom',
      ],
      [
        'activity-timeline',
        'Đọc dòng thời gian',
        'Nhóm theo ngày, mới nhất ở trên. Mỗi dòng ghi người làm, thay đổi và thời điểm; bấm mã hoặc tên công việc để mở nó.',
        'top',
      ],
      [
        'project-more',
        'Lối vào các màn phụ',
        'Hoạt động nằm trong menu Thêm, cùng Mục tiêu, Rủi ro & vướng mắc, Thùng rác và Cấu hình.',
        'bottom',
      ],
    ],
  ),
  tour('tour-reports', '/p/:key/reports', 'Báo cáo', 'Biểu đồ tiến độ và chất lượng của dự án.', [
    [
      'reports-tabs',
      'Bốn loại báo cáo',
      'Sprint (Burndown, Velocity), Tổng quan (phân bố công việc theo người), Luồng công việc và QA (chất lượng, bug đang mở). Rê chuột vào tab để xem gợi ý.',
      'bottom',
    ],
    [
      'reports-sprint-bar',
      'Chọn Sprint',
      'Ở tab Sprint, chọn Sprint cần xem. Nút In / Lưu PDF cho ra bản in của báo cáo đó.',
      'bottom',
    ],
    [
      'reports-panel',
      'Nội dung báo cáo',
      'Biểu đồ và số liệu của tab đang chọn. Địa chỉ trang nhớ tab bạn đang xem nên gửi liên kết là người nhận thấy đúng báo cáo.',
      'top',
    ],
  ]),
  tour(
    'tour-gantt',
    '/p/:key/gantt',
    'Lịch trình',
    'Xem công việc theo ngày bắt đầu và hạn chót.',
    [
      [
        'gantt-toolbar',
        'Công cụ của Lịch trình',
        'Đường găng, Phụ thuộc & cột mốc, Chưa lên lịch và Kế hoạch gốc đều ở thanh này. Lịch trình vẽ theo ngày bắt đầu và hạn chót của từng việc.',
        'bottom',
      ],
      [
        'gantt-critical',
        'Đường găng',
        'Chuỗi việc quyết định ngày kết thúc dự án: trễ một việc là trễ cả dự án. Bấm để tô đỏ; cần khai báo phụ thuộc trước.',
        'bottom',
      ],
      [
        'gantt-deps',
        'Phụ thuộc & cột mốc',
        'Khai báo việc nào phải xong trước việc nào, và các ngày cần chốt như bàn giao hay nghiệm thu.',
        'bottom',
      ],
      [
        'gantt-unscheduled',
        'Chưa lên lịch',
        'Việc chưa có ngày bắt đầu hoặc hạn và chưa nối với việc nào. Bấm để đặt ngày ngay tại đây, việc sẽ hiện lên biểu đồ.',
        'bottom',
      ],
      [
        'gantt-chart',
        'Biểu đồ',
        'Mỗi thanh là một công việc; rê chuột vào thanh để xem mã, tên việc và ngày. Chọn Kế hoạch gốc ở thanh công cụ để so với lịch ban đầu.',
        'over',
      ],
    ],
  ),
  tour('tour-tree', '/p/:key/tree', 'Cây việc', 'Xem Epic, việc cha và việc con theo cấp.', [
    [
      'tree-page',
      'Cây việc',
      'Công việc xếp theo cấp: Epic, việc cha, việc con. Muốn một việc nằm dưới việc khác, đặt trường "Việc cha" cho nó.',
      'over',
    ],
    [
      'tree-table',
      'Các cột',
      'Tiêu đề, Trạng thái, Người phụ trách, Ưu tiên và Điểm. Dòng có việc con hiện điểm cộng dồn: đã xong / tổng. Bấm một dòng để xem nhanh.',
      'top',
    ],
    [
      'tree-toggle-all',
      'Mở hoặc thu gọn',
      'Nút ở đầu cột thu gọn hoặc mở rộng cả cây; mũi tên trên từng dòng chỉ đóng mở nhánh đó.',
      'bottom',
    ],
    [
      'tree-drag-hint',
      'Đổi việc cha bằng cách kéo',
      'Kéo một dòng thả lên dòng khác để đổi Epic / Việc cha. Không kéo được thì mở công việc và đổi ở ô "Epic / Việc cha".',
      'bottom',
    ],
  ]),
  tour('tour-goals', '/p/:key/goals', 'Mục tiêu', 'Đặt mục tiêu theo kỳ và theo dõi tiến độ.', [
    [
      'goals-header',
      'Mục tiêu',
      'Đặt mục tiêu theo quý, mỗi mục tiêu kèm kết quả then chốt đo được bằng số.',
      'bottom',
    ],
    [
      'goals-filters',
      'Lọc mục tiêu',
      'Lọc theo kỳ (ví dụ 2026-Q3 là quý 3 năm 2026) hoặc theo trạng thái.',
      'bottom',
    ],
    [
      'goals-list',
      'Mỗi khối là một mục tiêu',
      'Nhóm theo kỳ, kỳ mới nhất ở trên. Mỗi mục tiêu có tiến độ chung, các kết quả then chốt, nút Biểu đồ và phần gắn công việc để theo dõi.',
      'top',
    ],
    [
      'goals-create',
      'Tạo mục tiêu',
      'Đặt mục tiêu mới cho dự án này. Nút chỉ hiện khi bạn có quyền quản lý mục tiêu.',
      'bottom',
    ],
  ]),
  tour(
    'tour-risks',
    '/p/:key/risks',
    'Rủi ro & vướng mắc',
    'Ghi lại và chấm điểm những gì có thể cản tiến độ.',
    [
      [
        'risks-header',
        'Rủi ro & vướng mắc',
        'Ghi lại rủi ro, giả định, vấn đề và việc chờ bên khác có thể cản tiến độ. Nút Xuất cho tải danh sách ra CSV.',
        'bottom',
      ],
      [
        'risks-kinds',
        'Bốn loại',
        'Rủi ro, Giả định, Vấn đề, Phụ thuộc. Mỗi tab có mô tả ngắn bên dưới để bạn phân loại cho đúng.',
        'bottom',
      ],
      [
        'risks-matrix',
        'Ma trận rủi ro',
        'Mỗi mục nằm ở một ô theo xác suất xảy ra (cột) và mức ảnh hưởng (hàng); ô càng đỏ càng cần lo trước. Bấm một ô để chỉ xem các mục trong ô đó.',
        'bottom',
      ],
      [
        'risks-table',
        'Danh sách chi tiết',
        'Nội dung, người phụ trách, xác suất × ảnh hưởng, trạng thái và hạn xử lý của từng mục.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-project-config',
    '/p/:key/config',
    'Cấu hình dự án',
    'Chỉnh thông tin, thành viên và quy trình của dự án.',
    [
      [
        'config-header',
        'Mục đang mở',
        'Tiêu đề và mô tả của mục cấu hình đang mở. Mỗi mục có địa chỉ riêng nên gửi liên kết là người nhận vào thẳng mục đó.',
        'bottom',
      ],
      [
        'subnav',
        'Các mục cấu hình',
        'Chung, Thành viên, Thành phần, Phiên bản, Nhãn, Quy trình, Thời gian xử lý, Xuất / Nhập dữ liệu. Chọn mục ở menu bên trái.',
        'right',
      ],
      [
        'config-content',
        'Nội dung mục',
        'Chỉnh ở đây. Phần lớn thao tác sửa chỉ dành cho quản trị dự án; người khác chỉ xem.',
        'top',
      ],
    ],
  ),

  // ----- Cài đặt tổ chức -----
  tour('tour-settings-general', '/settings/general', 'Thương hiệu', 'Logo của tổ chức.', [
    [
      'settings-general-header',
      'Thương hiệu',
      'Logo hiện ở nút chuyển tổ chức trên thanh trên cùng.',
      'bottom',
    ],
    [
      'settings-general-logo',
      'Logo tổ chức',
      'Bấm Tải ảnh lên (hoặc Đổi ảnh) để chọn logo. Chỉ quản trị chung đổi được; người khác chỉ xem.',
      'top',
    ],
    [
      'subnav',
      'Menu Cài đặt',
      'Các mục cài đặt chia theo nhóm: Chung, Con người, Cách làm việc… Menu thay đổi theo quyền của bạn.',
      'right',
    ],
  ]),
  tour(
    'tour-settings-audit',
    '/settings/audit',
    'Nhật ký quản trị',
    'Tra lại ai đã thay đổi cài đặt tổ chức.',
    [
      [
        'audit-header',
        'Nhật ký quản trị',
        'Ai đã thêm hoặc gỡ thành viên, đổi vai trò, sửa tích hợp… trong tổ chức này. Chỉ quản trị tổ chức xem được.',
        'bottom',
      ],
      [
        'audit-filters',
        'Lọc sự kiện',
        'Lọc theo loại sự kiện, người thực hiện và khoảng ngày (Từ ngày, Đến ngày). Bấm Xoá bộ lọc để xem lại tất cả.',
        'bottom',
      ],
      [
        'audit-list',
        'Từng sự kiện',
        'Mỗi dòng ghi người làm, việc đã làm, loại sự kiện và thời điểm (rê chuột vào giờ để xem ngày giờ đầy đủ). Còn nữa thì bấm Tải thêm.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-settings-notifications',
    '/settings/notifications',
    'Cài đặt thông báo',
    'Chọn thông báo bạn muốn nhận.',
    [
      [
        'notif-settings-header',
        'Thông báo của bạn',
        'Mặc định yên tĩnh — chỉ bật thông báo quan trọng. Đây là lựa chọn riêng của bạn, không đổi cho người khác.',
        'bottom',
      ],
      [
        'notif-settings-card',
        'Bấm là lưu',
        'Bật hoặc tắt từng loại thông báo trong ứng dụng. Mỗi lần bấm được lưu ngay, không có nút Lưu.',
        'top',
      ],
      [
        'notif-settings-list',
        'Tuỳ chọn email',
        'Một số loại có dòng "Tuỳ chọn email" để nhận thêm qua thư. Các thông báo email trong 5 phút được gộp thành một thư.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-settings-severities',
    '/settings/severities',
    'Mức nghiêm trọng',
    'Phân loại mức tác động của công việc.',
    [
      [
        'severities-header',
        'Mức nghiêm trọng',
        'Cho biết một công việc gây tác động lớn tới đâu. Số thứ tự càng nhỏ thì mức càng nặng, xử lý trước.',
        'bottom',
      ],
      [
        'severities-card',
        'Danh sách mức',
        'Mỗi dòng có màu, tên và số thứ tự. "Mặc định" đánh dấu mức dùng sẵn; "Hệ thống" là mức cố định, không sửa hay xoá được.',
        'top',
      ],
      [
        'severities-add',
        'Thêm mức',
        'Bấm Thêm mức độ để tạo mức mới (tên, màu, số thứ tự). Chỉ người có quyền quản lý mới thấy nút này.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-settings-priorities',
    '/settings/priorities',
    'Mức ưu tiên',
    'Quyết định việc nào làm trước.',
    [
      [
        'priorities-header',
        'Mức ưu tiên',
        'Cho biết việc nào cần làm trước. Số thứ tự càng nhỏ thì càng được làm trước.',
        'bottom',
      ],
      [
        'priorities-card',
        'Danh sách mức',
        'Mỗi dòng có màu, tên và số thứ tự. "Mặc định" đánh dấu mức dùng sẵn; "Hệ thống" là mức cố định, không sửa hay xoá được.',
        'top',
      ],
      [
        'priorities-add',
        'Thêm mức',
        'Bấm Thêm mức ưu tiên để tạo mức mới. Chỉ người có quyền quản lý mới thấy nút này.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-settings-fields',
    '/settings/fields',
    'Trường thông tin thêm',
    'Thêm ô thông tin riêng vào công việc.',
    [
      [
        'fields-header',
        'Trường thông tin thêm',
        'Thêm ô thông tin riêng vào mỗi công việc. Kiểu dữ liệu không đổi được sau khi tạo.',
        'bottom',
      ],
      [
        'fields-card',
        'Danh sách trường',
        'Mỗi dòng có tên, kiểu dữ liệu, nhãn "Bắt buộc" nếu có, và phạm vi áp dụng (toàn tổ chức hoặc một dự án).',
        'top',
      ],
      [
        'fields-add',
        'Thêm trường',
        'Bấm Thêm trường, đặt tên và chọn kiểu. Chỉ người có quyền quản lý trường thông tin thêm mới thấy nút này.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-settings-workflows',
    '/settings/workflows',
    'Quy trình',
    'Trạng thái của công việc và các bước chuyển.',
    [
      [
        'workflows-header',
        'Quy trình',
        'Các trạng thái của một công việc và những bước chuyển được phép giữa chúng.',
        'bottom',
      ],
      [
        'workflows-scheme',
        'Quy trình của tổ chức',
        'Mỗi loại việc dùng một quy trình trong toàn tổ chức; chọn xong bấm Lưu thay đổi. Dự án có thể dùng quy trình riêng. Chỉ người có quyền quản lý thấy mục này.',
        'bottom',
      ],
      [
        'workflows-list',
        'Danh sách quy trình',
        'Gồm Mẫu có sẵn, Quy trình của dự án và Quy trình dùng chung. Bấm một quy trình để xem và chỉnh chi tiết.',
        'top',
      ],
      [
        'workflows-create',
        'Tạo quy trình',
        'Tạo quy trình mới: đặt tên và chọn dùng chung hoặc riêng cho một dự án. Nút chỉ hiện khi bạn có quyền quản lý quy trình.',
        'left',
      ],
    ],
  ),
  tour(
    'tour-settings-import',
    '/settings/import',
    'Nhập dữ liệu',
    'Chuyển công việc từ Jira sang Tirapro.',
    [
      [
        'import-header',
        'Nhập dữ liệu',
        'Chuyển công việc từ Jira sang Tirapro bằng tệp CSV, ghép trường rồi nhập theo lô.',
        'bottom',
      ],
      [
        'import-steps',
        'Ba bước',
        'Tải tệp, Ghép dữ liệu, rồi Nhập & kết quả. Bước đang làm được tô nổi.',
        'bottom',
      ],
      [
        'import-file',
        'Chọn tệp CSV',
        'Trong Jira: Bộ lọc, Xem tất cả issue, Xuất, CSV (tất cả các trường). Tệp tối đa 25MB. Xong bấm Chọn tệp CSV.',
        'bottom',
      ],
      [
        'import-other',
        'Nhập vào dự án có sẵn',
        'CSV đơn giản hoặc JSON xuất từ Tirapro thì nhập ở Cấu hình của dự án, mục Xuất / Nhập dữ liệu — không phải ở trang này.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-settings-api',
    '/settings/api',
    'API & kết nối lập trình',
    'Cấp khoá cho phần mềm khác và trợ lý AI.',
    [
      [
        'apikeys-header',
        'API & kết nối lập trình',
        'Cấp khoá API để phần mềm khác và trợ lý AI (MCP) khai thác dữ liệu.',
        'bottom',
      ],
      [
        'apikeys-endpoints',
        'Điểm kết nối',
        'Địa chỉ REST API, MCP (HTTP) và cách xác thực bằng header Authorization. Sao chép dán vào phần mềm cần dùng.',
        'bottom',
      ],
      [
        'apikeys-create',
        'Tạo khoá',
        'Bấm Tạo khoá, đặt tên, thời hạn và có cho phép ghi hay không. Khoá chỉ hiện một lần nên hãy sao chép ngay.',
        'bottom',
      ],
      [
        'apikeys-list',
        'Danh sách khoá',
        'Xem các khoá đã cấp và bấm Thu hồi khi không dùng nữa.',
        'top',
      ],
    ],
  ),

  // ----- Kết nối -----
  tour(
    'tour-integrations',
    '/connect/integrations',
    'Ứng dụng bên ngoài',
    'Nối Tirapro với Telegram, kho mã và báo cáo định kỳ.',
    [
      [
        'integrations-tabs',
        'Các loại kết nối',
        'Telegram, Kho mã (nếu được bật) và Báo cáo định kỳ. Mỗi tab có địa chỉ riêng.',
        'bottom',
      ],
      [
        'integrations-telegram',
        'Telegram',
        'Gửi thông báo công việc tới nhóm Telegram. Kết nối từng bước: chọn bot, thêm bot vào nhóm, gõ mã liên kết, gửi thử.',
        'top',
      ],
      [
        'integrations-repos',
        'Kho mã (GitHub / GitLab)',
        'Liên kết kho mã để gắn commit và pull request vào đúng công việc, tiện theo dõi tiến độ lập trình.',
        'top',
      ],
      [
        'integrations-digest',
        'Báo cáo định kỳ',
        'Tổng hợp tiến độ dự án theo lịch rồi gửi qua Telegram và/hoặc email.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-automation',
    '/connect/automation',
    'Tự động hoá',
    'Để hệ thống làm giúp những việc lặp đi lặp lại.',
    [
      [
        'automation-header',
        'Tự động hoá',
        'Quy tắc tự chạy, mẫu công việc và việc lặp lại giúp bạn đỡ làm tay.',
        'bottom',
      ],
      [
        'automation-tabs',
        'Ba loại',
        'Quy tắc: khi có sự kiện thì hệ thống tự làm. Mẫu: điền sẵn trường cho việc hay gặp. Lặp lại: tự tạo việc theo lịch.',
        'bottom',
      ],
      [
        'automation-scope',
        'Chọn phạm vi',
        'Quy tắc gắn với dự án: chọn dự án ở ô Phạm vi quy tắc, rồi bấm Tạo quy tắc nếu bạn có quyền.',
        'bottom',
      ],
      [
        'automation-panel',
        'Nội dung của tab',
        'Phần này đổi theo tab đang mở. Chỉ quản trị dự án tạo và sửa Mẫu, Lặp lại; mọi người đều xem được.',
        'top',
      ],
    ],
  ),

  // ----- Quản trị hệ thống -----
  tour(
    'tour-admin-organizations',
    '/admin/organizations',
    'Tổ chức (quản trị hệ thống)',
    'Quản lý mọi tổ chức trong hệ thống.',
    [
      [
        'admin-orgs-header',
        'Mọi tổ chức trong hệ thống',
        'Đổi gói dịch vụ, lưu trữ hoặc khôi phục từng tổ chức. Trang này chỉ dành cho quản trị hệ thống.',
        'bottom',
      ],
      [
        'admin-orgs-filter',
        'Tìm và lọc',
        'Tìm theo tên, slug hoặc email chủ sở hữu. Tổ chức đã lưu trữ bị ẩn cho tới khi bạn bật "Hiện đã lưu trữ".',
        'bottom',
      ],
      [
        'admin-orgs-table',
        'Bảng tổ chức',
        'Mỗi dòng có chủ sở hữu, gói, số thành viên · dự án · công việc và lần hoạt động gần nhất. Bấm gói để đổi; nút Lưu trữ / Khôi phục ở cuối dòng.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-admin-accounts',
    '/admin/accounts',
    'Tài khoản (quản trị hệ thống)',
    'Tạo tài khoản và cấp quyền toàn hệ thống.',
    [
      [
        'admin-users-header',
        'Tài khoản toàn hệ thống',
        'Tạo tài khoản và cấp quyền lập tổ chức mới hoặc quản trị hệ thống. Nút Tạo tài khoản ở góc phải.',
        'bottom',
      ],
      [
        'admin-users-filter',
        'Tìm và lọc',
        'Tìm theo tên hoặc email, rồi lọc theo trạng thái bằng các nút bên cạnh.',
        'bottom',
      ],
      [
        'admin-users-list',
        'Từng tài khoản',
        'Mỗi dòng có hai công tắc: "Được lập tổ chức" và "Admin HT". Nút ⋯ cuối dòng mở các thao tác khác với tài khoản đó.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-admin-config',
    '/admin/config',
    'Cấu hình hệ thống',
    'Bật tắt tính năng và xem cấu hình nền.',
    [
      [
        'admin-config-header',
        'Cấu hình hệ thống',
        'Cờ tính năng bật hoặc tắt ngay, không cần triển khai lại; cấu hình nền lấy từ biến môi trường.',
        'bottom',
      ],
      [
        'admin-config-flags',
        'Cờ tính năng',
        'Cho phép đăng ký công khai, tắt khẩn cấp AI, bật tích hợp ngoài. Gạt công tắc là có hiệu lực ngay.',
        'bottom',
      ],
      [
        'admin-config-banner',
        'Banner bảo trì',
        'Nhập nội dung để hiện cho mọi người dùng; để trống thì ẩn. Sửa xong bấm Lưu ở thanh "Có thay đổi chưa lưu".',
        'top',
      ],
      [
        'admin-config-env',
        'Cấu hình nền',
        'AI, tìm kiếm ngữ nghĩa, Redis, lưu trữ và giới hạn — chỉ để xem, muốn đổi thì sửa biến môi trường khi triển khai.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-admin-system',
    '/admin/system',
    'Hệ thống',
    'Tình trạng dịch vụ và nhật ký kiểm toán.',
    [
      [
        'admin-system-header',
        'Tình trạng hệ thống',
        'Tình trạng dịch vụ (tự làm mới) và nhật ký kiểm toán toàn hệ thống.',
        'bottom',
      ],
      [
        'admin-system-health',
        'Tình trạng dịch vụ',
        'Database, Redis và AI còn chạy hay không, kèm Uptime, RAM, phiên bản và môi trường.',
        'bottom',
      ],
      [
        'admin-system-audit',
        'Nhật ký kiểm toán',
        'Hai tab: Quản trị và Hoạt động công việc. Dùng ô Lọc để chỉ xem một loại sự kiện; bấm Tải thêm để xem cũ hơn.',
        'top',
      ],
    ],
  ),
  tour(
    'tour-admin-points',
    '/admin/points',
    'Cách tính điểm',
    'Bảng hệ số tính điểm cho công việc.',
    [
      [
        'admin-points-header',
        'Cách tính điểm',
        'Điểm một việc = điểm gốc theo loại × hệ số độ khó × hệ số ưu tiên. Việc có việc con và Epic lấy tổng điểm, không dùng bảng này.',
        'bottom',
      ],
      [
        'admin-points-table',
        'Ba bảng hệ số',
        'Điểm gốc theo loại, Hệ số độ khó, Hệ số ưu tiên. Sửa số trực tiếp trong bảng.',
        'bottom',
      ],
      [
        'admin-points-example',
        'Thử một ví dụ',
        'Chọn loại việc, độ khó và ưu tiên để xem ra bao nhiêu điểm theo bảng đang sửa, trước khi lưu.',
        'top',
      ],
      [
        'admin-points-save',
        'Lưu hoặc khôi phục',
        'Lưu bảng hệ số sẽ tính lại điểm mọi việc trên toàn hệ thống, trừ việc đã chỉnh tay. Khôi phục mặc định đưa bảng về số ban đầu.',
        'top',
      ],
    ],
  ),
];

export const DEFAULT_GUIDES: GuideSeed[] = [
  {
    key: 'tour-home',
    type: 'TOUR',
    screen: '/',
    title: 'Làm quen Tổng quan',
    description: 'Bốn điểm cần biết khi mới vào Tirapro.',
    order: 0,
    version: 2,
    content: {
      autoStart: true,
      steps: [
        {
          selector: sel('home-overview'),
          title: 'Tổng quan',
          body: 'Việc của bạn và tiến độ chung hiện ở đây. Mở trang này đầu ngày là biết hôm nay cần làm gì.',
          placement: 'over',
          order: 0,
        },
        {
          selector: sel('nav-main'),
          title: 'Menu chính',
          body: 'Chuyển giữa Tổng quan, Dự án, Thành viên… Menu thay đổi theo quyền của bạn.',
          placement: 'right',
          order: 1,
        },
        {
          selector: sel('topbar-notifications'),
          title: 'Thông báo',
          body: 'Khi ai đó giao công việc, nhắc tên (@) hoặc bình luận vào công việc của bạn, chuông sẽ báo.',
          placement: 'bottom',
          order: 2,
        },
        {
          selector: sel('cmdk-hint'),
          title: 'Tìm và chạy lệnh nhanh',
          body: 'Bấm nút Tìm hoặc nhấn ⌘K / Ctrl+K để tìm công việc, dự án hoặc chạy lệnh.',
          placement: 'right',
          order: 3,
        },
      ],
    },
  },
  {
    key: 'tour-board',
    type: 'TOUR',
    screen: '/p/:key/board',
    title: 'Bảng việc',
    description: 'Kéo công việc qua các cột để cập nhật trạng thái.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('project-views'),
          title: 'Các cách xem',
          body: 'Bảng việc, Việc chờ, Lịch trình, Cây việc, Báo cáo là các cách nhìn khác nhau của cùng một dự án.',
          placement: 'bottom',
          order: 0,
        },
        {
          selector: sel('board-columns'),
          title: 'Cột trạng thái',
          body: 'Mỗi cột là một trạng thái. Kéo thẻ công việc sang cột khác để chuyển trạng thái, bấm vào thẻ để xem chi tiết.',
          placement: 'top',
          order: 1,
        },
        {
          selector: sel('project-create-issue'),
          title: 'Tạo công việc',
          body: 'Thêm công việc mới ở đây hoặc nhấn phím C. Cuối mỗi cột cũng có ô thêm nhanh.',
          placement: 'bottom',
          order: 2,
        },
        {
          selector: sel('board-backlog'),
          title: 'Việc chờ',
          body: 'Công việc chưa vào Sprint nằm ở Việc chờ — mở tab này để lập kế hoạch.',
          placement: 'bottom',
          order: 3,
        },
      ],
    },
  },
  {
    key: 'tour-backlog',
    type: 'TOUR',
    screen: '/p/:key/backlog',
    title: 'Việc chờ & Sprint',
    description: 'Thêm nhanh công việc và xếp vào Sprint.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('backlog-quickadd'),
          title: 'Thêm nhanh',
          body: 'Gõ tên công việc rồi Enter để thêm nhanh — thêm !cao @tên ~3 để đặt ưu tiên, người làm, điểm.',
          placement: 'top',
          order: 0,
        },
        {
          selector: sel('backlog-sprint'),
          title: 'Sprint',
          body: 'Kéo công việc vào Sprint để lập kế hoạch. Mỗi Sprint hiện tổng điểm và số công việc.',
          placement: 'bottom',
          order: 1,
        },
        {
          selector: sel('board-backlog'),
          title: 'Việc chờ',
          body: 'Việc chờ gom mọi công việc chưa vào Sprint.',
          placement: 'bottom',
          order: 2,
        },
      ],
    },
  },
  {
    key: 'tour-members',
    type: 'TOUR',
    screen: '/members',
    title: 'Thành viên & nhóm',
    description: 'Thêm người và gom thành nhóm.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('members-add'),
          title: 'Thêm thành viên',
          body: 'Chọn người có sẵn trong hệ thống hoặc tạo tài khoản mới. Người được thêm vào là dùng được ngay, không cần lời mời.',
          placement: 'bottom',
          order: 0,
        },
        {
          selector: sel('members-list'),
          title: 'Danh sách thành viên',
          body: 'Xem ai đang ở trong tổ chức, đổi vai trò hoặc gỡ khỏi tổ chức.',
          placement: 'top',
          order: 1,
        },
        {
          selector: sel('members-tabs'),
          title: 'Nhóm',
          body: 'Gom người theo chức năng thành nhóm để giao vai trò hàng loạt.',
          placement: 'bottom',
          order: 2,
        },
      ],
    },
  },
  {
    key: 'tour-roles',
    type: 'TOUR',
    screen: '/settings/roles',
    title: 'Vai trò & quyền',
    description: 'Vai trò quyết định ai làm được gì.',
    order: 0,
    version: 1,
    content: {
      steps: [
        {
          selector: sel('roles-list'),
          title: 'Danh sách vai trò',
          body: 'Vai trò gom các quyền để giao cho thành viên. Vai trò hệ thống là cố định; bạn có thể tạo vai trò riêng.',
          placement: 'top',
          order: 0,
        },
        {
          selector: sel('roles-tabs'),
          title: 'So sánh vai trò',
          body: 'Chuyển sang "So sánh vai trò" để xem bảng quyền của mọi vai trò cạnh nhau.',
          placement: 'bottom',
          order: 1,
        },
        {
          selector: sel('roles-create'),
          title: 'Tạo vai trò',
          body: 'Tạo vai trò tuỳ chỉnh khi các vai trò có sẵn chưa vừa với cách làm việc của nhóm bạn.',
          placement: 'left',
          order: 2,
        },
      ],
    },
  },
  ...SCREEN_TOURS,
  {
    key: 'onboarding-start',
    type: 'CHECKLIST',
    screen: '/',
    title: 'Bắt đầu với Tirapro',
    description: 'Bốn bước để tổ chức của bạn chạy được',
    order: 0,
    version: 1,
    // Tiến độ (`done`) tính từ dữ liệu thật theo `key` (OnboardingService); nhãn và đường dẫn lấy từ đây nên sửa không cần
    // deploy giao diện. `href: null` = giao diện tự mở hộp/đường dẫn phù hợp (xem `onboardingTarget`).
    content: {
      items: [
        { key: 'create_project', label: 'Tạo dự án đầu tiên' },
        { key: 'add_members', label: 'Thêm thành viên', href: '/members' },
        { key: 'start_sprint', label: 'Bắt đầu một Sprint' },
        { key: 'connect_telegram', label: 'Kết nối Telegram', href: '/connect/integrations' },
      ],
    },
  },
];
