# Web アプリ テスト方針 — 3 層（部品 / 画面 / 見た目）

`web-app.md` の一部。**何をどの層で守るか**を定めます。**Vitest は使いません。**
これを回すワークフロー雛形は `web-app-ci.md`、ストーリー自体の書き方は `web-app-storybook.md`。

## 1. 3 層の構成

**Vitest は使わない。** 手書きのユニットテストは生成しない。テストは**下から 3 層**で、**すべて GitHub Actions で実行**する。

| 層 | 何を守るか | 実装 |
| --- | --- | --- |
| ① **コンポーネントテスト** | 部品が単体で正しく動く・使える（操作 → 結果、a11y） | **`@storybook/test-runner`**（Storybook の play + a11y） |
| ② **ストーリーテスト** | 画面で「できること」（ユーザーストーリーの受け入れ基準） | **`@playwright/test`**（`tests/e2e/*.spec.ts`） |
| ③ **VRT** | 見た目が意図せず変わっていない | **`@playwright/test`** + `toHaveScreenshot()`（撮影対象は Storybook のストーリー） |

- **実行タイミングは 3 層とも既定で「開発ブランチ・本番ブランチへの push / PR」**。対象ブランチは `config` の `testing.componentTestBranches` / `storyTestBranches` / `vrtBranches` に従う（③ はコストや差分ノイズが問題なら `["main"]` に絞る）。
- ①（部品）で拾えないものを ②（画面）が、①② で拾えない「見た目」を ③ が拾う。**同じことを二重に書かない**（だから UI のユニットテストは持たない = ストーリーと重複するため）。

## 2. ① コンポーネントテスト（Storybook）
- **Storybook の play（動作）＋ a11y** で担保。CI 実行役は **`@storybook/test-runner`**（Playwright 基盤）。
- 追加のテストファイルは作らず、**ストーリー＝テスト**とする。
- 回し方: Storybook を静的ビルド → CI 内で配信 → test-runner を向ける（同じ成果物を ③ と公開が使い回す。`web-app-ci.md` §1）。
- **a11y は「アドオンを入れるだけ」では CI で落ちない**。`@storybook/addon-a11y` を入れたうえで、**`.storybook/preview.ts` で `test: 'error'` を明示**して初めて test-runner が違反を失敗として扱う（既定は報告のみ）:

```ts
// .storybook/preview.ts（抜粋）— これが無いと a11y 違反があっても CI は緑のままになる
const preview = {
  parameters: {
    a11y: {
      test: 'error', // 'error' = 違反でテスト失敗 / 'todo' = 報告のみ / 'off' = 無効
      // コントラストも含めて落とす。除外は config の testing.a11yReviewOnly に列挙された規則のみ
      // （既定は空。除外を足すときは「なぜ落とさないか」をデザイナーと合意してから）
    },
  },
}
export default preview
```

- **`test` の値と除外する規則は `config` の `testing.a11yTest` / `testing.a11yReviewOnly` に従う**（既定は `error` + `[]` = **すべて落とす**）。ここを勝手に変えない。
- **コントラストは CI で落とす — これは §6 の判断基準に対する意図的な例外。**
  §6 の原則は「デザイン起因は落とさず報告する」だが、コントラストだけは**落とす側に置く**。理由は 2 つ:
  ① **画面に出る文字が読めない**という利用者に直接届く不具合であり、報告して流されると誰も直さない
  ② **`cn()` 未対応で文字色が実行時に消えている**（`web-app-styling.md` §5）という**実装起因の事故が、コントラスト違反という形でしか現れない**。落とさないとこの穴を検出する手段が無くなる
  - **だから「落としたら人に返す」が必ずセット**（§2.1）。返す経路が無いまま落とすのは禁止。
  - **導入時に大量に出る場合の移行手順**（実運用で 84 件出た報告あり。全件デザイン起因だと**無関係なトークン更新 PR まで全部赤くなり作業が止まる**）:
    1. **棚卸しする** — `scripts/contrast.mjs` で全組み合わせを実測し、件数と寄せ先候補の一覧をデザイナーに渡す（`common.md` §9.2）
    2. **`testing.a11yReviewOnly` に `color-contrast` を入れて一旦落とさなくする**（`reviewOnRun: true`。`enabled: false` は a11y パネルからも消えるので使わない）
    3. **PR 本文に「何件を、なぜ、いつまで外しているか」を書く**（「検査していない」ではなく「判断を人に返している」と分かる形で）
    4. **棚卸しが終わったら外して落とす側に戻す。** ここまで行かないと ② の穴が開いたままになる
  - 一時的に外す場合も上記 3 は必須。**黙って外さない。**
