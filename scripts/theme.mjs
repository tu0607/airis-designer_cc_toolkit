/**
 * 実効 Tailwind テーマの読み取り — **import 専用モジュール**（CLI ではない。shebang が無いのがその印）
 *
 * effective-scale.mjs と selfcheck.mjs の共通基盤。
 *
 * ① 対象リポジトリの node_modules/tailwindcss 内の @theme（= 使っている版の既定テーマ）
 * ② プロジェクトの @theme（styles/tokens.css 等）
 * を順に読み、後勝ちで実効テーマを組む。ファイル名は決め打ちしない（版が上がっても追従不要）。
 */
import fs from 'node:fs'
import path from 'node:path'

export const ROOT_FONT_PX = 16 // rem → px 換算の前提

/** ディレクトリを浅く再帰して .css を集める */
export function collectCss(dir, { maxDepth = 3, skipNodeModules = true, depth = 0, out = [] } = {}) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name.startsWith('.')) continue
      if (skipNodeModules && e.name === 'node_modules') continue
      if (depth < maxDepth) collectCss(p, { maxDepth, skipNodeModules, depth: depth + 1, out })
    } else if (e.isFile() && e.name.endsWith('.css')) out.push(p)
  }
  return out
}

/** @theme / @theme inline / @theme static ブロックから --name: value を抜く */
export function parseThemeBlocks(css) {
  const vars = new Map()
  const re = /@theme\b[^{]*\{/g
  let m
  while ((m = re.exec(css))) {
    let i = m.index + m[0].length
    let depth = 1
    const start = i
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    for (const d of css.slice(start, i - 1).matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars.set(d[1], d[2].trim())
    }
    re.lastIndex = i
  }
  return vars
}

export function toPx(v) {
  if (typeof v !== 'string') return null
  const s = v.trim()
  let m = s.match(/^(-?[\d.]+)rem$/)
  if (m) return +(parseFloat(m[1]) * ROOT_FONT_PX).toFixed(4)
  m = s.match(/^(-?[\d.]+)px$/)
  if (m) return parseFloat(m[1])
  m = s.match(/^(-?[\d.]+)em$/) // 字送りは em 同士で比較する
  if (m) return parseFloat(m[1])
  m = s.match(/^(-?[\d.]+)$/) // 単位なし（font-weight / leading 等）
  if (m) return parseFloat(m[1])
  return null // calc() / clamp() / 色 / 複数値
}

/**
 * 対象リポジトリの実効テーマを返す。
 * @returns {{vars: Map, defaults: Map, project: Map, twVersion: string|null,
 *            twSources: string[], projSources: string[]}}
 */
export function readTheme(repo) {
  const twDir = path.join(repo, 'node_modules', 'tailwindcss')
  const defaults = new Map()
  const twSources = []
  let twVersion = null

  if (fs.existsSync(twDir)) {
    try {
      twVersion = JSON.parse(fs.readFileSync(path.join(twDir, 'package.json'), 'utf8')).version
    } catch { /* noop */ }
    for (const f of collectCss(twDir, { maxDepth: 2, skipNodeModules: false })) {
      const v = parseThemeBlocks(fs.readFileSync(f, 'utf8'))
      if (v.size) { twSources.push(path.relative(repo, f)); for (const [k, x] of v) defaults.set(k, x) }
    }
  }

  const project = new Map()
  const projSources = []
  for (const f of collectCss(repo, { maxDepth: 4 })) {
    const v = parseThemeBlocks(fs.readFileSync(f, 'utf8'))
    if (v.size) { projSources.push(path.relative(repo, f)); for (const [k, x] of v) project.set(k, x) }
  }

  return { vars: new Map([...defaults, ...project]), defaults, project, twVersion, twSources, projSources }
}
