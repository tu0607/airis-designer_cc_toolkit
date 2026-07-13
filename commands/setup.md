---
description: 初回セットアップ（前提確認・.airis/ の用意・自社ルールの登録・任意の Figma 接続）。冪等。
---

あなたは Airis の**セットアップ**を対話的に実行します。
デザイナーは非エンジニアの可能性があります。**日本語で、1 ステップずつ、専門用語を避けて**進めてください。
このコマンドは**何度実行しても安全（冪等）**です。すでに済んでいる項目はスキップし、足りない分だけ補ってください。

**`<Airis>`** = この Airis プラグインのインストール先（セッション開始時の `[Airis] plugin root:` 行、または `echo "${CLAUDE_PLUGIN_ROOT}"` で確認）。
セットアップは**今 Claude Code を起動しているディレクトリ**（このプロジェクト）に対して行います。ここが今後の作業場所になります。

> Figma 連携がメインの使い方ですが、Airis は **Claude Code だけでも使えます**（ラフ画や言葉からデザイン→コード化）。
> Figma 接続の設定はスキップ可能で、後から `/airis:setup` を再実行すれば追加できます。

## 手順

### 1. 前提コマンドの確認
`command -v node`, `command -v git`, `command -v gh` を確認し、バージョンを簡潔に報告する。

| 前提 | 無い / 未完了のとき |
| --- | --- |
| **Node.js v22 以上**（トークン変換に使う style-dictionary v5 の動作要件） | 入手先を案内して**止まる**: https://nodejs.org 。v22 未満も更新を案内して止まる（トークン変換が動かない） |
| **git** | 入手先を案内して**止まる**: https://git-scm.com |
| **`gh`（GitHub CLI）** — Claude が代わりにコミット・Push・PR 作成を行うために使う | https://cli.github.com を案内（Homebrew があれば `brew install gh`）。**止まらなくてよい**（Push の直前までに済めばよい）ので「残っている作業」として記録する |

- `gh` があれば `gh auth status` でログイン状態も確認する。未ログインなら **デザイナー自身に実行してもらう**（対話ログインなので Claude では完了できない）: プロンプトに `! gh auth login` と入力してもらい、ブラウザでの認証を案内する。

### 2. `.airis/` の用意（全員）

このプロジェクトに Airis の設定置き場 `.airis/` を作る（**`config.json` と `rules/` はコミットして共有する**。`work/` は使い捨てなので除外する）:

- `.airis/config.json` が無ければ `<Airis>/config/project.example.json` からコピーして作成する。既にあれば現在値を伝える。
- `.airis/work/` を作成し、`.airis/.gitignore` を `work/` の 1 行で作成する。
- `.airis/rules/` を作成する。中に短い `README.md` を置く: 「ここには Airis の変換ルール（`<Airis>/rules/`）への**自社向けの差分・追記だけ**を、同名のファイルで置きます。全文コピーは置かないでください（本体の更新に追随できなくなります）。同名ファイルがあると Claude はそちらを優先して読みます。」
- **プロダクト名**を聞いて `tokens.product` に保存する（**Figma を使わないルートでも必要**。トークンの置き場所が `tokens/product/<プロダクト名>/mode/` になる）。聞き方: 「このデザインは何というプロダクト / サービスのものですか？（英数字の短い名前で）」。既に設定済みなら現在値を伝えて変更するか確認する。
- このプロジェクトが git リポジトリで `.gitignore` に `.claude/settings.local.json` が無ければ、**追記を提案する**（後の手順で Figma トークンを保存する場所。コミットされると漏えいする）。

**許可設定の提案**（このプロジェクトの `.claude/settings.json`。既存があれば Read してマージ、無ければ新規作成。**書く前に一言確認する**）:

