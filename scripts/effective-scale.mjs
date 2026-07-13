#!/usr/bin/env node
/**
 * 実効 Tailwind スケールの取得と適合判定
 *
 * 使い方:
 *   node scripts/effective-scale.mjs <対象リポジトリのパス> [検査したい値...]
 *
 * 例:
 *   node scripts/effective-scale.mjs output/.push/my-repo
 *   node scripts/effective-scale.mjs output/.push/my-repo spacing:13px radius:5px text:15px weight:620 bp:1200px
 *
 * バージョン固有の数値をこのリポジトリに持たないための道具。
 * テーマの読み取りは theme.mjs に共通化してある（selfcheck.mjs と共用）。
 * ビルドもテストもせず、CSS を読むだけ（CLAUDE.md 原則 2 の対象外）。
 */
import path from 'node:path'
import { readTheme, toPx, ROOT_FONT_PX } from './theme.mjs'

// 接頭辞 → 「どのユーティリティ群か」の対応
const GROUPS = [
  { key: 'spacing', prefix: '--spacing', kind: 'multiple', util: 'p / m / gap / w / h' },
  { key: 'radius', prefix: '--radius-', kind: 'enum', util: 'rounded-*' },
  { key: 'text', prefix: '--text-', kind: 'enum', util: 'text-*',
    skip: (n) => n.includes('--line-height') || n.startsWith('--text-shadow-') },
  { key: 'text-shadow', prefix: '--text-shadow-', kind: 'opaque', util: 'text-shadow-*' },
  { key: 'weight', prefix: '--font-weight-', kind: 'enum', util: 'font-*', unit: '' },
  { key: 'leading', prefix: '--leading-', kind: 'enum', util: 'leading-*', unit: '' },
  { key: 'tracking', prefix: '--tracking-', kind: 'enum', util: 'tracking-*', unit: 'em', raw: true },
  { key: 'bp', prefix: '--breakpoint-', kind: 'enum', util: '*:' },
  { key: 'container', prefix: '--container-', kind: 'enum', util: 'max-w-*' },
  { key: 'shadow', prefix: '--shadow-', kind: 'opaque', util: 'shadow-*' },
  { key: 'blur', prefix: '--blur-', kind: 'enum', util: 'blur-*' },
  { key: 'color', prefix: '--color-', kind: 'opaque', util: 'bg-* / text-* / border-*' },
]

let PROJECT_KEYS = new Set()
function buildScale(vars) {
  const scale = {}
  for (const g of GROUPS) {
    const stops = []
    for (const [name, raw] of vars) {
      if (!name.startsWith(g.prefix)) continue
      if (g.skip?.(name)) continue
      const label = g.prefix === '--spacing' ? '' : name.slice(g.prefix.length)
      stops.push({ name, label, raw, px: toPx(raw), own: PROJECT_KEYS.has(name) })
    }
    if (stops.length) {
      stops.sort((a, b) => (a.px ?? Infinity) - (b.px ?? Infinity))
      scale[g.key] = { ...g, stops }
    }
  }
  return scale
}

// ---------------------------------------------------------------- 適合判定
function judge(scale, spec) {
  const [key, rawVal] = spec.includes(':') ? spec.split(':') : [null, spec]
  if (!key || !scale[key]) {
    const known = Object.keys(scale).join(' / ')
    return { spec, verdict: 'ERROR', note: `接頭辞が不明。使えるのは: ${known}（例 spacing:13px）` }
  }
  const g = scale[key]
  const px = toPx(rawVal)
  if (px === null) return { spec, verdict: 'ERROR', note: `値を px/rem/数値として解釈できない: ${rawVal}` }

  if (g.kind === 'multiple') {
    const unitPx = g.stops[0].px
    if (unitPx == null || unitPx <= 0) return { spec, verdict: 'UNKNOWN', note: `--spacing を解釈できない（${g.stops[0].raw}）` }
    const n = px / unitPx
    // Tailwind は calc(var(--spacing) * <数値>) を作るので **0.5 刻みまで表現できる**（p-1.5 = 6px / p-0.5 = 2px）。
    // 「整数倍か」で判定すると gap-1.5 や h-13.5 のような有効な値を OFF-SCALE として突き返し、
    // **存在しない不備をデザイナーに直させる**ことになる（原則 3 を守る道具が原則 3 を破る）。
    // 判定規則は classes.mjs の class-exists と必ず同一にする — 食い違うと
    // 生成前の診断が「直せ」、生成後の検査が「OK」と言う状態になり、どちらを信じるか決められない。
    const head = g.util.split(' / ')[0]
    if (Math.abs(n * 2 - Math.round(n * 2)) < 1e-9) {
      const step = Math.round(n * 2) / 2
      return { spec, verdict: 'OK', note: `${head}-${step} 等で表せる（${unitPx}px × ${step}）` }
    }
    const lo = Math.floor(n * 2) / 2, hi = Math.ceil(n * 2) / 2
    return {
      spec, verdict: 'OFF-SCALE',
      note: `${unitPx}px の 0.5 刻みに乗らない。寄せ先候補: ${lo * unitPx}px（${head}-${lo}）/ ${hi * unitPx}px（${head}-${hi}）`,
    }
  }

  if (g.kind === 'opaque') {
    return { spec, verdict: 'MANUAL', note: `${g.util} は数値比較できない（${g.stops.length} 個のトークンを目視で照合）` }
  }

  // enum
  const exact = g.stops.find((s) => s.px === px)
  if (exact) return { spec, verdict: 'OK', note: `${g.util.replace('*', exact.label)}（${exact.raw}）` }
  const below = [...g.stops].filter((s) => s.px != null && s.px < px).pop()
  const above = g.stops.find((s) => s.px != null && s.px > px)
  const u = g.unit ?? 'px'
  const cand = [below, above].filter(Boolean)
    .map((s) => `${g.raw ? s.raw : s.px + u}（${g.util.replace('*', s.label)}）`).join(' / ')
  return { spec, verdict: 'OFF-SCALE', note: `離散スケールに無い。寄せ先候補: ${cand || '（候補なし）'}` }
}

