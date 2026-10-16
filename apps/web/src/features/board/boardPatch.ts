import type { BoardDto, BoardType, SwimlaneBy } from '@tirapro/types';
import type { BoardPatch } from './api';

export interface BoardMetaDraft {
  name: string;
  jql: string;
  swimlane: SwimlaneBy;
  type: BoardType;
}

/** Chỉ các trường ĐÃ ĐỔI so với `board` (PATCH /boards/:id); rỗng = không có gì để gửi. `type` đi cùng body như các trường khác. */
export function boardMetaPatch(board: BoardDto, d: BoardMetaDraft): BoardPatch {
  const jql = d.jql.trim() || null;
  return {
    ...(d.name.trim() !== board.name ? { name: d.name.trim() } : {}),
    ...(jql !== (board.filterJql?.trim() || null) ? { filterJql: jql } : {}),
    ...(d.swimlane !== board.swimlaneBy ? { swimlaneBy: d.swimlane } : {}),
    ...(d.type !== board.type ? { type: d.type } : {}),
  };
}
