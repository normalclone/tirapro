import { createContext, useContext, type ReactNode } from 'react';
import { resolveScope, type ResolvedScope, type WidgetScopeInfo } from './widgetScope';

const WidgetScopeContext = createContext<WidgetScopeInfo | null>(null);

/** Cho các ô con biết phạm vi dữ liệu của dashboard (và danh sách dự án đã giải cho ô này). */
export function WidgetScopeProvider({
  value,
  children,
}: {
  value: WidgetScopeInfo | null;
  children: ReactNode;
}) {
  return <WidgetScopeContext.Provider value={value}>{children}</WidgetScopeContext.Provider>;
}

export function useWidgetScopeInfo(): WidgetScopeInfo | null {
  return useContext(WidgetScopeContext);
}

/** Nguồn số liệu của ô hiện tại (xem `resolveScope`). */
export function useWidgetScope(config: Record<string, unknown>): ResolvedScope {
  return resolveScope(useContext(WidgetScopeContext), config);
}