- **`parameters.a11y.config` は axe の `configure()` にそのまま渡る**（`options` は `run()` 側）。

### 2.1 赤くなったときにデザイナーへ返す（**a11y で止める運用の前提**）

**a11y で CI を止める設計は、「止まったことがデザイナーに届く」経路が無いと機能しない。**
デザイナーは Actions のログを読まないので、**Claude が読んで翻訳する**（`CLAUDE.md` ステップ 11）。手順は 3 つ:

1. **落ちた層と内容を取る**: `gh pr checks` → 赤いジョブを `gh run view --log-failed`。axe の出力には**規則 ID・該当ストーリー・要素・前景色 / 背景色 / 実際のコントラスト比**が出るので、そのまま材料になる。
2. **原因を 2 つに切り分ける**（**ここを飛ばして「Figma を直してください」と言わない**）:

   | | 見分け方 | 誰が直すか |
   | --- | --- | --- |
   | **実装起因** | トークンの組み合わせ自体は基準を満たしているのに違反が出る（**色が実行時に消えている** = `web-app-styling.md` §5 の `cn()` 未対応、間違ったトークンを当てた、`aria-label` の欠落など） | **Claude が直して再 Push**。デザイナーに何も依頼しない |
   | **デザイン起因** | 前景色 / 背景色の**トークンの組み合わせ自体**が基準未達（`scripts/contrast.mjs` で再現できる） | **デザイナーが Figma の Variable を直す** → 再エクスポート → 再生成 |

3. **デザイン起因だけを、Figma の言葉で返す**: 「どの画面のどの要素が」「どのトークンの組み合わせで」「実測 何:1 / 基準 4.5:1」「Figma のどの Variable をどうすると満たせるか（寄せ先候補）」。`common.md` §9 の診断と同じ書式で出す。

> **本来はここまで来る前に止めたい。** コントラストは**生成前の診断（`common.md` §9.2）で機械計算できる**ので、CI が赤くなるのは**診断をすり抜けた場合の最後の砦**という位置づけにする（`scripts/contrast.mjs`）。診断を省略して CI に判定を任せるのは、往復が 1 回増えるだけで誰の得にもならない。

> Storybook 9 以降は上記だけでよい（test-runner が addon-a11y と統合済み）。**Storybook 8 の場合は** `axe-playwright` を入れて `.storybook/test-runner.ts` の `preVisit`/`postVisit` で `injectAxe` / `checkA11y` を呼ぶ従来のレシピが必要（移植先の Storybook のメジャーバージョンを確認してから生成する）。

## 3. ② ストーリーテスト（画面のできること / Playwright E2E）
- **Playwright E2E**（`@playwright/test`）で「その画面でできること」の回帰を検証する。ファイル名・テスト名は**ユーザーストーリーの文**にする（「〜のとき / 〜すると / 〜になる」）。
- **画面（`features/<機能>/pages/`）を生成する時のみ**、受け入れ基準の**雛形**を `tests/e2e/*.spec.ts` に置く。本体の充実は移植先で行う前提。
- 画面を生成していない案件では、CI 側の該当ジョブごと削る（雛形にコメントで明示する）。

## 4. ③ VRT（見た目の回帰）

> **実行役は `@playwright/test`**（`@storybook/test-runner` ではない）。**撮影対象が Storybook のストーリー**であって、撮る道具は Playwright 本体。
> **なぜ test-runner を使わないか**: `toHaveScreenshot()` は `@playwright/test` のマッチャーであり、Jest 基盤の `@storybook/test-runner` では**使えない**（test-runner でやるなら `jest-image-snapshot` を別途入れることになる）。
> Playwright 本体なら **② と同じランナー・同じレポート**（差分画像つき HTML）・同じ `--update-snapshots` 運用に揃う。
> 役割分担: **① = test-runner（play / a11y）**、**②③ = @playwright/test**。

- **Storybook の静的ビルドを配信し、ストーリーの iframe を直接開いて撮る**。対象ストーリーの列挙は `storybook-static/index.json` から行い、**`vrt` タグの付いたストーリーだけ**を撮る（Storybook の `tags` は `index.json` に出るので、これを opt-in の印にする）。

