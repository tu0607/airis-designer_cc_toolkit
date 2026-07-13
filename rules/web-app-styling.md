# Web アプリ スタイリングルール — Tailwind v4 + CVA + shadcn/ui

`web-app.md` の一部。**トークンをクラスに変える工程**（Style Dictionary の設定・クラスの選び方・`cn()` の拡張）を定めます。
実装規約の本体は `web-app.md`、生成後の検査は `web-app-selfcheck.md`。

## 1. 変換パイプライン（トークン → `styles/tokens.css`）

- トークンの正本 `tokens/`（`core/` + `product/<プロダクト名>/mode/`、`common.md` §2）から、**Style Dictionary で `styles/tokens.css`（`@theme` の CSS 変数）を生成**する。
  - 実行: `npx style-dictionary build --config config/sd.config.js`。結合順は **`core` → `mode/default` → 有効モード（後勝ち・逆流禁止）**。**Tailwind v4 は `@theme` の変数からユーティリティクラスを自動生成**する（`--color-primary` → `bg-primary`）。
  - `tokens.css` は生成物であり**手編集しない**。値を変えたいときは正本 JSON を直して再ビルドする。
  - ローカルで実行するのは **`styles/tokens.css` を PR に含めるため**であり、テストの代わりではない（`CLAUDE.md` 前提の原則 2）。

## 2. `config/sd.config.js` の雛形（style-dictionary v5 / ESM）

**この設定を間違えると CI が「緑のまま何も当たらない」状態になる**ので、雛形から外れないこと。特に:
**`:root` ではなく `@theme` で囲む**（`:root` だと `bg-primary` 等のユーティリティが生成されない）／**結合順を `source` の配列順で表す**（後勝ち）。

```js
// config/sd.config.js — デザイントークン（DTCG JSON）→ Tailwind v4 の @theme
// 結合順は core → product/<名前>/mode/default → 有効モード（後勝ち・逆流禁止。common.md §2）
import StyleDictionary from 'style-dictionary'

const PRODUCT = process.env.PRODUCT ?? '<プロダクト名>' // config の tokens.product に置換する
const MODES = (process.env.MODES ?? '').split(',').map((m) => m.trim()).filter(Boolean)

// ★ Tailwind v4 は @theme の変数からユーティリティを自動生成する。
//   :root で出すと変数は定義されるがクラスが生えないので、必ず @theme で囲む。
// ★ Tailwind の既定スケールを壊す名前を出さないためのガード（common.md §2「予約名前空間」）。
//   Figma のトークン名は px 値そのものになりがち（Spacing/4 = 4px）で、素直に出すと
//   --spacing-4: 4px が既定の p-4（16px）を 4px に上書きする。ビルドも CI も通り、
//   画面全体の余白が静かに 1/4 になる。**除外して Tailwind 標準スケールに乗せる。**
//   衝突するのは「既定キーと同名になる名前」= 数値の段（4 / 16）と素の段名（xs sm base md lg xl 2xl…）。
//   意味ベースの名前（--color-primary / --radius-card / --text-heading-lg）は衝突しないので出す。
const RESERVED_KEY = String.raw`\d+(\.\d+)?|xs|sm|base|md|lg|\d?xl|none|full`
const RESERVED = new RegExp(`^--(spacing|text|radius|shadow|breakpoint|container|font)(-(${RESERVED_KEY})$|$)`)

StyleDictionary.registerFormat({
  name: 'tailwind/theme',
  format: ({ dictionary, file }) => {
    // プラグインが解決できなかった参照は "@VariableID:1:2" として温存される
    // （figma-plugin-airis.md §3 の unresolvedAliases）。長さでも色でもないので CSS に出さず、
    // 件数を最後にまとめて報告する（Tailwind はエラーを出さないので、出すと黙って壊れる）。
    const unresolved = []
    const reserved = []
    const body = []
    for (const t of dictionary.allTokens) {
      const value = t.$value ?? t.value
      if (typeof value === 'string' && value.startsWith('@')) { unresolved.push(t.name); continue }
      if (RESERVED.test(`--${t.name}`)) { reserved.push(t.name); continue }
      body.push(`  --${t.name}: ${value};`)
    }
    if (unresolved.length)
      console.warn(`⚠️ 未解決の参照 ${unresolved.length} 件を CSS に出していません: ${unresolved.join(', ')}`)
    if (reserved.length)
      console.warn(`⚠️ Tailwind 既定と衝突する ${reserved.length} 件を出していません（標準スケールを使う）: ${reserved.join(', ')}`)
    return `/* ${file.destination} — 生成物。手編集しない（正本は tokens/） */\n@theme {\n${body.join('\n')}\n}\n`
  },
})

export default {
  // 配列の順序が結合順そのもの。逆流させない
  source: [
    'tokens/core/**/*.json',
    `tokens/product/${PRODUCT}/mode/default/**/*.json`,
    ...MODES.map((m) => `tokens/product/${PRODUCT}/mode/${m}/**/*.json`),
  ],
  platforms: {
    web: {
      transformGroup: 'css', // 参照 {color.brand.blue} を解決し、値を実体化する
      buildPath: 'styles/',  // 配置先が src/ の案件では 'src/styles/' に置換する（`web-app.md` §2）
      files: [{ destination: 'tokens.css', format: 'tailwind/theme' }],
    },
  },
}
```

