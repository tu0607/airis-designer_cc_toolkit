# Web アプリ 生成後のセルフチェック（`scripts/selfcheck.mjs`）

`web-app.md` の一部。**生成物が自分のルールに従えているかの静的検査**を定めます。検査対象の規約本体は `web-app.md` と各分割ファイル。

## 1. 使い方

**生成の前には診断（`common.md` §9）があるのに、生成の後には何も無かった** — 自分のルールに従えているかを誰も確認していない状態が実装ミスの主な流入口だったので、**Push 前に静的検査を通す**（`CLAUDE.md` ステップ 10-1）。

```bash
node scripts/selfcheck.mjs <作業ツリー> [--src <配置先>] --tsc
```

- **ビルドもテスト実行もしない**（`--tsc` は型検査のみで成果物を出さない）。数秒で終わるので `CLAUDE.md` 原則 2 の例外として実行してよい。
- 既定では **今回生成/変更したファイルだけ**を検査する（`git status` ベース）。移植先の既存コードの違反を拾うとノイズになるため。全体を見たいときは `--all`。
- **配置先が `src/` の案件は `--src src` を渡す**（`styles/tokens.css` の探索先が変わる）。

## 2. 検査項目

| ID | レベル | 何を捕まえるか | 根拠 |
| --- | --- | --- | --- |
| `story-missing` | ERROR | `components/` `features/` の `.tsx` に対応する `.stories.tsx` が無い（**無いとテストも無いので CI は緑のまま**）。**画面（`pages/`）・`hooks/`・`index` / `types` / `constants` は対象外** | `web-app-storybook.md` §1 |
| `e2e-missing` | ERROR | 画面を生成したのに `tests/e2e/*.spec.ts` が無い | `web-app-testing.md` §3 |
| `tokens-css` | ERROR | `styles/tokens.css` が無い / 空 / **`:root` になっている**（`@theme` でないとユーティリティが生成されない） | `web-app-styling.md` §1・§2 |
| `sd-config` | ERROR | `config/sd.config.js`（`.mjs` でも可）が無い（CI 4 本が参照する） | `web-app-styling.md` §2 |
| `workflow-path` | ERROR | ワークフローが参照するパスが実在しない（**配置先を `src/` にした案件でずれる**） | `web-app.md` §2・`web-app-ci.md` §1 |
| `class-exists` | ERROR | **クラス名が `@theme` に実在しない**（`text-muted` だがトークンは `--color-text-muted`）。**Tailwind は何も出力せずエラーも出さない**ので tsc / ESLint / play / a11y のどれも捕まえられず、導入初期は VRT 対象もゼロ。**誰も気付かない最大の穴** | `web-app-styling.md` §3 |
| `cn-twmerge` | ERROR | 独自の書体トークン（`--text-*`）があるのに **`cn()` が素の `twMerge` のまま**。`text-<書体>` が文字色と誤判定され、**併記した文字色が実行時に黙って消える**。ビルド・`tsc`・ESLint・`class-exists` はすべて通り、**気付けるのは a11y のコントラスト検査だけ** | `web-app-styling.md` §5 |
| `arbitrary-value` | ERROR | `p-[13px]` のような arbitrary value（`data-[state=open]:` のような**バリアント修飾は除外**。`components/ui/` は対象外※） | `web-app-styling.md` §3・`web-app.md` §7 |
| `raw-palette` | ERROR | `bg-blue-500` のような生パレット参照（**プロジェクトが `@theme` で再定義した色名は除外**する） | `web-app-styling.md` §3・`web-app.md` §7 |
| `class-component` | ERROR | クラスコンポーネント | `web-app.md` §3.5・§7 |
| `classname-ternary` | ERROR | `className={cond ? 'a' : 'b'}`（`components/ui/` と CVA のバリアント選択は対象外※） | `web-app-styling.md` §3・`web-app.md` §7 |
| `runtime-css-in-js` | ERROR | styled-components / emotion の import | `web-app.md` §7 |
| `vrt-tag` | ERROR | 生成時に `tags: ['vrt']` を付けている（対象は `*.stories.tsx` のみ※） | `web-app-testing.md` §4 |
| `boolean-prefix` | ERROR | 自作部品の boolean props に `is` 接頭辞が無い（`components/ui/` とストーリーは対象外※） | `web-app.md` §3.2 |
| `named-export` | ERROR | `components/common/` が default export | `web-app.md` §3.1 |
| `story-title` | ERROR | ストーリーの `meta` に `title` が無い | `web-app-storybook.md` §1 |
| `tsc` | ERROR | 型エラー・import 漏れ・存在しない props への参照 | — |
| `explicit-any` | WARN | 明示的な `any` | `web-app.md` §3.2 |
| `useeffect-fetch` | WARN | `useEffect` と `fetch`/`axios` が同一ファイルにある | `web-app.md` §4・§7 |
| `story-variants` | WARN | ストーリーが 2 件未満（バリアントが列挙されていない） | `web-app-storybook.md` §1 |
| `story-play` | WARN | play 関数が無い（**省略が正当なケースがある**ので ERROR にしない） | `web-app-storybook.md` §1 |
| `scope` | WARN | `git status` が取れず全ファイルを検査した（対象リポジトリのルートを指していない疑い） | — |

