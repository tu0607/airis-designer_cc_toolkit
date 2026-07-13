#!/usr/bin/env node
/**
 * トークンの組み合わせのコントラスト比を実測する（生成前診断 = rules/common.md §9.2 用）
 *
 * 使い方:
 *   node scripts/contrast.mjs <対象リポジトリのパス> <前景:背景> [<前景:背景> …] [--large]
 *
 * 例:
 *   node scripts/contrast.mjs output/.push/my-repo text-content-muted:bg-surface
 *   node scripts/contrast.mjs output/.push/my-repo '#6b7280:#ffffff' --large
 *
 * 前景 / 背景はどの書き方でも渡せる:
 *   クラス名（text-* / bg-* / border-*）/ トークン名（--color-* / color-*）/ 生の色（#rrggbb / rgb() / oklch()）
 *
 * 「コントラストは目視で確認」を機械判定に置き換えるための道具。
 * a11y の CI（rules/web-app-testing.md §2）が赤くなる前に、デザイナーへ返せる形で拾うのが目的。
 * ビルドもテストもせず CSS を読むだけ（CLAUDE.md 原則 2 の対象外）。
 */
import path from 'node:path'
import { readTheme } from './theme.mjs'

const AA_NORMAL = 4.5 // WCAG AA: 通常の文字
const AA_LARGE = 3.0 //  WCAG AA: 大きい文字（24px 以上、または 18.66px 以上の太字）

// ---------------------------------------------------------------- 色の解釈
const NAMED = { white: '#ffffff', black: '#000000', transparent: '#00000000' }

/** CSS の色文字列 → {r,g,b,a}（各 0..1 の sRGB）。解釈できなければ null */
function parseColor(raw, vars = new Map(), depth = 0) {
  if (typeof raw !== 'string' || depth > 8) return null
  let s = raw.trim().toLowerCase()
  if (NAMED[s]) s = NAMED[s]

  // var(--x, fallback) は @theme を引いて解決する
  const v = s.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/)
  if (v) return parseColor(vars.get(v[1]) ?? v[2] ?? '', vars, depth + 1)

  let m = s.match(/^#([0-9a-f]{3,8})$/)
  if (m) {
    const h = m[1]
    const ex = (i) => parseInt(h.length <= 4 ? h[i].repeat(2) : h.slice(i * 2, i * 2 + 2), 16) / 255
    if (h.length === 3 || h.length === 6) return { r: ex(0), g: ex(1), b: ex(2), a: 1 }
    if (h.length === 4 || h.length === 8) return { r: ex(0), g: ex(1), b: ex(2), a: ex(3) }
    return null
  }

  const nums = (body) => body.split(/[\s,/]+/).filter(Boolean)
  const num = (x, scale = 1) => (x.endsWith('%') ? parseFloat(x) / 100 * scale : parseFloat(x))

  m = s.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const p = nums(m[1])
    if (p.length < 3) return null
    const c = p.slice(0, 3).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x) / 255))
    if (c.some(Number.isNaN)) return null
    return { r: c[0], g: c[1], b: c[2], a: p[3] === undefined ? 1 : num(p[3]) }
  }

  m = s.match(/^hsla?\(([^)]+)\)$/)
  if (m) {
    const p = nums(m[1])
    if (p.length < 3) return null
    const [h, sat, l] = [parseFloat(p[0]), num(p[1]), num(p[2])]
    if ([h, sat, l].some(Number.isNaN)) return null
    const c = (1 - Math.abs(2 * l - 1)) * sat
    const hp = ((h % 360) + 360) % 360 / 60
    const x = c * (1 - Math.abs((hp % 2) - 1))
    const seg = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hp) % 6]
    const mm = l - c / 2
    return { r: seg[0] + mm, g: seg[1] + mm, b: seg[2] + mm, a: p[3] === undefined ? 1 : num(p[3]) }
  }

  // Tailwind v4 の既定パレットは oklch で書かれている
  m = s.match(/^oklch\(([^)]+)\)$/)
  if (m) {
    const p = nums(m[1])
    if (p.length < 3) return null
    const L = num(p[0]) // 0..1（% 表記もある）
    const C = num(p[1], 0.4) // % 表記は 0.4 が 100%
    const H = parseFloat(p[2])
    if ([L, C, H].some(Number.isNaN)) return null
    const rgb = oklabToSrgb({ L, a: C * Math.cos(H * Math.PI / 180), b: C * Math.sin(H * Math.PI / 180) })
    return { ...rgb, a: p[3] === undefined ? 1 : num(p[3]) }
  }

  return null // color-mix() / lab() 等は判定しない（分かったふりをしない）
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const unlin = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
const clamp01 = (x) => Math.min(1, Math.max(0, x))

