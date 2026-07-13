/**
 * Tailwind クラス名が実効 @theme に実在するかを照合する — **import 専用モジュール**（CLI ではない）。
 * 呼び出し元: selfcheck.mjs の class-exists 検査。目的と根拠は rules/web-app-selfcheck.md。
 *
 * 誤検出を避けるため判定を 3 通りに分ける:
 *   A. トークン名前空間（bg- / rounded- / shadow- …）→ サフィックスを @theme と照合
 *   B. スペーシング系（p- / gap- / w- …）           → --spacing の 0.5 刻みに乗るか
 *   C. 静的ユーティリティ / 自由形式の名前空間        → 判定しない（知らないものを誤って責めない）
 */
import { toPx } from './theme.mjs'

// ── A. トークン名前空間: 接頭辞 → 探す @theme 名前空間 + その接頭辞固有の静的キーワード
const NS = {
  // 色系
  bg:      { look: ['--color-'], words: ['none', 'inherit', 'transparent', 'current', 'fixed', 'local', 'scroll', 'clip', 'origin', 'auto', 'cover', 'contain', 'center', 'top', 'bottom', 'left', 'right', 'repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'repeat-round', 'repeat-space'],
             open: ['linear', 'radial', 'conic', 'blend', 'position', 'size', 'image'] },
  text:    { look: ['--color-', '--text-'], words: ['left', 'center', 'right', 'justify', 'start', 'end', 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip', 'inherit', 'transparent', 'current'],
             open: ['shadow', 'decoration'] },
  // border は方向語（border-b / border-x-2 / border-t-primary）を伴うので、方向語も静的キーワードに含める
  border:  { look: ['--color-'], words: ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none', 'inherit', 'transparent', 'current', 'collapse', 'separate', 'spacing', 't', 'r', 'b', 'l', 'x', 'y', 's', 'e'] },
  ring:    { look: ['--color-'], words: ['inset', 'inherit', 'transparent', 'current'], open: ['offset'] },
  outline:  { look: ['--color-'], words: ['none', 'hidden', 'solid', 'dashed', 'dotted', 'double', 'inherit', 'transparent', 'current'], open: ['offset'] },
  divide:  { look: ['--color-'], words: ['solid', 'dashed', 'dotted', 'double', 'none', 'x', 'y', 'x-reverse', 'y-reverse', 'inherit', 'transparent', 'current'] },
  fill:    { look: ['--color-'], words: ['none', 'inherit', 'transparent', 'current'] },
  stroke:  { look: ['--color-'], words: ['none', 'inherit', 'transparent', 'current'] },
  accent:  { look: ['--color-'], words: ['auto', 'inherit', 'transparent', 'current'] },
  caret:   { look: ['--color-'], words: ['inherit', 'transparent', 'current'] },
  from:    { look: ['--color-'], words: ['inherit', 'transparent', 'current'] },
  via:     { look: ['--color-'], words: ['inherit', 'transparent', 'current'] },
  to:      { look: ['--color-'], words: ['inherit', 'transparent', 'current'] },
  // 純粋なトークン名前空間（静的キーワードがほぼ無い = 検出精度が高い）
  rounded:  { look: ['--radius-'], words: ['none', 'full', 't', 'r', 'b', 'l', 'tl', 'tr', 'br', 'bl', 's', 'e', 'ss', 'se', 'ee', 'es'] },
  shadow:   { look: ['--shadow-', '--color-'], words: ['none', 'inner', 'inherit', 'transparent', 'current'] },
  font:     { look: ['--font-weight-', '--font-'], words: [], open: ['stretch'] },
  leading:  { look: ['--leading-', '--spacing'], words: ['none', 'normal'] },
  tracking: { look: ['--tracking-'], words: ['normal'] },
  blur:     { look: ['--blur-'], words: ['none'] },
  'max-w':  { look: ['--container-', '--breakpoint-', '--spacing'], words: ['none', 'full', 'min', 'max', 'fit', 'prose', 'screen'] },
  'min-w':  { look: ['--container-', '--spacing'], words: ['none', 'full', 'min', 'max', 'fit', 'screen'] },
}

// ── B. スペーシング系（数値は --spacing の 0.5 刻み）
const SPACING = new Set([
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
  'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
  'gap', 'gap-x', 'gap-y', 'w', 'h', 'size',
  'space-x', 'space-y', 'inset', 'inset-x', 'inset-y',
  'top', 'right', 'bottom', 'left', 'start', 'end',
  'min-h', 'max-h', 'basis', 'indent', 'scroll-m', 'scroll-p',
])
// スペーシング系で数値以外に許される語
const SPACING_WORDS = new Set(['auto', 'full', 'screen', 'min', 'max', 'fit', 'px', 'dvh', 'dvw', 'lvh', 'svh', 'reverse', 'none'])

/** クラス文字列から variant / important / opacity 修飾を落として素のクラスにする */
export function bareClass(raw) {
  let c = raw.trim()
  if (!c) return null
  c = c.replace(/^!+/, '').replace(/!+$/, '')       // important
  const lastColon = c.lastIndexOf(':')
  if (lastColon >= 0) c = c.slice(lastColon + 1)     // hover: md: dark: group-hover: …
  c = c.replace(/\/[^/]*$/, '')                      // bg-primary/50
  return c || null
}

/**
 * @returns {{verdict:'ok'|'unknown'|'off-scale'|'skip', why?:string, suggest?:string[]}}
 */
export function judgeClass(raw, vars) {
  const c = bareClass(raw)
  if (!c) return { verdict: 'skip' }
  if (c.includes('[')) return { verdict: 'skip', why: 'arbitrary value（別ルールで検出）' }
  // Tailwind v4 の CSS 変数参照ショートハンド（min-w-(--radix-popper-anchor-width) 等）。
  // 値は実行時に決まるので @theme とは照合できない
  if (c.includes('(')) return { verdict: 'skip', why: 'CSS 変数参照' }
  if (/^-?\d/.test(c)) return { verdict: 'skip' }

  const neg = c.startsWith('-')
  const body = neg ? c.slice(1) : c

  // 最長一致で接頭辞を決める
  const prefixes = [...Object.keys(NS), ...SPACING].sort((a, b) => b.length - a.length)
  const pre = prefixes.find((p) => body === p || body.startsWith(p + '-'))
  if (!pre) return { verdict: 'skip' } // 知らない接頭辞は判定しない（flex / items-center 等）
  if (body === pre) return { verdict: 'ok' } // `border` `rounded` `shadow` 単体

  const suffix = body.slice(pre.length + 1)

  // B. スペーシング系
  if (SPACING.has(pre) && !NS[pre]) {
    if (SPACING_WORDS.has(suffix) || /^\d+\/\d+$/.test(suffix)) return { verdict: 'ok' }
    const n = suffix.match(/^(\d+(?:\.\d+)?)$/)
    if (!n) return { verdict: 'skip' }
    const unit = toPx(vars.get('--spacing'))
    if (!unit) return { verdict: 'skip', why: '--spacing が読めない' }
    // Tailwind は calc(var(--spacing) * <数値>) を作るので小数の刻みも成立する。
    // 既定スケール自体が 0.5 刻み（p-0.5 = 2px / p-1.5 = 6px）を使っているため、
    // 「--spacing の整数倍か」で判定すると shadcn/ui の py-0.5 等を誤って責めることになる。
    // 0.5 刻みまでを許容し、それより細かいもの（p-3.25 = 13px 等）を非適合として拾う。
    const step = parseFloat(n[1])
    const px = step * unit
    return (step * 2) % 1 === 0 ? { verdict: 'ok' } : { verdict: 'off-scale', why: `${px}px` }
  }

  // A. トークン名前空間
  const ns = NS[pre]
  if (ns.words.includes(suffix)) return { verdict: 'ok' }
  // 以降が自由形式の名前空間（bg-linear-to-r / ring-offset-2 / text-shadow-sm 等）は判定しない
  if (ns.open?.includes(suffix.split('-')[0])) return { verdict: 'skip' }
  // rounded-t-lg / divide-x-2 のように方向語が挟まる場合は方向語を除いて再評価
  const head = suffix.split('-')[0]
  if (ns.words.includes(head)) {
    const rest = suffix.slice(head.length + 1)
    if (!rest) return { verdict: 'ok' }
    if (/^\d+$/.test(rest)) return { verdict: 'ok' }
    if (ns.look.some((l) => vars.has(l + rest))) return { verdict: 'ok' }
    return { verdict: 'unknown', suggest: nearest(rest, ns.look, vars) }
  }
  if (/^\d+$/.test(suffix)) return { verdict: 'ok' } // border-2 / ring-2 など数値ユーティリティ
  // --spacing はスケール参照なので「数値のときだけ」有効（leading-6 は可 / leading-body は不可）
  const named = ns.look.filter((l) => l !== '--spacing')
  if (named.some((l) => vars.has(l + suffix))) return { verdict: 'ok' }

  return { verdict: 'unknown', suggest: nearest(suffix, ns.look, vars) }
}

/** 似ているトークン名を最大 3 件返す（打ち間違い・名前違いの提示用） */
function nearest(suffix, look, vars) {
  const cands = []
  for (const name of vars.keys()) {
    const l = look.find((x) => name.startsWith(x) && x !== '--spacing')
    if (!l) continue
    cands.push({ n: name.slice(l.length), d: distance(suffix, name.slice(l.length)) })
  }
  return cands.sort((a, b) => a.d - b.d).slice(0, 3).filter((c) => c.d <= Math.max(3, suffix.length / 2)).map((c) => c.n)
}
function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[a.length][b.length]
}

/**
 * `(` の直後 open から、対応する `)` の位置を返す（見つからなければ -1）。
 * 文字列・テンプレートリテラル・コメントの中の括弧は数えない。
 */
function closingParen(text, open) {
  let depth = 1
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === '"' || c === "'" || c === '`') { // 文字列は丸ごと飛ばす
      const q = c
      i++
      while (i < text.length && text[i] !== q) i += text[i] === '\\' ? 2 : 1
      continue
    }
    if (c === '/' && text[i + 1] === '/') { // 行コメント
      const nl = text.indexOf('\n', i)
      if (nl < 0) return -1
      i = nl
      continue
    }
    if (c === '/' && text[i + 1] === '*') { // ブロックコメント
      const close = text.indexOf('*/', i)
      if (close < 0) return -1
      i = close + 1
      continue
    }
    if (c === '(') depth++
    else if (c === ')' && --depth === 0) return i
  }
  return -1
}

