// scripts/ の再発防止テスト。Node 標準ライブラリだけで動く（依存なし）。
//   使い方: node scripts/test/selfcheck.test.mjs
// 一時ディレクトリに最小の「対象リポジトリ」を作り、effective-scale.mjs / selfcheck.mjs を実際に実行して
// 出力を検証する（ビルドもテストもしない。CSS と .tsx を読むだけ）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { modifierCollision, findModifierCollisions, MODIFIER_WORDS } from '../reserved.mjs'
import { resolveShadcnUiDir } from '../shadcn.mjs'

const SCRIPTS = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
let pass = 0, fail = 0
const t = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name) } else { fail++; console.log('  ❌ ' + name + (detail ? ' … ' + detail : '')) }
}
const run = (script, args) => {
  try { return { code: 0, out: execFileSync('node', [path.join(SCRIPTS, script), ...args], { encoding: 'utf8', stdio: 'pipe' }) } }
  catch (e) { return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') } }
}
const mkrepo = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airis-selfcheck-'))
  for (const [f, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true })
    fs.writeFileSync(path.join(dir, f), body)
  }
  return dir
}

// ---------------------------------------------------------------- 1. 判定表（reserved.mjs）
console.log('# reserved.mjs — ユーティリティの修飾語と同名の key')
t('--radius-s は rounded-s（start 側の辺指定）と衝突', modifierCollision('--radius-s')?.key === 's')
t('--radius-l は rounded-l（left 側の辺指定）と衝突', modifierCollision('--radius-l')?.key === 'l')
t('--radius-tl / --radius-ee（角の指定）も衝突', !!modifierCollision('--radius-tl') && !!modifierCollision('--radius-ee'))
t('--radius-card（意味ベース）は衝突しない', modifierCollision('--radius-card') === null)
t('--radius-sm は修飾語ではない（値の上書きは RESERVED 側の担当）', modifierCollision('--radius-sm') === null)
t('--text-left / --text-center は text-align と衝突', !!modifierCollision('--text-left') && !!modifierCollision('--text-center'))
t('--text-heading-lg は衝突しない', modifierCollision('--text-heading-lg') === null)
t('--shadow-none は衝突', !!modifierCollision('--shadow-none'))
t('--shadow-inner は衝突しない（v4 に shadow-inner は無く inset-shadow-* になった）', modifierCollision('--shadow-inner') === null)
t('--font-bold（ウェイト名を書体名に使う）は衝突', !!modifierCollision('--font-bold'))
t('--font-sans（既定の書体キー）は修飾語ではない', modifierCollision('--font-sans') === null)
t('--spacing-auto は m-auto と衝突', !!modifierCollision('--spacing-auto'))
t('--color-transparent は衝突、--color-primary は衝突しない', !!modifierCollision('--color-transparent') && modifierCollision('--color-primary') === null)
t('--radius-ne-s（接頭辞を挟んだ寄せ先）は衝突しない', modifierCollision('--radius-ne-s') === null)
{
  const found = findModifierCollisions(new Map([['--radius-s', '4px'], ['--radius-card', '8px'], ['--text-left', '12px']]))
  t('findModifierCollisions は衝突分だけ返す', found.length === 2 && found.every((c) => ['--radius-s', '--text-left'].includes(c.name)))
  t('寄せ先候補に「接頭辞を挟む」が出る', found[0].suggest.includes('接頭辞') && found[0].suggest.includes('--radius-app-s'))
}
t('判定表の語は各名前空間で重複していない',
  Object.values(MODIFIER_WORDS).every((w) => new Set(w).size === w.length))

