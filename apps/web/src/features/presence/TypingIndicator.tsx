import { useTypers } from './usePresence';

/** Câu hiển thị: "A đang nhập…", "A và B đang nhập…", "A, B và 2 người khác đang nhập…". */
function typingText(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return `${names[0]} đang nhập…`;
  if (names.length === 2) return `${names[0]} và ${names[1]} đang nhập…`;
  return `${names[0]}, ${names[1]} và ${names.length - 2} người khác đang nhập…`;
}

/** Dòng "đang nhập…" dưới khu bình luận; giữ chiều cao cố định để nội dung không nhảy khi bật/tắt. */
export function TypingIndicator({ issueId }: { issueId: string }) {
  const typers = useTypers(issueId);
  const text = typingText(typers.map((t) => t.displayName));
  return (
    <p className="h-4 text-xs text-faint" role="status" aria-live="polite">
      {text}
    </p>
  );
}