- **前提**: 移植先の `package.json` に `"type": "module"` があること（無ければファイル名を `sd.config.mjs` にして CI 側のパスも合わせる）。
- **予約名前空間のガード（`RESERVED`）を消さない**（何が起きるかと対象名前空間は `common.md` §2 が正）。除外した分は逆引き表に `Spacing/16 → p-4` の形で残す。
  - **意図的に既定を上書きしたい場合**（プロダクトの刻みを変える等）は `RESERVED` から外すのではなく、**デザイナーと合意した旨を PR 本文に書いてから**該当トークンだけを例外にする。
- **未解決の参照は CSS に出さず、件数を警告する**（上の `format` 内のガード）。`figma-plugin-airis.md` §3 は `unresolvedAliases` を「止める」区分にしているが、**プラグインは解決できなかった参照を `$value: "@VariableID:1:2"` として温存する**ので、素通しすると `--color-x: @VariableID:1:2;` という不正な値が CSS に出る。**「無言で壊れない」をここでも維持する。**
- **エントリ CSS への取り込みは 1 行のマージ提案として出す**（生成物に `@import "tailwindcss"` を含めない。既存のエントリと二重 import になるため）:
  ```css
  /* 例: src/index.css */
  @import "tailwindcss";
  @import "./styles/tokens.css";  /* ← この 1 行を追加してもらう */
  ```
- **モードの有効化は環境変数**（`MODES=dark npx style-dictionary build --config config/sd.config.js`）。`mode/dark/` を作るまでは指定不要で、`default` だけが流れるのが正常形。
- **Core の素値も `@theme` に出る**ので `bg-brand-blue` のようなクラスも生成可能になるが、**生成コードでは意味ベースのトークンだけを使う**（`common.md` §2）。素値を出したくない場合は `filter` を足すが、Core にある意味的トークン（`radius.md` 等）まで落とさないよう注意する。

## 2.1 `tokens.ts` も出す（**トークン一覧ギャラリー専用**）

Tailwind v4 では部品がクラス名でトークンを参照するので、値を JS から読む必要は普段ない。
しかしそれだけだと **「今どの名前でどの値が出ているか」をデザイナーが確認する場所が無くなる**。そこで Style Dictionary から 2 つ出す:

- `styles/tokens.css` … スタイルの実体（`@theme`）
- `tokens.ts` … **ギャラリー専用**。**部品からは import しない**（スタイルはクラス名で当てる。ここから値を読み始めると Tailwind を通さない経路ができる）

**命名ロジックは 1 つの関数に集約する。** 2 か所に書くと「CSS には出ているのにギャラリーに出ない」食い違いが静かに生まれる（除外規則 `RESERVED` も両方に効かせる）:

```js
// 両フォーマットが同じ関数を通る（片方だけ直すと必ずずれる）
const resolveToken = (token) => ({
  css: [[varName, value]],
  ts:  [{ kind, name, cssVar, value }],
})
```

**型は kind ごとに分配する。** 1 メンバーへ畳むと絞り込みが全滅する:

```ts
// ❌ { kind: Exclude<Kind,'typography'>; … } … Extract<Token, {kind:'color'}> が never になる
export type DesignToken = {
  [K in TokenKind]: {
    kind: K; name: string; cssVar: string
    value: K extends 'typography' ? TypographyValue : string
  }
}[TokenKind]
```

**ギャラリーのストーリーの書き方は `web-app-storybook.md` §1**（a11y で落ちない作りにする必要がある）。

## 3. クラスの書き方

- 生成コードは**トークン由来のセマンティックなクラス**を使う（`bg-primary`。`bg-blue-500` のような生パレット参照は書かない）。クラス名は `common.md` §2 の**逆引き表**から決める（Figma の生の値をそのまま書かない）。
- **クラス列はコンポーネント内部（shadcn/ui 部品・CVA 宣言）に隠蔽**し、アプリケーションコード（features / pages）はクリーンに保つ。variant を持つ自作部品は CVA でクラス列をスタイル宣言に隔離する。クラス文字列の三項演算子分岐は書かない。
- `w-[437px]` / `bg-[#1a73e8]` / `p-[13px]` のような **arbitrary value は書かない**。逆引き表に無い値・**Tailwind のスケールに乗らない値**は、勝手に丸めたりトークン名を付けたりせず、**`common.md` §9.3 の診断で操作者に判断させる**。
- **スケールの正は「使っている Tailwind の既定テーマ + プロジェクトの `@theme`」**。数値を暗記せず、`node scripts/effective-scale.mjs <作業ツリー>` で**実測**する（`common.md` §9.3）。余白・間隔は `--spacing` の **0.5 刻み**、角丸・文字サイズ・行間などは**離散スケール**という性質の違いに注意する。
- レイアウトは Flexbox / Grid ユーティリティで（Auto Layout → `flex` + `gap-*` + `p-*`）。レスポンシブは `sm: md: lg:` で表現する。
- shadcn/ui 導入部品のスタイル調整も**トークン経由**で行う（部品内のクラスを直接生値で書き換えない）。

## 4. shadcn/ui の色名を橋渡しする（**shadcn/ui を導入する案件では必須**）

shadcn/ui の部品は `bg-background` / `text-foreground` / `border-input` / `ring-ring` / `bg-muted` / `text-destructive` といった**独自の意味名**を前提にする。プロジェクトのトークン名（`surface` / `content` / `blue` …）と違うと、**Tailwind は何も出力せずエラーも出さない**ため、**スタイルが当たっていない部品カタログが緑のまま公開される**（`class-exists` が `shadcn add` 直後にほぼ全滅するのはこれ）。

`styles/shadcn-bridge.css` を作って橋渡しする。**このファイルは手編集してよい**（`tokens.css` と違い生成物ではない）。**値は必ずプロジェクトのトークンを参照し、ここで新しい色を作らない**:

```css
/* styles/shadcn-bridge.css — shadcn/ui の色名 → プロジェクトのトークン
   新しい色は作らない。すべて var(--color-*) でトークンを指す */
@theme {
  --color-background: var(--color-surface-base);
  --color-foreground: var(--color-content-primary);
  --color-primary: var(--color-blue-500);
  --color-primary-foreground: var(--color-gray-0);
  --color-muted: var(--color-neutral-50);
  --color-muted-foreground: var(--color-content-secondary);
  --color-destructive: var(--color-status-error);
  --color-border: var(--color-border-primary);
  --color-input: var(--color-border-primary);
  --color-ring: var(--color-blue-500);
}

/* ★ 名前空間（--color-* / --radius-* 等）に属さない変数は @theme に書くと
   Tailwind が黙って落とすので :root に置く。shadcn/ui の --radius がこれに当たる */
:root {
  --radius: var(--radius-md);
}
```