// ---------------------------------------------------------------- 実行
const [repo, ...specs] = process.argv.slice(2)
if (!repo) {
  console.error('使い方: node scripts/effective-scale.mjs <対象リポジトリのパス> [spacing:13px radius:5px …]')
  process.exit(2)
}

const { vars, project, twVersion, twSources, projSources } = readTheme(repo)
PROJECT_KEYS = new Set(project.keys())
const scale = buildScale(vars)

console.log('# 実効 Tailwind スケール')
console.log('')
console.log(`- 対象: ${path.resolve(repo)}`)
console.log(`- Tailwind: ${twVersion ? `v${twVersion}` : '**未インストール**（node_modules/tailwindcss が無い）'}`)
console.log(`- 既定テーマ: ${twSources.length ? twSources.join(', ') : '取得できず'}`)
console.log(`- プロジェクト @theme: ${projSources.length ? projSources.join(', ') : 'なし'}`)
console.log(`- rem → px の前提: 1rem = ${ROOT_FONT_PX}px`)
console.log('')

if (!twSources.length && !projSources.length) {
  console.log('> ⚠️ **スケールを取得できませんでした。** 対象リポジトリで `npm ci` を実行してから再試行してください。')
  console.log('> 取得できないまま数値の適合を断定しないこと（`common.md` §9.3 の劣化時の扱いに従う）。')
  process.exit(1)
}
if (!twSources.length) {
  console.log('> ⚠️ Tailwind の既定テーマが未取得です。下記は**プロジェクトの @theme のみ**で、既定値の分は欠けています。')
  console.log('')
}

for (const key of Object.keys(scale)) {
  const g = scale[key]
  const head = g.kind === 'multiple'
    ? `${key}（${g.util}）: **${g.stops[0].px}px の倍数**（--spacing = ${g.stops[0].raw}）`
    : g.kind === 'opaque'
      ? `${key}（${g.util}）: ${g.stops.length} トークン（数値比較不可）`
      : `${key}（${g.util}）: 離散 ${g.stops.length} 段`
  console.log(`## ${head}`)
  if (g.kind === 'enum') {
    console.log('  ' + g.stops.map((s) => `${s.label}=${s.px ?? s.raw}${s.own ? '*' : ''}`).join('  ') + (g.stops.some((s) => s.own) ? '   （* = プロジェクト定義）' : ''))
  } else if (g.kind === 'opaque') {
    const own = g.stops.filter((s) => s.own)
    const std = g.stops.length - own.length
    if (own.length) console.log('  プロジェクト定義: ' + own.map((s) => s.label).join('  '))
    if (std) console.log(`  Tailwind 既定: ${std} 個（**生成コードでは使わない** — セマンティックなトークンを使う）`)
  }
  console.log('')
}

if (specs.length) {
  console.log('# 適合判定')
  console.log('')
  console.log('| 値 | 判定 | 内容 |')
  console.log('| --- | --- | --- |')
  let off = 0
  let unjudged = 0
  for (const spec of specs) {
    const r = judge(scale, spec)
    if (r.verdict === 'OFF-SCALE') off++
    // MANUAL / ERROR / UNKNOWN は「適合」ではなく「判定していない」。
    // ここを OFF-SCALE だけで数えると、全件 ERROR でも「全件適合」と出て
    // **判定していないものを適合と誤読させる**（common.md §9.3 の「断定しない」に反する）
    else if (r.verdict !== 'OK') unjudged++
    console.log(`| \`${r.spec}\` | ${r.verdict} | ${r.note} |`)
  }
  console.log('')
  if (off) console.log(`**${off} 件がスケール非適合。** 寄せ先を操作者に選ばせる（Claude が丸めない）。`)
  if (unjudged) console.log(`**${unjudged} 件は判定していない**（MANUAL / ERROR / UNKNOWN）。**「適合」と報告しない** — 目視で照合するか、未実施として返す。`)
  if (!off && !unjudged) console.log('**全件適合。**')
}
