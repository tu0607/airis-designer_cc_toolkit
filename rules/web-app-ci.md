# Web アプリ CI ワークフロー雛形（`.github/workflows/`）

`web-app.md` の一部。**テストと公開を GitHub Actions で回す雛形**を置きます。何をどの層で守るかは `web-app-testing.md`。

## 1. ワークフロー雛形

雛形を書くときの前提（3 点）:

- **置換する**: 起動条件（`branches:`）とマージ先は `config` の `git.developBranch` / `mainBranch`、**公開ジョブの `if:` だけは `storybook.deployBranch`**（公開元はこちらが正。`web-app-storybook.md` §2）。Node のバージョン・npm スクリプト名は移植先に合わせる。パスは §2 の配置ルールに合わせる（**生成前に配置先を確認済みなので、最初から置換済みで書く**）。既存 CI があれば**上書きせずマージ提案**。
- **汎用名を使わない**: `ci.yml` / `test.yml` のような名前は禁止。ファイル名と `name:`（Actions タブの表示名）に**何を見ているか**を書き、検査の単位は**ジョブ名**で表す（PR のチェック一覧にジョブ名が個別に並ぶため、赤くなった層がそこで分かる）。
- **Storybook のビルドは 1 回だけ**: ①③と公開は同じ成果物を使うので **1 ファイル内で `needs` で繋ぐ**。分けると別 run になり成果物を共有できず（`workflow_run` は**デフォルトブランチに無いと起動しない・PR の必須チェックにしにくい**）、ビルドも 3 回に増える。

```
storybook-test-and-publish.yml   ← push / PR で起動
  build-storybook                   Storybook を 1 回ビルド（成果物）
    ├─ component-test               ① play / a11y（@storybook/test-runner）
    ├─ visual-regression-test       ③ 見た目の変化（@playwright/test）
    └─ publish-to-pages             ① 成功後・develop のみ公開（再ビルドなし）

story-test.yml                   ← ② 画面のできること（@playwright/test）
                                    アプリをビルドするので Storybook とは独立して並走する
```

### 1.1 `storybook-test-and-publish.yml` — Storybook のビルド・①③の検査・公開

```yaml
# .github/workflows/storybook-test-and-publish.yml
# Storybook を 1 回だけビルドし、①部品の検査 と ③見た目の検査 を行い、develop なら GitHub Pages へ公開する
# （①③と公開は同じビルド成果物を使うため 1 ファイルにまとめている。層の区別はジョブ名で行う）
name: Storybook の検査と公開（① 部品の操作・a11y ／ ③ 見た目の変化）

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]
  workflow_dispatch:

permissions:
  contents: read # Pages への書き込み権限は publish-to-pages ジョブにだけ与える（最小権限）

concurrency:
  group: storybook-test-and-publish-${{ github.ref }}
  cancel-in-progress: true # 同じブランチの古い実行は打ち切る（実行時間の節約）

jobs:
  # Storybook のビルドはここだけ。以降のジョブは成果物を受け取って使う
  build-storybook:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx style-dictionary build --config config/sd.config.js
      - name: トークンが反映されているか確認
        # Style Dictionary は対象が無くてもエラーにせず終了する（"No tokens for tokens.css" と出て正常終了）。
        # 放置すると「スタイルが当たっていない Storybook」が緑のまま公開されるので、生成物の有無で明示的に検査する
        run: test -s styles/tokens.css || { echo "::error::styles/tokens.css が生成されていません。tokens/ が未反映の可能性があります"; exit 1; }
      - run: npm run build-storybook # 出力: storybook-static
      - uses: actions/upload-artifact@v4
        with: { name: storybook-static, path: storybook-static, retention-days: 7 }

  # ① コンポーネントテスト（play / a11y）— @storybook/test-runner
  component-test:
    needs: build-storybook
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - uses: actions/download-artifact@v4
        with: { name: storybook-static, path: storybook-static }
      - run: npx playwright install --with-deps chromium
      - name: play / a11y を実行
        run: |
          npx concurrently -k -s first \
            "npx http-server storybook-static -p 6006 -s" \
            "npx wait-on tcp:127.0.0.1:6006 && npx test-storybook --url http://127.0.0.1:6006 --maxWorkers=2"

  # ③ VRT（見た目の回帰）— @playwright/test。baseline と同じ描画環境に固定するため公式コンテナで実行
  # 本番だけに絞る場合: if: github.ref == 'refs/heads/main' || github.base_ref == 'main'
  visual-regression-test:
    needs: build-storybook
    runs-on: ubuntu-latest
    container:
      # ↓ package.json の @playwright/test と必ず同じ版にする（ずれるとブラウザが見つからず失敗）
      image: mcr.microsoft.com/playwright:v1.62.0-noble
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - uses: actions/download-artifact@v4
        with: { name: storybook-static, path: storybook-static }
      - name: スクリーンショットを撮って baseline と比較
        run: npx playwright test --config playwright.vrt.config.ts
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: vrt-diff, path: playwright-report } # 差分画像つきレポート。人が見て判定する

  # Storybook を GitHub Pages へ公開（開発ブランチのみ・① が通ったときだけ・再ビルドしない）
  # ③ VRT は needs に入れない（見た目の差分は公開して見比べてもらうため）
  # ② ストーリーテストは別ワークフローなので needs にできない（カタログの公開可否は部品の検査で判断する）
  publish-to-pages:
    needs: component-test
    if: github.event_name == 'push' && github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    permissions:
      contents: read # ジョブ単位の permissions はワークフロー全体の指定を置き換えるので明示する
      pages: write
      id-token: write
    concurrency:
      group: pages # Pages のデプロイは 1 本ずつ
      cancel-in-progress: false # 進行中のデプロイは止めない（中断すると Pages が不整合になりうる）
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/download-artifact@v4
        with: { name: storybook-static, path: storybook-static }
      - uses: actions/upload-pages-artifact@v3
        with: { path: storybook-static }
      - id: deployment
        uses: actions/deploy-pages@v4
```

