# Push 先リポジトリの引き継ぎと git 操作

**Push 先リポジトリを扱うときの実装詳細**をまとめます。フロー上のどこで実施するかは `flow.md` が正:

| ここの節 | 実施するタイミング |
| --- | --- |
| §1 受け取った人への引き継ぎ | `flow.md` ステップ 9-2（PR 本文に書く。ステップ 11 の 4） |
| §2 push が拒否されるとき | `flow.md` ステップ 11 の push 直前・直後 |
| §3 マージ後の片付け | PR がマージされた後 |

## 1. 受け取った人が Push 先で作業できるようにする

コマンド・ルール・原則は **Airis プラグインに付いてくる**ので、Push 先リポジトリへの複製は不要（`CLAUDE.md` や `.claude/commands/` を生成して配る旧方式は廃止。ルールの正本はプラグイン側に 1 つだけ置き、自社差分は Push 先の `.airis/rules/` に置く）。
その代わり、**受け取った人がプラグインを入れていなければ何も始まらない**ので、**PR 本文とチャットに「始め方」を必ず書く**:

```
このリポジトリで続きの作業（トークン更新・部品の追加）をする場合:
1. Claude Code で /plugin marketplace add tu0607/airis-designer_cc_toolkit
2. 続けて /plugin install airis@airis
3. このリポジトリのルートで claude を起動し、/airis:setup を実行
以後は /airis:build-code（コード化）と /airis:build-token（トークンのみ更新）が使えます。
```

（フォーク運用の場合は 1 のリポジトリ名をフォーク先に読み替える。）

**プロジェクト側に必要なものは `/airis:setup` がすべて作る** — `.airis/`（設定・自社ルール差分・作業場）、`.mcp.json`（Figma 接続）、`.claude/settings.json`（許可設定）。手で作らせない。

**`.mcp.json` を忘れると Figma に繋がらない。** `.mcp.json` は**セッションの起動ディレクトリから読まれる**ので、別のプロジェクトにあっても Push 先で起動したセッションからは読まれない。見落としやすい理由が 2 つある:

- **許可と接続定義は別物。** `settings.json` に `mcp__figma-dev-mode` を入れても、接続定義が無ければ繋がらない。
- **トークンの取り込みだけなら Figma 接続は要らない**（プラグインの書き出し JSON で完結する）。**部品のコード化を Push 先でやろうとして初めて発覚する**。

PR 本文には**どの作業に Figma 接続が要るかを書き分ける**（実際に利用側から質問が出た点）:

- `/airis:build-code` で Figma からコード化する → **Dev Mode 接続が必要**
- 書き出した JSON からトークンを取り込むだけ（`/airis:build-token`） → **接続は不要**

また **初回起動時に「この MCP サーバーを許可するか」の確認が出る**ことを伝えておく（デザイナーが戸惑う。一度承認すれば以後は出ない）。

**検査コマンドを `package.json` の scripts に入れない。** プラグインのインストール先（`<Airis>`）は**人ごとに違う絶対パス**なので、scripts に書くと他の環境で必ず壊れる。検査（`selfcheck` / `contrast` / `effective-scale`）はデザイナーが手で打つものではなく、**Claude がコマンドの手順として実行する**。

**旧方式の生成物が残っているリポジトリ**（過去に Airis が生成した `CLAUDE.md` / `.claude/commands/*.md` がある）では、**無断で消さず**、「プラグイン方式に切り替わったので整理できます」と提案して操作者に判断させる（古い手順が残ると Claude がそれを読んで旧方式で動いてしまうため、放置の害も伝える）。

### トークン更新には「部品の定義が変わった」検査を組み込む（`/airis:build-token` が実施）

**トークンだけを更新する運用**（部品のコードは作り直さない）では、**Figma で部品にバリアントを足しても
その事実だけがリポジトリに入り、コードに反映されないまま誰も気付かない**（エラーにならず CI も緑）。

```bash
# 取り込みの「前」をバージョン管理から取り、取り込み後と比べる（作業ツリー内で実行）
git show HEAD:tokens/.meta/components.json > /tmp/airis-components-before.json
node <Airis>/scripts/components-diff.mjs /tmp/airis-components-before.json tokens/.meta/components.json
```

- **判定はしない。** コードを作り直すか、今回はトークンだけにとどめるかは**操作者が決める**（`lint-naming.mjs` と同じ扱い。違反で落とさず、読めなかったときだけ終了コード 2。初回は比較元が無いのでスキップ）。
- **検出できないもの**: 子レイヤーの変化（数が多く読めなくなるため見ていない）。**中身だけが変わった場合は VRT が拾う層**なので、両方を当てにする。
- 報告する 3 項目と「なぜコードを読まないか」は `scripts/components-diff.mjs` の冒頭が正。

## 2. push が拒否されるときの 2 大原因（**ワークフローを生成した回は先に確認する**）

`flow.md` ステップ 9 で `.github/workflows/` を生成し、ステップ 11 で push する。**`gh auth login` の既定スコープに `workflow` は含まれない**ため、**スコープを足していない環境では確実に失敗する**（一度足した環境では起きないので、`gh auth status` で毎回確かめる）。**失敗させてから調べると往復が 1 周増える。**

**① `workflow` スコープが無い**

```
! [remote rejected] refusing to allow an OAuth App to create or update workflow
  `.github/workflows/xxx.yml` without `workflow` scope
```

```bash
gh auth status   # scopes に workflow があるか
```

無ければ**本人に実行してもらう**（ブラウザ認証なので Claude では完了できない。プロンプトに `!` を付けて入力してもらう）:

```
! gh auth refresh -h github.com -s workflow
```

**② スコープを足しても直らない場合 — 資格情報ヘルパーが古いトークンを返している**（macOS で起きる）

```bash
git config --show-origin --get-all credential.helper
# /Library/.../git-core/gitconfig    osxkeychain   ← システム設定側が先に効く
```

システム側の `osxkeychain` が**先に古いトークンを返す**ため、`gh` を更新しても push は通らない。ヘルパー一覧を空でリセットしてから指定すると通る:

```bash
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -u origin <branch>
```

- **恒久対処は `gh auth setup-git`**（本人に実行してもらう）。以後この回避は不要になる。
- **①②は症状が同じ（push が拒否される）で原因が別。** ① を直しても通らないときに ② を疑う、という順で切り分ける。

## 3. マージ後の片付け（**ブランチを消す前に内容で確認する**）

PR がマージされても、**squash マージだとブランチのコミットは `main` の先祖にならない**。そのため次はどれも判定に使えない:

| 使えない方法 | なぜ |
| --- | --- |
| `git branch --merged` | squash では未マージ扱いになる |
| `git diff main..branch` | **両方向**の差分が出る。`main` が先に進んだだけのブランチも「差分あり」と出る |
| PR が MERGED という表示 | **マージ後に push した分は含まれない** |
| `gh pr view <n> --json headRefOid` | マージ後の push を反映しないことがある |

- **内容で確認する**: `git diff <マージ先>..<branch> -- <そのブランチが触ったファイル>` を見る、または生成物の件数・行数など具体的な指標で突き合わせる。**取り残しが無いと確認できるまで消さない。**
- **PR の更新はマージ前に済ませる。** GitHub の「Automatically delete head branches」が有効だと**マージした瞬間にブランチごと消え、後から push した分に気付けない**。
- ブランチの削除は**取り残しに気付けなくなる不可逆な操作**なので、**必ず確認を取ってから**実行する。許可設定では `-d` / `-D` / `--delete` を `ask` にしているが、**設定に頼らずこの規則に従う**（別の綴りは素通りする）。
