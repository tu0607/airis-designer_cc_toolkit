#!/usr/bin/env node
/**
 * デザインソースの命名検査（`components.json` を読む CLI）
 *
 * 使い方:
 *   node scripts/lint-naming.mjs [components.json のパス] [--strict]
 *   （既定は tokens/.meta/components.json。figma-plugin-airis.md §2 が「tokens/ に入れない」と定めているため）
 *
 * 部品が増えると目視では必ず見落とすので機械で判定する（rules/common.md §9.1）。
 * 検査するのは 4 つ:
 *   ① 部品名        … PascalCase・`/` で 2 階層まで
 *   ② バリアント軸名 … 1 語（CVA の variant キーになるため）
 *   ③ プロパティ名   … camelCase
 *   ④ 真偽値の接頭辞 … is（状態）/ has（要素の有無）。web-app.md §3.2
 *
 * 終了コード（**「違反がある」と「検査できていない」を区別する**）:
 *   0 … 検査できた（違反があっても既定では落とさない。直すのは Figma 側の人なので、
 *       落とすと無関係な PR まで全部赤くなって作業が止まる。rules/web-app-testing.md §6）
 *   1 … --strict 指定時に違反があった（既存違反を直し終えたらこちらへ切り替える）
 *   2 … **読み込めなかった**（ファイルが無い / JSON が壊れている）= 検査できていない。
 *       CI で `|| true` を付けるとこれも握りつぶし「緑のまま検査したことになる」ので付けない
 *
 * ビルドもテストもしない（JSON の読み取りだけ）。CLAUDE.md 原則 2 の対象外。
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_INPUT = path.join('tokens', '.meta', 'components.json')
const argv = process.argv.slice(2)
const strict = argv.includes('--strict')
const input = argv.find((a) => !a.startsWith('--')) ?? DEFAULT_INPUT

// 部品名の規則を適用しない例外（ブランドロゴ。表記はブランド側の資産なので直させない）
const EXCEPT = [/^logos?\//i, /^brand/i]

// 状態を表す語 → is。それ以外（要素の有無）→ has
const STATE_WORDS = new Set([
  'disabled', 'enabled', 'selected', 'checked', 'unchecked', 'indeterminate',
  'open', 'opened', 'closed', 'expanded', 'collapsed', 'active', 'inactive',
  'loading', 'busy', 'pending', 'focused', 'hovered', 'pressed', 'dragging',
  'readonly', 'required', 'optional', 'invalid', 'valid', 'error', 'success',
  'visible', 'hidden', 'current', 'default', 'editable', 'clickable', 'dirty',
])
// 「有無」を表す言い回し（先頭がこれなら要素の有無 = has）。
// 正規表現の \b では camelCase の境界（showBadge）を拾えず has+Show+Badge になるので、
// words() で分割した先頭の語で判定する（showBadge → hasBadge / with icon → hasIcon）
const EXISTENCE_WORDS = new Set(['show', 'shows', 'with', 'display', 'displays',
  'include', 'includes', 'use', 'uses', 'enable', 'enables'])

const findings = []
const add = (check, where, name, msg, fix) => findings.push({ check, where, name, msg, fix })

/** プラグインが付ける同名退避サフィックス / Figma のプロパティ id を落とす */
const stripId = (s) => s.replace(/\s*#[\w:.-]+$/, '').trim()

const isAscii = (s) => /^[\x20-\x7E]+$/.test(s)
const words = (s) => s.replace(/[_\-/]+/g, ' ').replace(/([a-z\d])([A-Z])/g, '$1 $2')
  .split(/\s+/).filter(Boolean)

const pascal = (s) => words(s).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('')
const camel = (s) => {
  const p = pascal(s)
  return p ? p[0].toLowerCase() + p.slice(1) : ''
}

const isPascal = (s) => /^[A-Z][A-Za-z\d]*$/.test(s)
const isCamel = (s) => /^[a-z][A-Za-z\d]*$/.test(s)
const isOneWord = (s) => /^[A-Za-z][A-Za-z\d]*$/.test(s)

/** 真偽値プロパティのあるべき名前。判定できなければ null */
function boolName(raw) {
  const w = words(raw).map((x) => x.toLowerCase())
  if (!w.length) return null
  if (/^(?:is|has|can|should)$/.test(w[0])) {
    // 接頭辞は付いている。残りを整えるだけ
    return w[0] + pascal(w.slice(1).join(' '))
  }
  const existence = EXISTENCE_WORDS.has(w[0])
  const core = existence ? w.slice(1) : w
  if (!core.length) return null
  const prefix = !existence && STATE_WORDS.has(core[core.length - 1]) ? 'is' : 'has'
  return prefix + pascal(core.join(' '))
}

/** 候補が規則を満たすときだけ提案を返す。満たせないなら理由を返す */
function suggest(candidate, ok, reason) {
  return candidate && ok(candidate) ? `→ ${candidate}` : reason
}

// ---------------------------------------------------------------- 読み込み
if (!fs.existsSync(input)) {
  console.error(`components.json が見つかりません: ${input}`)
  console.error('使い方: node scripts/lint-naming.mjs [components.json のパス]')
  process.exit(2)
}
let doc
try {
  doc = JSON.parse(fs.readFileSync(input, 'utf8'))
} catch (e) {
  console.error(`JSON として読めません: ${input}\n${e.message}`)
  process.exit(2)
}

// ---------------------------------------------------------------- 検査
for (const [rawName, comp] of Object.entries(doc)) {
  if (!comp || typeof comp !== 'object') continue
  const name = stripId(rawName)
  if (EXCEPT.some((re) => re.test(name))) continue

  // ① 部品名: PascalCase・2 階層まで
  const segs = name.split('/')
  if (segs.length > 2) {
    add('component-name', rawName, name, `階層が ${segs.length} 段ある`, '階層は 2 つまでです（`親/子`）')
  } else if (!segs.every(isPascal)) {
    if (!isAscii(name)) {
      add('component-name', rawName, name, 'PascalCase でない', '英語名を付けてください')
    } else {
      const cand = segs.map(pascal).join('/')
      add('component-name', rawName, name, 'PascalCase でない',
          suggest(cand, (c) => c.split('/').every(isPascal), '英語の単語に分けられる名前を付けてください'))
    }
  }

  // ②③④ プロパティ
  for (const [rawProp, def] of Object.entries(comp.properties ?? {})) {
    const prop = stripId(rawProp)
    const type = def?.type
    const where = `${name} / ${rawProp}`

    if (type === 'VARIANT') {
      // ② バリアント軸名は CVA の variant キーになるので 1 語に収める
      if (!isOneWord(prop)) {
        if (!isAscii(prop)) {
          add('variant-axis', where, prop, '軸名が 1 語でない', '英語 1 語の軸名を付けてください')
        } else {
          const cand = camel(prop)
          add('variant-axis', where, prop, '軸名が 1 語でない',
              suggest(cand, isOneWord, '英語 1 語の軸名を付けてください'))
        }
      }
      continue
    }

    if (type === 'BOOLEAN') {
      // ④ is / has（can / should も許容）
      if (!/^(?:is|has|can|should)[A-Z\d]/.test(prop) || !isCamel(prop)) {
        if (!isAscii(prop)) {
          add('bool-prefix', where, prop, 'is / has で始まる camelCase でない', '英語名を付けてください')
        } else {
          const cand = boolName(prop)
          add('bool-prefix', where, prop, 'is / has で始まる camelCase でない',
              suggest(cand, (c) => isCamel(c) && /^(?:is|has|can|should)[A-Z\d]/.test(c),
                      '状態なら is、要素の有無なら has で始めてください'))
        }
      }
      continue
    }

    // ③ それ以外（TEXT / INSTANCE_SWAP）は camelCase
    if (!isCamel(prop)) {
      if (!isAscii(prop)) {
        add('prop-name', where, prop, 'camelCase でない', '英語名を付けてください')
      } else {
        const cand = camel(prop)
        add('prop-name', where, prop, 'camelCase でない',
            suggest(cand, isCamel, '英語の単語に分けられる名前を付けてください'))
      }
    }
  }
}

// ---------------------------------------------------------------- 出力
const total = Object.keys(doc).length
console.log(`# 命名検査\n`)
console.log(`- 対象: ${path.resolve(input)}`)
console.log(`- 部品 ${total} 件\n`)

if (!findings.length) {
  console.log('✓ 指摘なし\n')
} else {
  console.log(`## 違反: ${findings.length} 件\n`)
  console.log('| 検査 | 場所 | 現在名 | 内容 | どうするか |')
  console.log('| --- | --- | --- | --- | --- |')
  for (const f of findings)
    console.log(`| ${f.check} | \`${f.where}\` | \`${f.name}\` | ${f.msg} | ${f.fix} |`)
  console.log('')
}
console.log('**綴り間違い**（軸名の `Siza`、値の `Learge` 等）は機械判定できません。**ここだけ目視で確認**してください。')
console.log('修正はデザインソース側で行います（`CLAUDE.md` ステップ 7 の A/B で操作者が判断）。')

// ---------------------------------------------------------------- CI への通知
// デザイナーは Actions のログを読まない（原則 1）。**落とさずに読まれる場所へ出す**
// （rules/web-app-testing.md §6）。① PR の画面に注釈 ② ジョブのサマリに表。
if (process.env.GITHUB_ACTIONS === 'true' && findings.length) {
  // GitHub の注釈はリポジトリ相対パスでしか行に紐付かない。
  // cwd の外（`..` で始まる）なら紐付けられないので、渡された文字列をそのまま使う
  const r = path.relative(process.cwd(), path.resolve(input))
  const rel = !r || r.startsWith('..') ? input : r
  for (const f of findings) {
    // 改行を含むと注釈が途切れるので 1 行に畳む
    const msg = `${f.msg}  ${f.fix}`.replace(/\s*\n\s*/g, ' ')
    console.log(`::warning file=${rel},title=命名規則 (${f.where})::${msg}`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '### デザインソースの命名規則の違反',
      '',
      `${findings.length} 件 / ${total} 部品。**直すのは Figma 側です**（コードの問題ではありません）。`,
      '',
      '| 部品 | 何が違反か | どう直すか |',
      '| --- | --- | --- |',
      ...findings.map((f) => `| \`${f.where}\` | ${f.msg} | ${f.fix.replace(/^→ /, '')} |`),
      '',
    ].join('\n'))
  }
}

// 違反では落とさない（--strict のときだけ落とす）。読み込み失敗の 2 とは意味が違う
process.exit(strict && findings.length ? 1 : 0)