- **前提**: リポジトリの **Settings → Pages → Source を「GitHub Actions」**にしておくこと（管理者の手作業。未設定だと `publish-to-pages` だけが赤くなる。案内は `web-app-storybook.md` §3）。
- **VRT の結果は公開を止めない**（`web-app-storybook.md` §2）。`needs` に入れていないのは意図的。
- Pages を使わない場合（`storybook.publish` が `artifact` / `none`）は `publish-to-pages` ジョブを削る（`storybook-static` の成果物は残るので、Actions の画面からダウンロードして開ける）。
- **実行コストを抑える工夫**（既定で入れてある。さらに削るならこの順で）: **Storybook のビルドは 1 回だけ** / `cancel-in-progress` / ブラウザは chromium のみ / VRT は `vrt` タグ付きのみ → それでも重ければ `visual-regression-test` に `if:` を足して本番ブランチだけにする（`testing.vrtBranches`）。
- Private リポジトリでは Actions の実行時間が課金対象になる点を実装者に伝える。

### 1.2 `story-test.yml` — ② 画面のできることを検査

```yaml
# .github/workflows/story-test.yml
# ユーザーストーリーの受け入れ基準（画面で何ができるか）を Playwright E2E で検査する
# アプリをビルドするため Storybook とは無関係。独立して並走する
# 画面を生成していない案件では、このファイルごと作らない
name: ストーリーテスト（画面のできること / Playwright E2E）

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: story-test-${{ github.ref }}
  cancel-in-progress: true

jobs:
  story-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx style-dictionary build --config config/sd.config.js
      - name: トークンが反映されているか確認 # 理由は storybook-test-and-publish.yml と同じ
        run: test -s styles/tokens.css || { echo "::error::styles/tokens.css が生成されていません。tokens/ が未反映の可能性があります"; exit 1; }
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npx playwright test # playwright.config.ts の webServer がプレビューを起動する
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report }
```

> `playwright.config.ts`（② 用）には **`webServer` でアプリのプレビュー起動を書いておく**こと（例: `{ command: 'npm run preview', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI }`）。
> 書かれていないと CI では「起動していないアプリ」にアクセスして全件失敗する。移植先に既存の設定があればそちらに合わせる。

### 1.3 `vrt-baseline-update.yml` — ③ の見本画像を更新（手動）

