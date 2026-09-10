#!/bin/sh
# =============================================================================
# Airis Design Tokens Export（Figma プラグイン）のセットアップ
#
# 使い方（利用者のプロジェクトのルート = .airis/ があるディレクトリで。/airis:build-plugin が実行する）:
#   sh "<Airis>/figma-plugin/build.sh"
#
# 依存の導入・更新（npm install）→ ビルド → 自己テストを 1 コマンドで行い、
# 最後に「Figma に読み込ませるファイルのパス」を表示します。
#
# 書き込み先はすべてプロジェクト側（<Airis> = プラグインのキャッシュには何も書かない）:
#   .airis/work/figma-plugin/   ビルド作業場（ソースの複製・node_modules・dist・test.log。gitignore 済み）
#   figma-plugin/               Figma が読む 3 ファイル（manifest.json / code.js / ui.html）+ README。プロジェクト直下。小さいのでコミットして共有する
#                               （.airis/ の中に置かないのは、隠しフォルダだと Figma のファイル選択画面で見つけにくいため）
#
# 何度実行しても安全です。Airis を更新したら再実行してください（同じ場所に上書きされるので Figma の再読み込みは不要）。
# figma-plugin/ はコミットして共有するので、クローンした人はビルド不要です。
# =============================================================================
set -eu

# このスクリプトの場所 = プラグイン本体（読むだけ。書かない）
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

info() { printf '\033[1;34m[Airis]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[Airis]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[Airis]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[Airis] エラー:\033[0m %s\n' "$1" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 1. 前提チェック
# ----------------------------------------------------------------------------
[ -d .airis ] \
  || fail "カレントディレクトリに .airis/ がありません。プロジェクトのルートで実行してください（先に /airis:setup を実行する）。"

command -v node >/dev/null 2>&1 \
  || fail "Node.js が見つかりません。https://nodejs.org からインストールしてください（v22 以上）。"
command -v npm >/dev/null 2>&1 \
  || fail "npm が見つかりません。Node.js を https://nodejs.org から入れ直してください。"

NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
case "$NODE_MAJOR" in
  ''|*[!0-9]*) fail "Node.js のバージョンを判定できませんでした（node -v: $(node -v)）。" ;;
esac
[ "$NODE_MAJOR" -ge 22 ] \
  || warn "Node.js が v$NODE_MAJOR です。プラグインのビルドは動きますが、Airis 本体は v22 以上を前提にしています。"

ok "Node.js $(node -v) を確認しました"

PROJECT=$PWD
BUILD="$PROJECT/.airis/work/figma-plugin"
OUT="$PROJECT/figma-plugin"

# work/ が gitignore されていることを保証する（node_modules をコミットさせない）
grep -qx 'work/' .airis/.gitignore 2>/dev/null || printf 'work/\n' >> .airis/.gitignore

# ----------------------------------------------------------------------------
# 2. ソースを作業場へ複製し、依存を導入・更新（初回のみ時間がかかります）
# ----------------------------------------------------------------------------
mkdir -p "$BUILD"
cp "$PLUGIN_DIR/package.json" "$PLUGIN_DIR/package-lock.json" "$PLUGIN_DIR/tsconfig.json" "$BUILD/"
cp -R "$PLUGIN_DIR/src" "$PLUGIN_DIR/test" "$BUILD/"
cd "$BUILD"

if [ -d node_modules ]; then
  info "依存は導入済みです（更新を確認します）..."
else
  info "依存を導入しています（初回は少し時間がかかります）..."
fi
npm install --no-fund --no-audit --loglevel=error \
  || fail "依存の導入に失敗しました。ネットワークを確認して再実行してください。"
ok "依存を導入しました"

# ----------------------------------------------------------------------------
# 3. ビルド + 自己テスト
# ----------------------------------------------------------------------------
info "ビルドと自己テストを実行しています..."
npm test >test.log 2>&1 || {
  warn "自己テストが失敗しました。詳細:"
  tail -30 test.log >&2
  fail "Airis 側の不具合の可能性があります。ログ（$BUILD/test.log）を添えて報告してください。"
}
[ -f dist/code.js ] \
  || fail "ビルド結果 dist/code.js が作られませんでした（ログ: $BUILD/test.log）。"

grep -E '合計: .*件成功' test.log | tail -1 | sed 's/^/  /' || true
ok "ビルドと自己テストが完了しました"

# ----------------------------------------------------------------------------
# 4. Figma が読む 3 ファイルだけをプロジェクト直下の figma-plugin/ に置く
#    フラットに置き、manifest の main/ui もそれに合わせる
#    （dist/ を無視する .gitignore を持つプロジェクトで code.js だけが黙って落ちるのを防ぐ）
# ----------------------------------------------------------------------------
if [ "$OUT" = "$PLUGIN_DIR" ]; then
  # Airis 本体のリポジトリで実行した場合: 出力先がソースと同じ。manifest は dist/code.js を指すので dist/ にだけ置く
  mkdir -p "$OUT/dist" && cp "$BUILD/dist/code.js" "$OUT/dist/"
else
mkdir -p "$OUT"
cp "$BUILD/dist/code.js" "$OUT/code.js"
cp "$PLUGIN_DIR/src/ui.html" "$OUT/ui.html"
sed -e 's#"dist/code\.js"#"code.js"#' -e 's#"src/ui\.html"#"ui.html"#' "$PLUGIN_DIR/manifest.json" > "$OUT/manifest.json"
cat > "$OUT/README.md" <<'README'
# Airis Design Tokens Export（ビルド済み）

Airis 同梱の Figma プラグインを `/airis:build-plugin` がビルドして置いたものです。**手で編集しないでください**（再実行で上書きされます）。

- Figma への読み込み: Plugins → Development → Import plugin from manifest… → この `manifest.json`
- Airis を更新したら `/airis:build-plugin` を再実行（同じ場所に上書きされるので Figma 側の再読み込みは不要）
- このフォルダはコミットして共有できます（チームの他の人はビルド不要で、上の読み込みだけで使えます）
README
fi

# ----------------------------------------------------------------------------
# 完了 — Figma への読み込み手順
# ----------------------------------------------------------------------------
ok "準備完了！🌈  出力先: $OUT"
printf '\nFigma に読み込ませる手順:\n'
printf '  1. Figma デスクトップアプリを開く\n'
printf '  2. メニュー → Plugins → Development → Import plugin from manifest…\n'
printf '  3. 次のファイルを選ぶ（パスをコピーして貼り付けられます）:\n\n'
printf '     %s/manifest.json\n\n' "$OUT"
printf '  4. Plugins → Development → Airis Design Tokens Export を実行\n'
printf '  5. 警告が出ていないことを確認して tokens.bundle.json をダウンロード\n'
printf '  6. Claude Code で /airis:build-code（トークンだけなら /airis:build-token）を実行し、そのファイルのパスを渡す\n\n'
printf '%s はコミットして共有できます（他の人はビルド不要）。\n' "figma-plugin/"
printf 'Airis を更新したら /airis:build-plugin を再実行してください（Figma の再読み込みは不要）。\n\n'
