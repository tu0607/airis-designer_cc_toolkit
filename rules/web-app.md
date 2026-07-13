# Web アプリ変換ルール（`webTarget: app`）— React + Vite + TypeScript

Web ターゲットの変換ルール。`common.md` を前提に、確定したスタックに沿った実装指針を定めます。
> このファイルはテンプレートです。自社のデザインシステム・規約に合わせて調整してください。

**このファイルは Web ルールの入口**（スタック・ファイル構成・コンポーネント規約・状態管理・a11y・Lint・やらないこと）。
工程ごとに 5 ファイルへ分かれているので、**必要な工程のファイルだけを読む**:

| ファイル | 何が書いてあるか | いつ読むか |
| --- | --- | --- |
| **`web-app.md`**（このファイル） | スタック / ファイル構成 / コンポーネント規約 / 状態管理 / a11y / Lint / やらないこと | **常に最初** |
| `web-app-styling.md` | トークン → `styles/tokens.css` の変換、クラスの選び方、`cn()` の拡張 | スタイルを当てるとき |
| `web-app-storybook.md` | ストーリーの書き方、GitHub Pages への公開、実装者への案内 | ストーリーを書くとき |
| `web-app-testing.md` | テスト 3 層（①部品 / ②画面 / ③見た目）と devDependencies | テスト成果物を作るとき |
| `web-app-ci.md` | `.github/workflows/` のワークフロー雛形 | CI を置くとき |
| `web-app-selfcheck.md` | 生成後の静的検査（`scripts/selfcheck.mjs`）の検査項目と扱い方 | **Push 前に必ず** |

## 生成直前チェックリスト（**書き始める前に読む**）

規約は分割しても総量は多いので、**間違えやすい 10 点**だけを先に置く（根拠は §7「やらないこと」と各ファイル）。

1. **shadcn/ui で表せる部品は手書きしない** → `npx shadcn@latest add <部品>` で導入する（手書きすると本物の API からずれる。これはファイル取得なので原則 2 の対象外）
2. クラス名は**`CLAUDE.md` ステップ 6 の逆引き表**から取る。arbitrary value（`p-[13px]`）と生パレット（`bg-blue-500`）は書かない
3. variant は **CVA** に隔離する。`className={cond ? 'a' : 'b'}` を書かない
4. 自作部品の boolean props は **`is` 接頭辞**（`components/ui/` の shadcn 派生は shadcn の API を尊重して改名しない）
5. `components/common/` は **named export**、`components/ui/` は shadcn 慣習（小文字ファイル名）
6. 関数コンポーネントのみ。データ取得は **TanStack Query**（`useEffect` で取得しない）
7. **コンポーネントを作ったら同時にストーリーも作る**（後で足す作業にしない）。`tags: ['vrt']` は付けない
8. 画面を作ったら `tests/e2e/*.spec.ts` の雛形も置く
9. **独自の書体トークン（`--text-*`）がある案件は `cn()` を拡張する**（素の `twMerge` だと `text-<書体>` が文字色と誤判定され、**文字色が黙って消える**。`web-app-styling.md` §5）
10. **`shadcn add` が入れる `lucide-react` の import は、デザインソース側のアイコンに差し替える**（デザインシステムを作る案件で外部のアイコン集に依存させない。対応が無いものは CSS で描くか、デザインソース側への追加を診断で挙げる）

## 1. スタック（確定）

