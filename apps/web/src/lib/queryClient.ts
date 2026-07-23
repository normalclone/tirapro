import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export const qk = {
  me: ['me'] as const,
  projects: ['projects'] as const,
  project: (key: string) => ['project', key] as const,
  boards: (projectId: string) => ['boards', projectId] as const,
  sprints: (projectId: string) => ['sprints', projectId] as const,
  issues: (filters: Record<string, unknown>) => ['issues', filters] as const,
  issue: (key: string) => ['issue', key] as const,
  comments: (issueId: string) => ['comments', issueId] as const,
  members: ['members'] as const,
};
