# リポジトリ構成とカスタマイズ

```
airis/
├── README.md                     # 入口（これは何か / インストール / 仕組み）
├── install.sh                    # インストーラー（curl | sh で実行。冪等）
│                                 #   tarball を展開するので .git は作らない
│                                 #   更新時は .airis-manifest と照合し、編集済みファイルを上書きしない
├── CLAUDE.md                     # Claude 向けフロー定義（オーケストレーションの「正」）
├── CHANGELOG.md                  # 同期した利用側で手を動かす必要がある変更だけ（リネーム時の grep 一覧）
├── .mcp.json                     # Figma MCP 設定（Dev Mode + Framelink。使わなくても害なし）
├── .env.example                  # 環境変数サンプル（Figma トークン・任意）
├── .github/
│   └── dependabot.yml            # Airis 自身の依存更新（配布する lock の鮮度を保つ）
│                                 #   ※ security updates の有効化は Settings 側。人手が必要
├── .claude/
│   ├── settings.json             # 権限設定（push は確認を挟む）
│   └── commands/
│       ├── setup.md              # /setup スラッシュコマンド
│       └── design-to-code.md     # /design-to-code スラッシュコマンド
├── docs/                         # README から切り出した説明（読むのは必要になったときで良い）
│   ├── usage.md                  # 使い方の詳細（進み方・コマンド）
│   ├── design-tokens.md          # Figma からトークンを取り出す 4 つの方法
│   ├── design-system.md          # デザインシステムの考え方（層構造・昇格）
│   ├── testing-and-publishing.md # テスト 3 層と Storybook の公開・公開範囲
│   ├── tech-stack.md             # 生成コードの技術スタック
│   ├── repo-structure.md         # このファイル
│   └── troubleshooting.md        # 困ったときの対処
├── rules/                        # ★ プロジェクトが管理する変換ルール
│   ├── README.md
│   ├── common.md                 # 共通ルール（トークン・命名・a11y・変換前診断）
│   ├── web-app.md                # Web アプリ (React + Vite + TS + Tailwind/CVA) の入口
│   ├── web-app-styling.md        #   ↳ トークン → tokens.css・クラスの選び方・cn()
│   ├── web-app-storybook.md      #   ↳ ストーリーの書き方・GitHub Pages への公開
│   ├── web-app-testing.md        #   ↳ テスト 3 層（部品 / 画面 / 見た目）
│   ├── web-app-ci.md             #   ↳ .github/workflows/ の雛形
│   ├── web-app-selfcheck.md      #   ↳ 生成後の静的検査（検査項目 22 個）
│   ├── web-lp.md                 # LP (Astro)・骨子版
│   ├── web-content-site.md       # コンテンツサイト (Next.js)・骨子版
│   ├── native.md                 # ネイティブ
│   ├── handoff.md                # Push 先の引き継ぎ設定・push の認証・マージ後の片付け
│   └── figma-plugin-airis.md     # 自作プラグイン「Airis Design Tokens Export」の取り込み仕様
├── figma-plugin/                 # 同梱の Figma プラグイン「Airis Design Tokens Export」
│   │                             #   Variables を DTCG で書き出す（Enterprise プラン不要）
│   │                             #   使うかは任意。取り込み仕様は rules/figma-plugin-airis.md
│   ├── setup.sh                  # ▶ これ 1 つで導入・ビルド・テスト（sh figma-plugin/setup.sh）
│   ├── README.md                 #   Figma への読み込み・出力契約
│   ├── src/{code.ts, ui.html}    #   プラグイン本体（npm run build で dist/ を生成）
│   └── test/                     #   Figma API をスタブした書き出しテスト（npm test）
├── config/
│   └── project.example.json      # プロジェクト既定値（/setup で local へコピー）
├── scripts/                      # Claude が使う道具（shebang があるものが実行用、無いものは import 専用）
│   ├── effective-scale.mjs       # ▶ 移植先の実効 Tailwind スケールを実測する（診断用・バージョン非依存）
│   ├── contrast.mjs              # ▶ トークンの組み合わせのコントラスト比を実測する（診断用。a11y の CI より前に拾う）
│   ├── lint-naming.mjs           # ▶ デザインソースの命名を機械検査する（診断用。components.json を読む）
│   ├── selfcheck.mjs             # ▶ 生成物の静的検査（クラス名の実在・ストーリー欠落・ルール違反・型エラー）
│   ├── doccheck.mjs              # ▶ このリポジトリのルール類の整合性を検査（ルールを編集したら通す）
│   ├── theme.mjs                 #   実効 @theme の読み取り（effective-scale / contrast / selfcheck / classes が共用）
│   └── classes.mjs               #   Tailwind クラス名の照合ロジック（selfcheck が使う）
├── package.json                  # style-dictionary 依存（install.sh が導入。/setup は欠落時の補完）
├── .airis-manifest               # install.sh が書く（取得時の各ファイルのハッシュ。更新時に編集を見分ける）
├── .airis-version                # install.sh が書く（取得元・ブランチ・取得日時）
└── output/                       # 作業用（gitignore。生成コードは Push 先の作業ツリーへ直接書きます）
    ├── preview/                  # デザイン合意用の HTML モック
    ├── diagnostics/              # 変換前診断の控え（項目が多い場合のみ）
    └── .push/                    # Push 先リポジトリのクローン先
```

## 変換ルールのカスタマイズ

コード生成の品質と規約準拠は `rules/` で決まります。自社のデザインシステム・
コーディング規約に合わせて編集してください。詳しくは [`rules/README.md`](../rules/README.md)。

- 共通方針（トークン・命名・a11y）: [`rules/common.md`](../rules/common.md)
- Web の実装規約: [`rules/web-app.md`](../rules/web-app.md)
- ネイティブの実装規約: [`rules/native.md`](../rules/native.md)

**ルールを編集したら `node scripts/doccheck.mjs` を通してください**（参照が静かに壊れるのを防ぎます）。
