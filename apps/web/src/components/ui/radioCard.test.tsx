import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RadioCard, type RadioCardOption } from './RadioCard';

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');
const src = () => read('components/ui/RadioCard.tsx');

type K = 'a' | 'b' | 'c';
const options: RadioCardOption<K>[] = [
  { value: 'a', label: 'Mục A', description: 'Mô tả A' },
  { value: 'b', label: 'Mục B', description: 'Mô tả B', children: <span>NỘI-DUNG-B</span> },
  { value: 'c', label: 'Mục C', disabled: true },
];
const html = (value: K | null, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    <RadioCard<K>
      value={value}
      onChange={() => undefined}
      options={options}
      ariaLabel="Chọn mục"
      {...(extra as object)}
    />,
  );

describe('RadioCard — ngữ nghĩa radiogroup', () => {
  it('radiogroup có tên truy cập; mỗi thẻ là role="radio" với aria-checked theo giá trị', () => {
    const h = html('b');
    expect(h).toMatch(
      /role="radiogroup"[^>]*aria-label="Chọn mục"|aria-label="Chọn mục"[^>]*role="radiogroup"/,
    );
    expect(h.match(/role="radio"/g)?.length).toBe(3);
    expect(h.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(h).toMatch(/aria-checked="true"[^>]*>(?:(?!<button).)*Mục B/s);
  });
  it('có thể gắn nhãn bằng ariaLabelledby (nhãn nhìn thấy của nơi dùng)', () => {
    const h = html('a', { ariaLabel: undefined, ariaLabelledby: 'lbl' });
    expect(h).toContain('aria-labelledby="lbl"');
  });
  it('một điểm dừng Tab: mục đang chọn; chưa chọn (null) → mục BẬT đầu tiên', () => {
    expect(html('b').match(/tabindex="0"/g)?.length).toBe(1);
    const sel = html('b');
    expect(sel.indexOf('tabindex="0"')).toBeGreaterThan(sel.indexOf('Mục A'));
    const none = html(null);
    expect(none).not.toContain('aria-checked="true"');
    expect(none.match(/tabindex="0"/g)?.length).toBe(1);
    expect(none.indexOf('tabindex="0"')).toBeLessThan(none.indexOf('Mục A'));
  });
  it('mục đầu bị tắt + chưa chọn → điểm vào là mục bật đầu tiên (bỏ qua mục tắt)', () => {
    const opts: RadioCardOption<K>[] = [
      { value: 'a', label: 'AA', disabled: true },
      { value: 'b', label: 'BB' },
    ];
    const h = renderToStaticMarkup(
      <RadioCard<K> value={null} onChange={() => undefined} options={opts} ariaLabel="x" />,
    );
    expect(h.indexOf('tabindex="0"')).toBeGreaterThan(h.indexOf('AA'));
    expect(h.indexOf('tabindex="0"')).toBeLessThan(h.indexOf('BB'));
  });
  it('mục tắt: disabled + aria-disabled; cả nhóm tắt → mọi mục tắt', () => {
    expect(html('a')).toMatch(
      /aria-disabled="true"[^>]*disabled|disabled=""[^>]*aria-disabled="true"/,
    );
    const all = html('a', { disabled: true });
    expect(all.match(/ disabled=""/g)?.length).toBe(3);
    expect(all).toContain('aria-disabled="true"');
  });
});

describe('RadioCard — mô tả, nội dung lồng, chỉ báo chọn', () => {
  it('mô tả gắn vào thẻ qua aria-describedby (id khác nhau từng thẻ, theo useId)', () => {
    const h = html('a');
    const ids = [...h.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBe(2); // C không có mô tả
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(h).toContain(`id="${id}"`);
    expect(h).toContain('Mô tả A');
    expect(src()).toContain('useId');
  });
  it('children chỉ hiện khi thẻ đang được chọn', () => {
    expect(html('b')).toContain('NỘI-DUNG-B');
    expect(html('a')).not.toContain('NỘI-DUNG-B');
  });
  it('chọn không chỉ bằng màu: chấm radio đặc (aria-hidden) ở thẻ chọn, viền + nền token primary', () => {
    const h = html('a');
    expect(h).toContain('data-selected="true"');
    expect(h.match(/data-selected="true"/g)?.length).toBe(1);
    expect(h).toContain('border-primary');
    expect(h).toContain('bg-primary-subtle');
    expect(src()).toMatch(/aria-hidden/);
  });
  it('không có viền-sọc bên (side-stripe bị cấm) và không gradient/glass', () => {
    const s = src();
    expect(s).not.toMatch(/border-l(-|\s|"|')/);
    expect(s).not.toMatch(/border-(l|r)-\d|border-s-|border-e-/);
    expect(s).not.toMatch(/gradient|backdrop-blur/);
  });
});

describe('RadioCard — lỗi, bàn phím, cảm ứng', () => {
  it('invalid chuỗi → aria-invalid + lời lỗi + describedby; aria-describedby truyền vào được nối', () => {
    const h = html('a', { id: 'g', invalid: 'Hãy chọn một mục', 'aria-describedby': 'hint1' });
    expect(h).toContain('aria-invalid="true"');
    expect(h).toContain('Hãy chọn một mục');
    expect(h).toMatch(/aria-describedby="hint1 g-error"/);
    expect(h).toContain('id="g-error"');
  });
  it('invalid boolean → aria-invalid, không vẽ lời lỗi; không lỗi → không aria-invalid', () => {
    expect(html('a', { invalid: true })).toContain('aria-invalid="true"');
    expect(html('a')).not.toContain('aria-invalid');
  });
  it('dùng chung cơ chế SegmentedControl: radioGroupKeyDownSkipDisabled + shouldEmitChange + invalidAttrs', () => {
    const s = src();
    expect(s).toContain('radioGroupKeyDownSkipDisabled');
    expect(s).toContain('shouldEmitChange');
    expect(s).toContain('invalidAttrs');
    expect(s).toContain('FieldErrorText');
  });
  it('vùng chạm ≥ 44px dưới sm / cảm ứng; thẻ xếp một cột', () => {
    const s = src();
    expect(s).toMatch(/max-sm:min-h-11/);
    expect(s).toMatch(/pointer:coarse\)\]:min-h-11/);
    expect(s).toMatch(/flex-col/);
    expect(s).not.toMatch(/grid-cols-2|sm:flex-row/);
  });
  it('cả thẻ là mục tiêu bấm (một nút bao toàn bộ phần đầu thẻ), motion-reduce an toàn', () => {
    const s = src();
    expect(s).toMatch(/w-full/);
    expect(s).toMatch(/motion-reduce|transition-colors/);
  });
});

describe('015b · thay các khối lặp bằng RadioCard', () => {
  const SITES = [
    'features/projects/CreateProjectModal.tsx',
    'features/backlog/CompleteSprintDialog.tsx',
    'features/sharing/SharePicker.tsx',
    'features/board/BoardSettingsDialog.tsx', // 2 nhóm: swimlane + loại bảng
    'features/issues/TransitionDialog.tsx',
  ];
  for (const f of SITES)
    it(`${f}: dùng <RadioCard>, không còn khối label+input radio tự viết`, () => {
      const s = read(f);
      expect(s).toContain("from '@/components/ui/RadioCard'");
      expect(s).not.toContain('type="radio"');
    });
  it('BoardSettingsDialog thay đủ 2 nhóm; SharePicker (dùng chung cho hộp chia sẻ) giữ SearchSelect lồng qua children', () => {
    expect(read('features/board/BoardSettingsDialog.tsx').match(/<RadioCard\b/g)?.length).toBe(2);
    const share = read('features/sharing/SharePicker.tsx');
    expect(share).toMatch(/children:/);
    expect(share).toContain('Dự án được chia sẻ');
    expect(share).toContain('Nhóm được chia sẻ');
  });
  it('CompleteSprint giữ mục tắt + SearchSelect "Sprint đích" khi chọn "existing"', () => {
    const s = read('features/backlog/CompleteSprintDialog.tsx');
    expect(s).toContain('disabled: o.disabled');
    expect(s).toContain('Sprint đích');
  });
  it('Transition: tự focus vào thẻ đang chọn (selector theo role/aria-checked, không còn input radio)', () => {
    const s = read('features/issues/TransitionDialog.tsx');
    expect(s).toContain('[role="radio"][aria-checked="true"]');
  });
  it('Transition: Enter trên một thẻ radio vẫn xác nhận như radio native (không bị coi là "Enter trên nút")', () => {
    const s = read('features/issues/TransitionDialog.tsx');
    expect(s).toMatch(
      /tagName === 'BUTTON'[^\n]*role[^\n]*radio|role[^\n]*radio[^\n]*tagName === 'BUTTON'/,
    );
  });
  it('không đụng nhóm radio KHÔNG có mô tả (Telegram bot, Worklog ước lượng): vẫn radio native inline', () => {
    expect(read('features/integrations/TelegramWizardDialog.tsx')).toContain('type="radio"');
    expect(read('features/issues/WorklogPanel.tsx')).toContain('type="radio"');
  });
});

describe('RadioCard — tên truy cập không lặp mô tả', () => {
  const withMeta: RadioCardOption<K>[] = [
    { value: 'a', label: 'Mục A', description: 'Mô tả A', meta: <span>CHIP-BƯỚC</span> },
    { value: 'b', label: 'Mục B' },
  ];
  const h = renderToStaticMarkup(
    <RadioCard<K> value="a" onChange={() => undefined} options={withMeta} ariaLabel="x" id="g" />,
  );
  const radios = [...h.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
  const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];

  it('aria-labelledby trỏ tới span nhãn (chỉ chứa nhãn), không phải toàn bộ nội dung nút', () => {
    const lab = attr(radios[0]!, 'aria-labelledby');
    expect(lab).toBeTruthy();
    expect(h).toMatch(new RegExp(`<span id="${lab}"[^>]*>Mục A</span>`));
    // mục không mô tả cũng có tên từ nhãn
    expect(attr(radios[1]!, 'aria-labelledby')).toBeTruthy();
  });
  it('mô tả nằm ở aria-describedby (id khác id nhãn); meta KHÔNG nằm trong tên lẫn mô tả', () => {
    const lab = attr(radios[0]!, 'aria-labelledby')!;
    const desc = attr(radios[0]!, 'aria-describedby')!;
    expect(desc).toBeTruthy();
    expect(desc).not.toBe(lab);
    expect(desc.split(' ')).toHaveLength(1);
    expect(h).toMatch(new RegExp(`<span id="${desc}"[^>]*>Mô tả A</span>`));
    expect(h).not.toMatch(new RegExp(`id="[^"]*"[^>]*>[^<]*CHIP-BƯỚC`));
    expect(attr(radios[1]!, 'aria-describedby')).toBeUndefined();
  });
  it('id nhãn theo useId, riêng từng thẻ', () => {
    expect(attr(radios[0]!, 'aria-labelledby')).not.toBe(attr(radios[1]!, 'aria-labelledby'));
    expect(src()).toContain('-label`');
  });
});

describe('TransitionDialog — id nhãn nhóm', () => {
  it('dùng useId, không hard-code', () => {
    const t = read('features/issues/TransitionDialog.tsx');
    expect(t).not.toContain('"tr-resolution-label"');
    expect(t).toContain('useId');
  });
});
