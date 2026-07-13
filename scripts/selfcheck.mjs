#!/usr/bin/env node
/**
 * 生成物のセルフチェック（静的検査 + 任意の型検査）
 *
 * 使い方:
 *   node scripts/selfcheck.mjs <対象リポジトリのパス> [--src <配置先>] [--tsc] [--all]
 *
 * 例:
 *   node scripts/selfcheck.mjs output/.push/my-repo --src src --tsc
 *
 * 既定では **今回生成/変更したファイルだけ** を検査する（git status ベース）。
 * 移植先の既存コードの違反まで拾うとノイズになるため。--all で全ファイルを対象にできる。
 *
 * ビルドもテストも走らせない（--tsc は型検査のみで成果物を出さない）。
 * CLAUDE.md 原則 2 の例外として、Push 前に実行してよい。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { readTheme } from './theme.mjs'
import { extractClasses, judgeClass } from './classes.mjs'

// ---------------------------------------------------------------- 引数
const argv = process.argv.slice(2)
const repo = argv.find((a) => !a.startsWith('--'))
const flag = (n) => argv.includes(`--${n}`)
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d }
if (!repo) {
  console.error('使い方: node scripts/selfcheck.mjs <対象リポジトリのパス> [--src <配置先>] [--tsc] [--all]')
  process.exit(2)
}
const SRC = (opt('src', '') || '').replace(/^\/|\/$/g, '') // 配置先（例: src）。空 = ルート直下
const under = (...p) => path.posix.join(SRC, ...p)

const findings = []
const add = (level, check, file, line, msg, how) =>
  findings.push({ level, check, file, line, msg, how })

// ---------------------------------------------------------------- 対象ファイル
function tracked() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    return out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean)
      .flatMap((p) => (p.endsWith('/') ? walk(path.join(repo, p)).map((f) => path.relative(repo, f)) : [p]))
  } catch { return null }
}
function walk(dir, out = []) {
  let e
  try { e = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const x of e) {
    if (x.name === 'node_modules' || x.name === '.git' || x.name === 'dist' || x.name === 'storybook-static') continue
    const p = path.join(dir, x.name)
    x.isDirectory() ? walk(p, out) : out.push(p)
  }
  return out
}
const all = walk(repo).map((f) => path.relative(repo, f).split(path.sep).join('/'))
let targets = all
if (!flag('all')) {
  const t = tracked()
  if (t === null) add('WARN', 'scope', '-', 0, 'git status が取れないため全ファイルを検査した', 'リポジトリのルートを指しているか確認する')
  else targets = t.map((p) => p.split(path.sep).join('/')).filter((p) => all.includes(p))
}
const tsx = targets.filter((f) => /\.tsx?$/.test(f))
const src = (f) => fs.readFileSync(path.join(repo, f), 'utf8')
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

console.log(`# セルフチェック\n`)
console.log(`- 対象: ${path.resolve(repo)}${SRC ? `（配置先: ${SRC}/）` : ''}`)
console.log(`- 検査対象: ${flag('all') ? '全ファイル' : '今回生成/変更したファイル'} ${targets.length} 件（うち .ts/.tsx ${tsx.length} 件）\n`)

// ================================================================ S1. 構造の完全性
const comps = tsx.filter((f) =>
  /(^|\/)(components|features)\//.test(f) && !/\.stories\.tsx$/.test(f) &&
  !/\/(index|types|constants)\.tsx?$/.test(f) && !/\/hooks?\//.test(f))
for (const c of comps) {
  if (/\/pages\//.test(c)) continue // 画面はストーリーを作らない（web-app-storybook.md §1）
  const story = c.replace(/\.tsx$/, '.stories.tsx')
  if (!all.includes(story))
    add('ERROR', 'story-missing', c, 0, 'ストーリーが無い',
        `${path.basename(story)} を同じディレクトリに生成する（web-app-storybook.md §1）`)
}
const pages = tsx.filter((f) => /\/pages\/[A-Z]\w*\.tsx$/.test(f))
if (pages.length && !all.some((f) => /^tests\/e2e\/.+\.spec\.ts$/.test(f)))
  add('ERROR', 'e2e-missing', pages[0], 0, `画面を ${pages.length} 件生成したが tests/e2e/*.spec.ts が無い`,
      '受け入れ基準の雛形を tests/e2e/ に置く（web-app-testing.md §3）')

const tokensCss = under('styles', 'tokens.css')
if (!all.includes(tokensCss))
  add('ERROR', 'tokens-css', tokensCss, 0, 'Style Dictionary の出力が無い',
      'config/sd.config.js を実行して生成する（未生成のまま push すると CI が落ちる）')
else {
  const css = src(tokensCss)
  if (!css.includes('@theme'))
    add('ERROR', 'tokens-css', tokensCss, 1, '@theme ブロックが無い（:root では Tailwind のユーティリティが生成されない）',
        'sd.config.js の format を tailwind/theme にする（web-app-styling.md §2）')
  if (!/--[\w-]+:/.test(css))
    add('ERROR', 'tokens-css', tokensCss, 1, 'トークンが 1 件も出力されていない',
        'sd.config.js の source が tokens/ に当たっているか確認する')
}
if (!all.includes('config/sd.config.js') && !all.includes('config/sd.config.mjs'))
  add('ERROR', 'sd-config', 'config/sd.config.js', 0, 'Style Dictionary の設定が無い（CI 4 本が参照する）',
      'web-app-styling.md §2 の雛形から生成する')

// ワークフローが参照するパスが実在するか（配置先を src/ にした案件でずれやすい）
for (const wf of all.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))) {
  const y = src(wf)
  // run: / --config / test -s / paths: に現れるリポジトリ相対パスを拾う（配置先を src/ にした案件でずれやすい）
  const cand = new Set()
  for (const m of y.matchAll(/(?:--config|test -s|-f|paths:\s*\[?)\s*["']?([\w./-]*[\w-]+\.(?:css|js|mjs|ts|json))["']?/g)) cand.add(m[1])
  for (const m of y.matchAll(/["']((?:config|styles|tokens|tests|src)\/[\w./-]+)["']/g)) cand.add(m[1])
  for (const p of cand) {
    if (!p.includes('/') || p.endsWith('/')) continue
    if (!all.includes(p) && !all.some((f) => f.startsWith(p + '/')))
      add('ERROR', 'workflow-path', wf, lineOf(y, y.indexOf(p)), `参照先が存在しない: ${p}`,
          `実際の配置に合わせて置換する（配置先が ${SRC || 'ルート'} なら styles/tokens.css → ${tokensCss}）`)
  }
}

// 実効テーマ（既定 + プロジェクトの @theme）。S2 の除外判定と S2b/S2c が使う
const theme = readTheme(repo)

// ================================================================ S2. ルール違反
const PALETTE = 'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone'
const RULES = [
  { id: 'arbitrary-value', level: 'ERROR',
    // `]` の直後が `:` のものはバリアント修飾（data-[state=open]: / aria-[…]: / has-[…]:）なので除外する
    re: /\bclassName=(?:"[^"]*|\{[^}]*)\b[a-z-]+\[[^\]]+\](?!:)/g,
    // components/ui/ は shadcn/ui から導入した実装。rounded-[2px] や
    // translate-y-[calc(…)] は上流のコードであり、書き換えると「本物の API からずれる」
    // （web-app.md §3.1・生成直前チェックリスト 1）。改名しないのと同じ理由で内部実装も責めない
    skipUi: true,
    msg: 'arbitrary value を使っている', how: 'トークン化するか common.md §9.3 の診断に回す（web-app-styling.md §3・web-app.md §7）' },
  { id: 'raw-palette', level: 'ERROR',
    re: new RegExp(String.raw`\b(?:bg|text|border|ring|from|via|to)-(?:${PALETTE})-\d{2,3}\b`, 'g'),
    // プロジェクトが @theme で同名を再定義していれば、それは生パレットではなく自前のトークン
    exempt: (m) => theme.project.has('--color-' + m[0].replace(/^(?:bg|text|border|ring|from|via|to)-/, '')),
    msg: '生パレットを直接参照している', how: 'セマンティックなトークン（bg-primary 等）に置き換える（web-app-styling.md §3・web-app.md §7）' },
  { id: 'class-component', level: 'ERROR',
    re: /class\s+\w+\s+extends\s+(?:React\.)?(?:Pure)?Component\b/g,
    msg: 'クラスコンポーネント', how: '関数コンポーネントにする（web-app.md §3.5・§7）' },
  { id: 'classname-ternary', level: 'ERROR',
    re: /className=\{[^}]*\?[^}]*:[^}]*\}/g,
    // components/ui/ は shadcn/ui の上流実装なので責めない（arbitrary-value と同じ理由）
    skipUi: true,
    // CVA のバリアント名を三項で選ぶのは「隔離できている」正しい書き方なので責めない
    //   ✅ buttonVariants({ variant: isActive ? 'outline' : 'ghost' })
    //   ❌ cn(cond ? 'bg-primary p-4' : 'bg-muted p-2')
    // 直前に variant/size 等のキーがある三項は前者と判定する
    exempt: (m) => /\b(?:variant|size|intent|tone|color|align|orientation|state)\s*:\s*[^?]*\?/.test(m[0]),
    msg: 'クラス文字列を三項演算子で分岐している', how: 'CVA の variants に隔離する（web-app-styling.md §3・web-app.md §7）' },
  { id: 'explicit-any', level: 'WARN',
    re: /:\s*any\b/g,
    msg: '明示的な any', how: '型を付ける。避けられないなら理由をコメントで残す（web-app.md §3.2）' },
  { id: 'runtime-css-in-js', level: 'ERROR',
    re: /from\s+['"](?:styled-components|@emotion\/[\w-]+)['"]/g,
    msg: 'ランタイム CSS-in-JS を import している', how: 'Tailwind + CVA にする（web-app.md §7）' },
  { id: 'vrt-tag', level: 'ERROR',
    re: /tags:\s*\[[^\]]*['"]vrt['"]/g,
    // 検査対象はストーリーだけ。tests/vrt/storybook.spec.ts は「vrt タグの付いたストーリーを
    // 絞り込んで撮る」側（web-app-testing.md §4 の雛形そのもの）なので、タグ名が出てくるのは正しい
    storiesOnly: true,
    msg: "tags: ['vrt'] を付けている", how: 'VRT 対象への追加は昇格後に人が行う。生成時は付けない（web-app-testing.md §4）' },
]
for (const f of tsx) {
  const t = src(f)
  // components/ui/ は shadcn/ui の導入・派生領域（web-app.md §3.1）。内部実装を書き換えると本物の API から
  // ずれるので、skipUi のルールは適用しない。storiesOnly はストーリー側だけを対象にする
  const isUi = /(^|\/)components\/ui\//.test(f)
  const isStory = /\.stories\.tsx$/.test(f)
  for (const r of RULES) {
    if (r.skipUi && isUi) continue
    if (r.storiesOnly && !isStory) continue
    for (const m of t.matchAll(r.re)) {
      if (r.exempt?.(m)) continue
      add(r.level, r.id, f, lineOf(t, m.index), r.msg, r.how)
    }
  }
  // useEffect の中でデータ取得している疑い
  if (/useEffect\(/.test(t) && /\b(?:fetch|axios)\s*\(/.test(t))
    add('WARN', 'useeffect-fetch', f, lineOf(t, t.indexOf('useEffect(')),
        'useEffect と fetch/axios が同一ファイルにある', 'データ取得は TanStack Query に寄せる（web-app.md §4・§7）')
  // boolean props に is 接頭辞が無い（shadcn 派生の components/ui/ は shadcn API を尊重するので除外）
  if (!isUi && !isStory) {
    for (const m of t.matchAll(/^\s{2,}(\w+)\??:\s*boolean\b/gm)) {
      const n = m[1]
      if (!/^(?:is|has|can|should)[A-Z]/.test(n))
        add('ERROR', 'boolean-prefix', f, lineOf(t, m.index), `boolean props「${n}」に is 接頭辞が無い`,
            `${'is' + n[0].toUpperCase() + n.slice(1)} にする（web-app.md §3.2）`)
    }
  }
  // components/common/ は named export
  if (/(^|\/)components\/common\/[A-Z]\w*\.tsx$/.test(f) && /export\s+default\b/.test(t))
    add('ERROR', 'named-export', f, lineOf(t, t.indexOf('export default')),
        'default export になっている', 'named export にする（web-app.md §3.1）')
}

// ================================================================ S2b. クラス名が @theme に実在するか
// tsc / ESLint / play / a11y のいずれも捕まえられない「沈黙する穴」（rules/web-app-selfcheck.md）
if (!theme.twSources.length && !theme.projSources.length) {
  add('WARN', 'class-exists', '-', 0, 'クラス名の照合をスキップ（@theme を取得できなかった）',
      `対象リポジトリで npm ci を実行し、${tokensCss} を生成してから再試行する`)
} else {
  if (!theme.twSources.length)
    add('WARN', 'class-exists', '-', 0, 'Tailwind の既定テーマが未取得のため、照合はプロジェクト定義分のみ',
        '対象リポジトリで npm ci を実行すると精度が上がる')
  for (const f of tsx) {
    const t = src(f)
    const seen = new Set()
    for (const { cls, idx } of extractClasses(t)) {
      const r = judgeClass(cls, theme.vars)
      if (r.verdict === 'ok' || r.verdict === 'skip') continue
      const key = `${cls}@${lineOf(t, idx)}`
      if (seen.has(key)) continue
      seen.add(key)
      if (r.verdict === 'unknown')
        add('ERROR', 'class-exists', f, lineOf(t, idx),
            `\`${cls}\` は @theme に無い（**Tailwind は何も出力せず、エラーも出さない**）`,
            r.suggest?.length ? `もしかして: ${r.suggest.join(' / ')}` : 'トークン名を確認する。無ければ common.md §9.3 の診断に回す')
      else
        add('ERROR', 'class-exists', f, lineOf(t, idx),
            `\`${cls}\` は --spacing のスケールに乗らない（${r.why}。刻みは 0.5 まで）`,
            'スケールに乗る値へ寄せる（寄せ先は effective-scale.mjs で確認）')
    }
  }
}

// ================================================================ S2c. cn() の tailwind-merge が書体トークンを知っているか
// tailwind-merge は Tailwind の既定スケールしか知らないので、独自の書体トークンを「文字色」と誤判定する。
// その結果 cn('text-<色>', 'text-<書体>') が衝突扱いになり、**文字色が実行時に黙って捨てられる**。
// ビルド・tsc・ESLint・class-exists はすべて通り、気付けるのは a11y のコントラスト検査だけ（web-app-styling.md §5）
const TW_FONT_SIZE = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'])
const typography = [...theme.project.keys()]
  .filter((k) => k.startsWith('--text-') && !TW_FONT_SIZE.has(k.slice(7)))
if (typography.length) {
  // cn() の定義は shadcn の初期化が置く lib/utils.ts にあり、今回の差分に含まれないことが多い。
  // そのため「今回生成/変更したファイル」に限定せず、リポジトリ全体の定番の置き場所も見る
  const cnFiles = [...new Set([...all.filter((f) => /(^|\/)lib\/(?:utils|cn|tw-merge)\.tsx?$/.test(f)), ...tsx])]
    .filter((f) => /from\s+['"]tailwind-merge['"]/.test(src(f)))
  for (const f of cnFiles) {
    const t = src(f)
    if (/\b(?:extendTailwindMerge|createTailwindMerge)\s*\(/.test(t)) continue
    const sample = typography.slice(0, 3).map((k) => k.slice(2)).join(' / ')
    add('ERROR', 'cn-twmerge', f, lineOf(t, t.indexOf('tailwind-merge')),
        `素の twMerge のままだが @theme に独自の書体トークンが ${typography.length} 件ある（${sample}${typography.length > 3 ? ' …' : ''}）。` +
        '`text-<書体>` が文字色と誤判定され、併記した文字色が実行時に消える',
        'extendTailwindMerge で font-size グループに書体トークンを登録する（web-app-styling.md §5）')
  }
}

// ================================================================ S3. ストーリーの中身
for (const f of targets.filter((x) => /\.stories\.tsx$/.test(x))) {
  const t = src(f)
  if (!/\btitle:\s*['"]/.test(t))
    add('ERROR', 'story-title', f, 1, 'meta に title が無い',
        "レイヤー付きで付ける（例: title: 'ui/Button'。web-app-storybook.md §1）")
  // ストーリー名は日本語の文章にする規約（web-app-storybook.md §1）なので Unicode 識別子に対応させる
  const stories = [...t.matchAll(/^export\s+const\s+([^\s:=(]+)/gm)].map((m) => m[1])
  if (stories.length < 2)
    add('WARN', 'story-variants', f, 1, `ストーリーが ${stories.length} 件しかない`,
        'variant / size / disabled / error などを個別ストーリーとして列挙する（web-app-storybook.md §1）')
  if (!/\bplay:\s*async/.test(t))
    add('WARN', 'story-play', f, 1, 'play 関数が無い',
        '「操作 → 結果」を play で書く。表示のみの部品なら省略可（web-app-storybook.md §1）')
}

// ================================================================ S4. 型検査（任意）
if (flag('tsc')) {
  const hasTs = fs.existsSync(path.join(repo, 'node_modules', 'typescript'))
  const hasCfg = fs.existsSync(path.join(repo, 'tsconfig.json'))
  if (!hasTs || !hasCfg) {
    add('WARN', 'tsc', '-', 0, `型検査をスキップ（${!hasTs ? 'typescript が未インストール' : 'tsconfig.json が無い'}）`,
        !hasTs ? '対象リポジトリで npm ci を実行してから再試行する' : '移植先の tsconfig.json を確認する')
  } else {
    try {
      execFileSync('npx', ['tsc', '--noEmit'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
    } catch (e) {
      const out = ((e.stdout ?? '') + (e.stderr ?? '')).split('\n').filter((l) => /error TS\d+/.test(l))
      for (const l of out.slice(0, 30)) {
        const m = l.match(/^(.+?)\((\d+),\d+\):\s*(.+)$/)
        add('ERROR', 'tsc', m ? m[1] : '-', m ? +m[2] : 0, m ? m[3] : l.trim(), '型エラーを解消する')
      }
      if (out.length > 30) add('ERROR', 'tsc', '-', 0, `ほか ${out.length - 30} 件の型エラー`, 'npx tsc --noEmit で全件確認する')
    }
  }
}

// ================================================================ 出力
const err = findings.filter((f) => f.level === 'ERROR')
const warn = findings.filter((f) => f.level === 'WARN')
for (const [label, list] of [['ERROR（直してから push する）', err], ['WARN（判断して報告する）', warn]]) {
  if (!list.length) continue
  console.log(`## ${label}: ${list.length} 件\n`)
  console.log('| 検査 | 場所 | 内容 | どう直すか |')
  console.log('| --- | --- | --- | --- |')
  for (const f of list) console.log(`| ${f.check} | \`${f.file}${f.line ? ':' + f.line : ''}\` | ${f.msg} | ${f.how} |`)
  console.log('')
}
if (!findings.length) console.log('✓ 指摘なし\n')
console.log(`**ERROR ${err.length} 件 / WARN ${warn.length} 件。**` +
  (err.length ? ' ERROR は push 前に直す。' : '') +
  (warn.length ? ' WARN は直すか「このまま進める」かを操作者に確認する。' : ''))
process.exit(err.length ? 1 : 0)