| 項目 | 決定 |
| --- | --- |
| 言語 / コンポーネント | React 19 + TypeScript（**関数コンポーネントのみ**） |
| ビルド | **Vite** |
| ルーティング | **React Router**（library mode。画面を生成する場合のみ） |
| サーバー状態 | **TanStack Query**（データフェッチ・キャッシュ・mutation） |
| クライアント状態 | **useState / useReducer → useContext → zustand** を範囲で使い分け（§4） |
| フォーム | **React Hook Form + Zod**（セットで採用。shadcn/ui の Form と統合） |
| スキーマ | **Zod**（API 境界・フォーム・URL クエリの検証。型は `z.infer` で導出） |
| スタイリング | **Tailwind CSS v4**（`@theme` = Style Dictionary の出力）+ **CVA** |
| コンポーネント | **Radix UI + shadcn/ui**（a11y はヘッドレスの Radix が担保。コードは手元にコピーされる） |
| Storybook | `@storybook/react-vite`。コンポーネントごとに生成（Autodocs + play + a11y）。**公開は GitHub Actions → GitHub Pages**（ローカル起動は前提にしない） |
| テスト | ①部品= `@storybook/test-runner`(play/a11y) / ②画面= `@playwright/test`(E2E) / ③見た目= `@playwright/test`(VRT。撮影対象は Storybook のストーリー)。**Vitest は使わない** |
| Lint / 整形 | **ESLint（検査）+ Prettier（整形）** の責務分割 |

## 2. ファイル構成（Feature-based）

**Feature-based 構成**を採用する（Atomic Design は使わない。分類コストが高い割にメリットが小さい）。
生成物は **Push 先リポジトリの作業ツリーへ直接書く**（`output/` へ書いてから配置し直す二段構えはしない。`CLAUDE.md` ステップ 8）。

**置き場所は 2 種類ある。混ぜないこと**（ここを間違えると CI のパスが全部ずれる）:

**(1) リポジトリのルート直下に固定** — CI・ツールが root 相対で参照するため、配置先ディレクトリの中には入れられない

```
<リポジトリのルート>/
├── CLAUDE.md                       # 受け取った人が Claude Code を起動する場所の入口
│                                   #   Airis の所在と参照の読み替え / 固有値 / 守ること / 検査コマンド
│                                   #   （無いと 2 回目以降の更新で原則が全部外れる。`handoff.md` §1）
├── .claude/
│   ├── commands/                   # そのリポジトリ向けの入口（マージ提案）
│   └── settings.json               # 検査コマンドの許可設定（Airis の実パスへ置換して生成）
├── tokens/                         # トークンの正本（DTCG 形式。common.md §2）
│   ├── core/                       #   ブランドの根源（最低限）
│   └── product/<プロダクト名>/mode/  #   default/（必須・作り込みの主戦場）+ 必要なモードの差分 + README.md
│                                   #   生成コードと同じ PR に入れる（Claude が commit / push する）
├── config/
│   └── sd.config.js                # Build Target: Style Dictionary 設定
│                                   #   （core → mode/default → 有効モード の順で結合し styles/tokens.css を出力）
├── tests/
│   ├── e2e/kebab-case.spec.ts      # ② Playwright: 画面のできることの受け入れ基準（雛形）
│   └── vrt/
│       ├── storybook.spec.ts       # ③ Playwright: Storybook のストーリーを撮って比較（`web-app-testing.md` §4）
│       └── __screenshots__/        # baseline PNG（CI 環境で撮る。昇格済みのみ）
├── playwright.config.ts            # ② 用（既存ならマージ提案・無ければ生成。webServer + reporter が必須）
├── playwright.vrt.config.ts        # ③ 専用（② とは分ける。`web-app-testing.md` §4 に雛形）
└── .github/
    ├── CODEOWNERS                  # パス単位でレビュー必須の承認者を定義できる仕組み（雛形・マージ提案）
    │                               # ※ 設定手順書ファイル（SETUP_GITHUB.md 等）は作らない。案内は PR 本文とチャット（`web-app-storybook.md` §3）
    └── workflows/                          # 汎用名（ci.yml / test.yml 等）は使わない。何を見るかを名前に書く
        ├── storybook-test-and-publish.yml  # Storybook をビルド → ①部品の検査 ③見た目の検査 → 公開
        │                                   #   jobs: build-storybook / component-test /
        │                                   #         visual-regression-test / publish-to-pages
        ├── story-test.yml                  # ② 画面のできることを検査（Playwright E2E。Storybook 不使用）
        ├── vrt-baseline-update.yml         # ③ の見本画像を更新（手動実行 → PR 起票）
        └── design-tokens-build.yml         # トークン JSON → Style Dictionary 出力の検査
```

