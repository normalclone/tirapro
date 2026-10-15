import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', '..'); // apps/web/src

/**
 * Ngoại lệ (đường dẫn tương đối `src`, kèm lý do). Hiện KHÔNG có: mọi hộp thoại phải luôn mount với `open` thật
 * để Radix kịp phát `data-state="closed"` (hiệu ứng đóng). Thêm ngoại lệ ở đây phải ghi rõ lý do.
 */
const EXCEPTIONS: Record<string, string> = {};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

/** Chặn `open` bằng early-return: `if (!open) return null`, `{ return null; }`, `return <></>`, `!isOpen`, `a || !open`. */
const EARLY_RETURN =
  /if\s*\((?:[^)]*\|\|\s*)?!\s*(?:open|isOpen)\b[^)]*\)\s*(?:\{\s*)?return\s+(?:null|false|undefined|<>\s*<\/>)\s*;?/;

/** Ternary mount: `open ? <XDialog …/> : null` hoặc `!open ? null : <XDialog …/>`. */
const TERNARY_MOUNT =
  /(?:\b(?:open|isOpen)\s*\?\s*\(?\s*<\w*(?:Dialog|Modal)\b|!\s*(?:open|isOpen)\s*\?\s*null\s*:\s*\(?\s*<\w*(?:Dialog|Modal)\b)/;

/** Các thẻ mở `<Dialog…>` / `<XxxDialog…>` / `<XxxModal…>` (đọc tới `>` đóng, bỏ qua `>` nằm trong `{}`/chuỗi). */
function dialogTags(text: string): { tag: string; start: number }[] {
  const out: { tag: string; start: number }[] = [];
  const re = /<(?:Dialog|[A-Z]\w*(?:Dialog|Modal))\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 0;
    let quote = '';
    let i = m.index + m[0].length;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (quote) {
        if (c === quote && text[i - 1] !== '\\') quote = '';
      } else if (c === '"' || c === "'" || c === '`') quote = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0 && text[i - 1] !== '=') break;
    }
    out.push({ tag: text.slice(m.index, i + 1), start: m.index });
  }
  return out;
}

/** Bỏ nội dung trong `{…}` (giữ cặp ngoặc) để chỉ còn thuộc tính cấp cao nhất của thẻ. */
function stripBraces(tag: string): string {
  let depth = 0;
  let out = '';
  for (const c of tag) {
    if (c === '{') {
      depth++;
      if (depth === 1) out += '{';
    } else if (c === '}') {
      depth--;
      if (depth === 0) out += '}';
    } else if (depth === 0) out += c;
  }
  return out;
}

/** `open` trần (`<Dialog open …>`) hoặc `open={true}` → luôn mở, nên chỉ hợp lệ khi cha gỡ cả cây lúc đóng (mất hiệu ứng). */
function hasConstantOpen(tag: string): boolean {
  return /\sopen=\{\s*true\s*\}/.test(tag) || /\sopen(?=\s|\/|>)/.test(stripBraces(tag));
}

/** Mount có điều kiện kiểu `{x && <XDialog open={x} …/>}`: cùng biểu thức vừa gỡ cây vừa làm `open`. */
function conditionalMountWithSameOpen(text: string): boolean {
  const re = /\{\s*(!?[\w.?]+)\s*&&[^<{]*<(?:Dialog|[A-Z]\w*(?:Dialog|Modal))\b/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const ident = m[1]!.replace(/^!/, '').replace(/[.?]/g, '\\$&');
    const tag = dialogTags(text.slice(m.index + m[0].lastIndexOf('<')))[0]?.tag ?? '';
    if (new RegExp(`\\sopen=\\{\\s*!*\\s*${ident}\\s*\\}`).test(tag)) return true;
  }
  return false;
}

function violations(text: string): string[] {
  const v: string[] = [];
  if (EARLY_RETURN.test(text)) v.push('early-return `!open`');
  if (TERNARY_MOUNT.test(text)) v.push('ternary `open ? <Dialog/> : null`');
  if (dialogTags(text).some((t) => hasConstantOpen(t.tag))) v.push('`open` trần / `open={true}`');
  if (conditionalMountWithSameOpen(text)) v.push('`{x && <Dialog open={x}/>}`');
  return v;
}

describe('bộ dò hợp đồng Dialog (tự kiểm regex)', () => {
  const bad = {
    'early-return một dòng': 'if (!open) return null;',
    'early-return có ngoặc nhọn': 'if (!open) {\n  return null;\n}',
    'early-return fragment': 'if (!open) return <></>;',
    'early-return !isOpen': 'if (!isOpen) return null;',
    'early-return kèm điều kiện đích': 'if (!open || !client) return null;',
    'open trần': '<Dialog open onOpenChange={(o) => !o && onClose()} title="x" />',
    'open trần xuống dòng': '<Dialog\n  open\n  onOpenChange={() => {}}\n/>',
    'open={true}': '<Dialog open={true} title="x" />',
    'open trần sau prop có =>': '<Dialog onOpenChange={(o) => !o && f()} open title="x" />',
    'wrapper open trần': '{pick && <StatusPickDialog open onCancel={() => 1} />}',
    ternary: 'return open ? <Dialog open={open} title="x" /> : null;',
    'mount có điều kiện cùng biểu thức':
      '{settingsOpen && <BoardSettingsDialog open={settingsOpen} />}',
    'mount có điều kiện cùng biểu thức (!!)': '{pick && (<XModal open={!!pick} />)}',
  };
  const good = {
    'open thật': '<Dialog open={open} onOpenChange={(o) => !o && onClose()} title="x" />',
    'effect return rỗng': 'useEffect(() => { if (!open) return; setX(1); }, [open]);',
    'mount có điều kiện nhưng open khác': '{pickShown && <StatusPickDialog open={!!pick} />}',
    'wrapper gác bằng đã-từng-mở':
      '{settingsKey > 0 && <BoardSettingsDialog key={k} open={settingsOpen} />}',
    'open nằm trong prop khác':
      '<Dialog onOpenChange={() => setOpen(true)} open={isOpen} title="open" />',
    'return null không liên quan open': 'if (!data) return null;',
  };
  for (const [name, code] of Object.entries(bad))
    it(`bắt: ${name}`, () => expect(violations(code), code).not.toEqual([]));
  for (const [name, code] of Object.entries(good))
    it(`bỏ qua: ${name}`, () => expect(violations(code), code).toEqual([]));
});

describe('hợp đồng Dialog', () => {
  const all = files(SRC).map((f) => ({ f: relative(SRC, f), text: readFileSync(f, 'utf8') }));

  it('mọi hộp thoại luôn mount với `open` thật (không early-return, không `open` trần, không mount có điều kiện cùng biểu thức)', () => {
    const bad = all
      .filter(({ f }) => !f.startsWith('components/ui/') && !(f in EXCEPTIONS))
      .flatMap(({ f, text }) => violations(text).map((v) => `${f}: ${v}`));
    expect(
      bad,
      `Giữ Dialog luôn mount + open thật (useRetained cho đối tượng đích):\n${bad.join('\n')}`,
    ).toEqual([]);
  });

  it('PlanningPanel dựng trên Dialog dùng chung (focus-trap, data-state)', () => {
    const t = all.find((x) => x.f === 'features/planning/PlanningPanel.tsx')!.text;
    expect(t).toContain("from '@/components/ui/Dialog'");
    expect(t).not.toMatch(/role="dialog"/);
  });
});
