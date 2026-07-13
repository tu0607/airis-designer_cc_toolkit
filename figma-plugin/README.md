# Airis Design Tokens Export（Figma プラグイン）

Figma Variables を W3C DTCG 形式のデザイントークンとして書き出す社内プラグイン。**Airis に同梱**。

**このファイルはプラグインの仕様だけを書く。** 出した bundle を Airis がどう使うか（`tokens/` への展開・診断への流用）は
[`../rules/figma-plugin-airis.md`](../rules/figma-plugin-airis.md)、その先のコミット・PR は `../CLAUDE.md` が正。

## 役割

- Figma Variables を **Plugin API で全量取得**（Professional プランで動作。REST API 不要）
- **Styles も取得**：Typography（テキストスタイル）/ Elevation（エフェクトスタイル）/ Paint / Grid。
  これらは Variables ではないため `getLocalVariablesAsync()` では取れない。専用 API で読み `core.json` へマージする
- **Components も仕様 JSON 化**：ComponentSet のバリアント軸と、各バリアント/レイヤーが束縛する
  トークン・適用スタイルを `components.json` へ。**既定で全 ComponentSet/Component を書き出す**
  （`COMPONENT_ALLOWLIST` 空＝全件／`COMPONENT_DENYLIST` に部分一致で除外指定。どちらも名前の部分一致）
- **レイアウトの事実も書き出す**：Auto Layout の方向・間隔・余白の実数値、固定/内容依存のサイズ、
  絶対配置、レイヤー名、テキストの書式を `variants[].layout` へ。
  **プラグインは事実だけを出し、「違反かどうか」の判定はしない**（判定は下流の責務）
- **ノード ID を持たせる**：`components.json` の各コンポーネント・バリアント・レイヤーに Figma の
  ノード ID が入るので、ファイルキーと組み合わせて該当箇所へ直リンクできる
  （`$meta.json.figmaFileKey` は開発モードで読み込むと `null` になりやすい。
  `"fileKey"` は manifest の `permissions` に指定できる値ではないため補えない）
- **アイコンは SVG 化**：`Icons/` 配下の COMPONENT を `exportAsync({format:'SVG'})` で書き出し `icons.json` へ。
  fill/stroke は **`currentColor` に正規化**（CSS の `color` で着色可）。固定 width/height は除去して伸縮可に。
  アイコンは `components.json`（仕様）からは除外（`COMPONENT_DENYLIST=['icons/']`）
- **ロゴも SVG 化**：名前に `logo` を含む COMPONENT_SET の各カラー variant を `logos.json` へ
  （`{ "<logo>": { "default": svg, "white": svg } }`）。**ロゴはブランド色を保持**（currentColor 化しない・サイズのみ除去）
- **エイリアス（変数参照）を潰さず**保持し、DTCG の参照 `{color.brand.primary}` として出力
- **モードはファイル分割**で表現（例: `semantic.light.json` / `semantic.dark.json`）
- **参照されているリモート変数は `remote.json` に取り込む**（購読ライブラリ等）。
  名前だけ解決して値を出さないと「定義の無い参照」が残るため（bundle 内で必ず解決できる状態にする）
- **自己検証つき**：解決できなかった参照・名前の衝突・書き出し失敗を `$meta.json.validation` に記録し、
  プラグイン UI にも警告として表示する（**無言で壊れない**ことを優先する）
- 出力は「ファイル名 → DTCG ツリー」を束ねた **1 ファイル `tokens.bundle.json`** をダウンロード
- **ネットワークを使わない**（manifest の `networkAccess` は `none`）

## セットアップ（これ 1 つでよい）

Airis のディレクトリで:

```bash
sh figma-plugin/setup.sh
```

中で `npm install` → `npm run build`（`src/code.ts` → `dist/code.js`）→ `npm test`（Figma API をスタブして書き出し挙動を検証）を順に実行し、
最後に **Figma に読み込ませる `manifest.json` の絶対パス**を表示する。**何度実行しても安全**で、どのディレクトリからでも動く。
`src/code.ts` を触ったらこれをもう一度実行する。

## Figma への読み込み（開発用）

> `dist/` は gitignore されている（＝clone 直後は存在しない）。**先に `sh figma-plugin/setup.sh` を実行する。**
> ビルド前に manifest を読み込むと `main` が見つからず失敗する。

1. `sh figma-plugin/setup.sh`（**表示されるパスをそのままコピーできる**）
2. Figma デスクトップアプリ → メニュー → Plugins → Development → **Import plugin from manifest…**
3. `figma-plugin/manifest.json` を選択
4. プラグイン実行 → `tokens.bundle.json` をダウンロード（既定 `~/Downloads`）

実行後に人が見るのはこの 2 点だけ（値の形は `npm test` が検査済み）:

- **プラグイン UI に警告が出ていない**（= `$meta.json.validation` が空。出ていれば Figma 側かプラグイン側の要対応）
- **ロゴ / アイコンの SVG が実際に描画される**（`<rect>` や `<mask>` の寸法・色が落ちていない）

