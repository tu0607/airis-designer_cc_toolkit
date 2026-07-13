#!/usr/bin/env node
/**
 * Airis 自身のドキュメント整合性チェッカー
 *
 * 使い方: node scripts/doccheck.mjs
 *
 * 検査するのは **このリポジトリのルール類**（生成物ではない。生成物は selfcheck.mjs）。
 * ルールを編集したら必ず通す。フローの順序やステップ番号を変えたときに参照が壊れるのを防ぐ。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const DOCS = ['CLAUDE.md', 'README.md', 'CHANGELOG.md',
  'docs/usage.md', 'docs/design-tokens.md', 'docs/design-system.md',
  'docs/testing-and-publishing.md', 'docs/tech-stack.md', 'docs/repo-structure.md',
  'docs/troubleshooting.md',
  'rules/README.md', 'rules/common.md',
  'rules/web-app.md', 'rules/web-app-styling.md', 'rules/web-app-storybook.md',
  'rules/web-app-testing.md', 'rules/web-app-ci.md', 'rules/web-app-selfcheck.md',
  'rules/web-lp.md', 'rules/web-content-site.md', 'rules/native.md', 'rules/figma-plugin-airis.md',
  'rules/handoff.md',
  '.claude/commands/setup.md', '.claude/commands/design-to-code.md', '.claude/commands/doc-audit.md',
  'figma-plugin/README.md']
const NUMBERED = ['CLAUDE.md', 'rules/common.md',
  'rules/web-app.md', 'rules/web-app-styling.md', 'rules/web-app-storybook.md',
  'rules/web-app-testing.md', 'rules/web-app-ci.md', 'rules/web-app-selfcheck.md',
  'rules/web-lp.md', 'rules/web-content-site.md', 'rules/native.md', 'rules/handoff.md']
// 実行時に生成される / 移植先リポジトリ側のパス（このリポジトリには存在しない）
const RUNTIME_PATHS = new Set(['config/project.local.json', 'config/custom-plugin-spec.md', 'config/sd.config.js'])

const read = (f) => fs.readFileSync(f, 'utf8')
const lines = (f) => read(f).split('\n')

// CHANGELOG は「もう無いファイル」を記録する場所なので、そこに載っている旧名は
// **存在しないのが正しい**。旧名の一覧は CHANGELOG 自身から読む（二重管理にしない）。
// 対象はリネーム表の 1 列目だけ（他の表の実在するパスは検査を続ける）
const RENAMED_AWAY = (() => {
  const sec = read('CHANGELOG.md').split(/^## /m).find((s) => s.startsWith('ルールファイルのリネーム')) ?? ''
  return new Set([...sec.matchAll(/^\| `([\w./-]+)` \|/gm)].map((m) => m[1]))
})()
let failed = 0
function report(title, issues, detail) {
  console.log(`=== ${title} ===`)
  if (detail) console.log(detail)
  if (issues.length) { failed += issues.length; for (const x of issues) console.log('  ✗ ' + x) }
  else console.log('  ✓ 問題なし')
  console.log('')
}

// ── A. Markdown 構造 ────────────────────────────────────────────
{
  const iss = []
  for (const f of DOCS) {
    const L = lines(f)
    let fence = null, prev = 0, i = 0
    const heads = []
    while (i < L.length) {
      const ln = L[i]
      if (/^\s*(```|~~~)/.test(ln)) { fence = fence ? null : i + 1; i++; continue }
      if (ln !== ln.replace(/\s+$/, '')) iss.push(`${f}:${i + 1} 行末に空白`)
      if (ln.includes('\t')) iss.push(`${f}:${i + 1} タブ文字`)
      if (!fence) {
        const hm = ln.match(/^(#+)\s+(.*)/)
        if (hm) {
          const lv = hm[1].length
          if (prev && lv > prev + 1) iss.push(`${f}:${i + 1} 見出しレベル飛び h${prev}->h${lv}`)
          prev = lv; heads.push(hm[2].trim())
        }
        if (ln.trimStart().startsWith('|') && i + 1 < L.length && /^\s*\|[\s:|-]+\|\s*$/.test(L[i + 1])) {
          const hc = (ln.match(/\|/g) || []).length
          let j = i + 2
          while (j < L.length && L[j].trimStart().startsWith('|')) {
            const c = (L[j].match(/\|/g) || []).length
            if (c !== hc) iss.push(`${f}:${j + 1} 表の列数不一致（見出し${hc - 1}列 vs ${c - 1}列）`)
            j++
          }
          i = j; continue
        }
      }
      i++
    }
    if (fence) iss.push(`${f}:${fence} 閉じられていないコードフェンス`)
    // 連続空行・末尾の余分な空行（整形の崩れ）
    let f2 = false
    L.forEach((ln, i) => {
      if (/^\s*(```|~~~)/.test(ln)) { f2 = !f2; return }
      if (!f2 && ln.trim() === '' && (L[i + 1] ?? 'x').trim() === '') iss.push(`${f}:${i + 1} 空行が 2 行以上続いている`)
    })
    if (L.length > 1 && L[L.length - 1] === '' && L[L.length - 2] === '') iss.push(`${f} 末尾に余分な空行`)
    for (const h of new Set(heads.filter((x) => heads.filter((y) => y === x).length > 1)))
      iss.push(`${f} 見出しの重複: 「${h}」`)
  }
  // 外部の整形処理が本文をテーブルセルへ混入させる事故があったため、その痕跡を検出する
  for (const f of DOCS) {
    const L = lines(f)
    const intro = L.slice(0, 10).map((l) => l.trim())
      .filter((l) => l.length >= 20 && !/^[#|\->`]/.test(l))
    L.forEach((l, i) => {
      if (!l.startsWith('|')) return
      for (const p of intro) if (l.includes(p.slice(0, 20)))
        iss.push(`${f}:${i + 1} 冒頭の本文がテーブルセルに混入している（整形事故の疑い）`)
    })
  }
  report('A. Markdown 構造（空白/タブ/見出し/表/フェンス/重複見出し/本文混入）', iss)
}

// ── B. 節・ステップ・原則の参照 ──────────────────────────────────
const sec = {}
for (const f of NUMBERED) {
  sec[f] = new Set([...read(f).matchAll(/^#{2,4}\s+(?:★\s*)?([0-9]+(?:[-.][0-9]+)*)\.?\s/gm)].map((m) => m[1]))
}
const allSec = new Set(Object.values(sec).flatMap((s) => [...s]))
{
  const iss = new Set()
  for (const f of DOCS) {
    const s = read(f)
    for (const m of s.matchAll(/`?(CLAUDE\.md|common\.md|web-app(?:-styling|-storybook|-testing|-ci|-selfcheck)?\.md|web-lp\.md|web-content-site\.md|native\.md|handoff\.md)`?\s*(?:の)?\s*(?:ステップ\s*|§)([0-9]+(?:[-.][0-9]+)*)/g)) {
      const k = m[1] === 'CLAUDE.md' ? 'CLAUDE.md' : 'rules/' + m[1]
      if (sec[k] && !sec[k].has(m[2])) iss.add(`${f} → ${m[1]} §/ステップ ${m[2]} が存在しない`)
    }
    if (sec[f]) for (const m of s.matchAll(/(?<![\w.])§([0-9]+(?:\.[0-9]+)*)/g))
      if (!sec[f].has(m[1]) && !allSec.has(m[1])) iss.add(`${f} 自ファイル §${m[1]} が存在しない`)
    for (const m of s.matchAll(/原則\s*([0-9]+)/g)) {
      const n = +m[1]
      if (n < 1 || n > 4) iss.add(`${f} 「原則 ${m[1]}」は存在しない（1〜4）`)
    }
    // 「3. プラットフォーム / ターゲット判定」のように番号+見出し名で引用している箇所
    const clHeads = Object.fromEntries([...read('CLAUDE.md').matchAll(/^### (\d+)\.\s+(.*)$/gm)]
      .map((m) => [m[1], m[2].replace(/[（(][\s\S]*/, '').trim()]))
    for (const m of s.matchAll(/「(\d+)\.\s*([^」]+)」/g)) {
      const [, num, title] = m
      const t = title.replace(/[（(][\s\S]*/, '').trim()
      const hit = Object.entries(clHeads).find(([, v]) => v.includes(t.slice(0, 6)) || t.includes(v.slice(0, 6)))
      if (hit && hit[0] !== num)
        iss.add(`${f} 「${num}. ${title}」は現在ステップ ${hit[0]}（番号がずれている）`)
    }
  }
  report('B. 節・ステップ・原則の参照の実在', [...iss].sort())
}