```yaml
# .github/workflows/vrt-baseline-update.yml
# 「今の見た目を正とする」を人の操作で実行し、PR として起票する（自動では更新しない）
name: VRT の見本画像を更新

on: { workflow_dispatch: } # Actions タブから手動実行

permissions:
  contents: write
  pull-requests: write

jobs:
  # ジョブ名も「何をするか」にする（`web-app.md` §2 の命名規約。update のような汎用名は使わない）
  vrt-baseline-update:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.62.0-noble # visual-regression-test と必ず同じ版にする
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npx style-dictionary build --config config/sd.config.js
      - name: トークンが反映されているか確認 # 未反映のまま撮ると誤った見本が baseline に入る
        run: test -s styles/tokens.css || { echo "::error::styles/tokens.css が生成されていません。tokens/ が未反映の可能性があります"; exit 1; }
      - run: npm run build-storybook
      - name: baseline を撮り直す
        # 差分があるほど失敗扱いになるので、更新目的の実行では結果を無視して先へ進める
        run: npx playwright test --config playwright.vrt.config.ts --update-snapshots || true
      - uses: peter-evans/create-pull-request@v7
        with:
          branch: vrt/update-baseline
          title: "VRT: 見本画像を更新"
          body: "見た目の変更を正として取り込みます。差分を確認してからマージしてください。"
```

- **使いどころは 2 つ**: ① VRT が赤くなったが**意図した変更**だったとき ② 部品を**昇格して `tags: ['vrt']` を付けた直後**（baseline がまだ無いので先に作る）。
- このワークフローが作る PR は `GITHUB_TOKEN` 起票のため、**その PR 上では CI が自動で回らない**（GitHub の仕様。無限ループ防止）。画像だけの PR なので通常は問題ないが、確認したい場合は PR を一度 close → reopen する。

## 2. トークン変更時の再ビルド検査（`design-tokens-build.yml`）

トークン JSON の変更をトリガーに、`style-dictionary build` の**出力が意図どおりか**だけを検査する（`tokens.figmaExport` のどの方式でも生成する）。

- **`styles/tokens.css` はコミットする**（`.gitignore` に入れない）。生成物だが、コミットされていないと `git diff --exit-code` の差分検出が**常に素通り**して検査が無意味になる（「手編集しない」と「コミットする」は両立する）。これが出力スナップショットの役割を兼ね、意図しない変換の変化・逆流を検出する。
- **Airis 経由の PR ではこの検査は緑になるのが正常**（Claude が push 前に `style-dictionary build` を回して `tokens.css` も一緒にコミットするため）。下記の「再生成 PR の自動起票」は、**Tokens Studio の Push や手作業でトークンだけが変更された場合の保険**。
- **①②③ と公開はここから呼ばない**。`storybook-test-and-publish.yml` / `story-test.yml` が push / PR で直接起動するので、トークン変更でも同じ連鎖が自動で走る（二重実行を避ける）:

```yaml
# .github/workflows/design-tokens-build.yml
# トークン JSON から Style Dictionary の出力が意図どおり作られるかを検査する
# （①②③ と公開は storybook-test-and-publish.yml / story-test.yml が push・PR で起動するので、ここからは呼ばない）
name: デザイントークンのビルド検査

on:
  push:
    paths: ["tokens/**"]
  pull_request:
    paths: ["tokens/**"]
  workflow_dispatch:

permissions:
  contents: write # 再生成した tokens.css を PR にするため
  pull-requests: write

jobs:
  design-tokens-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx style-dictionary build --config config/sd.config.js
      - name: トークンが反映されているか確認
        run: test -s styles/tokens.css || { echo "::error::styles/tokens.css が生成されていません。tokens/ が未反映の可能性があります"; exit 1; }
      - id: snapshot
        name: 出力スナップショットの差分を可視化（意図しない変換の検出）
        run: git diff --exit-code -- styles/tokens.css
      # 差分があった = トークンを更新したが tokens.css の再生成が入っていない
      # （Tokens Studio の Push や手作業でトークンだけ変わった場合）。再生成結果を PR にして人がマージできるようにする
      - name: 再生成した tokens.css を PR にする
        if: failure() && steps.snapshot.outcome == 'failure' && github.event_name == 'push'
        uses: peter-evans/create-pull-request@v7
        with:
          branch: tokens/rebuild-css
          title: "トークン: styles/tokens.css を再生成"
          body: "トークン JSON の変更に合わせて変換結果を更新します。差分を確認してからマージしてください。"
```

- **トークンだけが Push された回は、このワークフローが赤くなるのが正常**（`tokens.css` の再生成が入っていないため）。同時に**再生成 PR が自動で起票される**ので、それをマージすれば緑に戻る。Tokens Studio 運用ではこの流れを実装者・デザイナーの双方に伝える。
- PR イベントでは再生成 PR を作らない（失敗メッセージのみ）。開発者が手元で `npx style-dictionary build` して commit する想定。
