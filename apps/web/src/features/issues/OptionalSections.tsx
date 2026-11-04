import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Plus } from 'lucide-react';
import type { IssueDto } from '@tirapro/types';
import { isBugType } from '@/features/issue-edit/severity';
import { useChecklist } from '@/features/issue-extras/api';
import { useCanEditIssue, useCanIn } from '@/features/projects/permissions';
import { useIssueLinks } from '@/features/issue-widgets/api';
import { useIssueDocs } from '@/features/wiki/api';

/**
 * Các khối TUỲ CHỌN của trang việc/panel xem nhanh: rỗng thì ẩn, người có quyền sửa thêm lại qua nút "+ Thêm mục".
 * "Mô tả" và "Tệp đính kèm" luôn hiện (không thuộc nhóm này).
 */
export type OptionalSectionId =
  | 'acceptance'
  | 'checklist'
  | 'components'
  | 'fixVersions'
  | 'affectsVersions'
  | 'links'
  | 'docs'
  | 'environment';

/** Thứ tự trong menu = thứ tự khối trên trang. */
export const OPTIONAL_SECTION_LABELS: Record<OptionalSectionId, string> = {
  acceptance: 'Tiêu chí chấp nhận',
  checklist: 'Các bước cần làm',
  components: 'Thành phần',
  fixVersions: 'Sửa ở phiên bản',
  affectsVersions: 'Bị ảnh hưởng ở phiên bản',
  links: 'Liên kết',
  docs: 'Tài liệu liên quan',
  environment: 'Thông tin môi trường',
};
const ALL_IDS = Object.keys(OPTIONAL_SECTION_LABELS) as OptionalSectionId[];

/** Số mục của các khối nạp bất đồng bộ; `undefined` = chưa nạp xong (khối chưa hiện — không nhấp nháy ra rồi biến mất). */
export interface OptionalSectionData {
  checklist?: number;
  links?: number;
  docs?: number;
}

/** Nạp số mục checklist / liên kết / tài liệu bằng ĐÚNG các truy vấn mà từng khối dùng (chung cache, không gọi thừa). */
export function useOptionalSectionData(issueId: string): OptionalSectionData {
  const checklist = useChecklist(issueId).data?.length;
  const links = useIssueLinks(issueId).data?.length;
  const docs = useIssueDocs(issueId).data?.length;
  return { checklist, links, docs };
}

/** Khối có dữ liệu thật (nguồn: trường của việc + số mục nạp bất đồng bộ). */
export function sectionHasData(
  id: OptionalSectionId,
  issue: Pick<IssueDto, 'acceptanceCriteria' | 'components' | 'fixVersions' | 'environment'>,
  data: OptionalSectionData,
): boolean {
  switch (id) {
    case 'acceptance':
      return !!issue.acceptanceCriteria?.trim();
    case 'checklist':
      return (data.checklist ?? 0) >= 1;
    case 'components':
      return issue.components.length >= 1;
    case 'fixVersions':
      return issue.fixVersions.some((v) => v.type === 'FIX');
    case 'affectsVersions':
      return issue.fixVersions.some((v) => v.type === 'AFFECTS');
    case 'links':
      return (data.links ?? 0) >= 1;
    case 'docs':
      return (data.docs ?? 0) >= 1;
    case 'environment':
      return issue.environment !== null && issue.environment !== undefined;
  }
}

export interface OptionalSections {
  visible: (id: OptionalSectionId) => boolean;
  /** Khối đang ẩn mà người dùng CÓ THỂ thêm (đúng thứ tự menu). */
  hidden: OptionalSectionId[];
  open: (id: OptionalSectionId) => void;
  /** Khối vừa được MỞ BẰNG TAY trong phiên này (rỗng nhưng phải hiện, và vào thẳng chế độ nhập). */
  wasOpened: (id: OptionalSectionId) => boolean;
}

/**
 * Khối hiện khi có dữ liệu HOẶC đã được mở trong phiên xem trang này (state của component — không lưu lại; đổi sang việc
 * khác thì reset). `only`: tập khối mà bề mặt này có (panel xem nhanh không có Tiêu chí/Tài liệu/Môi trường).
 * Không đề nghị: "Thông tin môi trường" cho việc không phải Bug (khối chỉ có ở Bug), "Tài liệu liên quan" khi thiếu `wiki:manage`.
 */