```ts
// tests/vrt/storybook.spec.ts — Storybook のストーリーを撮って baseline と比較する
import fs from 'node:fs'
import { test, expect } from '@playwright/test'

// index.json には docs エントリも入る（docs も tags を持つ）ので type で必ず絞る
type Entry = { id: string; title: string; name: string; type: 'story' | 'docs'; tags?: string[] }
const index: { entries: Record<string, Entry> } = JSON.parse(
  fs.readFileSync('storybook-static/index.json', 'utf8'), // CWD = プロジェクトルート
)

// 昇格済み（公式カタログ掲載）のストーリーだけを対象にする: tags: ['vrt'] を付けたもの
const targets = Object.values(index.entries).filter((e) => e.type === 'story' && e.tags?.includes('vrt'))

// 対象 0 件のとき Playwright は「No tests found」で失敗する（終了コード 1）。
// VRT 対象は昇格後に人が付けるので、初期状態は 0 件が正常。ダミーの skip で緑を保つ
if (targets.length === 0) {
  test.skip('VRT 対象のストーリーがまだ無い（昇格時に tags: ["vrt"] を付ける）', () => {})
}

for (const story of targets) {
  test(`${story.title} / ${story.name} の見た目が変わっていない`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${story.id}&viewMode=story`)
    await page.waitForSelector('#storybook-root')
    await expect(page).toHaveScreenshot(`${story.id}.png`)
  })
}
```

```ts
// playwright.vrt.config.ts — VRT 専用（② の playwright.config.ts とは分ける）
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/vrt',
  // baseline の置き場所。環境は CI のコンテナで固定するので OS 名は入れない
  snapshotPathTemplate: 'tests/vrt/__screenshots__/{arg}{ext}',
  // ↓ 必須。既定の reporter では playwright-report/ が作られず、差分画像を CI 成果物に残せない
  reporter: [['html', { open: 'never' }]],
  // 静的ビルドをそのまま配信する（CI では事前ビルド済みの storybook-static を使う）
  webServer: {
    command: 'npx http-server storybook-static -p 6006 -s',
    url: 'http://127.0.0.1:6006',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:6006',
    ...devices['Desktop Chrome'],
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' }, // flaky 対策
  },
})
```

- **VRT 対象への追加は人間のプロセス**（`web-app.md` §3.1.1 の昇格と同じ）。Claude は生成時に `tags: ['vrt']` を**付けない**。昇格の合否判定を経てから人が付ける。
  - **昇格時の手順（順番を守る）**: ① ストーリーに `tags: ['vrt']` を付ける → ② **先に `vrt-baseline-update.yml` を手動実行して baseline を作る** → ③ その PR をマージ。
    この順を守らないと、baseline が無い状態で VRT が走り「A snapshot doesn't exist」で**必ず落ちる**（Playwright は CI で欠損スナップショットを失敗として扱う）。
- **①③ は CI でも別ジョブにする**（③ だけ**描画環境を固定したコンテナ**で走らせる）。
- **コンテナのタグと `@playwright/test` のバージョンは必ず一致させる**（`mcr.microsoft.com/playwright:v<X.Y.Z>-noble` の `<X.Y.Z>` = `package.json` の `@playwright/test`）。ずれるとブラウザが見つからず起動時に失敗する。バージョンを上げるときは **baseline の撮り直しとセット**で行う（描画が変わるため）。
- **baseline PNG はリポジトリ管理**。**差分の合否判定は人が行い**（判定者はプロジェクトで定める。機械では判定しない）、意図した変更のみ更新する。更新は手動ワークフロー（`vrt-baseline-update.yml`。`web-app-ci.md` §1.3）で PR として起票する（`main` へ直接コミットしない）。
  - **baseline をローカルで更新しない**。手元（macOS 等）で `--update-snapshots` すると CI（Linux コンテナ）と描画が違う画像が入り、**以後 CI が延々と落ちる**。撮影は必ず CI の手動ワークフローで行う。
- **`reporter: 'html'` は ② の `playwright.config.ts` にも必須**（`web-app.md` §2 の注記と同じ理由。無いと `playwright-report/` が作られず成果物のアップロードが空振りする）。
- flaky 対策（フォント固定・アニメーション無効・閾値調整・時刻/乱数固定・データモック）と、**PR への before / after / diff の自動コメント**は基盤構築のスコープ。CI は **Linux/Docker で環境固定**（`testing.playwrightImage`。baseline を撮った版から勝手に上げない）。
- **VRT が失敗しても Pages への公開は止めない**（`web-app-storybook.md` §2）。「見た目が変わった」は不具合とは限らず、人が見比べて判断するため。

## 5. 必要な devDependencies と npm スクリプト（雛形の前提）

雛形の CI は以下が**移植先の `package.json` に入っていること**を前提にする。`npx` の暗黙ダウンロード任せにしない（CI で version が揺れる・ネットワーク依存で不安定になる）。
足りないものは**インストールコマンドを添えて報告**する（Claude が勝手に `package.json` を書き換えない）。

| パッケージ | 用途 |
| --- | --- |
| `style-dictionary` | トークン JSON → `styles/tokens.css` の生成（全ジョブの前段） |
| `@storybook/test-runner` | ① play / a11y の実行役 |
| `@storybook/addon-a11y` | ① の a11y 検査（+ `preview.ts` の `test: 'error'`） |
| `@playwright/test` | ②③ の実行役。**コンテナのタグと同じ版に揃える** |
| `http-server` | Storybook 静的ビルドの配信（①③ とも使う） |
| `concurrently` / `wait-on` | ① で「配信 → 起動待ち → test-runner」を繋ぐ |
| `axe-playwright` | **Storybook 8 の場合のみ**（9 以降は不要） |

> **`npm install` で非推奨警告が十数行出るが、導入を止める必要はない。** 出どころは `@storybook/test-runner`（Jest 基盤）の推移的依存（`inflight` / `rimraf@3` / `glob@7` / `uuid@8` / `jest-process-manager` / `expect-playwright`）。
> **`@storybook/test-runner` 自体は非推奨ではない**ので、警告が出ること自体は不具合ではない。**導入時に利用者が不安になって手が止まるので、先に一言伝える。**
> ① を `@playwright/test` に寄せればこの依存はまるごと消えるが、test-runner が持つ機能（ストーリー index の取得・失敗時のストーリー名表示・並列制御）を雛形側で持つことになる。**急ぎではない**ので、乗り換えるかは案件ごとに判断する。

npm スクリプトは移植先の慣習に合わせる。雛形は次を前提に書いてある（違う名前なら CI 側を置換する）:
`build`（アプリのビルド）/ `build-storybook`（出力先 `storybook-static`）/ `storybook`（ローカル起動）。

## 6. デザイン起因の検査を「落とさずに届ける」

**判断基準はこの 1 行**:

> **実装起因は落とす / デザイン起因は落とさず報告する。**（例外は §2 のコントラスト。理由もそこに書いてある）

デザイン起因の検査（命名 lint = `scripts/lint-naming.mjs`、トークン化されていない直値の検出など）を `exit 1` にすると:

- 違反は**デザインソース側の問題で、直すのは人**。Claude が直せない
- **Figma を直すまで無関係なトークン更新 PR まで全部赤くなり、作業が止まる**

一方、**警告をログに出すだけではデザイナーは読まない**（原則 1: Actions のログを読ませない）。そこで**落とさずに、読まれる場所に出す**:

| # | 手段 | 何が起きるか |
| --- | --- | --- |
| ① | `::warning file=<path>,title=<件名>::<内容>` | **PR の画面に注釈として出る**（Files changed に並ぶ） |
| ② | `$GITHUB_STEP_SUMMARY` に表を追記 | **ログを掘らずジョブのサマリで読める** |
| ③ | 違反の終了コードは `0`（`--strict` で落とせる余地を残す） | PR を止めない |
| ④ | **「検査できていない」だけは落とす**（終了コード `2`） | 緑のまま「検査した」ことになるのを防ぐ |

**①〜④ は `scripts/lint-naming.mjs` に実装済み**なので、CI 側は呼ぶだけでよい:

```yaml
      - name: 命名の検査（違反では落とさない。検査できないときだけ落とす）
        # `|| true` を付けない。付けると JSON が壊れていても（終了コード 2）緑になり、
        # 「検査した」ことになってしまう（`common.md` §9.1 の終了コードの区別）
        run: node <Airis>/scripts/lint-naming.mjs tokens/.meta/components.json
        # ★ 既存違反を直し終えたら --strict を付けて落とす側に移す
```

- **④ が肝。** 違反（デザイン起因）では落とさないが、**読み込み失敗は落とす**。この 2 つを混ぜると、検査が空振りしていても気付けない。
- **「暫定で落とさない」は書き残さないと恒久化する。** `--strict` への移行条件をコメントに残し、**PR 本文にも書く**（`CLAUDE.md` ステップ 11 の 4）。
- **①② はどちらも必要。** ① だけだと注釈を見ない人に届かず、② だけだとサマリを開かない人に届かない。
- 落ちない検査でも **Claude は結果を読んでデザイナーに翻訳する**（`CLAUDE.md` ステップ 11-1 と同じ扱い。緑だから見ない、にしない）。
- **自作の検査を足すときも同じ形に揃える**（違反 = `0` + 注釈 + サマリ / 検査不能 = `2`）。
