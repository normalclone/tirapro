import { Avatar } from '@/components/ui/primitives';
import { audienceSummary, type AudienceEntry } from './commentAudience';

const MAX_AVATARS = 5;

/**
 * Dòng "Sẽ thông báo: [avatar]… +N" dưới ô bình luận. Ẩn khi không có ai. Avatar chỉ để nhìn (aria-hidden); trình đọc màn
 * hình đọc câu `sr-only` đầy đủ khi tới dòng này. KHÔNG là live region (không đọc lại mỗi lần gõ). `title` ghi rõ đây là
 * tối đa nỗ lực: người nhận có thể đã tắt loại thông báo này.
 */
export function CommentAudienceLine({ entries }: { entries: readonly AudienceEntry[] }) {
  if (entries.length === 0) return null;
  const summary = audienceSummary(entries);
  const shown = entries.slice(0, MAX_AVATARS);
  const more = entries.length - shown.length;
  return (
    <p
      className="flex items-center gap-2 text-xs text-muted"
      title={`${summary} — theo cài đặt thông báo của từng người`}
    >
      <span className="sr-only">{summary}</span>
      <span aria-hidden="true">Sẽ thông báo:</span>
      <span className="flex items-center -space-x-1.5" aria-hidden="true">
        {shown.map((e) => (
          <span key={e.id} className="rounded-full ring-2 ring-bg">
            <Avatar name={e.name} src={e.avatarUrl} size={20} decorative />
          </span>
        ))}
      </span>
      {more > 0 && <span aria-hidden="true">+{more}</span>}
    </p>
  );
}