/** Oklab → sRGB（0..1。範囲外はクリップ） */
function oklabToSrgb({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b
  const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3]
  return {
    r: clamp01(unlin(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    g: clamp01(unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    b: clamp01(unlin(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
  }
}

/** sRGB → Oklab */
function srgbToOklab({ r, g, b }) {
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  }
}

const hex = ({ r, g, b }) => '#' + [r, g, b].map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, '0')).join('')

/** 前景を背景に重ねる（半透明の前景は合成しないと比が出ない） */
const over = (fg, bg) => (fg.a >= 1 ? fg : {
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
})

const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)

/** WCAG 2.x のコントラスト比 */
function contrast(fg, bg) {
  const f = luminance(over(fg, bg))
  const b = luminance(bg)
  return (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05)
}

// ---------------------------------------------------------------- 指定の解決
const CLASS_NS = /^(?:text|bg|border|ring|outline|divide|fill|stroke|accent|caret|from|via|to)-/

/** `text-foo` / `--color-foo` / `#fff` などを {label, source, color} に解決する */
function resolveSide(spec, vars) {
  const s = spec.trim()
  const tryVar = (name) => (vars.has(name) ? { label: s, source: `${name} = ${vars.get(name)}`, color: parseColor(vars.get(name), vars) } : null)

  if (s.startsWith('--')) return tryVar(s) ?? { label: s, source: '@theme に無い', color: null }
  if (CLASS_NS.test(s)) {
    const name = '--color-' + s.replace(CLASS_NS, '').replace(/\/\d+$/, '') // bg-primary/50 の不透明度修飾は落とす
    return tryVar(name) ?? { label: s, source: `${name} が @theme に無い`, color: null }
  }
  const direct = parseColor(s, vars)
  if (direct) return { label: s, source: '直値', color: direct }
  return tryVar('--color-' + s) ?? { label: s, source: '解決できない', color: null }
}

// ---------------------------------------------------------------- 寄せ先候補
/**
 * 基準を満たす候補を出す（Claude が勝手に丸めないため、必ず候補まで添える）
 *  ① プロジェクトが定義済みのトークンのうち、基準を満たし かつ 元の色に近いもの
 *  ② それが無い / 足りない場合は、色相・彩度を保って明度だけ動かした提案値
 */
function suggest(fg, bg, threshold, vars, projectKeys) {
  const out = []
  const base = srgbToOklab(fg)
  const cands = []
  for (const [name, raw] of vars) {
    if (!name.startsWith('--color-') || !projectKeys.has(name)) continue
    const c = parseColor(raw, vars)
    if (!c || contrast(c, bg) < threshold) continue
    const o = srgbToOklab(c)
    cands.push({ name, d: Math.hypot(o.L - base.L, o.a - base.a, o.b - base.b), ratio: contrast(c, bg) })
  }
  cands.sort((a, b) => a.d - b.d)
  for (const c of cands.slice(0, 2)) out.push(`\`${c.name.replace('--color-', '')}\`（${c.ratio.toFixed(2)}:1）`)

  // ② 明度だけを動かした最小の変更案（Figma の Variable をどう直すかの目安）
  const chroma = Math.hypot(base.a, base.b)
  const hue = Math.atan2(base.b, base.a)
  const at = (L) => oklabToSrgb({ L, a: chroma * Math.cos(hue), b: chroma * Math.sin(hue) })
  let best = null
  for (const dir of [-1, 1]) {
    let lo = base.L, hi = dir < 0 ? 0 : 1
    if (contrast({ ...at(hi), a: 1 }, bg) < threshold) continue
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (contrast({ ...at(mid), a: 1 }, bg) >= threshold) hi = mid
      else lo = mid
    }
    if (!best || Math.abs(hi - base.L) < Math.abs(best - base.L)) best = hi
  }
  if (best !== null) out.push(`色を直すなら ${hex(at(best))}（明度のみ変更 / ${contrast({ ...at(best), a: 1 }, bg).toFixed(2)}:1）`)
  return out.length ? out.join(' / ' ) : '**既存トークンでは満たせない。背景側の見直しも含めてデザイナーと相談**'
}

