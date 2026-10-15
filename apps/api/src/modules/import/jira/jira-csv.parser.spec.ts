import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeJira, parseJiraCsv, parseJiraCsvAsync, parseJiraDate } from './jira-csv.parser';

const fixture = readFileSync(join(__dirname, '..', 'fixtures', 'jira-sample.csv'));

describe('parseJiraDate', () => {
  it('đọc định dạng dd/MMM/yy h:mm a của Jira (UTC)', () => {
    expect(parseJiraDate('15/Oct/26 9:30 AM')?.toISOString()).toBe('2026-10-15T09:30:00.000Z');
    expect(parseJiraDate('15/Oct/26 9:30 PM')?.toISOString()).toBe('2026-10-15T21:30:00.000Z');
    expect(parseJiraDate('01/Sep/26 12:05 AM')?.toISOString()).toBe('2026-09-01T00:05:00.000Z');
    expect(parseJiraDate('01/Sep/26 12:05 PM')?.toISOString()).toBe('2026-09-01T12:05:00.000Z');
  });
  it('chấp nhận năm 4 chữ số, giờ 24h, chỉ có ngày và ISO', () => {
    expect(parseJiraDate('3/Jan/2027 14:00')?.toISOString()).toBe('2027-01-03T14:00:00.000Z');
    expect(parseJiraDate('31/Dec/26')?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(parseJiraDate('2026-10-15T09:30:00Z')?.toISOString()).toBe('2026-10-15T09:30:00.000Z');
  });
  it('trả null khi rỗng hoặc không hợp lệ', () => {
    expect(parseJiraDate('')).toBeNull();
    expect(parseJiraDate('hôm qua')).toBeNull();
    expect(parseJiraDate('31/Foo/26')).toBeNull();
    expect(parseJiraDate('45/Oct/26')).toBeNull();
  });
});

describe('parseJiraCsv — jira-sample.csv', () => {
  const parsed = parseJiraCsv(fixture);
  const byKey = new Map(parsed.issues.map((i) => [i.key, i]));

  it('đọc đủ 20 issue, không cột lạ nào bị coi là chuẩn', () => {
    expect(parsed.issues).toHaveLength(20);
    expect(parsed.unknownColumns).toEqual(['Custom field (Ghi chú nội bộ)']);
  });

  it('gộp cột Labels lặp thành mảng (bỏ ô rỗng)', () => {
    expect(byKey.get('PROJ-3')!.labels).toEqual(['payment', 'backend', 'urgent']);
    expect(byKey.get('PROJ-14')!.labels).toEqual(['design', 'frontend', 'ui']);
    expect(byKey.get('PROJ-1')!.labels).toEqual([]);
  });

  it('gộp cột Sprint lặp thành mảng theo thứ tự', () => {
    expect(byKey.get('PROJ-4')!.sprints).toEqual(['Sprint 1', 'Sprint 2']);
    expect(byKey.get('PROJ-6')!.sprints).toEqual(['Sprint 3']);
    expect(byKey.get('PROJ-9')!.sprints).toEqual([]);
  });

  it('gộp cột Comment lặp và tách `ngày;accountId;nội dung` (nội dung có thể chứa dấu ; và xuống dòng)', () => {
    const c = byKey.get('PROJ-3')!.comments;
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ authorRef: 'acc-binh', body: 'Đã có tài liệu API.' });
    expect(c[0]!.createdAt?.toISOString()).toBe('2026-09-05T14:10:00.000Z');
    expect(c[1]!.authorRef).toBe('acc-an');
    expect(c[1]!.body).toBe('Bắt đầu làm; sẽ xong trong tuần.\nDòng thứ hai của bình luận.');
    expect(byKey.get('PROJ-10')!.comments).toHaveLength(3);
  });

  it('parse ngày Jira đúng', () => {
    const i = byKey.get('PROJ-6')!;
    expect(i.created?.toISOString()).toBe('2026-10-15T09:30:00.000Z');
    expect(byKey.get('PROJ-2')!.dueDate?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    expect(byKey.get('PROJ-3')!.resolved?.toISOString()).toBe('2026-09-20T16:30:00.000Z');
    expect(byKey.get('PROJ-9')!.resolved).toBeNull();
  });

  it('subtask mang Parent (id của việc cha), story mang Epic Link (key epic)', () => {
    const sub = byKey.get('PROJ-15')!;
    expect(sub.issueType).toBe('Sub-task');
    expect(sub.parentRef).toBe('10003');
    expect(byKey.get('PROJ-3')!.epicRef).toBe('PROJ-1');
    expect(byKey.get('PROJ-1')!.issueType).toBe('Epic');
    expect(parsed.issues.filter((i) => i.issueType === 'Sub-task')).toHaveLength(6);
  });

  it('giữ nguyên Description nhiều dòng có ngoặc kép; story points & thời gian (giây)', () => {
    const i = byKey.get('PROJ-3')!;
    expect(i.description).toContain('Yêu cầu:\n- Tạo link thanh toán\n- Xử lý IPN');
    expect(i.description).toContain('"Quan trọng": phải idempotent; xem a, b; c.');
    expect(i.storyPoints).toBe(8);
    expect(i.timeSpent).toBe(25200);
    expect(i.originalEstimate).toBe(28800);
    expect(byKey.get('PROJ-9')!.timeSpent).toBeNull();
    expect(byKey.get('PROJ-9')!.storyPoints).toBe(1);
  });
});