export function useOptionalSections(
  issue: IssueDto,
  data: OptionalSectionData,
  only: readonly OptionalSectionId[] = ALL_IDS,
): OptionalSections {
  const canWriteDocs = useCanIn(issue.projectId)('wiki:manage');
  const [state, setState] = useState<{ issueId: string; opened: ReadonlySet<OptionalSectionId> }>({
    issueId: issue.id,
    opened: new Set(),
  });
  const opened = state.issueId === issue.id ? state.opened : EMPTY;
  const [focusId, setFocusId] = useState<OptionalSectionId | null>(null);

  const offered = (id: OptionalSectionId) =>
    only.includes(id) &&
    (id !== 'environment' || isBugType(issue.type)) &&
    (id !== 'docs' || canWriteDocs);
  const visible = (id: OptionalSectionId) =>
    only.includes(id) &&
    (id !== 'environment' || isBugType(issue.type)) &&
    (sectionHasData(id, issue, data) || opened.has(id));
  const hidden = ALL_IDS.filter((id) => offered(id) && !visible(id));

  function open(id: OptionalSectionId) {
    setState((s) => ({
      issueId: issue.id,
      opened: new Set([...(s.issueId === issue.id ? s.opened : EMPTY), id]),
    }));
    setFocusId(id);
  }
  useScrollAndFocus(focusId, () => setFocusId(null));

  return { visible, hidden, open, wasOpened: (id) => opened.has(id) };
}

const EMPTY: ReadonlySet<OptionalSectionId> = new Set();

/** Sau khi khối vừa mở được vẽ: cuộn tới và đưa con trỏ vào ô nhập đầu tiên (thử vài khung hình vì khối có thể dựng muộn). */
function useScrollAndFocus(id: OptionalSectionId | null, done: () => void) {
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (!id) return;
    let frames = 0;
    let raf = 0;
    const attempt = () => {
      const root = document.querySelector<HTMLElement>(`[data-optional-section="${id}"]`);
      const target = root?.querySelector<HTMLElement>(
        'textarea, input:not([type="hidden"]), select, [role="combobox"], button',
      );
      if (root && target) {
        root.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        target.focus({ preventScroll: true });
        doneRef.current();
      } else if (frames++ < 30) {
        raf = requestAnimationFrame(attempt);
      } else doneRef.current();
    };
    raf = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(raf);
  }, [id]);
}

/** Nạp dữ liệu + trạng thái "đã mở" một lần cho cả vùng nội dung; con vẽ các khối theo `sections`. */
export function OptionalSectionsScope({
  issue,
  only,
  children,
}: {
  issue: IssueDto;
  only?: readonly OptionalSectionId[];
  children: (sections: OptionalSections) => ReactNode;
}) {
  const data = useOptionalSectionData(issue.id);
  const sections = useOptionalSections(issue, data, only);
  return <>{children(sections)}</>;
}

/** Vỏ một khối tuỳ chọn: không vẽ gì khi khối ẩn; có `data-optional-section` để cuộn/focus tới. */
export function OptionalSection({
  id,
  sections,
  children,
}: {
  id: OptionalSectionId;
  sections: OptionalSections;
  children: ReactNode;
}) {
  if (!sections.visible(id)) return null;
  return <div data-optional-section={id}>{children}</div>;
}

const ITEM_CLS =
  'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-ink outline-none transition-colors data-[highlighted]:bg-surface-2';

/**
 * Nút "+ Thêm mục": menu các khối đang ẩn. Không vẽ gì khi không còn khối nào để thêm hoặc người xem không sửa được việc.
 */
export function AddSectionButton({
  issue,
  hidden,
  onPick,
}: {
  issue: IssueDto;
  hidden: readonly OptionalSectionId[];
  onPick: (id: OptionalSectionId) => void;
}) {
  const canEdit = useCanEditIssue(issue.projectId)(issue);
  // Chọn xong: để con trỏ ở ô nhập của khối vừa mở, KHÔNG trả về nút "+ Thêm mục" (Esc/bấm ra ngoài vẫn trả như thường).
  const picked = useRef(false);
  if (!canEdit || hidden.length === 0) return null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] [@media(pointer:coarse)]:min-h-11"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Thêm mục
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          aria-label="Thêm mục"
          onCloseAutoFocus={(e) => {
            if (picked.current) e.preventDefault();
            picked.current = false;
          }}
          className="z-dropdown min-w-56 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
        >
          {hidden.map((id) => (
            <DropdownMenu.Item
              key={id}
              className={ITEM_CLS}
              onSelect={() => {
                picked.current = true;
                onPick(id);
              }}
            >
              {OPTIONAL_SECTION_LABELS[id]}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