// ---------------------------------------------------------------- 実行
const argv = process.argv.slice(2)
const large = argv.includes('--large')
const [repo, ...pairs] = argv.filter((a) => !a.startsWith('--'))
if (!repo || !pairs.length) {
  console.error('使い方: node scripts/contrast.mjs <対象リポジトリのパス> <前景:背景> [<前景:背景> …] [--large]')
  process.exit(2)
}

const { vars, project, projSources } = readTheme(repo)
const projectKeys = new Set(project.keys())
const threshold = large ? AA_LARGE : AA_NORMAL

console.log('# コントラスト比の実測')
console.log('')
console.log(`- 対象: ${path.resolve(repo)}`)
console.log(`- プロジェクト @theme: ${projSources.length ? projSources.join(', ') : '**なし**（トークン名では引けない）'}`)
console.log(`- 基準: WCAG AA ${AA_NORMAL}:1（通常の文字）/ ${AA_LARGE}:1（大きい文字 = 24px 以上 または 18.66px 以上の太字）`)
console.log(`- 寄せ先候補の基準: **${threshold}:1**${large ? '（--large 指定）' : ''}`)
console.log('')
console.log('| 前景 | 背景 | 比 | 通常 | 大文字 | 寄せ先候補 / 備考 |')
console.log('| --- | --- | --- | --- | --- | --- |')

let ng = 0
let unresolved = 0
for (const p of pairs) {
  const i = p.lastIndexOf(':')
  if (i <= 0) {
    unresolved++
    console.log(`| \`${p}\` | — | — | — | — | 書式は \`前景:背景\`（例 \`text-muted:bg-surface\`） |`)
    continue
  }
  const fg = resolveSide(p.slice(0, i), vars)
  const bg = resolveSide(p.slice(i + 1), vars)
  if (!fg.color || !bg.color) {
    unresolved++
    const why = [!fg.color && `前景: ${fg.source}`, !bg.color && `背景: ${bg.source}`].filter(Boolean).join(' / ')
    console.log(`| \`${fg.label}\` | \`${bg.label}\` | — | — | — | 色を解釈できない（${why}） |`)
    continue
  }
  const r = contrast(fg.color, bg.color)
  const okN = r >= AA_NORMAL
  const okL = r >= AA_LARGE
  if (r < threshold) ng++
  const note = []
  if (r < threshold) note.push(suggest(fg.color, bg.color, threshold, vars, projectKeys))
  if (bg.color.a < 1) note.push('**背景が半透明**なので、実際の比は下に重なる色で変わる')
  if (fg.color.a < 1) note.push(`前景の不透明度 ${Math.round(fg.color.a * 100)}% を背景に合成して計算`)
  console.log(`| \`${fg.label}\` | \`${bg.label}\` | **${r.toFixed(2)}:1** | ${okN ? '✓' : '✗'} | ${okL ? '✓' : '✗'} | ${note.join('。') || '—'} |`)
}

console.log('')
if (ng) {
  console.log(`**${ng} 件が ${threshold}:1 未達。** デザインソース側（Figma の Variable）で直すのが原則。`)
  console.log('**ただし Disabled 状態は対象外**（WCAG 1.4.3 の例外）。未達でも報告しない — 直す必要のない宿題を渡すことになる。**プレースホルダは対象内**。')
  console.log('候補をそのまま採用せず、**どれにするかはデザイナーに選ばせる**（`common.md` §9.2 の書式で返す）。')
} else if (!unresolved) {
  console.log(`**全件 ${threshold}:1 以上。**`)
}
if (unresolved) console.log(`**${unresolved} 件は判定できていない**（未実施として報告する。トークン名の綴りと \`npm ci\` の有無を確認する）。`)