- **必要な色名の全量は `shadcn` の初期化が置く CSS に載っている**（上は代表例）。導入した部品が使っている名前を `class-exists` の結果から拾って埋める。
- **`@theme` に書けるのは Tailwind の名前空間に属する変数だけ**（`--color-*` / `--radius-*` / `--text-*` …）。**それ以外は `@theme` に書いても出力されない**（v4 で確認済み。エラーも出ないので気付けない）。`--radius` のような素の変数は `:root` に置く。
- **エントリ CSS では `tokens.css` の後に import する**（後勝ちで上書きするため）:
  ```css
  @import "tailwindcss";
  @import "./styles/tokens.css";
  @import "./styles/shadcn-bridge.css";  /* ← tokens.css の後 */
  ```
- **対応が妥当かはデザイナーの判断事項。** 生成時に「shadcn の名前 → 当てたトークン」の一覧を報告し、合わないものは差し替えてもらう（`CLAUDE.md` ステップ 7 の A/B/C と同じ扱い）。

## 5. `cn()` を書体トークンに対応させる（**独自の書体トークンを使うなら必須**）

**「Tailwind v4 + 独自の書体トークン + shadcn/ui の `cn()`」の組み合わせでは、文字色が黙って消える。**
プロジェクト固有の事故ではなく、この 3 つが揃えば**必ず起きる**ので、`cn()` を持つ案件では最初に対処する。

何が起きるか:

- shadcn/ui の `cn()` は `twMerge(clsx(...))`。**tailwind-merge は Tailwind の既定スケールしか知らない**（v4 には JS の設定ファイルが無いので `@theme` を読めない）。
- そのため `text-<書体トークン>` のような**知らない `text-*`** を「文字サイズ」ではなく**「文字色」と推測**する。
- 結果、`cn('text-content-primary', 'text-heading-lg')` は**同じグループの衝突**とみなされ、**後勝ちで文字色が捨てられる**（全部品の文字が既定色になる）。

**誰も気付けない**のが厄介な点で、`class-exists`（`web-app-selfcheck.md`）と同じ性質の穴になる:

| 検査 | 結果 | 理由 |
| --- | --- | --- |
| Tailwind のビルド | 通る | クラス自体は `@theme` に実在するので正しく出力される |
| `tsc` / ESLint / Prettier | 通る | ただの文字列結合 |
| セルフチェックの `class-exists` | 通る | クラス名は実在する（**消えるのは実行時**） |
| Storybook の a11y（コントラスト） | **ここだけ落ちる** | 文字色が消えた結果、コントラスト比が基準を割る |
| VRT | 導入初期は素通り | 昇格前は撮影対象がゼロ（`web-app-testing.md` §4） |

対処 — **`lib/utils.ts` の `cn()` を拡張する**（`extendTailwindMerge` で `--text-*` を font-size 側だと教える）:

```ts
// lib/utils.ts — shadcn/ui の cn() を、プロジェクトの書体トークンに対応させる
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// @theme の --text-* は「文字サイズ（書体）」であると tailwind-merge に教える。
// これが無いと text-<書体トークン> が「文字色」と誤判定され、
// 併記した text-<色トークン> が黙って捨てられる（= 文字が全部既定色になる）。
const TYPOGRAPHY = ['heading-lg', 'body-md', 'caption-sm'] // ← @theme の --text-* から列挙する

const twMerge = extendTailwindMerge({
  extend: { classGroups: { 'font-size': [{ text: TYPOGRAPHY }] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- **`TYPOGRAPHY` は `@theme` の `--text-*` から機械的に写す**（`CLAUDE.md` ステップ 6 の逆引き表と同じ供給源）。トークンが増えたらここも足す。
  - 書体トークンの命名に一定の接頭辞があるなら、列挙の代わりに判定関数も置ける（`[{ text: [(v: string) => v.startsWith('<接頭辞>')] }]`）。
- **`extend` は既定のグループに追記する**（`override` にしない。`text-sm` 等の既定スケールを消してしまう）。
- **同じ事故は `text-` 以外でも起きる**。1 つの接頭辞が複数の役割を持つもの（`font-` = 書体 / 太さ、`shadow-` = 影 / 色）に既定スケール外の名前を足したら、同じ要領でそのグループにも登録する。
- **移植先に既存の `lib/utils.ts` がある場合は無断で書き換えず、この差分をマージ提案として出す**（`web-app.md` §2）。
- セルフチェックの **`cn-twmerge`**（`web-app-selfcheck.md` §2）がこの未対応を ERROR で検出する。
