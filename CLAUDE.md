# Airis — このリポジトリを開発する人（メンテナ）向けの指示

このリポジトリは **Claude Code プラグイン「airis」の本体**であり、同時に**自分自身を配布する marketplace** です（`.claude-plugin/plugin.json` + `marketplace.json`）。
利用者はこのリポジトリをクローンしません。`/plugin marketplace add` → `/plugin install` で導入し、任意のプロジェクトで `/airis:setup` `/airis:build-code` `/airis:build-token` を使います。

- **フロー全体（何を、どの順で、誰に確認するか）の「正」は `rules/flow.md`。** 常時守る 4 原則は `rules/principles.md`（`.airis/` のあるプロジェクトでは SessionStart hook が注入する。`hooks/hooks.json`）。
- コードの書き方・テストの実装詳細は `rules/` の各ファイルが正。構成の全体像は `docs/repo-structure.md`。
- 利用者のプロジェクト側に置かれるのは `.airis/`（`config.json` / `rules/` 差分 / `work/`）。雛形は `config/project.example.json`。
- `.claude/commands/doc-audit.md` は**メンテナ専用**（プラグインの `commands/` には含めない = 配布しない）。

## 編集時の約束

- **ルール・フロー・コマンドを編集したら `node scripts/doccheck.mjs` を通す**（参照が静かに壊れるのを防ぐ。特にステップ番号・ファイル名を変えたとき）。
- コマンド・ルール内の場所参照の規約: プラグイン同梱物は **`<Airis>`**（= `${CLAUDE_PLUGIN_ROOT}`）起点、利用者のプロジェクト側は **`.airis/`** 起点で書く。相対パス裸書き（`scripts/…` 等）は利用者の環境で解決できないので書かない。
- 配布物（コマンド・ルール・スクリプト）に変更を入れたら `.claude-plugin/plugin.json` の `version` を上げる。
