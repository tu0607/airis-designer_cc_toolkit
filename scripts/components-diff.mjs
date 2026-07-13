#!/usr/bin/env node
/**
 * デザインソースの「部品の定義が変わった」検出（`components.json` を前後で比べる CLI）
 *
 * 使い方:
 *   node scripts/components-diff.mjs <取り込み前の components.json> <取り込み後の components.json>
 *
 *   比較元はバージョン管理から取る:
 *     git show HEAD:tokens/.meta/components.json > /tmp/before.json
 *     node scripts/components-diff.mjs /tmp/before.json tokens/.meta/components.json
 *
 * **なぜ必要か**: トークンだけを更新する運用（色・余白・書体・アイコンは更新するが
 * 部品のコードは作り直さない）では、Figma で部品にバリアントを足しても
 * **その事実だけがリポジトリに入り、コードに反映されないまま誰も気付かない**。
 * エラーにならず CI も緑のままなので、比較して報告する層が要る。
 *
 * 報告するのは 3 つだけ:
 *   ① 部品の増減
 *   ② プロパティ名・バリアント軸の値の変化
 *   ③ レイアウトの変化 — バリアント直下の 9 項目
 *      （mode / gap / pad / r / sw / w / h / wSize / hSize）
 *
 * **既知の穴**: 子レイヤーは見ない（数が多く読めなくなるため）。
 * 中身だけが変わった場合はここでは検出できず、見た目の回帰は VRT が担う。
 *
 * **コードは一切読まない。** Figma の書き出し同士だけを比べる。
 * 「Figma とコードを照合する」方式は誤検知が支配的になる（1 部品を複数ファイルに分ける /
 * CVA でなく props でバリアントを表す / 別部品へ委譲する / サイズ名の表記差）。
 * 書き出し同士の比較ならこれらは原理的に起きない。
 *
 * **判定はしない。** 「対応が要るか」は人が決める（lint-naming.mjs と同じ扱い）。
 *
 * 終了コード:
 *   0 … 比較できた（差分があっても落とさない）/ 比較元が無い（初回の取り込み）
 *   2 … **読み込めなかった**（JSON が壊れている）= 比較できていない
 */
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const [beforePath, afterPath] = argv.filter((a) => !a.startsWith('--'))
if (!beforePath || !afterPath) {
  console.error('使い方: node scripts/components-diff.mjs <取り込み前の components.json> <取り込み後の components.json>')
  process.exit(2)
}

const load = (p, label) => {
  let text
  try { text = fs.readFileSync(p, 'utf8') } catch { return null }
  try { return JSON.parse(text) } catch (e) {
    console.error(`${label} を JSON として読めません: ${p}\n${e.message}`)
    process.exit(2)
  }
}

const after = load(afterPath, '取り込み後')
if (after === null) {
  console.error(`取り込み後の components.json が読めません: ${afterPath}`)
  process.exit(2)
}
const before = load(beforePath, '取り込み前')

console.log('# 部品の定義の変化\n')
if (before === null) {
  // 初回の取り込みには比較元が無い。落とさずスキップする
  console.log(`- 比較元が無いためスキップ（初回の取り込み）: \`${beforePath}\``)
  process.exit(0)
}
console.log(`- 比較元: \`${beforePath}\``)
console.log(`- 比較先: \`${afterPath}\`\n`)

// ---------------------------------------------------------------- 比較
// 報告するのは 3 種類だけ。**コードの状態は見ない**
const added = []      // ① 部品が増えた
const removed = []    // ① 部品が減った
const propDiffs = []  // ② プロパティ名・バリアント軸の値が変わった
const layoutDiffs = [] // ③ レイアウトが変わった

const names = (o) => Object.keys(o ?? {})
for (const n of names(after)) if (!(n in before)) added.push(n)
for (const n of names(before)) if (!(n in after)) removed.push(n)

/** properties を「名前 → 型と取りうる値」の比較しやすい形にする */
const propShape = (comp) => {
  const out = {}
  for (const [k, v] of Object.entries(comp?.properties ?? {})) {
    out[k] = { type: v?.type, values: Array.isArray(v?.values) ? [...v.values].sort() : undefined }
  }
  return out
}

// ③ で比べるレイアウトの項目（子は見ない — 変化が多すぎて読めなくなる）
const LAYOUT_KEYS = ['mode', 'gap', 'pad', 'r', 'sw', 'w', 'h', 'wSize', 'hSize']
const show = (v) => (v === undefined ? 'なし' : JSON.stringify(v))

