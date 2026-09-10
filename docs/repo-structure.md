# リポジトリ構成とカスタマイズ

このリポジトリは **Claude Code プラグイン「airis」の本体**であり、同時に**自分自身を配布する marketplace** です。
利用者はクローンせず、`/plugin marketplace add tu0607/airis-designer_cc_toolkit` → `/plugin install airis@airis` で導入します。

```
airis-designer_cc_toolkit/
├── README.md                     # 入口（これは何か / インストール / 仕組み）
├── CLAUDE.md                     # このリポジトリを開発する人（メンテナ）向けの指示
├── .claude-plugin/
│   ├── plugin.json               # プラグイン定義（name: airis）
│   └── marketplace.json          # 自分自身を配布する marketplace 定義（source: "./"）
├── commands/                     # 利用者に配布されるスラッシュコマンド
│   ├── setup.md                  # /airis:setup（前提確認・.airis/ の用意・Figma 接続）
│   ├── build-code.md             # /airis:build-code（デザイン確定 → コード化 → Push）
│   ├── build-token.md            # /airis:build-token（トークンのみ取り込み・更新 → PR）
│   └── build-plugin.md           # /airis:build-plugin（同梱 Figma プラグインをビルド → プロジェクト直下の figma-plugin/）
├── hooks/
│   └── hooks.json                # SessionStart: .airis/ のあるプロジェクトで 4 原則を自動注入
├── docs/                         # README から切り出した説明（読むのは必要になったときで良い）
│   ├── usage.md                  # 使い方の詳細（進み方・コマンド）
│   ├── design-tokens.md          # Figma からトークンを取り出す 4 つの方法
│   ├── design-system.md          # デザインシステムの考え方（層構造・昇格）
│   ├── testing-and-publishing.md # テスト 3 層と Storybook の公開・公開範囲
│   ├── tech-stack.md             # 生成コードの技術スタック
│   ├── repo-structure.md         # このファイル
│   └── troubleshooting.md        # 困ったときの対処
├── rules/                        # ★ 変換ルール（プラグインと一緒に配布される）
│   ├── README.md
│   ├── flow.md                   # フロー全体の「正」（コマンドの手順の実体）
│   ├── principles.md             # 絶対に守る 4 原則（SessionStart hook が注入）
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
│   ├── handoff.md                # Push 先の引き継ぎ・push の認証・マージ後の片付け
│   └── figma-plugin-airis.md     # 同梱プラグイン「Airis Design Tokens Export」の取り込み仕様
├── figma-plugin/                 # 同梱の Figma プラグイン「Airis Design Tokens Export」
│   │                             #   Variables を DTCG で書き出す（Enterprise プラン不要）
│   │                             #   使うかは任意。取り込み仕様は rules/figma-plugin-airis.md
│   ├── build.sh                  # ▶ /airis:build-plugin の実体（依存導入・ビルド・テスト → 成果物をプロジェクト直下の figma-plugin/ へ）
│   ├── README.md                 #   Figma への読み込み・出力契約
│   ├── src/{code.ts, ui.html}    #   プラグイン本体（npm run build で dist/ を生成）
│   └── test/                     #   Figma API をスタブした書き出しテスト（npm test）
├── config/
│   └── project.example.json      # プロジェクト設定の雛形（/airis:setup が .airis/config.json へコピー）
├── scripts/                      # Claude が使う道具（Node 標準ライブラリのみで動く。依存なし）
│   ├── effective-scale.mjs       # ▶ 移植先の実効 Tailwind スケールを実測する（診断用・バージョン非依存）
│   ├── contrast.mjs              # ▶ トークンの組み合わせのコントラスト比を実測する（診断用。a11y の CI より前に拾う）
│   ├── lint-naming.mjs           # ▶ デザインソースの命名を機械検査する（診断用。components.json を読む）
│   ├── components-diff.mjs       # ▶ 部品の定義が変わったかを前後の components.json で比べる（/airis:build-token が使う）
│   ├── selfcheck.mjs             # ▶ 生成物の静的検査（クラス名の実在・ストーリー欠落・ルール違反・型エラー）
│   ├── doccheck.mjs              # ▶ このリポジトリのルール類の整合性を検査（メンテナ用。ルールを編集したら通す）
│   ├── theme.mjs                 #   実効 @theme の読み取り（effective-scale / contrast / selfcheck / classes が共用）
│   └── classes.mjs               #   Tailwind クラス名の照合ロジック（selfcheck が使う）
├── .github/dependabot.yml        # 同梱 Figma プラグインの依存更新
└── .claude/                      # メンテナがこのリポジトリで作業するときの設定
    ├── settings.json             #   権限設定
    └── commands/doc-audit.md     #   /doc-audit（メンテナ専用。プラグインには含めない）
```

**利用者のプロジェクト側**に置かれるのは `.airis/` です（`/airis:setup` が作る）:

```
<あなたのプロジェクト>/.airis/
├── config.json      # プロジェクト固有の設定（コミットして共有）
├── rules/           # 自社向けのルール差分（同名ファイルが本体より優先される。コミットして共有）
├── work/            # 使い捨て（HTML モック・診断の控え・Push 先のクローン・プラグインのビルド作業場。gitignore 済み）
└── .gitignore       # 「work/」の 1 行
```

同梱の Figma プラグインを使う場合だけ、ビルド済みのプラグイン（`manifest.json` / `code.js` / `ui.html`）が**プロジェクト直下の `figma-plugin/`** にも置かれます（`/airis:build-plugin` が置く。隠しフォルダだと Figma のファイル選択画面で見つけにくいため `.airis/` の外。小さいのでコミットして共有）。

## 更新のしかた

Claude Code で `/plugin marketplace update` を実行すると最新版になります（`/plugin` の画面からも操作できます）。

- **本体の `rules/` は編集しないでください**（更新で上書きされます）。自社向けの調整は、あなたのプロジェクトの **`.airis/rules/` に同名ファイルで差分だけ**を置きます — Claude はそちらを優先して読みます。
- 大きく作り替えたい場合はこのリポジトリを**フォーク**し、`/plugin marketplace add <あなたのフォーク>` で配布してください。

## 変換ルールのカスタマイズ

コード生成の品質と規約準拠は `rules/` で決まります。詳しくは [`rules/README.md`](../rules/README.md)。

- 利用者: プロジェクトの `.airis/rules/` に差分を置く（`/airis:setup` の手順 3 でも登録できます）
- メンテナ / フォーク運用者: 本体の `rules/` を編集し、**`node scripts/doccheck.mjs` を通してください**（参照が静かに壊れるのを防ぎます）