// ---------------------------------------------------------------- 2. 診断と検査が同じ結論を出す（common.md §9.3）
console.log('\n# effective-scale.mjs / selfcheck.mjs — 角丸トークン名と辺指定ユーティリティの衝突（v0.4.0 の再発防止）')
{
  const repo = mkrepo({
    'styles/tokens.css': [
      '@theme {',
      '  --radius-s: 4px;',      // ← rounded-s（start 側だけ丸める）に取られる
      '  --radius-l: 12px;',     // ← rounded-l（left 側だけ丸める）に取られる
      '  --radius-card: 8px;',   // 意味ベース。問題なし
      '  --color-primary: #2563eb;',
      '}',
    ].join('\n') + '\n',
    'config/sd.config.js': 'export default {}\n',
    'components/common/Card.tsx': "export function Card() { return <div className=\"rounded-s rounded-card bg-primary\" /> }\n",
    'components/common/Card.stories.tsx': "export default { title: 'common/Card' }\nexport const 基本 = {}\nexport const 強調 = {}\n",
  })
  const diag = run('effective-scale.mjs', [repo])
  t('effective-scale が --radius-s を ERROR として報告する', /`--radius-s`\s*\|\s*ERROR/.test(diag.out), diag.out.slice(-600))
  t('effective-scale が --radius-l も報告する', /`--radius-l`\s*\|\s*ERROR/.test(diag.out))
  t('effective-scale は --radius-card を報告しない', !/`--radius-card`\s*\|\s*ERROR/.test(diag.out))
  t('effective-scale の報告に寄せ先「接頭辞を挟む」がある', diag.out.includes('接頭辞を挟む'))

  const check = run('selfcheck.mjs', [repo, '--all'])
  const rows = check.out.split('\n').filter((l) => l.includes('modifier-collision'))
  t('selfcheck が modifier-collision を ERROR で出す（終了コード 1）', check.code === 1 && rows.length === 2, check.out.slice(-800))
  t('selfcheck は --radius-s と --radius-l を指し、--radius-card は指さない',
    rows.some((l) => l.includes('--radius-s')) && rows.some((l) => l.includes('--radius-l')) && !rows.some((l) => l.includes('--radius-card')))
  t('selfcheck は tokens.css の行番号を示す', rows.some((l) => /tokens\.css:2/.test(l)) && rows.some((l) => /tokens\.css:3/.test(l)))
  t('class-exists は rounded-s を責めない（実在はする。捕まえるのは modifier-collision の役目）',
    !check.out.split('\n').some((l) => l.includes('class-exists') && l.includes('rounded-s')))
  fs.rmSync(repo, { recursive: true, force: true })
}
{
  // 衝突が無ければどちらも黙る
  const repo = mkrepo({
    'styles/tokens.css': '@theme {\n  --radius-app-s: 4px;\n  --radius-card: 8px;\n}\n',
    'config/sd.config.js': 'export default {}\n',
  })
  t('接頭辞を挟んだ名前は effective-scale が報告しない', !run('effective-scale.mjs', [repo]).out.includes('名前の衝突'))
  t('接頭辞を挟んだ名前は selfcheck が報告しない', !run('selfcheck.mjs', [repo, '--all']).out.includes('modifier-collision'))
  fs.rmSync(repo, { recursive: true, force: true })
}

