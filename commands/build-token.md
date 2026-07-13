---
description: デザイントークンだけを取り込み・更新して PR にする（コード生成はしない）
---

あなたは Airis の**トークンのみ更新**フローを実行します。Figma でトークン（色・余白・角丸・タイポ）だけが変わり、部品のコードは作り直さない回に使います。
**`<Airis>`** = この Airis プラグインのインストール先（セッション開始時の `[Airis] plugin root:` 行、または `echo "${CLAUDE_PLUGIN_ROOT}"` で確認）。
**手順の正は `<Airis>/rules/flow.md`**。このコマンドはそのうち**ステップ 1 → 5 → 6 → 11 だけ**を通るミニフローで、独自の手順は下記の検査 2 つだけ。
`.airis/config.json` が無い場合は、先に `/airis:setup` の実行を案内して止まる。

**`<Airis>/rules/principles.md` の 4 原則に従うこと**（特に: GitHub のブラウザ画面を触らせない / トークンの値を勝手に増やさない・丸めない）。

進め方（挨拶・前置きは書かない）:

1. **トークンの供給源を確定する**（`flow.md` ステップ 6-1 の 4 択。`.airis/config.json` の `tokens.figmaExport` に従う。未設定ならその場で選んでもらい保存）。
   - `tokens-studio` の場合: **プラグインの Push ボタンが別 PR を起票する方式**なので、このコマンドの仕事は同期先からの取り込み確認だけになる。その旨を伝える。
   - 書き出し JSON を受け取る方式の場合: ファイルを受け取り、**前回のハッシュと照合する**（`shasum -a 256`。同一なら「書き出し直されていない」事実を伝えて依頼する。`flow.md` 7-4 と同じ規律）。
2. **Push 先を確認し、作業ツリーを用意する**（`flow.md` ステップ 5。現在のプロジェクト自体が Push 先ならブランチを切るだけ。`npm ci` / `style-dictionary` の確認も同じ）。
3. **トークンを取り込み、変換する**（`flow.md` ステップ 6）:
   - 正本 `tokens/` へ取り込み、**既存トークンとの diff をチャットに提示**する（増えた・消えた・値が変わった、の 3 区分。**消えたトークンは特に目立たせる** — 下記検査 B の理由）。
   - `npx style-dictionary build --config config/sd.config.js` で `styles/tokens.css` を再生成する。
   - 「値 → トークン名」の逆引き表は**変わった分だけ**提示する。
4. **検査 A — 部品の定義が変わっていないか**（`rules/handoff.md` §1 の検査。トークンだけ更新する運用で、Figma のバリアント追加が黙って落ちるのを防ぐ）:

   ```bash
   # 作業ツリー内で実行する（比較元は git に入らない一時ファイルに置く）
   git show HEAD:tokens/.meta/components.json > /tmp/airis-components-before.json
   node <Airis>/scripts/components-diff.mjs /tmp/airis-components-before.json tokens/.meta/components.json
   ```

   - **判定はしない。** 変化が出たら「コードも作り直すか（→ `/airis:build-code`）、今回はトークンだけにとどめるか」を**操作者に選ばせる**（初回は比較元が無いのでスキップ。`components.json` が無い供給方式でも同様にスキップし、その旨を報告する）。
5. **検査 B — 既存コードのクラスが浮いていないか**: トークンの削除・改名は、それを参照している既存コードのクラスを**静かに無効化する**（Tailwind はエラーを出さず、CI も捕まえない）。
   `node <Airis>/scripts/selfcheck.mjs <作業ツリー> --src <既存コードの配置先> --all` を実行し、`@theme` に無くなったクラスが出ないか確認する（**`--all` 必須** — 既定は「今回変更したファイルだけ」なので、トークンしか触っていない回では既存コードが検査されない）。出たら一覧を提示し、**勝手に直さず**扱いを操作者に確認する。
6. **コントラストが変わったトークンは実測し直す**: `node <Airis>/scripts/contrast.mjs <作業ツリー> <変わった組み合わせ>`（`rules/common.md` §9.2）。未達があれば寄せ先候補と一緒に提示し、A（Figma を直す）/ B（この値で進める）を選ばせる。
7. **コミット → Push → PR**（`flow.md` ステップ 11。Push 直前の最終確認・PR 本文の書き方・CI の翻訳まで同じ）。PR 本文には 3 の diff・4/5 の検査結果・6 で保留にした項目を書く。

引数があれば供給源の指定（書き出し JSON のパス、Figma URL など）として解釈してください: $ARGUMENTS
