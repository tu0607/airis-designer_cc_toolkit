# 生成コードの技術スタック

Web は 2 つの質問（**検索から人が来るか → ページが増えていくか**）で 3 ターゲットに振り分けます。
**黙って決めることはしません** — 自動検知や設定で答えが出ている場合も、決定と理由を伝えて確認を取ります。

| ターゲット | 条件 | スタック | ルール |
| --- | --- | --- | --- |
| **Web アプリ** | SEO 不要（ログイン後・社内向け等） | React 19 + Vite（下表） | [`rules/web-app.md`](../rules/web-app.md) |
| **LP** | SEO 必要・コンテンツ追加なし・動的配信なし | **Astro**（静的・JS ほぼゼロ） | [`rules/web-lp.md`](../rules/web-lp.md)（骨子版） |
| **コンテンツサイト** | SEO 必要・コンテンツが増える / 動的配信あり | **Next.js**（App Router 標準運用） | [`rules/web-content-site.md`](../rules/web-content-site.md)（骨子版） |

## Web アプリの詳細

| 分類 | 採用 |
| --- | --- |
| フレームワーク | **React 19 + TypeScript + Vite** |
| ルーティング | React Router（画面を生成する場合のみ） |
| コンポーネント | **Radix UI + shadcn/ui**（a11y はヘッドレスが担保・コードは手元にコピー）。自作部品は Feature-based 配置、接頭辞は `config` で任意設定 |
| スタイリング | **Tailwind CSS v4**（`@theme` = トークン）+ CVA（クラス列は部品内部に隠蔽） |
| 状態管理 | サーバー: TanStack Query / クライアント: useState → useContext → zustand を範囲で使い分け |
| フォーム / スキーマ | React Hook Form + **Zod**（セット採用。型は `z.infer` で導出） |
| テスト | 3 層すべて **GitHub Actions**: ①コンポーネント = **Storybook**（Autodocs + play + a11y。生成時に自動付属）②ストーリー = **Playwright E2E** ③**VRT**（昇格済み部品のみ）。**Vitest 不使用**（検証内容がストーリーと重複するため「ストーリー = テスト」に一本化） |
| Storybook の公開 | **GitHub Actions でビルド・テスト → GitHub Pages へ公開**（ローカル起動は前提にしない。公開元は開発ブランチ） |
| Lint / 整形 | **ESLint**（検査）+ **Prettier**（整形）の責務分割。TypeScript は strict 必須 |

- ネイティブ（React Native / Flutter / SwiftUI / Kotlin）はフレームワークを固定せず、都度確認します（[`rules/native.md`](../rules/native.md)）
- デザイントークンの取り出し方と変換パイプライン（Style Dictionary）は [`design-tokens.md`](design-tokens.md)