`src/code.ts` を直したら手順 1 からやり直す。

## 想定する Figma の構成と出力名の対応

Figma 側のコレクション名・名前空間は、契約名に固定して出力する（`src/code.ts` の `COLLECTION_ALIAS` / `NAMESPACE_ALIAS`）。

| Figma | モード | 役割 | 出力 |
|---|---|---|---|
| Collection `Primitives` / `Core` | なし | 原始値（例: `color/blue/500`, `space/4`） | `core.json` |
| Collection `Semantic` / `Tokens` | Light / Dark | 用途トークン。Core をエイリアス参照 | `semantic.<モード>.json` |
| 名前空間 `Color` / `size` | — | — | `color` / `space`（参照 `{color.blue.500}` も同時に変換） |

Styles（typography / elevation / paint / grid）はコレクションに属さないため `core.json` ツリーへマージする。

## 変換ルール（要点）

| Figma | 出力 |
|---|---|
| 色 `{r,g,b,a}` | `#RRGGBB(AA)` |
| FLOAT（space/size 等） | `"16px"`（`$type: dimension`）。px→rem は後段の Style Dictionary |
| FLOAT（line-height） | 4 未満は倍率 `1.6`（`number`）／4 以上は `"24px"`（`dimension`） |
| FLOAT（その他） | 数値（`$type: number`） |
| 変数名 `a/b/c` | ネスト `a.b.c` |
| エイリアス | `{a.b.c}`（参照のまま保持）。解決できない場合は `@<id>` を残し `validation` に記録 |
| テキストスタイル | `$type: typography` → `typography.*`。`fontStyle` は `normal`/`italic`（Figma の呼び名は `$extensions` に温存）／`letterSpacing` は `0` なら `normal`、`%` は `em` 換算 |
| エフェクトスタイル（影） | `$type: shadow`（color/offset/blur/spread/inset）→ `elevation.*` |
| 塗りスタイル | 単色は `color`、それ以外は `other` で温存 → `paint.*` |
| グリッドスタイル | 使う値だけに整形（pattern/alignment/gutterSize/count/sectionSize/offset）→ `grid.*` |

> スタイル名が `elevation/card` のようにグループ名で始まる場合、先頭セグメントを畳んで
> `elevation.card` にする（`elevation.elevation.card` の二重ネストを避ける）。

## 出力の契約（`$meta.json`）

| キー | 用途 |
|---|---|
| `schemaVersion` | 出力の形の版（現在 `4`）。**形を変えたら必ず上げる**ので、読み手はこれで仕様変更を検知できる |
| `files` | `[{ file, collection, mode }]` の対応表。**ファイル名はモード構成で変わるので、これが唯一の正** |
| `collections` / `styles` / `components` / `icons` / `logos` | 収録物の索引 |
| `validation` | 自己検証の結果（下記）。**空でない項目は Figma 側かプラグイン側の要対応** |

`validation` の項目:

| キー | 意味 |
|---|---|
| `danglingRefs` | bundle 内に定義が無い `{参照}`。**空であることがこのプラグインの契約**（空でなければ出力は不完全） |
| `unresolvedAliases` | 変数 id を名前に解決できなかったもの（削除済み変数など） |
| `pathConflicts` | トークン名の衝突（葉の下に枝を作った・二重定義・同名コンポーネント） |
| `crossFileDuplicates` | 別コレクションが同じパスを定義（結合時に無言の後勝ちになる） |
| `fileConflicts` | ファイル名の衝突（別名で退避済み） |
| `exportFailures` | アイコン / ロゴの SVG 書き出し失敗 |
| `droppedRemoteModes` | リモート変数が複数モードを持つが先頭のみ採用した |
| `missingValues` | 値が読めなかったトークン |
| `remoteVariables` | 参照を辿って解決したリモート変数（情報。エラーではない） |
| `libraryBoundToLocalNames` | **ローカルに同名の変数があるのに、コンポーネントが購読ライブラリ版に束縛されている**（情報。出力は壊れないが、ファイルがライブラリに依存している実態が分かる） |

### `components.json` の `layout`（構造の検査用）

`bindings`（トークン束縛）には出ない「レイアウトの事実」をそのまま入れる。
**判定はしない**（「Auto Layout でないのは違反」などの解釈は下流が行う）。

```jsonc
"variants": [{
  "name": "Style=Solid Fill, State=Default",
  "id": "74:2",
  "bindings": { ... },
  "layout": {
    "id": "74:2", "name": "Style=Solid Fill, State=Default", "type": "COMPONENT",
    "mode": "HORIZONTAL",        // Auto Layout の方向。無いキー = Auto Layout ではない
    "gap": 4,                    // itemSpacing
    "pad": [8, 16, 8, 16],       // 上・右・下・左。全部 0 なら省略
    "w": 104, "h": 36,
    "wSize": "HUG", "hSize": "FIXED",   // FIXED / HUG / FILL
    "r": 8,                      // 角丸。四隅が不揃いなら [左上, 右上, 右下, 左下]
    "sw": 1,                     // 枠線の太さ
    "children": [
      { "id": "74:4", "name": "ボタン", "type": "TEXT",
        "font": { "size": 16, "family": "Inter", "style": "Medium", "lineHeight": "160%" } },
      { "id": "91:2", "name": "Frame 12", "type": "FRAME", "abs": true }  // 絶対配置
    ]
  }
}]
```