**(2) 配置先ディレクトリの中**（`CLAUDE.md` ステップ 5 で確認した `src/` 等。ルート直下でも構わない）

```
<配置先>/
├── components/
│   ├── ui/                         # 葉コンポーネント（shadcn/ui 派生。小文字ファイル名・cva）
│   │   ├── button.tsx
│   │   └── button.stories.tsx
│   └── common/                     # 機能横断の複合コンポーネント（PascalCase + 任意接頭辞）
│       ├── SearchField.tsx
│       └── SearchField.stories.tsx
├── features/                       # 機能単位（画面・機能を生成する場合のみ）
│   └── orders/
│       ├── components/             # この機能専用のコンポーネント
│       ├── hooks/                  # この機能専用のフック（TanStack Query の query/mutation 等）
│       ├── pages/                  # 画面（OrdersPage.tsx）
│       └── types/                  # Zod スキーマ + z.infer 型
├── hooks/                          # グローバル hooks
├── lib/                            # ユーティリティ・API クライアント
├── types/                          # グローバル型定義
├── styles/tokens.css               # Style Dictionary が生成（@theme。手編集しない）
├── routes.tsx                      # React Router のルート定義（画面生成時のみ。移植先へはマージ提案）
└── assets/                         # 画像（images/）・アイコン（icons/）
```

> **配置先が `src/` の場合、`sd.config.js` の出力先と各ワークフローの `styles/tokens.css` は `src/styles/tokens.css` に置換する**（`CLAUDE.md` ステップ 8）。雛形はルート直下の前提で書いてあるので、ここを直さないと「トークンが反映されているか確認」ステップが必ず落ちる。
>
> **既存ファイルは無断上書きしない**: `vite.config` / `.storybook/` / Playwright・ESLint・Prettier 設定 / `routes.tsx` は移植先に既存の可能性が高いので、**「マージ提案」**として提示する。
> 特に **`.storybook/preview.ts` への a11y パラメータ追加**（`web-app-testing.md` §2）と **`playwright.config.ts` への `webServer` / `reporter` 追加**（`web-app-testing.md` §3）は、既存ファイルへの**差分提案**として明示的に伝えること（これが入らないと CI が素通り・空振りする）。

## 3. コンポーネントの書き方・API 規約

### 3.1 レイヤーと命名

| レイヤー | 置き場所 | 命名 | 規約 |
| --- | --- | --- | --- |
| 葉（汎用 UI 部品） | `components/ui/` | shadcn/ui 慣習（小文字ファイル: `button.tsx`、接頭辞なし） | shadcn/ui からの導入・派生。**API（`disabled` 等）は shadcn/Radix のまま尊重し、改名しない** |
| 複合（機能横断） | `components/common/` | **PascalCase + 任意接頭辞**（named export） | 自作。§3.2 以降の規約に従う |
| 機能専用 | `features/<機能>/components/` | 同上 | 自作。§3.2 以降の規約に従う |

- 接頭辞は `config/project.local.json` の `web.componentPrefix` で設定する（**ツールの既定は接頭辞なし**。例: `"App"` を設定すると `AppSearchField.tsx`）。
- Figma のレイヤー名から意味のある名前へ整える（`Frame 12` → `PrimaryButton`）。連番・略語のままにしない。
- Figma のデザインが shadcn/ui の既存部品（Button / Input / Dialog 等）で表せる場合は、**新規に作らず shadcn/ui を導入してトークンでスタイルを合わせる**。表せない場合のみ自作する。

#### 3.1.1 共通層への「昇格」ルール

