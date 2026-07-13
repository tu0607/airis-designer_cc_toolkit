# 自作 Figma プラグイン取り込みルール — Airis Design Tokens Export

`tokens.figmaExport` が `custom-plugin` で、**社内プラグイン「Airis Design Tokens Export」の出力を受け取る場合**の取り込み仕様。
`tokens.customPluginSpec` にこのファイルのパスを入れておくと、2 回目以降も同じ変換を再現できる。

- プラグインの所在: **このリポジトリの `figma-plugin/`**（Airis が管理する。実装・出力仕様の詳細は `figma-plugin/README.md`）
- 出力: **`tokens.bundle.json` 1 ファイル**（「ファイル名 → DTCG ツリー」のマップ）。既定のダウンロード先は `~/Downloads`
- 取得手段: **Figma Plugin API**。Variables を全量取れるので **Enterprise プランや REST API が不要**（`claude` モードのプラン制約を受けない）
- ネットワークを使わない。GitHub への反映は Airis 側（`git` / `gh`）が行う

> **このプラグインを使うかどうかは操作者の判断。** 合わなければ `tokens-studio` / `plugin` / `claude` でも成立する（`CLAUDE.md` ステップ 6-1）。

## 1. 最初に `$meta.json` を読む（ファイル名を推測しない）

| キー | 使い方 |
| --- | --- |
| `schemaVersion` | **このルールが想定するのは `4`。** 一致しなければ止める。`4` 未満なら**互換対応せず、`sh figma-plugin/setup.sh` の後に Figma で書き出し直してもらう**。`4` より新しければ `figma-plugin/README.md` の「非互換な変更」を確認してこのファイルを更新する |
| `files` | `[{ file, collection, mode }]` の対応表。**ファイル名を推測せずこれを読む**（モード追加で名前が変わっても壊れない） |
| `validation` | 自己検証結果。**空でない項目は診断（§3）に回す** |
| `icons` / `logos` / `components` | 収録物の索引 |
| `figmaFileKey` | 開発モードで読み込むと `null` になりやすい。`null` なら Figma の URL から補う（ノード ID との組み合わせで該当箇所へ直リンクできる） |

## 2. `tokens/` への展開

Airis のトークン構造（`common.md` §2）へは、`$meta.json.files` の `collection` / `mode` を見て振り分ける。

| bundle のファイル | 展開先 | 備考 |
| --- | --- | --- |
| `collection: core`（`core.json`） | `tokens/core/` | Styles（typography / elevation / paint / grid）もここにマージ済み |
| `collection: semantic` かつ `mode` が `default` 相当 | `tokens/product/<プロダクト名>/mode/default/` | **どのモードを `default` に対応させるかは操作者に確認する。** `light` を機械的に `default` と決めない |
| `collection: semantic` の他モード | `tokens/product/<プロダクト名>/mode/<モード名>/` | モード名は性質名の共通語彙に寄せる（`common.md` §2）。`Dark` → `dark` |
| `remote.json` | `tokens/core/` | 購読ライブラリの変数定義。**参照解決に必要なので落とさない**（落とすと Style Dictionary が dangling で壊れる） |
| `components.json` | **`tokens/` に入れない** | トークンではなく設計の事実。§3 の診断と §4 の生成に使う |
| `icons.json` / `logos.json` | **`tokens/` に入れない** | SVG。§4 でアセットとして展開する |

- エイリアスは `{color.blue.500}` の**参照のまま**入っている。解決して実値に潰さない（`common.md` §2 の逆流禁止と同じ理由）。
- 値の形は既に DTCG（色 `#RRGGBB(AA)` / 寸法 `"16px"` / `$type` 付き）なので、**追加の正規化は不要**。px → rem 等の変換は下流の Style Dictionary の役目。
- 展開後は **`common.md` §2 の「値 → トークン名」逆引き表**を作る。`components.json` の `bindings` が「どのプロパティにどのトークンが当たっているか」を持っているので、それを根拠にできる。

## 3. 診断への流用（**このプラグインを使う最大の利点**）

`components.json` の `layout` は「**事実だけを出し、違反かどうかの判定はしない**」方針で作られている。
つまり **`common.md` §9 の診断を、目視ではなく機械的に判定できる**。

### `validation` から直接引ける項目（カテゴリ ①）

**各キーの意味は `figma-plugin/README.md`（出力の契約）が正。** ここでは診断としての扱いだけを決める。

| 扱い | キー |
| --- | --- |
| **止める**（そのまま展開するとトークンが壊れる） | `danglingRefs` / `unresolvedAliases` / `pathConflicts` / `crossFileDuplicates` / `missingValues` |
| **必ず確認**（展開先や成果物が意図とずれる） | `fileConflicts` / `exportFailures` |
| **情報として報告**（件数があってよい） | `remoteVariables` / `droppedRemoteModes` / `libraryBoundToLocalNames` |

### `layout` と `bindings` の突き合わせで判定できる項目