```json
{
  "permissions": {
    "allow": [
      "Bash(git status)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git branch:*)",
      "Bash(git add:*)", "Bash(git commit:*)", "Bash(git clone:*)", "Bash(git switch:*)", "Bash(git pull:*)",
      "Bash(npm ci)", "Bash(npm run:*)", "Bash(npx style-dictionary:*)", "Bash(npx tsc --noEmit)",
      "Bash(npx shadcn:*)", "Bash(npx shadcn@latest:*)",
      "Bash(gh auth status)", "Bash(gh repo view:*)", "Bash(gh pr view:*)", "Bash(gh pr list:*)",
      "Bash(gh run list:*)", "Bash(gh run view:*)",
      "Bash(node <Airis>/scripts/effective-scale.mjs:*)", "Bash(node <Airis>/scripts/contrast.mjs:*)",
      "Bash(node <Airis>/scripts/lint-naming.mjs:*)", "Bash(node <Airis>/scripts/selfcheck.mjs:*)",
      "Bash(node <Airis>/scripts/components-diff.mjs:*)"
    ],
    "ask": [
      "Bash(git push:*)", "Bash(git remote:*)", "Bash(gh pr create:*)", "Bash(gh pr edit:*)",
      "Bash(git branch -d:*)", "Bash(git branch -D:*)", "Bash(git branch --delete:*)"
    ]
  }
}
```

- **`<Airis>` は実際のインストール先の絶対パスに置換して書く**（このパスは人ごとに違う。チームで共有するリポジトリでは、他の人の環境で許可が効かず**確認が 1 回多く出るだけ**で壊れはしない、と一言添える）。
- `git push` / `gh pr create` を `ask` に入れるのは**勝手に外部へ送らないための安全装置**。allow に移さない。

### 3. 自社ルールの登録（オプション）

聞く: **「会社のデザインシステムやコーディング規約など、生成コードに反映したい決まりごとはありますか？」**

- **無い / まだ分からない** → スキップ（「後から `.airis/rules/` に足せます」と一言）。
- **ある** → 内容を聞き取り、対応する Airis のルールファイルと**同名のファイル**（例: 命名なら `web-app.md`、トークン構造なら `common.md`）として `.airis/rules/` に**差分だけ**を書く。書いたら要約を見せて確認を取る。

### 4. Figma 接続（オプション）

デザイナーに聞く: **「Figma のデザインをコード化する予定はありますか？」**
- **無い / まだ分からない** → スキップして完了へ（後から `/airis:setup` を再実行すれば追加できる、と伝える）。
- **ある** → 接続方法を選んでもらう:
  - (A) **公式 Dev Mode**（Figma デスクトップアプリ内で起動・トークン不要）
  - (B) **Framelink**（Figma API トークンで動作・アプリ不要）

選んだ方式に応じて、**このプロジェクトの `.mcp.json` に接続定義を書く**（既存があれば Read してマージ。接続定義はセッションの起動ディレクトリから読まれるため、プロジェクトごとに必要）:

```json
{
  "mcpServers": {
    "figma-dev-mode": { "type": "http", "url": "http://127.0.0.1:3845/mcp" },
    "figma-framelink": {
      "command": "npx",
      "args": ["-y", "figma-developer-mcp", "--figma-api-key=${FIGMA_API_KEY}", "--stdio"]
    }
  }
}
```

（使う方だけ書けばよい。両方書いても害はない。初回起動時に「この MCP サーバーを許可するか」の確認が出ることを伝えておく — 一度承認すれば以後は出ない。）

**(A) の場合**: `curl -s -o /dev/null -m 2 http://127.0.0.1:3845/mcp` で到達確認。
- 到達不可なら案内: Figma デスクトップアプリ → 環境設定 → 「Enable local MCP Server」を有効化。

**(B) の場合**: Figma の Personal access token を尋ねる（https://www.figma.com/settings で発行, スコープ File content=Read）。
- 受け取ったトークンをこのプロジェクトの `.claude/settings.local.json` の `env.FIGMA_API_KEY` に保存する（既存内容がある場合は Read してマージ。無ければ `{"env":{"FIGMA_API_KEY":"..."}}` を作成）。**保存前に、このファイルが gitignore されていることを必ず確認する**（手順 2）。**絶対にコミットしない。**
- 保存後、**必ず伝える**: 「トークンを反映するため、一度 Claude Code を終了して `claude` で起動し直してください」（MCP サーバーはセッション開始時に環境変数を読み込むため）。

### 5. デザイントークンの取り出し方（Figma 接続を設定した場合のみ）

デザイナーに聞く: **「Figma の色や余白などの設定（デザイントークン）を、どうやってコード側へ届けますか？ 4 つのやり方があります」**

**どれが正解ということはありません。**環境（プラグインを入れられるか）と頻度（継続的に更新するか）で選んでもらう:

| | やり方 | 向いている場面 | 用意するもの |
| --- | --- | --- | --- |
| (A) | **Tokens Studio + GitHub 連携** … プラグインのボタン 1 つで GitHub へ送る（コミットと Pull Request が作られる） | デザインを継続的に更新していく | Tokens Studio プラグイン + GitHub のトークン |
| (B) | **自作プラグインで書き出す** … 社内で作った Figma プラグインで JSON を書き出し、Claude に渡す | すでに社内プラグインがある。独自の命名規則がある | 自作プラグイン（**Airis 同梱のものが 1 つあり**、取り込みルール込みで使えます） |
| (C) | **既製プラグインで書き出す** … TokensBrücke などで JSON を書き出し、Claude に渡す | 単発・小規模。導入は最小限にしたい | 無料プラグイン 1 つ |
| (D) | **Claude Code が読み取る** … プラグインを使わず、Claude が Figma から直接読み取って作る | プラグインを入れられない。まず試したい | **Figma デスクトップアプリ（Dev Mode 接続）**。下記の注意を参照 |

選択を `.airis/config.json` の `tokens.figmaExport` に保存する（A → `"tokens-studio"` / B → `"custom-plugin"` / C → `"plugin"` / D → `"claude"`。既存値がある場合は現在の設定を伝え、変えるか確認）。**後から `/airis:setup` を再実行すればいつでも変更できる**と伝える。

**共通して必ず伝えること**: どのやり方でも、**トークンは生成コードと同じ Pull Request に入り、コミット・Push・PR 作成は Claude Code が代わりに行います**（GitHub の画面でファイルをアップロードする作業はありません）。Push の直前には必ず確認を取るので、勝手に送信されることもありません。
- 例外は (A) Tokens Studio のみ。この方式では**プラグインの Push ボタンがコミットと PR を作る**ので、トークンの PR がコードとは別に立ちます（それでも触るのは Figma プラグイン内だけで、GitHub の画面は使いません）。

**(A) Tokens Studio + GitHub 連携の設定案内**（丁寧に、画面の言葉で、1 ステップずつ確認しながら）:
1. Figma で対象ファイルを開き、リソースメニュー（Shift+I）→「プラグイン」→ **「Tokens Studio for Figma」を検索して実行**（無料版で可）。
2. GitHub の Personal access token を用意してもらう（https://github.com/settings/tokens 。対象＝トークンを置くリポジトリ、権限＝Contents: Read and write。発行は社内の詳しい人に頼んでも OK と伝える）。
3. プラグインの **Settings → Sync providers → Add new → GitHub** で設定: トークン / リポジトリ（通常は移植先リポジトリ）/ ブランチ / 保存先パス（`tokens/` フォルダ。トークンセットを core と product/<プロダクト名>/mode/（default ほか）に対応させる）。
4. 以後の使い方: デザイン変更のたびにプラグインで **Push** を押す → コミットと Pull Request が作られる（この方式だけ、トークンの PR が生成コードとは別に立つ）。
- 注意: GitHub トークンはプラグイン内に保存される。共有ファイルでの扱いは組織のセキュリティ方針に従う。
- 正直に伝える: 「編集しただけで自動コミット」までの完全自動化は Figma の Webhook（Organization/Enterprise プラン）+ Variables REST API（Enterprise）が必要。標準プランでは Push ボタンが起点になる。

**(B) 自作プラグインの場合**:
0. **社内プラグインの取り込みルールが 1 つ用意されている**ので、**一度だけ触れる**（押しつけない）:
   > 「Airis には **Airis Design Tokens Export** という Figma プラグインが同梱されていて（`<Airis>/figma-plugin/`）、取り込みルールも用意してあります。Variables を DTCG で書き出せて Enterprise プランが不要です。もしこれを使うなら設定はこれで済みますが、**別のプラグインをお使いならそのままで問題ありません**。」
   - **使う** → `tokens.customPluginSpec` を `<Airis>/rules/figma-plugin-airis.md` に設定し、**`sh "<Airis>/figma-plugin/setup.sh"` を実行**する（依存導入・ビルド・自己テストが 1 コマンドで終わり、Figma に読み込ませるパスが表示される）。表示されたパスをそのまま伝えて Figma への読み込みを案内する（プラグインの更新でパスが変わることは無いので、Figma には一度読み込ませれば以後も使える）。下の 1〜3 は不要。
   - **別のプラグインを使う / 分からない** → **それ以上勧めず**、下の 1 に進む。
