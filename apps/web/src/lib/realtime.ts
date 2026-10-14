import { useEffect } from 'react';
import { keys } from './queryKeys';
import { queryClient } from './queryClient';
import { getSocket } from './socket';

/** Placeholder — thay bằng bản đầy đủ ở bước sau. */
export function useProjectRealtime(projectId: string | undefined) {
  useEffect(() => {
    if (!projectId) return;
    const s = getSocket();
    if (!s.connected) s.connect();
    const join = () => s.emit('subscribe', { kind: 'project', id: projectId });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: keys.issues.byProject(projectId) });
    join();
    s.on('connect', join);
    s.on('issue:moved', refresh);
    return () => {
      s.emit('unsubscribe', { kind: 'project', id: projectId });
      s.off('connect', join);
      s.off('issue:moved', refresh);
    };
  }, [projectId]);
}
