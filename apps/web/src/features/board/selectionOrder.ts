import type { IssueDto } from '@tirapro/types';

/**
 * Id các thẻ theo THỨ TỰ HIỂN THỊ (= thứ tự DOM): bảng phẳng đi cột trái → phải; có làn thì lần lượt từng làn, trong làn theo
 * thứ tự cột; trong cột từ trên xuống. Là thứ tự Shift+click dùng để chọn dải.
 */
export function boardVisualOrder(
  columns: ReadonlyArray<{ id: string }>,
  byColumn: ReadonlyMap<string, IssueDto[]>,
  lanes: ReadonlyArray<{ key: string }> | null,
  laneCols: ReadonlyMap<string, ReadonlyMap<string, IssueDto[]>>,
): string[] {
  const out: string[] = [];
  const addColumns = (map: ReadonlyMap<string, IssueDto[]> | undefined) => {
    if (!map) return;
    for (const col of columns) for (const issue of map.get(col.id) ?? []) out.push(issue.id);
  };
  if (lanes) for (const lane of lanes) addColumns(laneCols.get(lane.key));
  else addColumns(byColumn);
  return out;
}
