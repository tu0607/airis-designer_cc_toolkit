/**
 * shadcn/ui 由来の部品が置かれるフォルダの解決 — **import 専用モジュール**（CLI ではない）。
 *
 * selfcheck.mjs は「shadcn 派生の層は上流のコードなので arbitrary-value / classname-ternary /
 * boolean-prefix を責めない」と判定する（web-app-selfcheck.md §3）。その層の場所を `components/ui/`
 * と決め打ちすると、shadcn CLI の書き出し先を変えた案件で検査が全部品に当たる（または当たらない）。
 * **正は対象リポジトリの components.json の aliases.ui**（shadcn CLI がそこへ書き出す）。
 * 無ければ従来どおり `components/ui/` を既定にする。.airis/config.json に上書き設定は作らない。
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_RE = /(^|\/)components\/ui\//

/**
 * @param {string} repo 対象リポジトリのパス
 * @returns {{ source: 'components.json'|'default', dir: string|null, alias: string|null, isUi: (f: string) => boolean }}
 *   dir はリポジトリ相対のパス（末尾スラッシュなし）。tsconfig の paths で解決できなかった場合は
 *   alias の先頭セグメント（`@/` `~/` 等）を落とした残りで「どこかに現れるか」を見る。
 */
export function resolveShadcnUiDir(repo) {
  const cfgPath = path.join(repo, 'components.json')
  let alias = null
  try {
    alias = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))?.aliases?.ui ?? null
  } catch { /* 無い・壊れている → 既定 */ }
  if (typeof alias !== 'string' || !alias.trim())
    return { source: 'default', dir: 'components/ui', alias: null, isUi: (f) => DEFAULT_RE.test(f) }

  const resolved = resolveAlias(repo, alias.trim())
  if (resolved !== null) {
    const dir = path.posix.normalize(resolved).replace(/^(\.\/)+|\/+$/g, '')
    // 解決先が実在するときだけ「先頭一致」にする。実在しない（paths の書き方が想定外）なら下の後方一致に劣化させ、
    // shadcn 由来の層を 1 つも免除しない状態（全部品に arbitrary-value が出る）を避ける
    if (dir && fs.existsSync(path.join(repo, dir)))
      return { source: 'components.json', dir, alias, isUi: (f) => f.startsWith(dir + '/') }
  }
  // tsconfig で解決できない alias（"@/components/ui" の "@/" を落とし、どこかに現れるかで見る）
  const rest = alias.replace(/^[@~$]\/?/, '').replace(/^\.?\/+|\/+$/g, '')
  const re = new RegExp(`(^|/)${rest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`)
  return { source: 'components.json', dir: rest, alias, isUi: (f) => re.test(f) }
}

/**
 * tsconfig の compilerOptions.paths で alias をリポジトリ相対パスに解決する（できなければ null）。
 * Vite の雛形は paths を tsconfig.app.json に置く（tsconfig.json は references だけ）ので、tsconfig.*.json も見る。
 * paths の解決先は baseUrl 起点（未指定なら tsconfig の場所 = リポジトリ直下）。
 */
function resolveAlias(repo, alias) {
  let names
  try { names = fs.readdirSync(repo).filter((n) => /^(tsconfig|jsconfig)(\.[\w-]+)?\.json$/.test(n)).sort() } catch { return null }
  // tsconfig.json → tsconfig.app.json … の順（素の名前を優先）
  names.sort((a, b) => (a.split('.').length - b.split('.').length) || a.localeCompare(b))
  for (const name of names) {
    let json
    try {
      const raw = fs.readFileSync(path.join(repo, name), 'utf8')
      // tsconfig はコメント・末尾カンマを含みうるので、雑に落としてから読む
      json = JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'))
    } catch { continue }
    const paths = json?.compilerOptions?.paths
    if (!paths) continue
    const base = json.compilerOptions.baseUrl ?? '.'
    for (const [pattern, targets] of Object.entries(paths)) {
      const target = Array.isArray(targets) ? targets[0] : targets
      if (typeof target !== 'string') continue
      if (pattern.endsWith('/*')) {
        const head = pattern.slice(0, -1) // "@/*" → "@/"
        if (alias.startsWith(head)) return path.posix.join(base, target.replace(/\*$/, ''), alias.slice(head.length))
      } else if (alias === pattern) {
        return path.posix.join(base, target)
      }
    }
  }
  return null
}
