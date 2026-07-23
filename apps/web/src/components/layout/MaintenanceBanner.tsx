import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

/** Banner bảo trì toàn hệ thống — admin bật ở /admin/config. Ẩn khi rỗng. */
export function MaintenanceBanner() {
  const { data } = useQuery({
    queryKey: ['system-announcement'],
    queryFn: async () => (await api.get<{ maintenanceBanner: string; signupEnabled: boolean }>('/health/announcement')).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const msg = data?.maintenanceBanner?.trim();
  if (!msg) return null;
  return (
    <div role="status" className="flex items-start gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm text-ink">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 whitespace-pre-wrap">{msg}</span>
    </div>
  );
}