for (const n of names(after)) {
  if (!(n in before)) continue
  const b = before[n], a = after[n]

  // ② プロパティ / バリアント軸
  const bp = propShape(b), ap = propShape(a)
  for (const k of new Set([...Object.keys(bp), ...Object.keys(ap)])) {
    if (!(k in bp)) { propDiffs.push([n, k, 'プロパティが増えた', show(ap[k].type), '']); continue }
    if (!(k in ap)) { propDiffs.push([n, k, 'プロパティが減った', '', show(bp[k].type)]); continue }
    if (bp[k].type !== ap[k].type)
      propDiffs.push([n, k, '型が変わった', show(ap[k].type), show(bp[k].type)])
    const bv = JSON.stringify(bp[k].values), av = JSON.stringify(ap[k].values)
    if (bv !== av) propDiffs.push([n, k, '取りうる値が変わった', av ?? 'なし', bv ?? 'なし'])
  }

  // ③ レイアウト。**両側に存在するバリアントだけ**を比べる。
  // バリアント軸が増えると全バリアントの名前が変わる（state=Default → state=Default, size=M）。
  // 名前で突き合わせると、この全件が「片側にしか無い」ことになり、
  // ② で報告済みの軸変更をレイアウト欄でも重複して報告してしまう。
  // **ノード id は軸を足しても既存バリアントで変わらない**ので id で突き合わせる。
  // 実測: 3→9 バリアントへ軸を足したケースで、名前照合も id 照合もノイズは 0 件。
  // 差が出るのは「軸追加と同時に既存バリアントのレイアウトも変わった」場合で、
  // **名前照合はそれを取り逃がす**（id 照合は 2 件検出）。だから id を使う
  const byId = (comp) => new Map((comp?.variants ?? []).map((v) => [v.id, v]))
  const bvs = byId(b), avs = byId(a)
  for (const [id, av] of avs) {
    const bvv = bvs.get(id)
    if (!bvv) continue // 片側にしか無い = ② の軸変更か新規バリアント。ここでは報告しない
    for (const k of LAYOUT_KEYS) {
      const x = JSON.stringify(bvv.layout?.[k]), y = JSON.stringify(av.layout?.[k])
      if (x !== y) layoutDiffs.push([n, av.name ?? id, k, show(av.layout?.[k]), show(bvv.layout?.[k])])
    }
  }
}

// ---------------------------------------------------------------- 出力
const total = added.length + removed.length + propDiffs.length + layoutDiffs.length
const table = (head, rows) => {
  console.log(`| ${head.join(' | ')} |`)
  console.log(`| ${head.map(() => '---').join(' | ')} |`)
  for (const r of rows) console.log(`| ${r.join(' | ')} |`)
  console.log('')
}

if (added.length || removed.length) {
  console.log(`## ① 部品の増減: ${added.length + removed.length} 件\n`)
  table(['部品', '変化'], [
    ...added.map((n) => [`\`${n}\``, '**増えた**']),
    ...removed.map((n) => [`\`${n}\``, '減った']),
  ])
}
if (propDiffs.length) {
  console.log(`## ② プロパティ・バリアント軸: ${propDiffs.length} 件\n`)
  table(['部品', 'プロパティ', '変化', '今', '前'],
    propDiffs.map(([c, k, w, a, b]) => [`\`${c}\``, `\`${k}\``, w, a, b]))
}
if (layoutDiffs.length) {
  console.log(`## ③ レイアウト: ${layoutDiffs.length} 件\n`)
  table(['部品', 'バリアント', '項目', '今', '前'],
    layoutDiffs.map(([c, v, k, a, b]) => [`\`${c}\``, `\`${v}\``, `\`${k}\``, a, b]))
}

if (!total) {
  console.log('✓ 部品の定義に変化なし\n')
} else {
  console.log(`**${total} 件の変化。** 対応が要るかは**人が判断する**（このスクリプトは判定しない）。`)
  console.log('コードを作り直すか、今回はトークンだけの更新にとどめるかを操作者に確認する。')
}

// CI では落とさずに読まれる場所へ出す（`rules/web-app-testing.md` §6 と同じ形）
if (process.env.GITHUB_ACTIONS === 'true' && total) {
  const rel = (() => {
    const r = path.relative(process.cwd(), path.resolve(afterPath))
    return !r || r.startsWith('..') ? afterPath : r
  })()
  console.log(`::warning file=${rel},title=部品の定義が変わった::${total} 件（部品 ${added.length + removed.length} / プロパティ ${propDiffs.length} / レイアウト ${layoutDiffs.length}）。詳細はジョブのサマリ`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### 部品の定義が変わりました\n\n${total} 件。**コードの作り直しが要るかは人が判断します。**\n\n` +
      `- 部品の増減: ${added.length + removed.length} 件\n- プロパティ・バリアント軸: ${propDiffs.length} 件\n- レイアウト: ${layoutDiffs.length} 件\n\n`)
  }
}
process.exit(0)
