# 変更履歴（利用側で対応が必要なものだけ）

**すべての変更は書きません。** ここに載せるのは **Airis を同期した利用側で手を動かす必要があるもの**だけです。

`install.sh` のハッシュ台帳は **Airis の写し自体**は守りますが、**利用側が自分で書いた参照**（生成した `CLAUDE.md`・独自の CI・社内ドキュメント）までは追えません。
そこでルールファイルのリネーム・削除があったときは、**利用側で grep すべき旧名**をここに残します。

**各項目に「いつ入ったか」を書きます。** これが無いと、利用者は**自分が前回同期した後の変更だけを見る**ことができません（全部読み直すことになる）。
日付は `.airis-version` の `fetched:` と見比べてください。

## ルールファイルのリネーム・分割（2026-07-30）

| 旧名 | 新しい参照先 | 利用側での対応 |
| --- | --- | --- |
| `rules/web-react.md` | `rules/web-app.md`（入口）+ `-styling` / `-storybook` / `-testing` / `-ci` / `-selfcheck` の 5 分冊 | 旧名の参照を入口に付け替える |
| `rules/web-next.md` | `rules/web-content-site.md` | 同上 |

```bash
# 利用側リポジトリで実行して、旧名への参照が残っていないか確認する
grep -rnE 'web-react\.md|web-next\.md' . --exclude-dir=node_modules --exclude-dir=.git
```

- **節番号も変わっています。** 旧 `web-react.md` §7（やらないこと）は `web-app.md` §7 のままですが、Pages の公開範囲は `web-app-storybook.md` §2、テストは `web-app-testing.md` へ移りました。
- **今後の再発を防ぐには、生成する `CLAUDE.md` から分冊名を参照しないこと**（`rules/handoff.md` §1）。参照するのは `common.md` とターゲットの入口だけにしてください。

## 終了コードの意味が変わったもの（2026-07-31）

| スクリプト | 変更 |
| --- | --- |
| `scripts/lint-naming.mjs` | 違反時の終了コードが `1` → **`0`**（`--strict` で `1`）。読み込み失敗の `2` は据え置き |

**利用側での対応**: CI の呼び出しから **`|| true` を外す**。付けたままだと `components.json` が壊れていても（終了コード `2`）緑になり、**「検査した」ことになってしまう**（`rules/web-app-testing.md` §6）。