// ── C. フロー図と実見出しの一致 + 作業ツリー依存の順序 ────────────
{
  const cl = read('CLAUDE.md')
  const flow = cl.match(/## フロー全体\n\n```\n([\s\S]*?)```/)[1]
  const fs_ = Object.fromEntries([...flow.matchAll(/^(\d+)\.\s+(.*)$/gm)].map((m) => [+m[1], m[2].trim()]))
  const hs_ = Object.fromEntries([...cl.matchAll(/^### (\d+)\.\s+(.*)$/gm)].map((m) => [+m[1], m[2].trim()]))
  const iss = []
  const a = Object.keys(fs_).map(Number).sort((x, y) => x - y)
  const b = Object.keys(hs_).map(Number).sort((x, y) => x - y)
  if (a.join() !== b.join()) iss.push(`番号集合が不一致 図=[${a}] 見出し=[${b}]`)
  for (const n of a.filter((x) => b.includes(x))) {
    const key = fs_[n].replace(/[（(][\s\S]*/, '').replace('★', '').split('…')[0].trim().slice(0, 6)
    const head = hs_[n].replace(/[（(][\s\S]*/, '').replace('★', '').trim()
    if (key && !head.includes(key)) iss.push(`ステップ ${n}: 図「${fs_[n]}」と見出し「${hs_[n]}」が対応しない`)
  }
  report('C. フロー図と実見出しの一致', iss, `  図 ${a.length} ステップ / 見出し ${b.length} ステップ`)

  // 作業ツリー（クローン）を必要とする記述が、クローンより前のステップに無いか
  const marks = [...cl.matchAll(/^### (\d+)\.\s/gm)].map((m) => [+m[1], m.index])
  const bodies = {}
  marks.forEach(([n, pos], k) => { bodies[n] = cl.slice(pos, k + 1 < marks.length ? marks[k + 1][1] : cl.length) })
  const cloneStep = Object.entries(bodies).find(([, v]) => v.includes('クローン') && v.includes('git switch'))?.[0]
  const iss2 = []
  if (!cloneStep) iss2.push('クローンを行うステップが見つからない')
  else for (const [n, body] of Object.entries(bodies)) {
    if (+n >= +cloneStep) continue
    for (const kw of ['作業ツリー', 'effective-scale.mjs', 'selfcheck.mjs', 'style-dictionary build', 'npm ci'])
      if (body.split('\n').some((l) => l.includes(kw) && !l.includes('ない') && !l.includes(`ステップ ${cloneStep}`)))
        iss2.push(`ステップ ${n} が「${kw}」に言及（クローンはステップ ${cloneStep}。順序が逆）`)
  }
  report('C2. 作業ツリー依存の順序', iss2, `  クローンを行うステップ: ${cloneStep}`)
}

// ── D. 番号リストの連続性 ────────────────────────────────────────
{
  const iss = []
  const flush = (f, seq) => {
    if (seq.length < 2) return
    const n = seq.map((x) => x[1])
    if (n.join() !== Array.from({ length: n.length }, (_, i) => n[0] + i).join())
      iss.push(`${f}:${seq[0][0]} 番号リストが不連続 [${n}]`)
  }
  for (const f of DOCS) {
    let fence = false, seq = []
    lines(f).forEach((ln, i) => {
      if (/^\s*(```|~~~)/.test(ln)) { fence = !fence; return }
      if (fence) return
      const m = ln.match(/^(\d+)\.\s/)
      if (m) seq.push([i + 1, +m[1]])
      else if (!(ln.trim() === '' || /^[\s>]/.test(ln))) { flush(f, seq); seq = [] }
    })
    flush(f, seq)
  }
  report('D. 番号リストの連続性', iss)
}

// ── E. リンク・参照パスの実在 ────────────────────────────────────
{
  const iss = new Set()
  for (const f of DOCS) {
    const s = read(f)
    for (const m of s.matchAll(/\[[^\]]+\]\(([^)#][^)]*)\)/g)) {
      const t = m[1]
      if (t.startsWith('http')) continue
      if (!fs.existsSync(path.join(path.dirname(f), t)) && !fs.existsSync(t)) iss.add(`${f} リンク切れ: ${t}`)
    }
    for (const m of s.matchAll(/`((?:scripts|rules|config|\.claude)\/[A-Za-z0-9_./-]+)`/g)) {
      const t = m[1]
      if (t.includes('<') || t.includes('*') || RUNTIME_PATHS.has(t) || RENAMED_AWAY.has(t)) continue
      if (!fs.existsSync(t)) iss.add(`${f} 参照パスが存在しない: ${t}`)
    }
  }
  report('E. リンク・参照パスの実在', [...iss].sort())
}

// ── F. 撤回済み・禁止表現 ────────────────────────────────────────
{
  const banned = {
    commitByDesigner: '廃止した設定キー',
    'SETUP_GITHUB.md を生成': '手順書ファイル生成は禁止',
    文脈から自明なら聞かない: '撤回した方針（ターゲット判定）',
    要件から自動判定: '撤回した表現（黙って決める）',
    'output/tokens': '旧パス', 'output/config': '旧パス', 'output/components': '旧パス',
    'scripts/lib': '解消したディレクトリ',
    'Tailwind v4 の既定値で': 'ハードコード数値（実測に移行済み）',
  }
  const iss = []
  for (const f of DOCS) lines(f).forEach((ln, i) => {
    for (const [k, why] of Object.entries(banned)) if (ln.includes(k)) iss.push(`${f}:${i + 1} 「${k}」= ${why}`)
  })
  report('F. 撤回済み・禁止表現の残存', iss)
}

// ── G. 設定キー参照の実在 ────────────────────────────────────────
{
  const cfg = JSON.parse(read('config/project.example.json'))
  const keys = new Set(Object.entries(cfg).flatMap(([k, v]) =>
    k.startsWith('$') || typeof v !== 'object' ? [] : Object.keys(v).filter((x) => !x.startsWith('$')).map((x) => `${k}.${x}`)))
  const docs = DOCS.map(read).join('\n')
  const iss = new Set()
  for (const m of docs.matchAll(/`(tokens|storybook|testing|git|web|platform|pushTarget|lint|native)\.([A-Za-z]+)`/g)) {
    // ファイル名（tokens.ts / tokens.css …）は設定キーではない。拡張子を足し忘れると誤検知になる
    if (/\.(md|css|js|mjs|ts|tsx|json)$/.test(`${m[1]}.${m[2]}`)) continue
    const r = `${m[1]}.${m[2]}`
    if (!keys.has(r)) iss.add(`config に無い設定キー参照: ${r}`)
  }
  report('G. 設定キー参照の実在', [...iss].sort())
}

// ── H. CI ワークフロー雛形 ───────────────────────────────────────
{
  const iss = [], info = []
  for (const m of read('rules/web-app-ci.md').matchAll(/```yaml\n([\s\S]*?)```/g)) {
    const L = m[1].split('\n')
    const fn = L.find((l) => l.startsWith('# .github/'))?.replace(/^#\s*/, '').trim() ?? '?'
    const jobs = []
    let inj = false
    for (const l of L) {
      if (l.startsWith('jobs:')) { inj = true; continue }
      if (l.trim() && !l.startsWith(' ') && !l.startsWith('#')) inj = false
      if (inj && /^  [a-z][a-z0-9-]*:\s*$/.test(l)) jobs.push(l.trim().replace(/:$/, ''))
    }
    const needs = [...m[1].matchAll(/^\s*needs:\s*(.+)$/gm)]
      .flatMap((x) => x[1].replace(/[[\]]/g, '').split(',').map((y) => y.trim()).filter(Boolean))
    const bad = needs.filter((n) => !jobs.includes(n))
    const generic = jobs.filter((j) => ['build', 'test', 'ci', 'update', 'deploy', 'run'].includes(j))
    if (bad.length) iss.push(`${fn}: needs に未定義ジョブ [${bad}]`)
    if (generic.length) iss.push(`${fn}: 汎用ジョブ名 [${generic}]（命名規約違反）`)
    info.push(`  ${fn}: [${jobs}]`)
  }
  report('H. CI ワークフロー雛形', iss, info.join('\n'))
}

// ── I. スクリプトの構文と規約 ────────────────────────────────────
{
  const iss = []
  for (const f of ['config/project.example.json', '.claude/settings.json', 'package.json', '.mcp.json']) {
    try { JSON.parse(read(f)) } catch (e) { iss.push(`${f}: JSON 構文 ${e.message}`) }
  }
  // シェルスクリプトは構文検査 + 実行ビットを確認
  for (const f of ['install.sh', 'figma-plugin/setup.sh']) {
    try { execFileSync('sh', ['-n', f], { stdio: 'pipe' }) } catch { iss.push(`${f}: シェル構文エラー`) }
    if (!read(f).startsWith('#!/bin/sh')) iss.push(`${f}: shebang が #!/bin/sh でない`)
    if (!(fs.statSync(f).mode & 0o111)) iss.push(`${f}: 実行ビットが立っていない`)
  }
  // scripts/ はフラット構成。shebang の有無で CLI / import 専用モジュールを区別する規約
  const self = path.basename(process.argv[1])
  for (const f of fs.readdirSync('scripts').filter((x) => x.endsWith('.mjs')).sort()) {
    const p = `scripts/${f}`, text = read(p)
    try { execFileSync('node', ['--check', p], { stdio: 'pipe' }) } catch (e) { iss.push(`${p}: JS 構文エラー`) }
    const isCli = text.startsWith('#!')
    // 必須引数を持つ CLI か（使い方の行に <…> があるか）。doccheck 自身は引数不要
    const needsArg = /使い方:.*<[^>]+>/.test(text)
    if (f === self) continue // 自分自身は実行しない（無限再帰になる）
    let code = 0, out = ''
    try { out = execFileSync('node', [p], { stdio: 'pipe', encoding: 'utf8' }) } catch (e) { code = e.status ?? 1 }
    if (isCli) {
      if (needsArg && code !== 2) iss.push(`${p}: 必須引数のある CLI なのに引数なし実行の終了コードが 2 でない（${code}）`)
    } else {
      if (!/export (function|const)/.test(text)) iss.push(`${p}: shebang が無いのに export も無い（CLI かモジュールか不明）`)
      if (code !== 0 || out) iss.push(`${p}: モジュールなのに実行時に副作用がある（exit=${code}）`)
    }
    for (const m of text.matchAll(/from\s+['"](\.\/[\w./-]+)['"]/g))
      if (!fs.existsSync(path.join('scripts', m[1]))) iss.push(`${p}: import 先が存在しない ${m[1]}`)
  }
  report('I. 構文とスクリプトの規約', iss)
}

// ── I2. selfcheck の検査 ID がドキュメントと一致するか ─────────────
{
  const doc = read('rules/web-app-selfcheck.md'), impl = read('scripts/selfcheck.mjs')
  // 検査 ID には数字が入る（e2e-missing）。[a-z-]+ にすると**両側から黙って消える**ため一致してしまう
  const idsDoc = new Set([...doc.matchAll(/^\| `([a-z0-9-]+)` \| (?:ERROR|WARN)/gm)].map((m) => m[1]))
  const idsImpl = new Set([...[...impl.matchAll(/add\('(?:ERROR|WARN)',\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
    ...[...impl.matchAll(/id:\s*'([a-z0-9-]+)'/g)].map((m) => m[1])])
  const iss = []
  for (const x of [...idsDoc].sort()) if (!idsImpl.has(x)) iss.push(`web-app-selfcheck.md §2 に \`${x}\` があるが selfcheck.mjs に実装が無い`)
  for (const x of [...idsImpl].sort()) if (!idsDoc.has(x)) iss.push(`selfcheck.mjs が \`${x}\` を出すが web-app-selfcheck.md §2 に記載が無い`)
  report('I2. セルフチェックの検査 ID（ドキュメント ↔ 実装）', iss, `  ドキュメント ${idsDoc.size} 件 / 実装 ${idsImpl.size} 件`)
}

// ── I3. 同梱プラグインの schemaVersion がルールの想定と一致するか ──
{
  const code = read('figma-plugin/src/code.ts')
  const spec = read('rules/figma-plugin-airis.md')
  const impl = code.match(/const SCHEMA_VERSION = (\d+);/)?.[1]
  const want = spec.match(/このルールが想定するのは `(\d+)`/)?.[1]
  const iss = []
  if (!impl) iss.push('figma-plugin/src/code.ts の SCHEMA_VERSION が読めない')
  else if (impl !== want) iss.push(`SCHEMA_VERSION=${impl} だが rules/figma-plugin-airis.md の想定は ${want}`)
  // 出力契約のキーがルールに記載されているか
  for (const k of [...new Set([...code.matchAll(/validation\.(\w+)\.push/g)].map((m) => m[1]))])
    if (!spec.includes(k)) iss.push(`validation.${k} が rules/figma-plugin-airis.md に無い`)
  // 同梱プラグインの案内が必要な場所から落ちていないか（過去に README の表から消えた）。
  // 方式を選ぶ人が見るのは「4 つの方法」の表なので、README ではなくそこを必須にする
  const REQUIRED_MENTIONS = {
    'docs/design-tokens.md': 'figma-plugin/',
    'docs/repo-structure.md': 'figma-plugin/',
    'CLAUDE.md': 'rules/figma-plugin-airis.md',
    '.claude/commands/setup.md': 'sh figma-plugin/setup.sh',
    'config/project.example.json': 'rules/figma-plugin-airis.md',
    'rules/README.md': 'figma-plugin-airis.md',
    'figma-plugin/README.md': 'rules/figma-plugin-airis.md',
  }
  for (const [f, needle] of Object.entries(REQUIRED_MENTIONS))
    if (!read(f).includes(needle)) iss.push(`${f} に「${needle}」への言及が無い（案内が落ちている）`)
  report('I3. 同梱プラグインと取り込みルールの整合', iss, `  SCHEMA_VERSION: ${impl}`)
}

// ── I4. 旧ブランド・旧リポジトリ名の混入（例外なし） ─────────────
{
  // 追跡対象と未追跡（gitignore 済みは除く）の全ファイルを見る。
  // doccheck 自身はこのパターンを定義しているので対象外。
  // **install.sh は tarball で中身だけを展開する（.git を作らない）** ので、
  // 利用者の環境では git が使えない。落とさずスキップして「未実施」と報告する
  let listed
  try {
    listed = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
      .split('\n').filter(Boolean)
  } catch {
    listed = null
  }
  if (listed === null) {
    report('I4. 旧ブランド・旧リポジトリ名の混入（例外なし）', [],
      '  ⚠️ git リポジトリでないため**未実施**（install.sh は .git を作らないので利用者環境では通常スキップされる）')
  } else {
  listed = listed.filter((f) => !/package-lock|^scripts\/doccheck\.mjs$/.test(f))
  const PAT = /hamee|ne-design-system|ne\.design-system|ne-inc/i
  const iss = []
  for (const f of listed) {
    let text
    try { text = read(f) } catch { continue }
    if (!PAT.test(text)) continue
    text.split('\n').forEach((l, i) => {
      const m = l.match(PAT)
      if (m) iss.push(`${f}:${i + 1} 旧ブランド/旧リポジトリ名「${m[0]}」が残っている`)
    })
  }
  report('I4. 旧ブランド・旧リポジトリ名の混入（例外なし）', iss, `  走査 ${listed.length} ファイル`)
  }
}

// ── I5. sd.config.js 雛形の必須要素 ────────────────────────────
// 誤ると CI が「緑のまま何も当たらない」状態になるので、雛形が壊れていないかを静的に検査する
{
  const doc = read('rules/web-app-styling.md')
  const m = doc.match(/```js\n(\/\/ config\/sd\.config\.js[\s\S]*?)```/)
  const iss = []
  if (!m) iss.push('rules/web-app-styling.md に sd.config.js の雛形コードブロックが無い')
  else {
    const code = m[1]
    const body = code.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
    const must = [
      [/@theme \{/, '@theme で囲んでいない（:root だとユーティリティが生成されない）'],
      [/registerFormat/, 'カスタム format を登録していない'],
      [/transformGroup:\s*'css'/, "transformGroup: 'css' が無い（参照が解決されない）"],
      [/tokens\/core\/\*\*/, 'source に tokens/core/** が無い'],
      [/mode\/default\/\*\*/, 'source に mode/default/** が無い'],
      [/MODES/, '有効モードを差分結合する仕組みが無い'],
      [/buildPath/, '出力先 buildPath が無い'],
      // これが落ちると --spacing-4 等が既定スケールを上書きし、CI が通ったまま余白が壊れる
      [/RESERVED/, 'Tailwind 予約名前空間のガードが無い（common.md §2）'],
    ]
    for (const [re, why] of must) if (!re.test(code)) iss.push(`雛形: ${why}`)
    if (/@import\s+["']tailwindcss["']/.test(body))
      iss.push('雛形が @import "tailwindcss" を出力している（エントリ CSS と二重 import になる）')
    if (/:root/.test(body)) iss.push('雛形のコード本体に :root がある')
    // source の順序（core → mode/default → 有効モード）が逆流していないか
    const si = code.indexOf('tokens/core/**'), di = code.indexOf('mode/default/**'), mi = code.lastIndexOf('MODES.map')
    if (!(si < di && di < mi)) iss.push('雛形の source の順序が core → mode/default → 有効モード になっていない')
  }
  report('I5. sd.config.js 雛形の必須要素', iss)
}

// ── J. サイズ ───────────────────────────────────────────────────
console.log('=== J. サイズ ===')
let total = 0
for (const f of [...DOCS, ...fs.readdirSync('scripts').filter((x) => x.endsWith('.mjs')).sort().map((x) => `scripts/${x}`)]) {
  const b = fs.statSync(f).size
  total += b
  console.log(`  ${String(lines(f).length).padStart(5)}行 ${String(b).padStart(7)}B  ${f}`)
}
console.log(`  ${''.padStart(5)}  ${String(total).padStart(7)}B  合計\n`)
console.log(failed === 0 ? '✓ 全検査パス' : `✗ ${failed} 件の問題`)
process.exit(failed ? 1 : 0)
