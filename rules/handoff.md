# Push 先リポジトリの引き継ぎと git 操作

**Push 先リポジトリを扱うときの実装詳細**をまとめます。フロー上のどこで実施するかは `CLAUDE.md` が正:

| ここの節 | 実施するタイミング |
| --- | --- |
| §1 引き継ぎ設定の生成 | `CLAUDE.md` ステップ 9（テスト成果物と同時に生成する） |
| §2 push が拒否されるとき | `CLAUDE.md` ステップ 11 の push 直前・直後 |
| §3 マージ後の片付け | PR がマージされた後 |

## 1. Push 先を Claude Code で扱えるようにする（**これが無いと 2 回目から原則が全部外れる**）

**構造的な穴なので必ず埋める。** `/setup` と `/design-to-code` は **Airis の `.claude/commands/` にあるので、Airis のディレクトリで起動したときだけ使える**。
一方、成果物を受け取った人が Claude Code を起動するのは **Push 先のルート**。そこには `CLAUDE.md` もコマンドも無いため、守るべきこと（生成物を手編集しない / デザインソースの不備を推測で埋めない / Push 前に確認を取る / ローカルでテストを回して「検証済み」としない）が**一切読み込まれない**。
**初回は Airis 側で作業するので気付けない** — 効いていると思い込んだまま 2 回目以降で外れる。

Push 先のルートに次を生成する（**既存があれば無断上書きせずマージ提案**。`CLAUDE.md` ステップ 8 の既存ファイル方針と同じ）:

| 生成物 | 何を書くか |
| --- | --- |
| `CLAUDE.md` | そのリポジトリの入口。① **Airis の所在**と参照の読み替え ② 固有値（配置先・プロダクト名・ブランチ運用） ③ 守ること（原則 1〜4 の要約） ④ 検査コマンド |
| `.claude/commands/*.md` | そのリポジトリ向けの入口（例: トークンを取り込んで再生成する / セルフチェックを通す） |
| `.claude/settings.json` | 検査コマンドの許可設定 |
| `.mcp.json` | **Figma 接続の定義**（設定済みの方式に合わせる。Dev Mode なら `{"mcpServers":{"figma-dev-mode":{"type":"http","url":"http://127.0.0.1:3845/mcp"}}}`。Framelink 構成なら `FIGMA_API_KEY` の受け渡しも案内する） |

**`.mcp.json` を忘れると Figma に繋がらない。** `.mcp.json` は**セッションの起動ディレクトリから読まれる**ので、Airis 側にあっても Push 先で起動したセッションからは読まれない。見落としやすい理由が 2 つある:

- **許可と接続定義は別物。** `settings.json` に `mcp__figma-dev-mode` を入れても、接続定義が無ければ繋がらない。
- **トークンの取り込みだけなら Figma 接続は要らない**（プラグインの書き出し JSON で完結する）。**部品のコード化を Push 先でやろうとして初めて発覚する**。初回は Airis 側で作業するのでそこでも気付けない。

生成する `CLAUDE.md` には**どの作業に Figma 接続が要るかを書き分ける**（実際に利用側から質問が出た点）:

- `/design-to-code` で Figma からコード化する → **Dev Mode 接続が必要**
- 書き出した JSON からトークンを取り込むだけ → **接続は不要**

また **初回起動時に「この MCP サーバーを許可するか」の確認が出る**ことを伝えておく（デザイナーが戸惑う。一度承認すれば以後は出ない）。

**外すと静かに壊れる点が 3 つある**:

1. **Airis のドキュメント内の相対パスは Airis 起点。** `rules/common.md` は `<Airis>/rules/common.md` を指すので、Push 先のルートで読むと見つからない。生成する `CLAUDE.md` に **Airis の所在と読み替え規則を必ず書く**（例:「変換ルールは `<Airis の絶対パス>/rules/` にある。`rules/…` と書かれた参照はすべてそこを起点に読み替える」）。**これを書かないと Claude が Push 先で `rules/` を探して見つけられない。**
    - **生成する `CLAUDE.md` が参照するのは安定した入口だけにする — `common.md` と該当ターゲットの入口（`web-app.md` など）のみ。分冊名（`web-app-styling.md` 等）を列挙しない。** 分冊は入口ファイル冒頭の表から辿れる。**Airis 側の分割・リネームで利用側の記述が壊れるのを防ぐため**（`install.sh` の台帳は Airis の写しは守るが、**利用側が自分で書いた参照は追えない**）。
2. **`.claude/settings.json` の許可パターンはパスが変わる。** Airis 側の `Bash(node scripts/selfcheck.mjs:*)` は、Push 先では `node <Airis>/scripts/selfcheck.mjs` になり**マッチしない**。生成時に実パスへ置換する。
3. **検査コマンドは `package.json` の scripts にする**（デザイナーに長いパスを打たせない）。ただし **`package.json` は勝手に書き換えない**（`web-app-testing.md` §5）ので、**差分をマージ提案として出す**:

    ```json
    "check":    "node <Airis>/scripts/selfcheck.mjs . --src <配置先> --tsc",
    "contrast": "node <Airis>/scripts/contrast.mjs .",
    "scale":    "node <Airis>/scripts/effective-scale.mjs ."
    ```

- **Airis の絶対パスは環境ごとに違う。** 他の人の環境では動かないので、**直す場所が 1 か所に集まっている**ことを生成した `CLAUDE.md` に明記する。
- **Airis 自体を Push 先へコピーしない。** ルールの正本は Airis 側に 1 つだけ置く（複製すると更新が分岐し、どちらが正か分からなくなる）。

## 2. push が拒否されるときの 2 大原因（**ワークフローを生成した回は先に確認する**）

`CLAUDE.md` ステップ 9 で `.github/workflows/` を生成し、ステップ 11 で push する。**`gh auth login` の既定スコープに `workflow` は含まれない**ため、**スコープを足していない環境では確実に失敗する**（一度足した環境では起きないので、`gh auth status` で毎回確かめる）。**失敗させてから調べると往復が 1 周増える。**

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
- ブランチの削除は**取り残しに気付けなくなる不可逆な操作**なので、**必ず確認を取ってから**実行する。`.claude/settings.json` は `-d` / `-D` / `--delete` を `ask` にしているが、**設定に頼らずこの規則に従う**（別の綴りは素通りする）。
