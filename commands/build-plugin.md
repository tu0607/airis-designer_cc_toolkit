---
description: 同梱の Figma プラグイン「Airis Design Tokens Export」をビルドしてプロジェクト直下の figma-plugin/ に置く（初回と Airis の更新後だけ。ビルド済みをクローンした人は不要）。冪等。
---

あなたは Airis 同梱の Figma プラグイン **Airis Design Tokens Export** を、このプロジェクト用にビルドします。
デザイナーは非エンジニアの可能性があります。**日本語で、専門用語を避けて**進めてください。
**`<Airis>`** = この Airis プラグインのインストール先（セッション開始時の `[Airis] plugin root:` 行、または `echo "${CLAUDE_PLUGIN_ROOT}"` で確認）。

**いつ使うか**: プロジェクト直下の `figma-plugin/` が無いとき（このプロジェクトで初めて使う）と、Airis を更新したあと。
ビルド済みの `figma-plugin/` はコミットして共有するので、**クローンした人はこのコマンドを実行しなくてよい**（Figma に読み込ませるだけ）。

## 手順

1. `.airis/` が無ければ、先に `/airis:setup` の実行を案内して止まる。
2. `figma-plugin/manifest.json` が既にあれば「ビルド済みです。Airis を更新した直後でなければ再ビルドは不要です」と伝え、進めるか確認する（再実行しても安全）。
3. **このプロジェクトのルートで** `sh "<Airis>/figma-plugin/build.sh"` を実行する。
   - 中身: ソースを `.airis/work/figma-plugin/`（gitignore 済み）に複製 → `npm install`（依存の導入・更新）→ ビルド → 自己テスト → Figma が読む 3 ファイル（`manifest.json` / `code.js` / `ui.html`）だけを**プロジェクト直下の `figma-plugin/`** にフラットに置く（`.airis/` の中だと隠しフォルダで Figma のファイル選択画面から見つけにくい。`dist/` を無視する `.gitignore` の影響も受けない）。人に `npm install` を頼まない。
   - **`<Airis>` 配下には何も書かない。** 完了報告でも `<Airis>` 配下のパスを案内しない。
   - 失敗したらスクリプトの表示をそのまま伝える（Node.js が無い → https://nodejs.org を案内。自己テストの失敗 → Airis 側の不具合の可能性があるので、表示されたログの場所を添えて報告を促す）。
4. スクリプトが表示した `figma-plugin/manifest.json` の**絶対パス**と Figma への読み込み手順（Plugins → Development → Import plugin from manifest…）をそのまま伝える。置き場所はプロジェクト内で固定なので、**再ビルドしても Figma の再読み込みは不要**。
5. `.airis/config.json` の `tokens.figmaExport` が `custom-plugin`、`tokens.customPluginSpec` が `<Airis>/rules/figma-plugin-airis.md` になっていなければ、そう設定するか聞く（`/airis:setup` の手順 5 (B) と同じ。これが無いと書き出した JSON の読み方が決まらない）。
6. `figma-plugin/` を**コミットして共有する**ことを提案する（小さい。Push はしない）。チームの他の人はビルド不要で使える、と一言添える。

## 注意
- 破壊的な操作はしない（上書きするのは `figma-plugin/` だけ。`.airis/work/figma-plugin/` は使い捨て）。
- 書き出した `tokens.bundle.json` の受け取りと取り込みは `/airis:build-code` / `/airis:build-token` の仕事（`<Airis>/rules/figma-plugin-airis.md`）。ここではビルドと読み込み案内だけを行う。
