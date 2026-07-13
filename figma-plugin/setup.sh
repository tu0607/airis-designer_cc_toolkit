#!/bin/sh
# =============================================================================
# Airis Design Tokens Export（Figma プラグイン）のセットアップ
#
# 使い方（Airis のディレクトリで）:
#   sh figma-plugin/setup.sh
#
# 依存の導入 → ビルド → 自己テストまでを 1 コマンドで行い、
# 最後に「Figma に読み込ませるファイルのパス」を表示します。
#
# 何度実行しても安全です。どのディレクトリから実行しても動きます。
# =============================================================================
set -eu

# このスクリプトの場所を基準にする（実行時のカレントディレクトリに依存しない）
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

info() { printf '\033[1;34m[Airis]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[Airis]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[Airis]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[Airis] エラー:\033[0m %s\n' "$1" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 1. 前提チェック
# ----------------------------------------------------------------------------
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

# ----------------------------------------------------------------------------
# 2. 依存の導入（初回のみ時間がかかります）
# ----------------------------------------------------------------------------
cd "$PLUGIN_DIR"

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
npm test >/tmp/airis-plugin-test.log 2>&1 || {
  warn "自己テストが失敗しました。詳細:"
  tail -30 /tmp/airis-plugin-test.log >&2
  fail "src/code.ts を直してから再実行してください（ログ: /tmp/airis-plugin-test.log）。"
}
[ -f dist/code.js ] \
  || fail "ビルド結果 dist/code.js が作られませんでした（ログ: /tmp/airis-plugin-test.log）。"

grep -E '合計: .*件成功' /tmp/airis-plugin-test.log | tail -1 | sed 's/^/  /' || true
ok "ビルドと自己テストが完了しました"

# ----------------------------------------------------------------------------
# 完了 — Figma への読み込み手順
# ----------------------------------------------------------------------------
ok "準備完了！🌈"
printf '\nFigma に読み込ませる手順:\n'
printf '  1. Figma デスクトップアプリを開く\n'
printf '  2. メニュー → Plugins → Development → Import plugin from manifest…\n'
printf '  3. 次のファイルを選ぶ（パスをコピーして貼り付けられます）:\n\n'
printf '     %s/manifest.json\n\n' "$PLUGIN_DIR"
printf '  4. Plugins → Development → Airis Design Tokens Export を実行\n'
printf '  5. 警告が出ていないことを確認して tokens.bundle.json をダウンロード\n'
printf '  6. Claude Code で /design-to-code を実行し、そのファイルのパスを渡す\n\n'
printf 'src/code.ts を編集したら、このスクリプトをもう一度実行してください。\n\n'