// ---------------------------------------------------------------- 3. shadcn 由来のフォルダを決め打ちしない
console.log('\n# shadcn.mjs / selfcheck.mjs — shadcn 由来の層は components.json の aliases.ui から読む')
{
  const ui = resolveShadcnUiDir(mkrepo({}))
  t('components.json が無ければ既定 components/ui/', ui.source === 'default' && ui.dir === 'components/ui' && ui.isUi('src/components/ui/button.tsx') && !ui.isUi('src/components/common/Card.tsx'))
}
{
  const repo = mkrepo({
    'components.json': JSON.stringify({ aliases: { ui: '@/components/primitives', utils: '@/lib/utils' } }),
    'tsconfig.json': '{\n  // コメント付き\n  "compilerOptions": { "paths": { "@/*": ["./src/*"] }, },\n}\n',
    'src/components/primitives/.keep': '',
  })
  const ui = resolveShadcnUiDir(repo)
  t('aliases.ui を tsconfig の paths で解決する', ui.source === 'components.json' && ui.dir === 'src/components/primitives', JSON.stringify(ui))
  t('解決先だけを shadcn 由来と見なす', ui.isUi('src/components/primitives/button.tsx') && !ui.isUi('src/components/ui/button.tsx'))
  fs.rmSync(repo, { recursive: true, force: true })
}
{
  // Vite の雛形: paths は tsconfig.app.json にあり、tsconfig.json は references だけ
  const repo = mkrepo({
    'components.json': JSON.stringify({ aliases: { ui: '@/components/ui' } }),
    'tsconfig.json': JSON.stringify({ files: [], references: [{ path: './tsconfig.app.json' }] }),
    'tsconfig.app.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
    'src/components/ui/.keep': '',
  })
  const ui = resolveShadcnUiDir(repo)
  t('paths が tsconfig.app.json にあっても解決する', ui.dir === 'src/components/ui' && ui.isUi('src/components/ui/button.tsx'), JSON.stringify(ui))
  fs.rmSync(repo, { recursive: true, force: true })
}
{
  // baseUrl 起点の paths（"@/*": ["*"] + baseUrl: "src"）
  const repo = mkrepo({
    'components.json': JSON.stringify({ aliases: { ui: '@/components/ui' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: 'src', paths: { '@/*': ['*'] } } }),
    'src/components/ui/.keep': '',
  })
  const ui = resolveShadcnUiDir(repo)
  t('baseUrl を起点に解決する', ui.dir === 'src/components/ui' && ui.isUi('src/components/ui/button.tsx'), JSON.stringify(ui))
  fs.rmSync(repo, { recursive: true, force: true })
}
{
  // paths の解決先が実在しない（想定外の書き方）→ 後方一致に劣化させ、免除ゼロにしない
  const repo = mkrepo({
    'components.json': JSON.stringify({ aliases: { ui: '@/components/ui' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./nowhere/*'] } } }),
  })
  const ui = resolveShadcnUiDir(repo)
  t('解決先が実在しなければ alias の後方一致に劣化する', ui.dir === 'components/ui' && ui.isUi('src/components/ui/button.tsx'), JSON.stringify(ui))
  fs.rmSync(repo, { recursive: true, force: true })
}
{
  const repo = mkrepo({ 'components.json': JSON.stringify({ aliases: { ui: '~/components/shadcn' } }) })
  const ui = resolveShadcnUiDir(repo)
  t('tsconfig が無ければ alias の先頭を落として照合する', ui.dir === 'components/shadcn' && ui.isUi('app/components/shadcn/button.tsx'))
  fs.rmSync(repo, { recursive: true, force: true })
}
{
  // selfcheck が実際にその場所で arbitrary-value / boolean-prefix を免除し、既定の ui/ を免除しないこと
  const repo = mkrepo({
    'components.json': JSON.stringify({ aliases: { ui: '@/components/primitives' } }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
    'src/components/primitives/.keep': '',
    'src/styles/tokens.css': '@theme {\n  --color-primary: #2563eb;\n}\n',
    'config/sd.config.js': 'export default {}\n',
    'src/components/primitives/button.tsx': "type P = {\n  disabled?: boolean\n}\nexport function Button({ disabled }: P) { return <button className=\"rounded-[2px] bg-primary\" disabled={disabled} /> }\n",
    'src/components/primitives/button.stories.tsx': "export default { title: 'ui/Button' }\nexport const 基本 = {}\nexport const 無効 = {}\n",
    'src/components/ui/legacy.tsx': "export function Legacy() { return <div className=\"p-[13px]\" /> }\n",
    'src/components/ui/legacy.stories.tsx': "export default { title: 'ui/Legacy' }\nexport const 基本 = {}\nexport const 別 = {}\n",
    'src/components/widgets/Panel.tsx': "export default function Panel() { return <div className=\"bg-primary\" /> }\n",
    'src/components/widgets/Panel.stories.tsx': "export default { title: 'widgets/Panel' }\nexport const 基本 = {}\nexport const 別 = {}\n",
    'src/components/Toolbar.tsx': "export default function Toolbar() { return <div /> }\n",
    'src/components/Toolbar.stories.tsx': "export default { title: 'Toolbar' }\nexport const 基本 = {}\nexport const 別 = {}\n",
    'src/components/shared/Card/Card.tsx': "export default function Card() { return <div /> }\n",
    'src/components/shared/Card/Card.stories.tsx': "export default { title: 'shared/Card' }\nexport const 基本 = {}\nexport const 別 = {}\n",
    'src/components/primitives/Dialog.tsx': "export default function Dialog() { return <div /> }\n",
    'src/components/primitives/Dialog.stories.tsx': "export default { title: 'ui/Dialog' }\nexport const 基本 = {}\nexport const 別 = {}\n",
  })
  const out = run('selfcheck.mjs', [repo, '--all', '--src', 'src']).out
  const line = (id, file) => out.split('\n').some((l) => l.includes(`| ${id} |`) && l.includes(file))
  t('ヘッダに解決した shadcn 由来の層が出る', out.includes('src/components/primitives/') && out.includes('aliases.ui'))
  t('aliases.ui の層は arbitrary-value を免除される', !line('arbitrary-value', 'primitives/button.tsx'), out)
  t('aliases.ui の層は boolean-prefix を免除される', !line('boolean-prefix', 'primitives/button.tsx'))
  t('aliases.ui が別の場所を指すとき、従来の components/ui/ は免除されない', line('arbitrary-value', 'ui/legacy.tsx'), out)
  t('自作部品のフォルダ名は任意（widgets/ でも named-export を検査する）', line('named-export', 'widgets/Panel.tsx'), out)
  t('components/ 直下の PascalCase も named-export の対象', line('named-export', 'components/Toolbar.tsx'), out)
  t('深い階層（shared/Card/Card.tsx）も named-export の対象', line('named-export', 'shared/Card/Card.tsx'), out)
  t('shadcn 由来の層は PascalCase でも named-export を責めない', !line('named-export', 'primitives/Dialog.tsx'), out)
  fs.rmSync(repo, { recursive: true, force: true })
}

console.log(`\n${fail ? '❌' : '✅'} pass ${pass} / fail ${fail}`)
process.exit(fail ? 1 : 0)