- 生成した自作コンポーネントの置き場所は**既定でプロダクトローカル**（`features/<機能>/components/`）。昇格前のローカルコンポーネントは各プロダクト側に置くことが公式に許可されている。
- **共通層（`components/common/` = 公式カタログ掲載）への昇格は人間のプロセス**であり、Claude が勝手に行わない:
  - 昇格候補の条件 = **2 プロダクト以上で同一用途が発生した時点**（1 プロダクトでの汎用化予測は禁止）
  - 昇格時に Props API 設計・アクセシビリティ・Token 準拠のレビューを通過すること（**複数観点のダブル承認**。承認者はプロジェクトで定める）
- 生成時に「これは昇格候補になりそう」と気づいた場合は、勝手に common へ置かず**報告に添える**にとどめる。

### 3.2 props（自作コンポーネント）

- camelCase。**boolean は `is` / `has` で始める**。**状態は `is`**（`isDisabled` / `isLoading` / `isOpen` / `isReadonly`）、**要素の有無は `has`**（`hasIcon` / `hasBadge` / `hasLabel`）。
  - Figma のプロパティ名もこれに揃える（`scripts/lint-naming.mjs` が機械検査する。`common.md` §9.1）。
  - `can` / `should` も可（能力・推奨を表す場合。セルフチェックの `boolean-prefix` はこの 4 つを許容する）。
- 見た目のバリエーションは **CVA の variants で定義し、props の型は `VariantProps` から導出**する（文字列自由入力にしない）:
  - `variant: 'primary' | 'secondary' | 'ghost' | 'danger'` / `size: 'sm' | 'md' | 'lg'`
  - 標準語彙は上記を基本とし、Figma のバリアント名がこれで表せない場合のみ追加する。
- 標準 props 名（同じ意味には同じ名前を使う）: `label`, `variant`, `size`, `isDisabled`, `isLoading`, `error`（エラー文言, `string`）。
- shadcn/ui 部品へ渡す内側ではネイティブ名（`disabled={isDisabled}`）に変換する。**外向き API は `is` / `has` で統一**。
- `any` を避け、props は `interface Props` で型を付ける。

### 3.3 コールバック

- **`onXxx` + 命令形カテゴリ名**（`onClick`, `onSubmit`, `onChange`, `onClose`）。過去形にしない。

### 3.4 children / 差し込み

- テキストだけなら `children` より **`label` props を優先**（Storybook の args で扱いやすい）。
- 複数の差し込み口が要る場合のみ `ReactNode` 型の named props（`header`, `iconLeading` 等）を使う。

### 3.5 実装スタイル

- **関数コンポーネントのみ**（クラスコンポーネントは書かない）。ロジックが太る場合は `hooks/useXxx.ts` へ切り出す。
- **生成される葉・複合コンポーネントはプレゼンテーショナル**にする: props で受け取り、コールバックで返すだけ。ストア・API に直接依存させない。
- テンプレートは意味的な HTML 要素を使う（`<button>`, `<nav>`, `<ul>`。`<div>` 乱用禁止）。

## 4. 状態管理・データ取得・フォーム

### 状態の置き場所（使い分けフローチャート）

```
この状態はサーバーから取得したデータか？
  ↓ Yes → TanStack Query
  ↓ No（クライアント状態）
一つのコンポーネント内で完結するか？
  ↓ Yes → useState / useReducer
  ↓ No（複数コンポーネントにまたがる）
特定のツリー内だけか？
  ↓ Yes → useContext
  ↓ No（アプリ全体）
  → zustand
```

- **zustand が必要な場面は限定的**（ログインユーザー情報・権限程度を想定）。安易にグローバル化しない。
- zustand のストアはグローバル `hooks/`（例: `useAuthStore.ts`。zustand のストアはフックとして定義される）に置く。用途が限定的なため専用ディレクトリは作らない。
- **`useEffect` でデータ取得しない**（TanStack Query に寄せる。`useEffect` は外部システムとの同期のみ）。
- Query の定義（queryKey / queryFn / mutation）は `features/<機能>/hooks/` に置く。

