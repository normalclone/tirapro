/** Hình dạng tối thiểu của phản hồi REST mà MCP đọc — chỉ các trường thực sự dùng. */
export interface ProjectLite {
  id: string;
  key: string;
  name: string;
}
export interface UserLite {
  id: string;
  email: string;
  displayName: string;
}
interface NamedRef {
  id: string;
  name: string;
  key?: string;
}
export interface ProjectMeta {
  issueTypes: NamedRef[];
  priorities: NamedRef[];
}
export interface IssueRef {
  id: string;
  version: number;
}
