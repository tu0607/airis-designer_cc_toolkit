# 変換ルール

このディレクトリは、デザイン（Figma / Claude Design / ラフ画・言葉）をコードへ変換する際の**ルール**を定義します。
Claude はコード生成の前に必ずここを読み込みます。

## 構成

| ファイル           | 役割                                                        |
| -------------- | --------------------------------------------------------- |
| `common.md`    | 全ターゲット共通のルール（命名・デザイントークン・余白・アクセシビリティ・アセット方針・**変換前診断**）      |
| `web-app.md` | Web アプリ（SEO 不要の SPA。React + Vite + TypeScript）の**入口** — スタック / ファイル構成 / コンポーネント規約 / 状態管理 / a11y / Lint / やらないこと。工程別に下の 5 ファイルへ分かれる |
| `web-app-styling.md` | ↳ トークン → `styles/tokens.css` の変換、クラスの選び方、`cn()` の拡張 |
| `web-app-storybook.md` | ↳ ストーリーの書き方、GitHub Pages への公開、実装者への案内 |
| `web-app-testing.md` | ↳ テスト 3 層（①部品 / ②画面 / ③見た目）と devDependencies |
| `web-app-ci.md` | ↳ `.github/workflows/` のワークフロー雛形 |
| `web-app-selfcheck.md` | ↳ 生成後の静的検査（`scripts/selfcheck.mjs`）の検査項目と扱い方 |
| `web-lp.md`    | LP（SEO 必要・コンテンツ追加なし。Astro）のルール — 骨子版                    |
| `web-content-site.md`  | コンテンツサイト（SEO 必要・コンテンツが増える。Next.js）のルール — 骨子版       |
| `native.md`    | ネイティブターゲットのルール（React Native / Flutter / SwiftUI / Kotlin） |
| `handoff.md`   | Push 先リポジトリの引き継ぎと git 操作（引き継ぎ設定の生成 / push が拒否されるとき / マージ後の片付け） |
| `figma-plugin-airis.md` | 自作 Figma プラグイン「Airis Design Tokens Export」の出力を取り込む仕様（`tokens.figmaExport` が `custom-plugin` のとき） |

## ルールの優先順位

1. ターゲット固有ルール（`web-app.md` など）
2. 共通ルール（`common.md`）
3. デザインの見た目

ルールとデザインが矛盾する場合、Claude は**ルールを優先**し、その旨をデザイナーに伝えます。

## 拡張・カスタマイズの指針

- 会社/プロダクトのコーディング規約、コンポーネントライブラリ、デザインシステムに合わせて各ファイルを編集してください。
- 新しいターゲット（例: Web の別フレームワーク）を追加する場合:
  1. `rules/<target>.md` を追加。
  2. `CLAUDE.md` のフロー「3. プラットフォーム / ターゲット判定」「4. 変換ルールの読み込み」に対象を追記。
  3. 必要なら `config/project.example.json` に既定値を追加。
- ルールは**具体的な指示 + 良い例/悪い例**で書くと、生成品質が安定します。

## 編集したら検査を通す

```bash
node scripts/doccheck.mjs
```

> `install.sh` は `.git` を作らないため、**利用者の環境では I4（旧ブランド名の混入）だけ「未実施」としてスキップ**されます（落ちません）。

ルール類の整合性（Markdown 構造 / 節・ステップ・原則の参照の実在 / フロー図と見出しの一致 / 作業ツリー依存の順序 / 番号リスト / リンク / 撤回済み表現の残存 / 設定キー / CI 雛形 / スクリプトの構文と規約 / `selfcheck` の検査 ID とドキュメントの一致 / 同梱プラグインとの整合 / 旧ブランド名の混入 / `sd.config.js` 雛形の必須要素）を機械検査します。
**特にフローの順序やステップ番号を変えたときは必須**（参照が静かに壊れるため）。生成物の検査は別物で、そちらは `scripts/selfcheck.mjs`（`web-app-selfcheck.md`）。
