/**
 * Liên kết "Tìm hiểu thêm" tới một mục của trang Hướng dẫn (`/documentation#<mục>`), mở tab mới để không bỏ dở
 * việc đang làm. Dùng cuối mô tả một câu của `PageHeader`: mô tả giữ ngắn, phần giải thích dài nằm ở tài liệu.
 * `anchor` phải là `id` có thật trong `features/docs/DocumentationPage.tsx` (test `docsLinks.test.ts` kiểm).
 */
export function DocsLink({ anchor }: { anchor: string }) {
  return (
    <a
      href={`/documentation#${anchor}`}
      target="_blank"
      rel="noopener noreferrer"
      className="whitespace-nowrap text-primary underline underline-offset-2 hover:text-primary-hover"
    >
      Tìm hiểu thêm
    </a>
  );
}
