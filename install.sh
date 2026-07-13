#!/bin/sh
# =============================================================================
# Airis インストーラー
#
# 使い方（推奨）:
#   curl -fsSL https://raw.githubusercontent.com/tu0607/airis-designer_cc_toolkit/main/install.sh | sh
#
# オプション（環境変数で指定）:
#   AIRIS_DIR=airis        インストール先ディレクトリ（既定: ./airis）
#   AIRIS_REPO=<owner/repo または git URL>   取得元（既定: 本家）
#   AIRIS_BRANCH=main      取得するブランチ（既定: main）
#
# 例:
#   AIRIS_DIR=my-airis curl -fsSL https://raw.githubusercontent.com/tu0607/airis-designer_cc_toolkit/main/install.sh | sh
#
# 中身だけを取得します（tarball を展開するので .git は作りません）。
# 何度実行しても安全です（既にインストール済みなら最新版へ更新します）。
#
# 更新時のふるまい（.airis-manifest に記録した取得時のハッシュと照合します）:
#   - 編集していないファイル → 上書きする
#   - 編集したファイル       → 上書きせずスキップして報告（rules/ の自社向け調整を守るため）
#   - 上流から消えたファイル → 片付ける（古いルールが残ると Claude がそれを読むため）
#                              ただし編集済みなら消さずに報告する
#   - 台帳に無いファイル     → 触らない（利用者が自分で足したもの）
# =============================================================================
set -eu

AIRIS_DIR="${AIRIS_DIR:-airis}"
AIRIS_REPO="${AIRIS_REPO:-tu0607/airis-designer_cc_toolkit}"
AIRIS_BRANCH="${AIRIS_BRANCH:-main}"

MANIFEST_NAME=".airis-manifest"   # 取得時点の各ファイルのハッシュ（利用者の編集を見分けるため）
VERSION_NAME=".airis-version"     # 取得元・ブランチ・取得日時

info() { printf '\033[1;34m[Airis]\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m[Airis]\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m[Airis]\033[0m %s\n' "$1"; }
fail() { printf '\033[1;31m[Airis] エラー:\033[0m %s\n' "$1" >&2; exit 1; }

# ----------------------------------------------------------------------------
# 1. 前提チェック
# ----------------------------------------------------------------------------
info "前提を確認しています..."

command -v curl >/dev/null 2>&1 \
  || fail "curl が見つかりません。Airis の取得に必要です。"
command -v tar >/dev/null 2>&1 \
  || fail "tar が見つかりません。Airis の展開に必要です。"

# git は取得には使わないが、生成コードの Push 先を扱うのに必要
command -v git >/dev/null 2>&1 \
  || fail "git が見つかりません。https://git-scm.com からインストールしてください。"

command -v node >/dev/null 2>&1 \
  || fail "Node.js が見つかりません。v22 以上を https://nodejs.org からインストールしてください。"

NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
case "$NODE_MAJOR" in
  ''|*[!0-9]*) fail "Node.js のバージョンを判定できませんでした（node -v: $(node -v)）。" ;;
esac
[ "$NODE_MAJOR" -ge 22 ] \
  || fail "Node.js v22 以上が必要です（現在: $(node -v)）。トークン変換に使う style-dictionary v5 の動作要件です。"

command -v npm >/dev/null 2>&1 \
  || fail "npm が見つかりません。Node.js を https://nodejs.org から入れ直してください。"

ok "git / Node.js $(node -v) を確認しました"

# ----------------------------------------------------------------------------
# 2. Airis の取得（tarball を展開。.git は作らない）
# ----------------------------------------------------------------------------
# git URL でも owner/repo でも受け取れるように owner/repo へ正規化する。
# ホスト名の有無を条件分岐せず「末尾 2 セグメント」を取る（owner/repo をそのまま渡しても壊れない）
SLUG=$(printf '%s' "$AIRIS_REPO" \
  | sed -E -e 's|^git@([^:]*):|\1/|' -e 's|^ssh://git@|https://|' -e 's|^https?://||' \
           -e 's|\.git$||' -e 's|/+$||' \
  | awk -F/ 'NF>=2 { print $(NF-1) "/" $NF }')
