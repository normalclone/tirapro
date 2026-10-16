import { useCallback } from 'react';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-token';
import { keys } from '@/lib/queryKeys';
import { BlobUrlCache } from './blobCache';
import { isImageMime } from './ref';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';

export interface Attachment {
  id: string;
  issueId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  uploadedById: string;
  createdAt: string;
}

/** Danh sách tệp đính kèm của issue. */
export function useAttachments(issueId: string | undefined) {
  return useQuery({
    queryKey: keys.issues.attachments(issueId ?? ''),
    queryFn: issueId
      ? async () => (await api.get<Attachment[]>(`/issues/${issueId}/attachments`)).data
      : skipToken,
  });
}

/** POST một tệp (multipart/form-data, field `file`) tới `path` của API; lỗi → Error mang thông điệp của server. */
async function postFile(path: string, file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    credentials: 'include',
    body: formData,
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      `Tải lên thất bại (${res.status})`;
    throw new Error(message);
  }
  return json as Attachment;
}

/** Tải 1 tệp lên issue (cần quyền sửa). Dùng lại được (vd tạo issue rồi upload). */
export function uploadAttachmentFile(issueId: string, file: File): Promise<Attachment> {
  return postFile(`/issues/${issueId}/attachments`, file);
}

/**
 * Tải 1 tệp minh hoạ cho BÌNH LUẬN (vd người báo lại bug cũ) — chỉ cần quyền bình luận, không cần quyền sửa issue.
 * Tệp gắn vào issue; hiện trong bình luận qua `![](attachment:ID)`.
 */
export function uploadCommentAttachmentFile(issueId: string, file: File): Promise<Attachment> {
  return postFile(`/issues/${issueId}/comment-attachments`, file);
}

/** Tải lên tệp (multipart/form-data, field `file`). Không tự set Content-Type. */
export function useUploadAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadAttachmentFile(issueId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issues.attachments(issueId) }),
  });
}

/** Xoá tệp đính kèm. */
export function useDeleteAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.issues.attachments(issueId) }),
  });
}

/** Tên tệp trong `Content-Disposition: attachment; filename="..."` (server mã hoá phần trăm); không có → undefined. */
function filenameFromDisposition(h: string | null): string | undefined {
  const m = /filename="?([^";]+)"?/i.exec(h ?? '');
  if (!m?.[1]) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** Tải file về máy: fetch kèm token → blob → object URL → click anchor tạm → revoke. */
export async function downloadAttachment(id: string, fileName?: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/attachments/${id}/download`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Tải xuống thất bại (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download =
      fileName ?? filenameFromDisposition(res.headers.get('Content-Disposition')) ?? 'tep-dinh-kem';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Tối đa 60 blob URL ảnh cùng lúc trong bộ nhớ trình duyệt; mục cũ nhất bị giải phóng khi vượt. */
const BLOB_CACHE_LIMIT = 60;
const blobUrls = new BlobUrlCache(BLOB_CACHE_LIMIT, (url) => URL.revokeObjectURL(url));

/**
 * Ảnh đính kèm cần header `Authorization` nên không dùng thẳng `<img src=".../download">`: tải bằng fetch
 * rồi dựng blob URL (không mở route công khai/ký URL — ảnh không lộ ra ngoài). Chỉ nhận ảnh an toàn (không SVG).
 */
async function fetchAttachmentBlobUrl(id: string): Promise<string> {
  const hit = blobUrls.get(id);
  if (hit) return hit;
  const res = await fetch(`${BASE_URL}/attachments/${encodeURIComponent(id)}/download`, {
    headers: { Authorization: `Bearer ${getAccessToken()}` },
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`Không xem được ảnh (${res.status})`);
  const blob = await res.blob();
  if (!isImageMime(blob.type)) throw new Error('Tệp này không phải ảnh xem được');
  const url = URL.createObjectURL(blob);
  blobUrls.set(id, url);
  return url;
}

/** Blob URL của một ảnh đính kèm (giữ 10 phút sau khi không còn chỗ nào hiển thị). */
export function useAttachmentUrl(id: string) {
  return useQuery({
    queryKey: keys.attachments.blob(id),
    queryFn: () => fetchAttachmentBlobUrl(id),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

/**
 * Tải ảnh dán (Ctrl+V) lên một công việc có sẵn, trả `attachment:ID` để chèn vào Markdown.
 * `comment` = ảnh trong bình luận: route `comment-attachments` (chỉ cần quyền bình luận); ảnh vẫn là tệp của CÔNG VIỆC
 * nên hiện ở khối Tệp đính kèm. Không `comment` = mô tả (cần quyền sửa).
 */
export function usePastedImageUploader(issueId: string, kind: 'description' | 'comment') {
  const qc = useQueryClient();
  return useCallback(
    async (files: File[]) => {
      const upload = kind === 'comment' ? uploadCommentAttachmentFile : uploadAttachmentFile;
      const refs: Array<{ name: string; ref: string }> = [];
      for (const f of files) {
        const a = await upload(issueId, f);
        refs.push({ name: a.fileName, ref: `attachment:${a.id}` });
      }
      void qc.invalidateQueries({ queryKey: keys.issues.attachments(issueId) });
      return refs;
    },
    [issueId, kind, qc],
  );
}