describe('analyzeJira', () => {
  const analysis = analyzeJira(parseJiraCsv(fixture));

  it('tóm tắt project/loại/trạng thái/ưu tiên theo thứ tự xuất hiện, bỏ giá trị rỗng', () => {
    expect(analysis.rows).toBe(20);
    expect(analysis.projectKeys).toEqual(['PROJ']);
    expect(analysis.issueTypes).toEqual(['Epic', 'Story', 'Bug', 'Task', 'Sub-task']);
    expect(analysis.statuses).toEqual(['Done', 'In Progress', 'In Review', 'To Do']);
    expect(analysis.priorities).toEqual(['High', 'Medium', 'Highest', 'Low', 'Lowest']);
  });

  it('liệt kê user (assignee/reporter/creator + tác giả comment), gộp accountId về tên', () => {
    const names = analysis.users.map((u) => u.name);
    expect(names).toEqual(
      expect.arrayContaining(['Nguyễn Văn An', 'Trần Thị Bình', 'Lê Minh Cường']),
    );
    // acc-ghost chỉ xuất hiện ở comment → hiện bằng accountId
    expect(names).toContain('acc-ghost');
    // acc-an đã gắn với "Nguyễn Văn An", không xuất hiện riêng
    expect(names).not.toContain('acc-an');
    expect(new Set(names).size).toBe(names.length);
  });

  it('báo cột lạ', () => {
    expect(analysis.unknownColumns).toEqual(['Custom field (Ghi chú nội bộ)']);
  });
});

describe('parseJiraCsv — biến thể', () => {
  it('chấp nhận BOM, tên cột Story Points thường, project key suy ra từ issue key', () => {
    const csv =
      '\uFEFFSummary,Issue key,Issue id,Issue Type,Status,Story Points,Assignee\nA,ABC-7,1,Task,To Do,3,admin@x.vn\n';
    const p = parseJiraCsv(csv);
    expect(p.issues[0]).toMatchObject({ key: 'ABC-7', storyPoints: 3 });
    const a = analyzeJira(p);
    expect(a.projectKeys).toEqual(['ABC']);
    expect(a.users).toEqual([{ name: 'admin@x.vn', email: 'admin@x.vn' }]);
  });

  it('thiếu cột Summary hoặc Issue key → ném lỗi tiếng Việt', () => {
    expect(() => parseJiraCsv('Foo,Bar\n1,2\n')).toThrow(/Summary/);
    expect(() => parseJiraCsv('Summary,Status\nx,y\n')).toThrow(/Issue key/);
  });

  it('bỏ qua dòng trống hoàn toàn', () => {
    const csv = 'Summary,Issue key\nA,P-1\n,\n\nB,P-2\n';
    expect(parseJiraCsv(csv).issues.map((i) => i.key)).toEqual(['P-1', 'P-2']);
  });
});