case "$SLUG" in
  */*) : ;;
  *) fail "AIRIS_REPO を owner/repo として解釈できませんでした（${AIRIS_REPO}）。" ;;
esac

# ハッシュ計算（sha256sum / shasum のどちらかを使う）
if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  hash_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  fail "sha256sum / shasum が見つかりません。更新時に編集を守るために必要です。"
fi

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t airis)
trap 'rm -rf "$TMP"' EXIT INT TERM

info "Airis を取得しています（$SLUG@${AIRIS_BRANCH}）..."
TARBALL="$TMP/airis.tar.gz"
if ! curl -fsSL -o "$TARBALL" "https://codeload.github.com/$SLUG/tar.gz/refs/heads/$AIRIS_BRANCH"; then
  # 非公開リポジトリは gh の認証経由で取得する
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    info "公開 URL から取得できなかったため gh 経由で再試行します..."
    gh api "repos/$SLUG/tarball/$AIRIS_BRANCH" > "$TARBALL" \
      || fail "取得に失敗しました（$SLUG@${AIRIS_BRANCH}）。リポジトリ名とブランチを確認してください。"
  else
    fail "取得に失敗しました（$SLUG@${AIRIS_BRANCH}）。非公開リポジトリの場合は gh auth login を済ませてから再実行してください。"
  fi
fi

SRC="$TMP/src"
mkdir -p "$SRC"
# GitHub の tarball は <repo>-<ref>/ で 1 段包まれているので剥がす
tar -xzf "$TARBALL" -C "$SRC" --strip-components=1 \
  || fail "展開に失敗しました。ダウンロードが壊れている可能性があります。再実行してください。"
[ -f "$SRC/CLAUDE.md" ] \
  || fail "展開結果に CLAUDE.md がありません。取得元（${SLUG}）とブランチ（${AIRIS_BRANCH}）を確認してください。"

# ----------------------------------------------------------------------------
# 3. 配置（新規 = そのまま / 既存 = 編集済みファイルを守って更新）
# ----------------------------------------------------------------------------
SKIPPED="$TMP/skipped.txt"   # 編集済みなので上書きしなかった
REMOVED="$TMP/removed.txt"   # 上流から消えたので片付けた
KEPT="$TMP/kept.txt"         # 上流から消えたが編集済みなので残した
: > "$SKIPPED"; : > "$REMOVED"; : > "$KEPT"

if [ ! -e "$AIRIS_DIR" ]; then
  mkdir -p "$AIRIS_DIR"
  (cd "$SRC" && tar -cf - .) | (cd "$AIRIS_DIR" && tar -xf -)
  ok "$AIRIS_DIR/ に展開しました（.git は作っていません）"
else
  [ -d "$AIRIS_DIR" ] \
    || fail "$AIRIS_DIR は存在しますがディレクトリではありません。AIRIS_DIR=<別の名前> を付けて再実行してください。"
  # 台帳が無い = このインストーラー以外で用意された（ZIP を手動展開した / 別物）。
  # どのファイルが上流のままでどれが編集済みか判定できないので、勝手に上書きしない
  [ -f "$AIRIS_DIR/$MANIFEST_NAME" ] \
    || fail "$AIRIS_DIR/ はこのインストーラーの管理下ではありません（$MANIFEST_NAME が無いため、編集済みのファイルを見分けられません）。ZIP を手動展開した場所はここでは更新できません。別の場所へ入れる（AIRIS_DIR=<別の名前>）か、中身を退避してから再実行してください。"

  info "既存の $AIRIS_DIR/ を更新します（編集したファイルは上書きしません）..."
  MANIFEST="$AIRIS_DIR/$MANIFEST_NAME"
  (cd "$SRC" && find . -type f -print) | sed 's|^\./||' | while IFS= read -r rel; do
    dst="$AIRIS_DIR/$rel"
    if [ ! -f "$dst" ]; then
      mkdir -p "$(dirname "$dst")"
      cp "$SRC/$rel" "$dst"
      continue
    fi
    # 取得時点のハッシュと今の中身が違う = 利用者が編集した → 上書きしない
    rec=$(awk -v p="$rel" '$2==p{print $1; exit}' "$MANIFEST" 2>/dev/null || true)
    if [ -n "$rec" ] && [ "$rec" != "$(hash_of "$dst")" ] && ! cmp -s "$SRC/$rel" "$dst"; then
      printf '%s\n' "$rel" >> "$SKIPPED"
      continue
    fi
    cp "$SRC/$rel" "$dst"
  done

  # 上流から消えたファイルを片付ける（git pull なら消えていた分）。
  # 残すと **古いルールを Claude が読む**（例: 分割前の rules/web-react.md）。
  # 対象は**このインストーラーが置いたもの（旧台帳にあるもの）だけ**。
  # 台帳に無いファイル（利用者が自分で足した / 手動で置いた）には触らない
  while IFS= read -r line; do
    rel=$(printf '%s' "$line" | sed 's/^[0-9a-f]*  //')
    [ -n "$rel" ] || continue
    [ -f "$SRC/$rel" ] && continue        # 上流にまだある
    dst="$AIRIS_DIR/$rel"
    [ -f "$dst" ] || continue             # すでに無い
    if [ "$(printf '%s' "$line" | cut -d' ' -f1)" = "$(hash_of "$dst")" ]; then
      rm -f "$dst"
      printf '%s\n' "$rel" >> "$REMOVED"
    else
      printf '%s\n' "$rel" >> "$KEPT"     # 編集済み → 消さずに報告
    fi
  done < "$MANIFEST"
  ok "更新しました"
fi

# 台帳を書き直す（次回の更新で編集を見分けるため。中身は「上流の正」のハッシュ）
(cd "$SRC" && find . -type f -print) | sed 's|^\./||' | while IFS= read -r rel; do
  printf '%s  %s\n' "$(hash_of "$SRC/$rel")" "$rel"
done > "$AIRIS_DIR/$MANIFEST_NAME"
printf 'repo: %s\nbranch: %s\nfetched: %s\n' "$SLUG" "$AIRIS_BRANCH" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  > "$AIRIS_DIR/$VERSION_NAME"

# ----------------------------------------------------------------------------
# 4. 依存パッケージの導入（style-dictionary）
# ----------------------------------------------------------------------------
if [ -f "$AIRIS_DIR/package.json" ]; then
  info "依存パッケージをインストールしています（デザイントークン変換用の style-dictionary）..."
  (cd "$AIRIS_DIR" && npm install --no-fund --no-audit --loglevel=error) \
    || fail "npm install に失敗しました。ネットワークを確認して再実行してください。"
  ok "依存パッケージを導入しました"
else
  warn "package.json が見つからないため依存の導入をスキップしました（後で /setup が補います）。"
fi

# ----------------------------------------------------------------------------
# 5. Claude Code / GitHub CLI の確認（任意。/setup が改めて案内する）
# ----------------------------------------------------------------------------
if command -v claude >/dev/null 2>&1; then
  ok "Claude Code を確認しました"
else
  warn "Claude Code が見つかりません。次のコマンドでインストールできます:"
  warn "  npm install -g @anthropic-ai/claude-code"
fi

if command -v gh >/dev/null 2>&1; then
  ok "GitHub CLI (gh) を確認しました"
else
  warn "GitHub CLI (gh) が見つかりません。生成コードのコミット・Push・PR 作成に使います:"
  warn "  https://cli.github.com （Homebrew があれば brew install gh）"
fi

# ----------------------------------------------------------------------------
# 完了
# ----------------------------------------------------------------------------
if [ -s "$REMOVED" ]; then
  info "上流から削除されたので片付けたファイル:"
  while IFS= read -r l; do info "    $l"; done < "$REMOVED"
fi

if [ -s "$SKIPPED" ]; then
  warn "編集済みのため更新しなかったファイル:"
  while IFS= read -r l; do warn "    $l"; done < "$SKIPPED"
  warn "  最新版を取り込む場合は、退避してから再実行してください（差分は上流を見て手で当てます）。"
fi

if [ -s "$KEPT" ]; then
  warn "上流から削除されましたが、編集済みのため残したファイル:"
  while IFS= read -r l; do warn "    $l"; done < "$KEPT"
  warn "  もう使われないルールです。内容を確認して自分で削除してください。"
fi

ok "インストール完了！🌈"
printf '\n次のステップ:\n'
printf '  1. cd %s\n' "$AIRIS_DIR"
printf '  2. claude          # Claude Code を起動\n'
printf '  3. /setup          # 初回セットアップ（対話式・何度でも安全）\n'
printf '  4. /design-to-code # デザインをコードに\n\n'
printf '任意: 同梱の Figma プラグイン（Variables を DTCG で書き出す）を使う場合\n'
printf '  sh figma-plugin/setup.sh   # 導入・ビルド・テストを 1 コマンドで\n\n'
