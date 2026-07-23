import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { queryClient } from '@/lib/queryClient';
import { boardIssuesKey } from './api';

/** Gộp nhiều event dồn dập trong 1 nhịp ngắn thành 1 lần invalidate (tránh nháy). */
const ECHO_DEBOUNCE_MS = 250;

/**
 * Subscribe realtime cho 1 project: cập nhật board khi người khác đổi issue.
 *
 * Chống nháy (echo): mutation của chính mình đã cập nhật cache optimistic; khi
 * event realtime dội về, ta debounce để gộp nhiều event (và event tự-echo trùng
 * với optimistic) thành một lần invalidate duy nhất — tránh card giật/nháy.
 * (Payload WS hiện chưa mang actorId nên chưa lọc self theo actor được.)
 */
export function useProjectRealtime(projectId: string | undefined) {
  useEffect(() => {
    if (!projectId) return;
    const s = getSocket();
    if (!s.connected) s.connect();

    const join = () => s.emit('subscribe', { kind: 'project', id: projectId });

    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void queryClient.invalidateQueries({ queryKey: boardIssuesKey(projectId) });
        // Backlog/Tree/Gantt chia sẻ dữ liệu project qua key riêng.
        void queryClient.invalidateQueries({ queryKey: ['backlog-issues', projectId] });
      }, ECHO_DEBOUNCE_MS);
    };

    join();
    s.on('connect', join);
    s.on('issue:moved', invalidate);
    s.on('issue:updated', invalidate);
    s.on('issue:created', invalidate);
    s.on('issue:deleted', invalidate);

    return () => {
      if (timer) clearTimeout(timer);
      s.emit('unsubscribe', { kind: 'project', id: projectId });
      s.off('connect', join);
      s.off('issue:moved', invalidate);
      s.off('issue:updated', invalidate);
      s.off('issue:created', invalidate);
      s.off('issue:deleted', invalidate);
    };
  }, [projectId]);
}