describe('parseJiraCsvAsync', () => {
  it('cho kết quả giống hệt parseJiraCsv trên jira-sample.csv', async () => {
    const [a, b] = [parseJiraCsv(fixture), await parseJiraCsvAsync(fixture)];
    expect(b.issues).toEqual(a.issues);
    expect(b.unknownColumns).toEqual(a.unknownColumns);
    expect([...b.accountNames]).toEqual([...a.accountNames]);
  });

  it('nhận cả string và ném cùng lỗi thiếu cột như bản đồng bộ', async () => {
    await expect(parseJiraCsvAsync('a,b\n1,2\n')).rejects.toThrow(/Summary/);
    await expect(parseJiraCsvAsync('')).rejects.toThrow(/Summary/);
    await expect(parseJiraCsvAsync('Summary,Status\nx,y\n')).rejects.toThrow(/Issue key/);
  });

  it('không chặn event loop: setImmediate/timer vẫn chạy xen giữa lúc parse tệp lớn', async () => {
    const header = 'Summary,Issue key\n';
    const big = header + Array.from({ length: 60_000 }, (_, i) => `Việc ${i},P-${i}`).join('\n');
    let ticks = 0;
    const t = setInterval(() => {
      ticks++;
    }, 0);
    const r = await parseJiraCsvAsync(Buffer.from(big));
    clearInterval(t);
    expect(r.issues).toHaveLength(60_000);
    expect(r.issues[59_999]!.row).toBe(60_000);
    expect(ticks).toBeGreaterThan(3); // ≥ vài lần nhường event loop
  });

  it('tệp ~25MB: khoảng chặn event loop dài nhất < một nửa thời gian chặn của bản đồng bộ', async () => {
    const header = 'Summary,Issue key,Description\n';
    const desc = 'x'.repeat(200);
    const rows: string[] = [];
    let size = header.length;
    for (let i = 0; size < 25 * 1024 * 1024; i++) {
      const line = `Việc ${i},P-${i},${desc}`;
      rows.push(line);
      size += Buffer.byteLength(line) + 1;
    }
    const buf = Buffer.from(header + rows.join('\n'));
    // Baseline: bản đồng bộ chặn event loop trọn vẹn bằng chừng này (đo cùng máy, cùng lúc).
    const syncStart = performance.now();
    parseJiraCsv(buf);
    const syncBlock = performance.now() - syncStart;

    let last = performance.now();
    let maxGap = 0;
    const t = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 1);
    const r = await parseJiraCsvAsync(buf);
    clearInterval(t);
    maxGap = Math.max(maxGap, performance.now() - last);
    expect(r.issues).toHaveLength(rows.length);
    expect(maxGap).toBeLessThan(syncBlock / 2);
  }, 60_000);

  it('CSV hỏng giữa luồng (quote không đóng / quote lạc) → reject, không treo', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `Việc ${i},P-${i}`);
    const head = 'Summary,Issue key\n';
    await expect(
      parseJiraCsvAsync(head + rows.join('\n') + '\n"không đóng,P-x\nvà tiếp\n'),
    ).rejects.toThrow();
    await expect(
      parseJiraCsvAsync(
        head + rows.slice(0, 2500).join('\n') + '\nViệc "lạc,P-y\n' + rows.join('\n'),
      ),
    ).rejects.toThrow();
  });
});