1. **初回だけ、書き出した JSON のサンプルを見せてもらう**（Claude が読み方を決めるため）。聞くこと: DTCG 形式かどうか / トークンのまとまりが `core` と `product/<プロダクト名>/mode/` のどれに当たるか / 参照（別トークンを指す書き方）の形式。
2. Claude は読み取り方を短いメモにまとめて **`.airis/custom-plugin-spec.md`** に保存し、そのパスを `.airis/config.json` の `tokens.customPluginSpec` に記録する（2 回目以降は同じ変換を再現するため。メモはリポジトリで共有される＝チームの資産になる）。
3. 以後は書き出した JSON を `/airis:build-code` / `/airis:build-token` 実行時に渡してもらう。

**(C) 既製プラグインの場合**:
1. リソースメニュー →「プラグイン」→ **「TokensBrücke」を検索して実行**（無料。Variables / Styles を W3C DTCG 形式の JSON で書き出せる）。
2. 書き出した JSON は `/airis:build-code` / `/airis:build-token` 実行時に渡してもらう（ドラッグ&ドロップやパス指定で受け取り、Push 先の `tokens/` の該当する場所（通常は `product/<プロダクト名>/mode/default/`）に取り込む）。

**(D) Claude Code が読み取る場合**:
1. 追加の準備は不要。`/airis:build-code` の中で Claude が Figma から Variables / Styles を読み取って JSON を作る。
2. **接続方法によって読めるものが違う**（手順 4 でどちらを設定したかを確認して伝える）:
   - **Dev Mode（A）で接続している** → Figma の **Variables（変数）まで読める**。この方法の本来の使い方。
   - **Framelink（B）だけで接続している** → **Variables は読めません**（Figma 側の制限で、変数を API から読むには Enterprise プランが必要）。読めるのは画面に実際に使われている色・サイズなどの値だけなので、そこから Claude が名前を提案してデザイナーと決める形になる。**変数をきちんと持ち出したい場合は、(A)〜(C) のプラグイン方式か Dev Mode 接続を勧める**（プラグインはプランの制限を受けない）。
3. **正直に伝える**: 読み取った内容には Claude の解釈が入るので、**作った後に「この名前・この値でよいか」を一緒に確認**する。また、Figma 側で Variables を使わず色を直接指定している箇所は拾いきれない。**その場合 Claude が勝手に名前を付けて埋めることはせず**、「どのレイヤーがトークン化されていないか」「Figma でどう直すか」を一覧で返す（`/airis:build-code` の変換前診断。`<Airis>/rules/common.md` §9）。

### 6. 完了報告
- 何を設定し、何をスキップしたかを一覧で示す。
- `.airis/`（`config.json`・`rules/`）を**コミットして共有する**ことを案内する（コミット自体はこの場で提案してよい。Push はしない）。
- Figma トークンを新規設定した場合は「Claude Code の再起動が必要」を再掲。
- **未完了の項目を「残っている作業」として明示**する（例: `gh auth login`。誰がやるか・どこでやるかを 1 行ずつ）。
- 次のステップを案内: 「`/airis:build-code` を実行してください。言葉で要望を伝えても、ラフ画を渡しても、Figma URL を貼っても OK です。トークンだけを更新したいときは `/airis:build-token` です」。
- **Storybook カタログの公開範囲と GitHub Pages の設定はここでは扱わない**と一言伝える: 「公開まわりの確認と設定案内は、最初の `/airis:build-code` で Push 先が確定した時点で行います」（実施内容は `<Airis>/rules/flow.md` ステップ 9-1・判定表は `rules/web-app-storybook.md` §2 が正）。
- **コード化の前に「変換前診断」が入る**ことを一言伝える: 「Figma の設定に足りないところ（**トークン化されていない値・状態の描き漏れ・使う技術の余白の刻みに乗らない値など**）があれば、**勝手に埋めずに『どこをどう直すか』を先にお伝えします**。直してから進めるか、そのまま進めるかはその場で選べます」。

## 注意
- トークンなどの秘密情報をログ出力・コミットに含めない。
- 破壊的な操作はしない（既存ファイルを問答無用で上書きしない。設定はマージ）。
