import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useIssue } from '@/features/issues/api';
import { primaryTourOf, routeToScreen } from '@/features/guides/routeToScreen';
import { useScreenGuides } from '@/features/guides/api';
import { useProject, useProjects } from '@/features/projects/api';
import { apiErrorMessage } from '@/lib/api';
import { issueKeyFromPathname, readRecentProjectKeys, safeDecode } from '@/lib/currentProject';
import { useAuth } from '@/stores/auth';
import type { Block } from './blocks';
import {
  conversationReducer,
  loadConversation,
  saveConversation,
  type ConversationAction,
} from './conversation';
import { createAssistantDeps } from './deps';
import { detectIntent } from './intents';
import { greetingBlocks, respond, type AssistantProject, type RespondEnv } from './respond';
import type { TourContent } from '@tirapro/shared';

const uid = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export interface SubmitOptions {
  /** Chữ hiện ở bong bóng người dùng (chip chọn dự án hiển thị tên dự án thay vì cả câu lệnh). */
  label?: string;
  /** Chọn dự án cho lượt này (chip dự án) — không lưu sang lượt sau. */
  projectKey?: string;
}

/**
 * Điều khiển hội thoại của Trợ lý: gom ngữ cảnh màn hình (đường dẫn, dự án hiện tại, tour) → gọi `respond` → ghi tin vào
 * reducer (lưu sessionStorage). Dữ liệu đọc qua API sẵn có bằng token của người dùng; không gì rời trình duyệt ra ngoài
 * hệ thống Tirapro.
 */
export function useAssistantController(open: boolean) {
  const { pathname } = useLocation();
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);

  const [messages, dispatch] = useReducer(conversationReducer, userId, loadConversation);
  const [busy, setBusy] = useState(false);

  const { data: activeProjects } = useProjects();
  const issueKey = issueKeyFromPathname(pathname);
  const urlKey = /^\/p\/([^/]+)/.exec(pathname)?.[1];
  const { data: urlProject } = useProject(urlKey ? safeDecode(urlKey) : '');
  const { data: issue } = useIssue(issueKey);
  const { data: allProjects } = useProjects(true, !!issueKey);
  const project: AssistantProject | null =
    urlProject ?? (issue ? (allProjects?.find((p) => p.id === issue.projectId) ?? null) : null);

  const { data: guides } = useScreenGuides(routeToScreen(pathname));
  const tourGuide = primaryTourOf(guides);

  const env = useMemo<RespondEnv>(
    () => ({
      pathname,
      project: project ? { id: project.id, key: project.key, name: project.name } : null,
      projects: (activeProjects ?? []).map((p) => ({ id: p.id, key: p.key, name: p.name })),
      recentKeys: readRecentProjectKeys(),
      tour: tourGuide
        ? {
            available: true,
            title: tourGuide.title,
            // Mô tả của tour nếu có; không có thì để trống (mô tả màn đã đủ).
            description:
              tourGuide.description ??
              ((tourGuide.content as TourContent).steps.length > 0
                ? `${(tourGuide.content as TourContent).steps.length} bước`
                : null),
          }
        : { available: false },
      issueKey,
    }),
    [pathname, project, activeProjects, tourGuide, issueKey],
  );
  const envRef = useRef(env);
  envRef.current = env;
  const deps = useMemo(() => createAssistantDeps(qc), [qc]);
  const busyRef = useRef(false);

  // Lưu hội thoại trong phiên (sessionStorage, bọc try/catch trong `saveConversation`).
  useEffect(() => saveConversation(userId, messages), [userId, messages]);

  // Câu đầu tiên khi mở panel lần đầu: lời chào + chip hợp màn hiện tại.
  useEffect(() => {
    if (open && messages.length === 0)
      dispatch({
        type: 'add',
        message: { id: uid(), role: 'bot', blocks: greetingBlocks(envRef.current.pathname) },
      });
  }, [open, messages.length]);

  const submit = useCallback(
    async (raw: string, opts: SubmitOptions = {}) => {
      const text = raw.trim();
      if (!text || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      dispatch({
        type: 'add',
        message: { id: uid(), role: 'user', blocks: [{ type: 'text', text: opts.label ?? text }] },
      });
      let blocks: Block[];
      try {
        blocks = await respond(
          detectIntent(text),
          { ...envRef.current, ...(opts.projectKey ? { forceProjectKey: opts.projectKey } : {}) },
          deps,
        );
      } catch (e) {
        blocks = [{ type: 'text', text: `Mình chưa lấy được dữ liệu: ${apiErrorMessage(e)}` }];
      }
      dispatch({ type: 'add', message: { id: uid(), role: 'bot', blocks } });
      busyRef.current = false;
      setBusy(false);
    },
    [deps],
  );

  const clear = useCallback(() => dispatch({ type: 'clear' }), []);
  const patchDraft = useCallback(
    (m: Extract<ConversationAction, { type: 'patch-draft' }>) => dispatch(m),
    [],
  );

  return { messages, busy, submit, clear, patchDraft };
}
