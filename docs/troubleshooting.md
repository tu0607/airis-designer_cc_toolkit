# 困ったときの対処

| 症状 | 対処 |
| --- | --- |
| Figma のデータが取れない | Dev Mode は対象を選択＆ローカル MCP 有効化を確認。Framelink は `/setup` でトークン再設定。 |
| `FIGMA_API_KEY` が反映されない | `/setup` を再実行し、Claude Code を起動し直す（`.claude/settings.local.json` の env はセッション開始時に読み込まれる）。 |
| push で止まる | 仕様です。外部影響のある操作は確認を挟みます。内容を確認して承認してください。 |
| PR が作られない / `gh` のエラー | `gh auth status` でログイン状態を確認してください。未ログインなら、Claude のプロンプトに `! gh auth login` と入力して認証してください（対話ログインなので Claude では完了できません）。 |
| 「Figma を直してください」と言われた | 変換前診断の結果です。**先に Figma を直して再実行**するか、**その前提のまま進める**かを選べます。後者を選んだ箇所には `TODO` コメントが入り、PR 本文にも一覧が残ります。 |
| 「文字と背景の明るさの差が足りない」と言われた | 色のコントラストが基準（WCAG AA 4.5:1 / 大きい文字 3:1）に届いていません。**実測値と、基準を満たす色の候補**を一緒に出しますので、**どれにするかを選んで Figma の Variable を直してください**（Claude は色を勝手に変えません）。生成前の診断で出るのが通常ですが、すり抜けた場合は PR のチェックが赤くなって同じ指摘が出ます。 |
| PR のチェックが赤くなった | Claude が中身を読んで、**Claude 側の直しか、Figma 側の直しか**を切り分けて日本語で伝えます。前者はそのまま直して追加コミットします。後者だけ、あなたに Figma の修正をお願いします（**Actions のログを読む必要はありません**）。 |
| Storybook の URL が開けない | ① **URL が合っているか**（access control が有効な環境では `<org>.github.io/<repo>/` ではなく `<ランダム>.pages.github.io`。`gh api repos/<owner>/<repo>/pages --jq .html_url` で確認）② GitHub にサインインしていて、そのリポジトリの read 権限があるか ③ Settings → Pages → Source が「GitHub Actions」か ④ Actions タブでワークフローが成功しているか ⑤ 公開は**開発ブランチ（既定 `develop`）へのマージ後**（PR 段階では公開されない）。 |
| カタログが外部に見えていないか不安 | `gh api repos/<owner>/<repo>/pages --jq .public` を実行してください。**`false` なら read 権限のあるサインイン済みの人だけ**が閲覧できます（外部には出ません）。`true` なら誰でも閲覧可なので、`storybook.publish` を `artifact` に切り替えてください。**リポジトリが Private でも `true` になり得ます**（[公開範囲に注意](testing-and-publishing.md)）。 |
| VRT（見た目のチェック）が赤い | 「見た目が変わった」の合図で、不具合とは限りません。Actions の実行画面から差分画像（`vrt-diff`）を確認し、**意図した変更なら**「**VRT の見本画像を更新**」を手動実行 → 作られた PR をマージします。 |
| 部品を VRT 対象にしたら赤くなった | 見本画像（baseline）がまだ無いためです。**`tags: ["vrt"]` を付ける → 見本を作る**の順を守り、先に「VRT の見本画像を更新」を実行してその PR をマージしてください。 |
| デザインを公開したくない | `storybook.publish` を `artifact` に変更（Actions の成果物としてダウンロード）。Pages に認証をかけるには GitHub Enterprise Cloud が必要です。 |
