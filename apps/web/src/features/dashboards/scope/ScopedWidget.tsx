import { createContext, useContext, type ReactNode } from 'react';
import { useProjects } from '@/features/projects/api';
import { cfgString } from '../widgetConfig';
import { WidgetScopeLabelContext } from '../WidgetFrame';
import { WidgetScopeProvider } from './ScopeContext';
import { resolveScope, scopeLabel, widgetInfoOf, type DashboardScopeInfo } from './widgetScope';

const DashboardScopeContext = createContext<DashboardScopeInfo | null>(null);

/** Cấp phạm vi dữ liệu của dashboard cho mọi ô bên trong (màn xem và màn soạn dùng chung). */
export function DashboardScopeProvider({
  value,
  children,
}: {
  value: DashboardScopeInfo | null;
  children: ReactNode;
}) {
  return <DashboardScopeContext.Provider value={value}>{children}</DashboardScopeContext.Provider>;
}

/**
 * Bọc MỘT ô: tính nguồn số liệu của ô (kế thừa phạm vi bảng hay dự án riêng), cấp cho ô và cho nhãn "lấy số liệu của đâu".
 * `server` = danh sách máy chủ đã giải cho đúng người xem (màn xem); chế độ soạn tự dựng từ bản đã lưu.
 */
export function ScopedWidget({
  config,
  server,
  children,
}: {
  config: Record<string, unknown>;
  server?: { inherits?: boolean; projectIds?: string[] | null };
  children: ReactNode;
}) {
  const dashboard = useContext(DashboardScopeContext);
  const info = widgetInfoOf(dashboard, config, server);
  const own = cfgString(config, 'projectId');
  const { data: projects } = useProjects(true, !!info && !!own);
  const explicitKey = own ? projects?.find((p) => p.id === own)?.key : undefined;
  const label = scopeLabel(info, resolveScope(info, config), explicitKey);
  return (
    <WidgetScopeProvider value={info}>
      <WidgetScopeLabelContext.Provider value={label}>{children}</WidgetScopeLabelContext.Provider>
    </WidgetScopeProvider>
  );
}