/** .tsx から className / cva / cn の文字列リテラルを集める */
export function extractClasses(text) {
  const out = []
  // idx は「そのトークン自身の位置」を指す（cn( の開始位置ではない）。ここをずらすと
  // 指摘した行に該当クラスが無く、同じクラスが別の行として二重に報告される
  const push = (s, base) => {
    for (const m of s.matchAll(/\S+/g)) out.push({ cls: m[0], idx: base + m.index })
  }
  const literals = (s, base) => {
    for (const m of s.matchAll(/["'`]([^"'`]*)["'`]/g)) push(m[1], base + m.index + 1)
  }
  // className="…" / class="…"
  for (const m of text.matchAll(/\bclass(?:Name)?\s*=\s*"([^"]*)"/g))
    push(m[1], m.index + m[0].length - 1 - m[1].length)
  // className={...} の中の文字列リテラル
  for (const m of text.matchAll(/\bclass(?:Name)?\s*=\s*\{([\s\S]*?)\}/g))
    literals(m[1], m.index + m[0].length - 1 - m[1].length)
  // cva(...) / cn(...) の中の文字列リテラル。
  // 終端は括弧の対応で決める。「行頭の `)`」を終端にすると、1 行で閉じている cn() が
  // 後続の JSX まで飲み込み、style や data-* の値をクラスと誤認して ERROR を出す
  for (const m of text.matchAll(/\b(?:cva|cn|clsx|twMerge)\s*\(/g)) {
    const open = m.index + m[0].length
    const close = closingParen(text, open)
    if (close < 0) continue // 対応が取れない = 構文として壊れている。tsc に任せる
    literals(text.slice(open, close), open)
  }
  return out
}
