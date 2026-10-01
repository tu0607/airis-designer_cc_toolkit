/**
 * Tailwind のユーティリティ修飾語と衝突するトークン名の判定 — **import 専用モジュール**（CLI ではない）。
 *
 * effective-scale.mjs（生成前の診断）と selfcheck.mjs（生成後の検査）の共通基盤。
 * **判定表はここ 1 か所だけに置く**。片方だけ直すと「診断は OK、検査は ERROR」の食い違いが生まれる
 * （common.md §9.3 の方針。--spacing の 0.5 刻みと同じ扱い）。
 *
 * 何を捕まえるか（common.md §2「ユーティリティの修飾語と同名になる key」）:
 *   @theme に --radius-s: 4px を出すと Tailwind は rounded-s というクラスを生成するが、
 *   rounded-s は「start 側の 2 隅だけ丸める」辺指定ユーティリティとして予約されていて、両方が 1 つの
 *   ルールに合成される。結果、隅ごとに値が食い違う部品がビルド・tsc・class-exists（--radius-s は実在する）を
 *   すべて通って公開される。値の上書き（--spacing-4 が p-4 を 4px にする）とは別の穴で、名前が予約語と
 *   同じなのが原因。衝突の向きは 3 通りあり、どれも黙って起きる（Tailwind 4.3.3 の compile で実測）:
 *     - 予約側が勝ってトークンが無視される（shadow-none / bg-transparent）
 *     - トークンが既存ユーティリティを乗っ取る（w-full が 7px に / font-bold が太字でなく書体指定に）
 *     - 両方効く（text-left を書体に使うと左揃えも付く）
 *   v4 に無いユーティリティ（shadow-inner は inset-shadow-* に置き換わった）は衝突しないので表に入れない。
 *
 * rules/web-app-styling.md §2 の sd.config.js 雛形にある MODIFIER_WORDS はこの表の写し。
 * doccheck.mjs（I5）が両者の一致を検査する。
 */

/** 名前空間（@theme の接頭辞）→ ユーティリティ側で修飾語・キーワードとして予約されている key */
export const MODIFIER_WORDS = {
  // rounded-<辺>: 辺・角だけ丸める（s/e = 論理方向 start/end。ss/se/es/ee = 論理方向の角）
  '--radius-': ['s', 'e', 't', 'r', 'b', 'l', 'ss', 'se', 'es', 'ee', 'tl', 'tr', 'br', 'bl'],
  // text-align / text-wrap / text-overflow
  '--text-': ['left', 'center', 'right', 'justify', 'start', 'end', 'wrap', 'nowrap', 'balance', 'pretty', 'ellipsis', 'clip'],
  // shadow-none（v4 に shadow-inner は無い。inset-shadow-* になったので衝突しない）
  '--shadow-': ['none'],
  // font-<ウェイト名>（font-* は書体と太さを兼ねるので、太さの語を書体名に使うと font-bold が書体になる）
  '--font-': ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'],
  // m-auto / w-px / w-full / w-screen / w-min / w-max / w-fit
  '--spacing-': ['auto', 'px', 'full', 'screen', 'min', 'max', 'fit'],
  // max-w-none / max-w-full / max-w-min / max-w-max / max-w-fit / max-w-prose / max-w-screen
  '--container-': ['none', 'full', 'min', 'max', 'fit', 'prose', 'screen'],
  // bg-inherit / text-current / border-transparent
  '--color-': ['inherit', 'current', 'transparent'],
  // leading-none / blur-none
  '--leading-': ['none'],
  '--blur-': ['none'],
}

/** 名前空間 → 生成されるクラスの接頭辞（報告用） */
const UTIL = {
  '--radius-': 'rounded', '--text-': 'text', '--shadow-': 'shadow', '--font-': 'font',
  '--spacing-': 'p / m / w / h', '--container-': 'max-w', '--color-': 'bg / text / border',
  '--leading-': 'leading', '--blur-': 'blur',
}
/** 名前空間 → 何が起きるか（報告用。common.md §2 の表と同じ内容） */
const EFFECT = {
  '--radius-': '辺指定の rounded-<辺> と合成され、隅ごとに値が食い違う',
  '--text-': 'text-align / text-wrap / text-overflow が同時に効く（書体のつもりが揃えまで変わる）',
  '--shadow-': '予約側（影を消す）が勝ち、トークンは無視される',
  '--font-': 'font-<ウェイト> を乗っ取り、太字指定が書体指定に化ける',
  '--spacing-': 'w-full / m-auto 等の予約値を乗っ取り、全部品の寸法が変わる',
  '--container-': 'max-w-* の予約値を乗っ取る',
  '--color-': '予約側（transparent 等）が勝ち、トークンは無視される',
  '--leading-': 'leading-none（行間 1）を乗っ取る',
  '--blur-': 'blur-none（ぼかし無し）を乗っ取る',
}

/**
 * 1 つの @theme 変数名が修飾語と衝突するか。
 * @returns {{ns:string, key:string, util:string}|null}
 */
export function modifierCollision(name) {
  for (const [ns, words] of Object.entries(MODIFIER_WORDS)) {
    if (!name.startsWith(ns)) continue
    const key = name.slice(ns.length)
    if (words.includes(key)) return { ns, key, util: UTIL[ns], effect: EFFECT[ns] }
  }
  return null
}

/**
 * プロジェクト定義の @theme 変数から衝突を列挙する。
 * Tailwind 既定分は見ない（既定テーマにこの名前は無く、あっても利用者に直せない）。
 * @param {Map<string,string>} project readTheme().project
 * @returns {{name:string, ns:string, key:string, util:string, effect:string, cls:string, suggest:string}[]}
 */
export function findModifierCollisions(project) {
  const out = []
  for (const name of project.keys()) {
    const c = modifierCollision(name)
    if (!c) continue
    const head = c.util.split(' / ')[0]
    out.push({
      name, ...c,
      cls: `${head}-${c.key}`,
      // 寄せ先は「接頭辞を挟む」。値を変えるのではなく名前を空ける（意味ベースの名前にしてもよい）
      suggest: `接頭辞を挟む（例: ${c.ns}app-${c.key} → ${head}-app-${c.key}）か、意味ベースの名前にする`,
    })
  }
  return out
}

/** 変数が定義されているファイルと行を探す（報告の場所表示用。見つからなければ null） */
export function locateVar(readFile, sources, name) {
  for (const f of sources) {
    let text
    try { text = readFile(f) } catch { continue }
    const i = text.search(new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:`))
    if (i >= 0) return { file: f, line: text.slice(0, i).split('\n').length }
  }
  return null
}
