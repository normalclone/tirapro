import { AudiencePanel } from './AudiencePanel';
import { CopyLinkRow } from './CopyLinkRow';
import { SharePicker } from './SharePicker';
import { sameShare, type ShareCopy, type ShareKind, type ShareValue } from './shareModel';

/**
 * Thân hộp chia sẻ dùng chung: bộ chọn mức → "Ai có quyền xem" → "Sao chép liên kết" (chỉ khi đã lưu: có `link`).
 * `readOnly` (không phải chủ): bỏ bộ chọn, chỉ xem ai có quyền + sao chép liên kết.
 */
export function SharePanel({
  value,
  onChange,
  kinds,
  copy,
  keep,
  link,
  readOnly = false,
  error,
}: {
  value: ShareValue;
  onChange: (v: ShareValue) => void;
  kinds: readonly ShareKind[];
  copy: ShareCopy;
  keep?: { projectId?: string; teamId?: string };
  /** Chỉ có khi đã lưu. `saved` = mức đang lưu thật (để nhắc khi mức chọn khác). */
  link?: { url: string; saved: ShareValue };
  readOnly?: boolean;
  error?: string | null;
}) {
  return (
    <>
      {readOnly ? (
        <p className="text-sm text-muted">
          Chỉ người tạo {copy.noun} mới đổi được phạm vi chia sẻ.
        </p>
      ) : (
        <SharePicker value={value} onChange={onChange} kinds={kinds} copy={copy} keep={keep} />
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <AudiencePanel value={value} />
      {link && <CopyLinkRow url={link.url} unsavedChange={!sameShare(value, link.saved)} />}
    </>
  );
}