※ = 下の**検査範囲の絞り込み**を参照。

## 3. 扱い方

**ERROR / WARN の扱いとスキップ時の報告は `CLAUDE.md` ステップ 10-1 が正**（要点: ERROR は 0 になるまで直す / WARN は勝手に直さず報告する / スキップされたら「未実施」と報告する）。

- **`class-exists` の判定方法**（数値をハードコードしない）:
  - 照合するクラスは `className` / `class` 属性と `cn()` / `cva()` / `clsx()` / `twMerge()` の引数から集める。**範囲は括弧の対応で決める**（行頭の `)` を終端にすると 1 行で閉じた `cn()` が後続の JSX まで飲み込み、`style` や `data-*` の値をクラスと誤認する）
  - **トークン名前空間**（`bg-` `text-` `rounded-` `shadow-` `font-` `leading-` `tracking-` `blur-` `max-w-` 等）→ サフィックスを実効 `@theme` と照合し、無ければ ERROR
    - **「もしかして」が出るのは打ち間違い程度に近いときだけ**（編集距離が 3 かサフィックス長の半分まで）。**名前の付け方そのものが違う場合は候補が出ない** — 上の `text-muted` → `--color-text-muted` がその例で、「トークン名を確認する。無ければ診断に回す」に落ちる。**候補が空なのは「実在する」ではない。**
  - **スペーシング系**（`p-` `gap-` `w-` 等）→ **`--spacing` の 0.5 刻みに乗るか**。Tailwind は `calc(var(--spacing) * <数値>)` を作るので小数の刻みも成立し、**既定スケール自体が 0.5 刻み**（`p-0.5` = 2px / `p-1.5` = 6px）を使う。「整数倍か」で見ると shadcn/ui の `py-0.5` / `size-2.5` を誤って責める。0.5 より細かい `p-3.25`（13px）は ERROR
  - **静的ユーティリティ**（`flex` `items-center`）と**自由形式の名前空間**（`bg-linear-to-r` `ring-offset-2`）→ 判定しない（知らないユーティリティを誤って責めない）
  - `hover:` `md:` などの variant、`!`、`/50` の不透明度は落として照合する。**方向語**（`border-b` / `rounded-t-lg`）は外して評価し、**`(--変数)` の CSS 変数参照**（`min-w-(--radix-popper-anchor-width)`）は判定しない
  - **`@theme` が取得できなければ WARN でスキップ**し「照合は未実施」と報告する（`npm ci` 前など）
- **※ 検査範囲の絞り込み**（範囲を狭めるだけで、検査は無効化していない）:
  - **`components/ui/` は `arbitrary-value` / `classname-ternary` / `boolean-prefix` の対象外**（`boolean-prefix` はストーリーも）。この層は shadcn/ui からの導入・派生で、`rounded-[2px]` / `translate-y-[calc(…)]` / `orientation === 'horizontal' ? '-ml-4' : '-mt-4'` は**上流のコードそのもの**。改名しないのと同じ理由（`web-app.md` §3.1・同ファイルの生成直前チェックリスト 1）で内部実装も変えない — 変えると本物の API からずれ、以後の `shadcn add` も当たらなくなる。
    **トレードオフ**: **自分で `components/ui/` に arbitrary value を足しても検査されない。** 検査されないことは許可ではなく、**逆引き表に無い値を書かないのは `web-app.md` §7 のまま**。値の調整はトークン側か `components/common/` のラッパーで行う
  - **`classname-ternary` は CVA のバリアント選択を除外する。** `buttonVariants({ variant: isActive ? 'outline' : 'ghost' })` は**クラス列を CVA に隔離できている**正しい形で、禁止対象は `cn(cond ? 'bg-primary p-4' : 'bg-muted p-2')` のような**クラス文字列自体の分岐**。`variant` / `size` / `intent` / `tone` / `color` / `align` / `orientation` / `state` のキーに続く三項は前者と判定する
  - **`vrt-tag` の対象は `*.stories.tsx` のみ。** `tests/vrt/storybook.spec.ts` は「`vrt` タグの付いたストーリーを絞り込んで撮る」側（`web-app-testing.md` §4 の雛形）なので、タグ名が出てくるのは正しい。禁じたいのは**ストーリー側が生成時に付けること**だけ
- **`cn-twmerge` の判定方法**: `@theme` に**プロジェクトが定義した `--text-*`**（既定スケール `xs`〜`9xl` 以外の名前 = 独自の書体トークン）があり、かつ `tailwind-merge` を import しているファイルに `extendTailwindMerge` / `createTailwindMerge` が無ければ ERROR。**移植先の既存 `lib/utils.ts` も対象**（`cn()` は shadcn の初期化が置くファイルで、今回の差分に入らないことが多い）。`@theme` を取得できなければ判定しない。
- **ここで検査できないものは CI の役目**（play / a11y / E2E / VRT）。セルフチェックはそれらの代わりではなく、**CI が赤くなる前に潰せるもの**と**CI では沈黙するもの**を拾う層。
