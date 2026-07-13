# LP 変換ルール（`webTarget: lp`）— Astro

**対象**: コンテンツが追加されない・動的配信がない、完結した公開ページ（SEO・表示速度・配信コスト優先）。
`common.md` を前提とする。

> **骨子版**です。初の LP 案件で拡充し、あわせて選定方針を ADR 化します。
> 不足しているルールに突き当たったら、推測で進めず止まって確認してください。

## 1. スタック

| 項目 | 決定 |
| --- | --- |
| フレームワーク | **Astro**（静的出力・既定で JS ゼロ） + TypeScript |
| スタイリング | **Tailwind CSS v4**（`@theme` = Style Dictionary の出力。`web-app-styling.md` §1 と同一パイプライン） |
| インタラクション | 必要な箇所のみ **React アイランド**（`client:*` ディレクティブ）。shadcn/ui 部品・CVA を再利用可 |
| テスト | **`@playwright/test`**（E2E 雛形 + VRT）。Storybook はページ完結の LP では原則生成しない（省略した旨を報告） |

> **LP の VRT は「ページ」を対象にする**（`web-app-testing.md` §4 の VRT は Storybook のストーリー対象だが、LP は Storybook を作らないため成立しない）。
> `tests/e2e/` の spec 内でページを開いて `toHaveScreenshot()` する形にし、baseline の管理・環境固定・人による差分判定の原則は `web-app-testing.md` §4 に従う。
> Storybook を作らないので **GitHub Pages への Storybook 公開も行わない**（`web-app-storybook.md` §2 は適用外）。CI は E2E + VRT のみの構成にする。

## 2. ファイル構成

生成物は **Push 先の作業ツリーへ直接書く**（`CLAUDE.md` ステップ 8）。**置き場所は 2 種類に分かれる**（`web-app.md` §2 と同じ制約。混ぜると CI のパスがずれる）。

```
<リポジトリのルート>/            # ← CI が root 相対で参照するので固定
├── tokens/ , config/         # 正本トークンと SD 設定（common.md §2）
├── tests/e2e/                # 受け入れ基準の雛形 + VRT（LP の VRT はページ対象）
├── playwright.config.ts      # E2E + VRT 兼用（VRT を分けないので専用 config は作らない）
│                             #   webServer + reporter: 'html' + snapshotPathTemplate が必須
└── .github/workflows/        # story-test.yml（E2E + VRT）/ design-tokens-build.yml（マージ提案）

<配置先>/                       # ← ルート直下でも src/ でもよい
├── src/
│   ├── pages/                # 各 LP（*.astro）
│   └── components/           # Astro コンポーネント（+ 必要なら React アイランド）
├── styles/tokens.css         # Style Dictionary が生成（@theme。手編集しない）
└── assets/                   # 画像・アイコン
```

> 配置先が `src/` なら **`sd.config.js` の出力先とワークフロー内の `styles/tokens.css` を置換する**（`web-app.md` §2）。

## 3. 原則

- **既定は JS ゼロ**（静的 HTML）。`client:*` は本当に動きが要る島だけに付ける。
- **SEO は必須要件**: `title` / meta description / OGP / 構造化データを必ず設定し、画像は `astro:assets` で最適化する。
- トークン参照は Web アプリと同じ（`bg-primary` 等。生パレット・arbitrary value 禁止）。命名・a11y・アセットは `common.md` 準拠。
- フォーム送信先・計測タグは案件要件を確認する。**外部サービスの API キーをクライアントに置かない**（`web-app.md` §4 と同じ原則）。

## 4. やらないこと

- SSR・サーバー機能（必要になった = 動的配信が生えた時点で、**Next ターゲットへの移行を提案**する）。
- コンテンツコレクションでの記事運用（コンテンツが増えるサイトは最初から `web-content-site.md`）。