### フォーム（React Hook Form + Zod）

- フォームは **React Hook Form（非制御ベース）で管理**する。RHF と Zod は**セットで採用**（`zodResolver`）。
- **Zod スキーマ 1 つからバリデーションルールと TypeScript 型（`z.infer`）を同時に得る**。型とスキーマを二重定義しない。
- shadcn/ui の **Form コンポーネント**（`FormField` 等）を使って RHF と統合する。
- RHF の管理外に置く単発の入力（検索ボックス等）のみ controlled（`value` + `onChange`）でよい。

### スキーマ（Zod）

- API レスポンスは境界（`lib/` の API クライアント or `features/<機能>/types/`）でスキーマ `parse` して信頼できる型にする。
- URL クエリパラメータを状態として使う場合も、同じスキーマ資産で検証する。

### アクセス制御のあるコンテンツ

- 権限による表示の出し分け（有料会員のみ・管理者のみ等）の**保護は API 側の認可で担保**する（権限のないユーザーにはデータ自体を返さない）。
- クライアント側の出し分けは「見せ方の調整」にすぎず、**セキュリティ境界として扱わない**（生成時にこの前提が崩れそうな要求を受けたら指摘する）。
- **外部サービス（LLM / RAG / 決済等）の API キーをクライアントに置かない・直接通信を書かない**。呼び出しは必ずサーバー側（自プロダクトの API または BFF）を経由する（生成時に直接通信の要求を受けたら指摘し、経由エンドポイントの前提でコードを書く）。

## 5. アクセシビリティ

**a11y の目的は利用者の操作性向上**（キーボード操作・フォーカス管理・スクリーンリーダー対応）。

- インタラクティブな挙動を持つ部品（ダイアログ / メニュー / コンボボックス / タブ等）は **shadcn/ui（= Radix UI）を使う**ことで WAI-ARIA 準拠を担保する。自前実装しない。
- **Behavior（Radix Primitives）は「選定済み依存」であり、デザイン意思決定の外**に置く（通常の依存パッケージとしてバージョン管理する）。Style と Behavior の分離により、意思決定はトークンとスタイルに集中できる。
- 自作部分はセマンティック HTML（`<button>`/`<nav>`/`<ul>`…）+ ラベル紐付け（`<label htmlFor>`）+ フォーカスリングを守る。
- **すべてのインタラクティブ要素・値を持つ要素に「読み上げ名」があるか**を生成時に確認する。**見た目にラベルがあることと、読み上げ名が付いていることは別**であり、ここが最も落ちやすい:
  - **テキストを内包しない部品**（`role="progressbar"` / slider / meter、アイコンのみのボタン）は、そのままでは名前がゼロになる。`aria-label` か `aria-labelledby` を必ず付ける（装飾 SVG は `aria-hidden="true"`）。
  - **`role="combobox"` のトリガー**（shadcn/ui の Select など `<button>` 実装のもの）は、**`<label htmlFor>` では紐付かない**（`<label>` が結び付けられるのはフォームコントロールであり、`<button>` は対象外）。**label の `id` を `aria-labelledby` に渡す**（または `aria-label`）。
- コントラスト不足が疑われる箇所は、**生成前に `common.md` §9 の診断で挙げる**（勝手に色を変えて解決しない）。
  - CI ではコントラストのみ**暫定で「要確認」扱い**にしている（`web-app-testing.md` §2）。**落ちないことは「直さなくてよい」ではない** — 是正はトークン側で行い、暫定である旨を PR 本文に残す。
  - **文字色が意図せず消えていないかも疑う**。独自の書体トークンを使う案件では `cn()` の未対応でコントラスト違反が量産される（`web-app-styling.md` §5）。
- Storybook の a11y アドオンと `eslint-plugin-jsx-a11y` で機械検査する。

## 6. Lint / 整形（ESLint + Prettier の責務分割）