| 判定 | 条件 | §9 の項目 |
| --- | --- | --- |
| **Auto Layout になっていない** | `layout.mode` キーが**無い** | ①（絶対配置） |
| **Auto Layout 内で絶対配置に逃がしている** | `layout.children[].abs === true` | ① |
| **未バインドの直値（角丸）** | `layout.r` があるのに `bindings` に `*Radius` が無い | ①（Variables 化されていない直値） |
| **未バインドの直値（間隔・余白）** | `layout.gap` / `layout.pad` があるのに `bindings` に `itemSpacing` / `padding*` が無い | ① |
| **Text Style 未適用** | `layout.children[].font` があるのに `bindings` に `style:text` が無い | ① |
| **書式が不統一** | `font` が `mixed` | ② |
| **連番・無名レイヤー** | `layout.children[].name` が `Frame 12` / `Group 3` 等 | ① |
| **固定サイズ** | `wSize` / `hSize` が `FIXED`（レスポンシブで伸縮しない） | ②（レスポンシブの欠落） |
| **実数値がスケールに乗らない** | `layout.gap` / `pad` / `r` / `sw`、および `wSize` / `hSize` が `FIXED` のときの `w` / `h` を `scripts/effective-scale.mjs` と照合（`children[]` の `HUG` な `w` / `h` は測定結果なので除く） | ③（`common.md` §9.3。**トークンの値だけを照合して終わらせない**） |
| ↑ の注意 | `pad` は 4 要素の配列、`r` は四隅が揃っていなければ配列なので**要素ごとに渡す**。`sw` は**枠線が実際に付いているノードにしか出ない**（無いノードは判定不要）。`sw` / `font.size` が `'mixed'` の値は数値照合に渡せないので ② の「書式が不統一」として扱う | ③ |
| **部品名・プロパティ名の規約違反** | `components.json` のキー（部品名）と `properties` のキーを `scripts/lint-naming.mjs` で判定（PascalCase / camelCase / 真偽値の `is`・`has`） | ①（`common.md` §9.1） |
| **非表示レイヤーが混ざっている** | `layout.children[].hidden === true` | ①（意図しない残骸か、状態の作り置きかを確認する） |
| **バリアント名が標準語彙に乗らない** | `variants[].name`（`Style=Solid Fill, State=Default` 等）を `variant` / `size` の語彙と照合。**軸名は `lint-naming.mjs` が機械判定する。値の綴り間違い（`Learge` 等）は目視** | ③ |
| **状態の欠落** | `variants[].name` の軸に `hover` / `disabled` / `error` 等が無い | ②（インタラクション状態の欠落） |

- **判定結果には Figma への直リンクを添える。** `variants[].id` / `layout.children[].id` がノード ID なので、`https://www.figma.com/design/<fileKey>/?node-id=<id>` の形で「どこを直すか」を具体的に示せる（`fileKey` が `null` なら操作者に URL を聞く）。
- `layout` は**参照検査の対象外**（レイヤー名に `{...}` が含まれても未解決参照として扱わない）。
- **`layout` に無いものは判定しない。** `INSTANCE` の内部には入らない仕様なので、アイコン内部の構造は分からない。
- `truncated: true` は 12 階層で打ち切られた印。**「問題なし」ではないので、その旨を報告する**。

## 4. アセットの展開

| bundle | 展開先 | 注意 |
| --- | --- | --- |
| `icons.json` | `assets/icons/<名前>.svg` | fill/stroke が **`currentColor` に正規化済み**なので CSS の `color` で着色できる。固定 width/height は除去済み（伸縮可） |
| `logos.json` | `assets/logos/<名前>-<variant>.svg` | **ブランド色を保持**している（`currentColor` 化しない）。色を上書きしない |

`components.json` の `bindings` は、生成時に「この部品のこのプロパティにはこのトークン」の根拠として使う（`common.md` §2 の逆引き表と併せる）。

## 5. 受け渡しの手順

1. 操作者が Figma デスクトップでプラグインを実行 → `tokens.bundle.json` をダウンロード（**GUI 操作なので Claude は代行できない**）
   - 初回は **`sh figma-plugin/setup.sh`** が必要（`dist/` は gitignore されている）。依存導入・ビルド・自己テストを 1 コマンドで行い、Figma に読み込ませるパスを表示する。**ここは Claude が実行できる**
   - Figma への読み込みは Plugins → Development → Import plugin from manifest… → `figma-plugin/manifest.json`
2. Claude が bundle のパスを受け取り、`$meta.json.schemaVersion` と `validation` を最初に確認する
3. `validation` に空でない項目があれば、**トークンを展開する前に**診断（§3）として提示する
4. §2 に従って `tokens/` へ展開 → §4 でアセットを展開 → 逆引き表を提示

> **`schemaVersion` が想定と違うとき、推測で読み進めない。** `figma-plugin/README.md` の「非互換な変更」で差分を確認し、このファイルを更新してから進める（**両方このリポジトリにあるので同時に直せる**）。