| キー | 出す事実（**キーが無い = その事実が無い**） |
|---|---|
| `mode` | Auto Layout の方向（`HORIZONTAL` / `VERTICAL`）。Auto Layout でなければキーごと出さない |
| `gap` / `pad` | 間隔・余白の実数値（`pad` は 上・右・下・左。全部 0 なら省略） |
| `w` / `h` / `wSize` / `hSize` | サイズの実数値と決まり方（`FIXED` / `HUG` / `FILL`） |
| `r` | 角丸の実数値（四隅が不揃いなら `[左上, 右上, 右下, 左下]`） |
| `sw` | 枠線の太さ |
| `abs` | `true` = Auto Layout の中で絶対配置になっている子 |
| `hidden` | `true` = 非表示レイヤー |
| `font` | テキストの書式（`mixed` = 1 レイヤー内で不統一） |
| `truncated` | 12 階層を超えて打ち切った |

- **INSTANCE の内部には入らない**（`bindings` と同じ方針）。アイコン内部の構造は含まれない。
- `layout` は参照検査の対象外（レイヤー名に `{...}` が含まれても未解決参照として扱わない）。
- **これらを `bindings` と突き合わせて「未バインドの直値」等を判定するのは下流**（`../rules/figma-plugin-airis.md` §3）。

### 版の履歴

**取り込み側が受け取るのは `schemaVersion: 4` 以降のみ**（`4` 未満は互換対応せず、`sh figma-plugin/setup.sh` の後に書き出し直す）。過去の変更は「なぜ今この形か」の記録として残す。

| 版 | 変更 |
|---|---|
| **v4** | Airis へ移管し、`typography.*` の `$extensions` のベンダー名前空間を `airis.design-system` に改名（**非互換**） |
| v3 | `components.json` に Figma のノード ID（`id`）と `variants[].layout`（レイアウトの事実）を追加（後方互換） |
| v2 | 無言で壊れる箇所を潰した（**非互換**）: エフェクトの二重ネスト解消 / 解決できないエイリアスを `@<id>` + `validation` に記録 / リモート変数を `remote.json` に取り込む / `typography` の値を DTCG 準拠に正規化 / `grid.*` を使う値だけに整形 / 同名レイヤーを ` #2` で両方残す |

## 既知の割り切り

- `dimension` 判定は名前ヒューリスティック（`space|size|radius|...`）。命名規則が固まれば調整。
- 複数ファイルは 1 つの bundle にまとめてダウンロード（ブラウザの複数 DL 回避）。
- **Styles は解決済みの値を出力**（fontSize 等が変数バインドされていても値として展開。参照 `{..}` にはしない）。
- **リモート（購読ライブラリ）の扱い**：**参照されている変数だけ** `getVariableByIdAsync` で辿り、
  そのうち **ローカルに同名（同じトークンパス）が無いものだけ** `remote.json` に出す。
  ライブラリの全量取り込みやリモート **Styles** は未対応で、`teamLibrary` / `importByKeyAsync`
  系の追加実装が必要（未対応）。
  - **ローカルと同名のものは出さない**：ファイルが自分自身の公開ライブラリを購読していると、
    同じ変数がローカル版とライブラリ版で別 id として存在し、コンポーネントがライブラリ版に
    束縛される。参照はパスで解決するのでローカル定義で足り、出すと同じパスの二重定義になって
    Style Dictionary の結合が後勝ちになる。該当は `validation.libraryBoundToLocalNames` に記録。
  - リモートコレクションのモード id は手元で判別できないため**先頭モードの値のみ**採用し、
    落としたモードは `validation.droppedRemoteModes` に記録する。
- **Components は全件書き出し**：既定で全 ComponentSet/Component（`COMPONENT_ALLOWLIST` 空）。
  絞る/除外は `COMPONENT_ALLOWLIST` / `COMPONENT_DENYLIST`（部分一致）。`bindings` はレイヤー名で
  ネストし、変数は `{token}`・適用スタイルは `style:text` 等のキーで `{typography.*}` を指す。
  **`bindings` はトークン束縛だけ**を持つ（レイアウトの実数値は別キー `layout` に出す。上記）。
  - 変数名は `getVariableByIdAsync` で**ローカル＋リモート（購読ライブラリ）両方**を解決。
    それでも解決できない id は `@VariableID:...` として温存（＝要調査の目印）。
  - **INSTANCE の内部には再帰しない**（アイコン等は別コンポーネントの領域）。
    ボタン自身が持つ束縛のみを契約に含める。
- 将来 localhost MCP ブリッジを足すと、ダウンロード受け渡しが不要になる。
