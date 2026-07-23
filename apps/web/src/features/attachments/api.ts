import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getAccessToken } from '@/lib/auth-token';

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

export const attachmentsKey = (issueId: string) => ['attachments', issueId] as const;

/** Danh sách tệp đính kèm của issue. */
export function useAttachments(issueId: string | undefined) {
  return useQuery({
    queryKey: attachmentsKey(issueId ?? ''),
    queryFn: async () => (await api.get<Attachment[]>(`/issues/${issueId}/attachments`)).data,
    enabled: !!issueId,
  });
}

/** Tải 1 tệp lên issue (multipart/form-data, field `file`). Dùng lại được (vd tạo issue rồi upload). */
export async function uploadAttachmentFile(issueId: string, file: File): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`${BASE_URL}/issues/${issueId}/attachments`, {
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

/** Tải lên tệp (multipart/form-data, field `file`). Không tự set Content-Type. */
export function useUploadAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadAttachmentFile(issueId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentsKey(issueId) }),
  });
}

/** Xoá tệp đính kèm. */
export function useDeleteAttachment(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/attachments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: attachmentsKey(issueId) }),
  });
}

/** Tải file về máy: fetch kèm token → blob → object URL → click anchor tạm → revoke. */
export async function downloadAttachment(id: string, fileName: string): Promise<void> {
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
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
