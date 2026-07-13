# コンテンツサイト変換ルール（`webTarget: content-site`）— Next.js

**対象**: SEO 要件があり、コンテンツが追加されていく・動的配信があるサイト（ブログ・サービスサイト等）。
`common.md` を前提とする。

> **骨子版**です。初の案件で拡充し、あわせて選定方針を ADR 化します。
> 不足しているルールに突き当たったら、推測で進めず止まって確認してください。

## 1. スタック

| 項目 | 決定 |
| --- | --- |
| フレームワーク | **Next.js**（App Router・**標準的な運用**。RSC 回避などの特殊運用はしない） + TypeScript |
| レンダリング | **SSG 中心**。動的が必要な箇所のみサーバーレンダリング |
| スタイリング / 部品 | **Tailwind CSS v4 + CVA + shadcn/ui**（`web-app.md` §3 と `web-app-styling.md` の規約を準用。トークンも同一パイプライン） |
| テスト | `web-app-testing.md` の 3 層をそのまま準用: ①部品 = **`@storybook/test-runner`**（公開も `web-app-storybook.md` §2 と同じく Actions → Pages）/ ②画面 = **`@playwright/test`** / ③見た目 = **`@playwright/test`**（撮影対象は Storybook のストーリー。ページではない） |

## 2. ファイル構成

生成物は **Push 先の作業ツリーへ直接書く**（`CLAUDE.md` ステップ 8）。**置き場所は 2 種類に分かれる**（`web-app.md` §2 と同じ制約。混ぜると CI のパスがずれる）。

```
<リポジトリのルート>/            # ← CI が root 相対で参照するので固定
├── tokens/ , config/         # 正本トークンと SD 設定（common.md §2）
├── tests/{e2e, vrt}/ , playwright*.config.ts
└── .github/workflows/        # storybook-test-and-publish.yml / story-test.yml ほか（web-app-ci.md・マージ提案）

<配置先>/                       # ← ルート直下でも src/ でもよい
├── app/                      # App Router（ルーティング + metadata）
├── components/{ui, common}   # web-app.md §3.1 と同じレイヤー構成
└── styles/tokens.css         # Style Dictionary が生成（@theme。手編集しない）
```

> 配置先が `src/` なら **`sd.config.js` の出力先とワークフロー内の `styles/tokens.css` を置換する**（`web-app.md` §2）。

## 3. 原則

- **SEO は必須要件**: Metadata API で `title` / description / OGP を必ず設定。sitemap / robots も生成対象。
- コンポーネントの書き方・API 規約・a11y は `web-app.md` §3・§5 を準用する。
- **外部サービスの API キーをクライアントに置かない**。サーバー側で扱う場合も秘匿情報の管理方針を案件で確認する。
- **既知の脆弱性はバージョン更新で対応**する（設計の歪みで回避しない）。依存の脆弱性監視（Dependabot 等）を CI に含める。

## 4. 初案件で確定させること（未確定）

- コンテンツの管理方式（Markdown / CMS 連携）とその更新フロー
- ホスティング先と ISR（増分再生成）の要否
- 動的部分のデータ取得パターン