**検査 = ESLint / 整形 = Prettier** に責務を分割する。

- **ESLint（flat config）**: `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y`。コードの正しさの検査に専念する。
  - **`eslint-config-prettier` を設定の最後に置き**、ESLint 側の整形系ルールを無効化する（責務の境界線。順番を間違えない）。
- **Prettier**: 整形に専念。設定は最小限（`.prettierrc` はチーム標準に従う）。
- **TypeScript 運用**: `strict: true` を**最初から**有効にする（後から入れると地獄）。`@typescript-eslint/no-explicit-any` は導入から 3 ヶ月は `warn`、以降 `error` へ昇格する。
- 生成コードは初めからこの規約に準拠させる。
- 移植先が別の Lint / 整形設定を持つ場合は**移植先に合わせて調整**し、設定ファイルを無断上書きしない。

## 7. やらないこと

**この一覧の大半は `scripts/selfcheck.mjs` が機械検査する**（`web-app-selfcheck.md`）。ルールとして守るだけでなく、生成後に必ず検査を通す。

- クラスコンポーネント（関数コンポーネントに統一）。
- `useEffect` でのデータ取得（TanStack Query を使う）。
- Redux（TanStack Query + zustand で代替。ボイラープレート過多）。
- フォーム状態の自前管理（React Hook Form を使う）。
- インタラクティブ部品（ダイアログ・メニュー等）の自前実装（shadcn/ui = Radix を使う）。
- Atomic Design のディレクトリ分類（Feature-based で十分）。
- ランタイム CSS-in-JS（styled-components / emotion 等。スタイルは Tailwind + CVA）。
- `bg-blue-500` のような生パレット参照・arbitrary value 乱用（セマンティックなトークンを使う）。
- **独自の書体トークンを使う案件で `cn()` を素の `twMerge` のままにすること**（文字色が黙って消える。`web-app-styling.md` §5）。
- **読み上げ名の無いインタラクティブ要素・値要素**（アイコンボタン / progressbar / `role="combobox"` のトリガー。§5）。
- クラス文字列の三項演算子分岐（variant は CVA に隔離）。
- 葉コンポーネントへのストア/API 直結（プレゼンテーショナルに保つ）。
- 型とスキーマの二重定義（Zod スキーマから `z.infer` で導出）。
- 手書き Vitest テストの生成。
- **`story-play` の WARN を消すための形だけの `play` 関数**（「要素が存在する」だけを見るもの。壊れても気付けないうえ「テストがある」と誤認させる。省略してよいケースは `web-app-storybook.md` §1）。
- **Storybook の共有をローカル起動前提にする**こと（デザイナーへの確認は公開 URL が既定。`web-app-storybook.md` §2）。
- **Push 前にローカルでテスト・ビルド・Storybook を実行して「検証済み」とすること**（検査は GitHub Actions の役目。`web-app-storybook.md` §2・`CLAUDE.md` 前提の原則 2）。
- **GitHub の設定手順書ファイル（`SETUP_GITHUB.md` 等）の生成**（案内は PR 本文とチャットで済ませる。`web-app-storybook.md` §3）。
- **逆引き表に無い値を arbitrary value や独断のトークン名で埋めること**（`common.md` §9 の診断レポートに回す）。
- VRT の Chromatic 利用（スナップショット数課金がモード Token の増加と相性が悪い。Playwright 自前構築で代替し、flaky 対策・差分レポートを構築スコープに含める）。
- 移植先の既存設定（vite.config / .storybook / playwright.config / eslint.config / .prettierrc / routes.tsx / CODEOWNERS / **CLAUDE.md / .claude/**）の無断上書き（マージ提案にとどめる）。
- **Push 先に `CLAUDE.md` と `.claude/` を置かずに引き渡すこと**（受け取った人の環境では原則が 1 つも読み込まれない。`handoff.md` §1）。
- **Airis 本体を Push 先へコピーすること**（ルールの正本が 2 つになり、更新が分岐する）。
