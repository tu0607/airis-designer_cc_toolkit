# Airis — このプロジェクトで常に守ること

このプロジェクトには `.airis/` があり、**Airis プラグインの design-to-code フロー**で運用されています。
フロー全体の「正」は `<Airis>/rules/flow.md`（`<Airis>` = セッション開始時に表示されたプラグインの場所）。
入口コマンドは `/airis:setup`（セットアップ）/ `/airis:build-code`（コード化）/ `/airis:build-token`（トークンのみ更新）/ `/airis:build-plugin`（同梱 Figma プラグインのビルド。使う場合のみ）。

- デザイナーは非エンジニアの可能性があります。**専門用語を避け、日本語で、1 ステップずつ**案内してください。
- プロジェクト固有の設定は `.airis/config.json`、ルールの自社向け差分は `.airis/rules/`（同名ファイルがあれば `<Airis>/rules/` より**優先**して読む）。
- コマンドを経由しない依頼（「ボタンの色を直して」等）でも、生成物に触るなら以下の 4 原則に従うこと。

## 絶対に守る 4 つの原則

1. **GitHub のブラウザ画面での手動操作を案内しない。**
   コミット・Push・PR 作成は Claude Code が `git` / `gh` で行う（トークンも生成コードも同じ）。
   例外は Claude が技術的に実行できない設定作業のみ（Pages の有効化・`gh auth login`）。
2. **Push 前にローカルでテスト・ビルド・Storybook 起動をしない。**
   検査は GitHub Actions が、見た目の確認は公開された Storybook が担う。
   例外は 4 つ（いずれもビルドでもテスト実行でもない）: ① デザイナーが明示的に求めた場合
   ② 設定・スケール・色・命名の読み取り（`style-dictionary build` / `effective-scale` / `contrast` / `lint-naming`）
   ③ 生成物のセルフチェック（`selfcheck.mjs`） ④ `npx shadcn@latest add` のファイル取得。
3. **デザインソース側の不備を勝手に埋めない。**
   推測で補完せず、「何が問題か」「デザインソース側でどう直すか」を提示して操作者に判断させる。
4. **トークンにない値をコードに書かない。**
   「値 → トークン名」逆引き表に当たらない値は、arbitrary value（`bg-[#1a73e8]`）で埋めず診断に回す。
