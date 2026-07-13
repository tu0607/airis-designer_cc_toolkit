// Airis Design Tokens Export — Figma プラグイン本体（main / サンドボックス）
//
// フェーズ1: Figma Variables を W3C DTCG 形式のトークンに変換し、UI 経由で
// ダウンロードさせる。ネットワークは一切使わない（GitHub への書き込みは
// Claude のローカル gh が担当）。
//
// 出力は「ファイル名 → DTCG ツリー」のバンドル 1 ファイル（tokens.bundle.json）。
// 受け取った Claude が tokens/ 配下の各ファイルに展開する。
//   例) core.json / semantic.light.json / semantic.dark.json / $meta.json
//
// 設計上の約束（下流を壊さないための不変条件）:
//   1. 値を「無言で落とさない」。解決できなかったものは $meta.json.validation に必ず残す。
//   2. 参照 {a.b.c} は、必ず bundle 内のどこかに定義がある状態で出す（dangling を作らない）。
//   3. 名前の衝突（ファイル名・トークンパス）は後勝ちで潰さず、衝突として報告する。

type Dict = { [key: string]: unknown };
type Leaf = { $value: unknown; $type: string; $extensions?: Dict };

figma.showUI(__html__, { width: 380, height: 320 });

// ---- 出力の契約バージョン ----
// 下流（トークン取り込み / Style Dictionary）が仕様変更を検知できるようにする。
// 出力の形を変えたらここを上げる。
const SCHEMA_VERSION = 4;

// ---- 検証結果（無言で壊れないための記録）----
// build 中に見つけた「怪しいもの」を全部ここに集め、$meta.json と UI に出す。
const validation: {
  unresolvedAliases: string[];
  danglingRefs: string[];
  pathConflicts: string[];
  crossFileDuplicates: string[];
  fileConflicts: string[];
  exportFailures: string[];
  remoteVariables: string[];
  libraryBoundToLocalNames: string[];
  droppedRemoteModes: string[];
  missingValues: string[];
} = {
  unresolvedAliases: [],
  danglingRefs: [],
  pathConflicts: [],
  crossFileDuplicates: [],
  fileConflicts: [],
  exportFailures: [],
  remoteVariables: [],
  libraryBoundToLocalNames: [],
  droppedRemoteModes: [],
  missingValues: [],
};

function hasIssues(): boolean {
  return (
    validation.unresolvedAliases.length > 0 ||
    validation.danglingRefs.length > 0 ||
    validation.pathConflicts.length > 0 ||
    validation.crossFileDuplicates.length > 0 ||
    validation.fileConflicts.length > 0 ||
    validation.exportFailures.length > 0 ||
    validation.droppedRemoteModes.length > 0 ||
    validation.missingValues.length > 0
  );
}

// "color/brand/primary" -> "color.brand.primary"
function toPath(name: string): string {
  return name
    .split('/')
    .map((s) => s.trim())
    .join('.');
}

// Figma のコレクション名 → 契約の層名（core / semantic）。
// Figma 側の命名が変わっても出力ファイル名を契約に固定するためのマップ。
const COLLECTION_ALIAS: { [name: string]: string } = {
  Primitives: 'core',
  Tokens: 'semantic',
};

// トップ階層の名前空間を契約名に正規化（例: Color→color, size→space）。
// 参照（エイリアス）先の解決名にも同じ変換を通すことで {color.blue.500} 形に揃える。
const NAMESPACE_ALIAS: { [seg: string]: string } = {
  Color: 'color',
  size: 'space',
};

// ドット区切りパスの先頭セグメントだけを NAMESPACE_ALIAS で置換する。
function normalizePath(path: string): string {
  const parts = path.split('.');
  if (parts.length > 0 && NAMESPACE_ALIAS[parts[0]] !== undefined) {
    parts[0] = NAMESPACE_ALIAS[parts[0]];
  }
  return parts.join('.');
}

// 変数名 → 参照文字列 "{a.b.c}"
function refOf(v: Variable): string {
  return `{${normalizePath(toPath(v.name))}}`;
}

// 名前を小文字ケバブに（ファイル名/コレクション名用）
function slug(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function isLeaf(x: unknown): boolean {
  return typeof x === 'object' && x !== null && '$value' in (x as Dict);
}

// ネスト木に葉を差し込む。
// 「葉の下に枝を作る」「枝を葉で潰す」「同じパスの二重定義」は
// いずれも壊れた木になるので、後勝ちで潰さず衝突として記録して差し込みを中止する。
function setLeaf(root: Dict, path: string, leaf: Leaf, where: string): void {
  const parts = path.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const seg = parts[i];
    const cur = node[seg];
    if (isLeaf(cur)) {
      validation.pathConflicts.push(
        `${where}: "${parts.slice(0, i + 1).join('.')}" は値を持つトークンなのに、その下に "${path}" を作ろうとした`,
      );
      return;
    }
    if (typeof cur !== 'object' || cur === null) node[seg] = {};
    node = node[seg] as Dict;
  }
  const last = parts[parts.length - 1];
  const existing = node[last];
  if (existing !== undefined) {
    validation.pathConflicts.push(
      isLeaf(existing)
        ? `${where}: "${path}" が二重に定義されている`
        : `${where}: "${path}" は既に枝（子を持つ階層）として使われている`,
    );
    return;
  }
  node[last] = leaf as unknown as Dict[string];
}

// スタイル名がグループ名で始まる場合（例: "elevation/card" を elevation グループへ）、
// そのまま入れると elevation.elevation.card と二重になる。先頭セグメントを畳む。
function stylePath(name: string, group: string): string {
  const path = toPath(name);
  const parts = path.split('.');
  if (parts.length > 1 && parts[0].toLowerCase() === group) return parts.slice(1).join('.');
  return path;
}

function toHex(c: RGB | RGBA | undefined | null): string | null {
  if (!c || typeof (c as RGB).r !== 'number') return null;
  const to255 = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255);
  const h = (n: number) => to255(n).toString(16).padStart(2, '0');
  const a = (c as RGBA).a;
  const base = `#${h(c.r)}${h(c.g)}${h(c.b)}`;
  return a === undefined || a === 1 ? base : `${base}${h(a)}`;
}

// dimension とみなす名前のヒューリスティック（px→rem 変換は後段の Style Dictionary が担当）。
// line-height は「倍率（1.6）」でも「px（24px）」でもありうるので別扱いにする（下の LINE_HEIGHT_RE）。
// ※ 判定は必ず LINE_HEIGHT_RE → DIMENSION_RE の順に行う。
//   （"line-height" は "height" を含むため。正規表現の後読みは Figma のサンドボックスで
//     動く保証がないので使わず、評価順で解決する）
const DIMENSION_RE =
  /(space|spacing|size|radius|width|height|gap|padding|margin|inset|font-?size)/i;
const LINE_HEIGHT_RE = /line-?height/i;

// FLOAT 変数の 1 値を DTCG 化する。dtcgType() と必ず同じ判定を使う（型と値がズレないように）。
function floatLeaf(name: string, raw: unknown): Leaf {
  if (typeof raw !== 'number' || !isFinite(raw)) {
    validation.missingValues.push(`${name}: 数値として読めない値`);
    return { $value: null, $type: 'number' };
  }
  if (LINE_HEIGHT_RE.test(name)) {
    // 行間は px と倍率が混在する。4 未満は倍率（unitless）と判断する
    return raw < 4
      ? { $value: round3(raw), $type: 'number' }
      : { $value: `${raw}px`, $type: 'dimension' };
  }
  return DIMENSION_RE.test(name)
    ? { $value: `${raw}px`, $type: 'dimension' }
    : { $value: raw, $type: 'number' };
}

function dtcgType(v: Variable): string {
  switch (v.resolvedType) {
    case 'COLOR':
      return 'color';
    case 'FLOAT':
      if (LINE_HEIGHT_RE.test(v.name)) return 'number'; // 倍率想定。px なら floatLeaf 側で dimension になる
      return DIMENSION_RE.test(v.name) ? 'dimension' : 'number';
    case 'STRING':
      return 'string';
    case 'BOOLEAN':
      return 'boolean';
    default:
      return 'other';
  }
}

function isAlias(value: VariableValue): value is VariableAlias {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as VariableAlias).type === 'VARIABLE_ALIAS'
  );
}

// ---- Styles ----
// Typography / Elevation などは Variables ではなく Styles で作られており、
// getLocalVariablesAsync() では取れない。ここで各 Style を DTCG トークンに変換する。
// スタイルは変数コレクションに属さないため、出力は core.json ツリーへマージする（契約）。
const STYLES_TARGET_FILE = `${slug(COLLECTION_ALIAS['Primitives'] || 'core')}.json`;

// フォントスタイル名（"Bold" 等）→ DTCG fontWeight 数値。未知なら名前をそのまま返す。
const WEIGHT_MAP: { [key: string]: number } = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  book: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
};

function fontWeight(styleName: string): number | string {
  const key = styleName.toLowerCase().replace(/\s|italic|oblique/g, '');
  return WEIGHT_MAP[key] !== undefined ? WEIGHT_MAP[key] : styleName;
}

// CSS / DTCG の fontStyle は normal|italic|oblique の軸であり、太さとは別物。
// Figma の fontName.style（"Bold" 等）をそのまま入れると CSS に流せないので分離する。
function fontStyle(styleName: string): string {
  return /italic|oblique/i.test(styleName) ? 'italic' : 'normal';
}

// lineHeight: PIXELS→"Npx" / PERCENT→比率(1.6 等。float 誤差を丸める) / AUTO→"normal"
function lineHeightValue(lh: LineHeight): number | string {
  if (lh.unit === 'AUTO') return 'normal';
  if (lh.unit === 'PIXELS') return `${lh.value}px`;
  return round3(lh.value / 100);
}

// letterSpacing: 0→"normal" / PERCENT→em 換算（CSS にそのまま流せる形）/ PIXELS→"Npx"
function letterSpacingValue(ls: LetterSpacing): string {
  if (ls.value === 0) return 'normal';
  return ls.unit === 'PERCENT' ? `${round3(ls.value / 100)}em` : `${ls.value}px`;
}

function shadowValue(e: DropShadowEffect | InnerShadowEffect): Dict {
  return {
    color: toHex(e.color),
    offsetX: `${e.offset.x}px`,
    offsetY: `${e.offset.y}px`,
    blur: `${e.radius}px`,
    spread: `${e.spread}px`,
    inset: e.type === 'INNER_SHADOW',
  };
}

// Grid（レイアウトグリッド）は DTCG に標準型が無い。
// Figma の生オブジェクトをそのまま入れると boundVariables や {r,g,b,a} が混入して
// Style Dictionary が扱えないので、レイアウト実装に必要な値だけへ整形する。
function gridValue(grids: readonly LayoutGrid[]): Dict[] {
  return grids.map((g) => {
    if (g.pattern === 'GRID') {
      return { pattern: 'GRID', sectionSize: `${g.sectionSize}px` };
    }
    const c = g as RowsColsLayoutGrid;
    const out: Dict = {
      pattern: c.pattern, // COLUMNS | ROWS
      alignment: c.alignment, // MIN | MAX | CENTER | STRETCH
      gutterSize: `${c.gutterSize}px`,
      count: c.count,
    };
    if (c.alignment !== 'STRETCH' && c.sectionSize !== undefined) {
      out.sectionSize = `${c.sectionSize}px`;
    }
    if (c.alignment !== 'CENTER' && c.offset !== undefined) {
      out.offset = `${c.offset}px`;
    }
    return out;
  });
}

async function buildStyles(): Promise<Dict> {
  const out: Dict = {};

  // Typography（テキストスタイル）→ $type: typography（合成トークン）
  const textStyles = await figma.getLocalTextStylesAsync();
  if (textStyles.length > 0) {
    const group: Dict = {};
    for (const s of textStyles) {
      setLeaf(
        group,
        stylePath(s.name, 'typography'),
        {
          $type: 'typography',
          $value: {
            fontFamily: s.fontName.family,
            fontWeight: fontWeight(s.fontName.style),
            fontStyle: fontStyle(s.fontName.style),
            fontSize: `${s.fontSize}px`,
            lineHeight: lineHeightValue(s.lineHeight),
            letterSpacing: letterSpacingValue(s.letterSpacing),
          },
          // Figma 側の呼び名（"Bold" 等）は情報として温存する
          $extensions: { 'airis.design-system': { figmaFontStyle: s.fontName.style } },
        },
        `typography style "${s.name}"`,
      );
    }
    out['typography'] = group;
  }

  // Elevation（エフェクトスタイル：影）→ $type: shadow。影以外は other で温存。
  const effectStyles = await figma.getLocalEffectStylesAsync();
  if (effectStyles.length > 0) {
    const group: Dict = {};
    for (const s of effectStyles) {
      const shadows = s.effects.filter(
        (e) => e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW',
      ) as (DropShadowEffect | InnerShadowEffect)[];
      const leaf: Leaf =
        shadows.length > 0
          ? {
              $type: 'shadow',
              $value:
                shadows.length === 1
                  ? shadowValue(shadows[0])
                  : shadows.map(shadowValue),
            }
          : { $type: 'other', $value: s.effects };
      setLeaf(group, stylePath(s.name, 'elevation'), leaf, `effect style "${s.name}"`);
    }
    out['elevation'] = group;
  }

  // Paint（塗りスタイル）→ 単色は color、グラデ等は other。
  const paintStyles = await figma.getLocalPaintStylesAsync();
  if (paintStyles.length > 0) {
    const group: Dict = {};
    for (const s of paintStyles) {
      const p = s.paints[0];
      const hex =
        p && p.type === 'SOLID'
          ? toHex({
              r: p.color.r,
              g: p.color.g,
              b: p.color.b,
              a: p.opacity === undefined ? 1 : p.opacity,
            })
          : null;
      const leaf: Leaf =
        hex !== null
          ? { $type: 'color', $value: hex }
          : { $type: 'other', $value: s.paints };
      setLeaf(group, stylePath(s.name, 'paint'), leaf, `paint style "${s.name}"`);
    }
    out['paint'] = group;
  }

  // Grid（レイアウトグリッドスタイル）→ DTCG 標準型なし。必要な値だけに整形して other で温存。
  const gridStyles = await figma.getLocalGridStylesAsync();
  if (gridStyles.length > 0) {
    const group: Dict = {};
    for (const s of gridStyles) {
      setLeaf(
        group,
        stylePath(s.name, 'grid'),
        { $type: 'other', $value: gridValue(s.layoutGrids) },
        `grid style "${s.name}"`,
      );
    }
    out['grid'] = group;
  }

  return out;
}

// ---- Components（仕様 JSON：バリアント軸 + 各レイヤーの token 束縛）----
// 既定は全 ComponentSet / Component を書き出す（allowlist 空＝全件）。
// 特定コンポーネントだけに絞りたい場合は ALLOWLIST に名前（部分一致）を並べる。
// 逆に一部を除外したい場合は DENYLIST に名前（部分一致）を並べる（例: アイコン）。
const COMPONENT_ALLOWLIST: string[] = [];
// アイコンは components.json（仕様）ではなく icons.json（SVG）へ回すので除外。
const COMPONENT_DENYLIST: string[] = ['icons/'];

function matchesAny(name: string, patterns: string[]): boolean {
  const n = name.toLowerCase();
  return patterns.some((p) => n.indexOf(p.toLowerCase()) !== -1);
}

function inComponentScope(name: string): boolean {
  if (COMPONENT_DENYLIST.length > 0 && matchesAny(name, COMPONENT_DENYLIST))
    return false;
  // allowlist 空＝全件。指定があれば部分一致でそれだけ。
  return COMPONENT_ALLOWLIST.length === 0 || matchesAny(name, COMPONENT_ALLOWLIST);
}

// 1 ノードの boundVariables を { プロパティ: "{token}" } に変換
function boundRefs(node: SceneNode, resolve: (id: string) => string): Dict {
  const out: Dict = {};
  const bv = (node as unknown as { boundVariables?: Dict }).boundVariables;
  if (!bv) return out;
  for (const field of Object.keys(bv)) {
    const binding = bv[field];
    if (Array.isArray(binding)) {
      const refs = binding
        .filter((b) => b && (b as VariableAlias).id)
        .map((b) => resolve((b as VariableAlias).id));
      if (refs.length > 0) out[field] = refs.length === 1 ? refs[0] : refs;
    } else if (binding && (binding as VariableAlias).id) {
      out[field] = resolve((binding as VariableAlias).id);
    }
  }
  return out;
}

// 適用スタイル（テキスト/エフェクト等）を { "style:text": "{typography..}" } に変換。
// これらは Variables ではないので boundVariables には現れず、*StyleId で参照される。
const STYLE_ID_FIELDS: { field: string; key: string }[] = [
  { field: 'fillStyleId', key: 'style:fill' },
  { field: 'strokeStyleId', key: 'style:stroke' },
  { field: 'effectStyleId', key: 'style:effect' },
  { field: 'gridStyleId', key: 'style:grid' },
  { field: 'textStyleId', key: 'style:text' },
];

function appliedStyles(node: SceneNode, styleRef: {
  [id: string]: string;
}): Dict {
  const out: Dict = {};
  const n = node as unknown as { [k: string]: unknown };
  for (const { field, key } of STYLE_ID_FIELDS) {
    const id = n[field];
    if (typeof id === 'string' && id && styleRef[id]) out[key] = styleRef[id];
  }
  return out;
}

// 子ノード。INSTANCE（アイコン等）の内部には入らない＝別コンポーネントの領域なので
// 契約から除外し、ネストのノイズを抑える。
function childrenOf(node: SceneNode): readonly SceneNode[] {
  if (node.type === 'INSTANCE') return [];
  return 'children' in node ? (node as ChildrenMixin & SceneNode).children : [];
}

// 走査対象ノード配下で束縛されている変数 id を全収集（名前解決の前段）。
function gatherVarIds(node: SceneNode, acc: { [id: string]: true }): void {
  const bv = (node as unknown as { boundVariables?: Dict }).boundVariables;
  if (bv) {
    for (const field of Object.keys(bv)) {
      const binding = bv[field];
      if (Array.isArray(binding)) {
        for (const x of binding)
          if (x && (x as VariableAlias).id) acc[(x as VariableAlias).id] = true;
      } else if (binding && (binding as VariableAlias).id) {
        acc[(binding as VariableAlias).id] = true;
      }
    }
  }
  for (const child of childrenOf(node)) gatherVarIds(child, acc);
}

// ノード木を歩いて「レイヤー名 → 束縛トークン + 適用スタイル」を再帰収集。
// 同名の兄弟レイヤーは layer:<名前> が衝突して先のものが消えるため、2 つ目以降に #n を付ける。
function collectBindings(
  node: SceneNode,
  resolve: (id: string) => string,
  styleRef: { [id: string]: string },
): Dict {
  const self = boundRefs(node, resolve);
  const styles = appliedStyles(node, styleRef);
  for (const k of Object.keys(styles)) self[k] = styles[k];
  const used: { [name: string]: number } = {};
  for (const child of childrenOf(node)) {
    const sub = collectBindings(child, resolve, styleRef);
    if (Object.keys(sub).length === 0) continue;
    const n = (used[child.name] = (used[child.name] || 0) + 1);
    self[n === 1 ? `layer:${child.name}` : `layer:${child.name} #${n}`] = sub;
  }
  return self;
}

// ---- レイアウトの事実（構造の検査用）----
// 「Auto Layout か絶対配置か」「無名レイヤーが残っていないか」「余白の実際の数値」は
// bindings（トークン束縛）には出ないため、別途そのまま書き出す。
// **プラグインは事実だけを出し、違反かどうかの判定は下流で行う**。
// 既定値・空の項目は省いてサイズを抑える。
const LAYOUT_MAX_DEPTH = 12;

function num(x: unknown): number | undefined {
  return typeof x === 'number' && isFinite(x) ? Math.round(x * 100) / 100 : undefined;
}

function textFacts(node: SceneNode): Dict | undefined {
  if (node.type !== 'TEXT') return undefined;
  const t = node as unknown as { [k: string]: unknown };
  const out: Dict = {};
  // fontSize / fontName は複数書式が混在すると figma.mixed になる（＝1 レイヤー内で不統一）
  out.size = t.fontSize === figma.mixed ? 'mixed' : num(t.fontSize);
  if (t.fontName === figma.mixed) {
    out.family = 'mixed';
  } else if (t.fontName && typeof t.fontName === 'object') {
    const f = t.fontName as FontName;
    out.family = f.family;
    out.style = f.style;
  }
  if (t.lineHeight === figma.mixed) {
    out.lineHeight = 'mixed';
  } else if (t.lineHeight && typeof t.lineHeight === 'object') {
    const lh = t.lineHeight as LineHeight;
    out.lineHeight = lh.unit === 'AUTO' ? 'auto' : `${(lh as { value: number }).value}${lh.unit === 'PERCENT' ? '%' : 'px'}`;
  }
  return out;
}

function layoutOf(node: SceneNode, depth: number): Dict {
  const n = node as unknown as { [k: string]: unknown };
  const out: Dict = { id: node.id, name: node.name, type: node.type };

  // Auto Layout。mode が無い＝Auto Layout ではない（構造の検査対象）
  const mode = n.layoutMode;
  if (mode === 'HORIZONTAL' || mode === 'VERTICAL') {
    out.mode = mode;
    const gap = num(n.itemSpacing);
    if (gap !== undefined) out.gap = gap;
  }

  // 余白（上・右・下・左）。全部 0 なら省略
  const pad = [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft].map((p) =>
    typeof p === 'number' ? p : 0,
  );
  if (pad.some((p) => p !== 0)) out.pad = pad;

  const w = num(n.width);
  const h = num(n.height);
  if (w !== undefined) out.w = w;
  if (h !== undefined) out.h = h;
  // FIXED（固定サイズ）/ HUG（内容に合わせる）/ FILL（親に合わせる）
  if (typeof n.layoutSizingHorizontal === 'string') out.wSize = n.layoutSizingHorizontal;
  if (typeof n.layoutSizingVertical === 'string') out.hSize = n.layoutSizingVertical;
  // Auto Layout の中で絶対配置に逃がしている子
  if (n.layoutPositioning === 'ABSOLUTE') out.abs = true;
  if (n.visible === false) out.hidden = true;

  // 角丸。四隅が揃っていれば数値、揃っていなければ [左上, 右上, 右下, 左下]。
  // これが無いと「角丸を使っているのに変数にバインドしていない」を判定できない
  // （bindings に *Radius が無いだけでは、角丸を使っていないのか未バインドなのか分からない）。
  if (n.cornerRadius === figma.mixed) {
    out.r = [n.topLeftRadius, n.topRightRadius, n.bottomRightRadius, n.bottomLeftRadius].map((x) =>
      typeof x === 'number' ? x : 0,
    );
  } else {
    const r = num(n.cornerRadius);
    if (r !== undefined && r !== 0) out.r = r;
  }
  // 枠線の太さ。**枠線が実際に付いているノードだけ**出す。
  // strokeWeight は枠線が無くても既定 1 を返すため、無条件に出すと
  // 「枠線があるのに色を変数にバインドしていない」の判定が全ノードで誤検知になる。
  const strokes = n.strokes;
  const hasStroke =
    Array.isArray(strokes) &&
    strokes.some((s) => s && (s as Paint).visible !== false);
  if (hasStroke) {
    if (n.strokeWeight === figma.mixed) out.sw = 'mixed';
    else {
      const sw = num(n.strokeWeight);
      if (sw !== undefined && sw !== 0) out.sw = sw;
    }
  }

  const font = textFacts(node);
  if (font) out.font = font;

  const kids = childrenOf(node);
  if (kids.length > 0) {
    if (depth >= LAYOUT_MAX_DEPTH) out.truncated = true;
    else out.children = kids.map((c) => layoutOf(c, depth + 1));
  }
  return out;
}

// "Priority=CTA, Size=Medium" を {Priority:"CTA", Size:"Medium"} へ
function variantProps(node: ComponentNode): Dict {
  if (node.variantProperties) return { ...node.variantProperties } as Dict;
  const out: Dict = {};
  for (const part of node.name.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function buildComponents(
  sets0: readonly ComponentSetNode[],
  singles0: readonly ComponentNode[],
  resolve: (id: string) => string,
  styleRef: { [id: string]: string },
): Dict {
  // いったん配列に集めてから出力する。out[name] = ... と名前で直接書くと、
  // 同名コンポーネント（例: 複数の "Button"）が互いを上書きし、変種の少ない方が
  // 本体を潰してしまう。名前衝突は下でまとめて解消する。
  type Entry = { name: string; id: string; weight: number; value: Dict };
  const entries: Entry[] = [];

  for (const set of sets0) {
    if (!inComponentScope(set.name)) continue;
    const defs = set.componentPropertyDefinitions;
    const properties: Dict = {};
    for (const key of Object.keys(defs)) {
      const d = defs[key];
      properties[key] = {
        type: d.type,
        default: d.defaultValue,
        values: d.variantOptions || undefined,
      };
    }
    const variants = set.children
      .filter((c) => c.type === 'COMPONENT')
      .map((c) => ({
        name: c.name,
        id: c.id, // 指示書から Figma へ直リンクするために持たせる
        props: variantProps(c as ComponentNode),
        bindings: collectBindings(c as SceneNode, resolve, styleRef),
        layout: layoutOf(c as SceneNode, 0),
      }));
    entries.push({
      name: set.name,
      id: set.id,
      // COMPONENT_SET は単体 COMPONENT より優先。多変種ほど優先。
      weight: 1000 + variants.length,
      value: { type: 'COMPONENT_SET', id: set.id, properties, variants },
    });
  }

  for (const c of singles0) {
    if (!inComponentScope(c.name)) continue;
    entries.push({
      name: c.name,
      id: c.id,
      weight: 0,
      value: {
        type: 'COMPONENT',
        id: c.id,
        bindings: collectBindings(c as SceneNode, resolve, styleRef),
        layout: layoutOf(c as SceneNode, 0),
      },
    });
  }

  // 名前でグループ化し、weight 降順で並べて「素の名前」は最上位1つだけに割り当てる。
  // 同名の敗者は `名前 #id`（id は一意）に退避し、取りこぼしをゼロにする。
  // ※ この "#id" はプラグインが付ける退避サフィックスであり、Figma の自動採番ではない。
  //   出てきたら「Figma 上で同名のコンポーネントが複数ある」という指摘として読む。
  const groups: { [name: string]: Entry[] } = {};
  for (const e of entries) (groups[e.name] = groups[e.name] || []).push(e);

  const out: Dict = {};
  const duplicates: string[] = [];
  for (const name of Object.keys(groups)) {
    const list = groups[name].sort((a, b) => b.weight - a.weight);
    if (list.length > 1) {
      duplicates.push(`"${name}" が ${list.length} 件（id: ${list.map((e) => e.id).join(', ')}）`);
    }
    list.forEach((e, i) => {
      out[i === 0 ? name : `${name} #${e.id}`] = e.value;
    });
  }
  if (duplicates.length > 0) {
    validation.pathConflicts.push(
      ...duplicates.map((d) => `同名コンポーネント: ${d}`),
    );
  }

  return out;
}

// ---- Icons / Logos（SVG エクスポート）----
// "Icons/" 配下の COMPONENT を SVG 文字列として書き出し、icons.json にまとめる。
// 色は currentColor に正規化し、CSS の color で着色できるようにする。
const ICON_PREFIX = 'icons/';

// Uint8Array(UTF-8) → 文字列（Figma サンドボックスに TextDecoder が無い場合の保険）。
function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i++];
    if (b < 0x80) {
      out += String.fromCharCode(b);
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (b < 0xf0) {
      out += String.fromCharCode(
        ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    } else {
      const cp =
        ((b & 0x07) << 18) |
        ((bytes[i++] & 0x3f) << 12) |
        ((bytes[i++] & 0x3f) << 6) |
        (bytes[i++] & 0x3f);
      const c = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff));
    }
  }
  return out;
}

// ルートの <svg> タグからだけ固定 width/height を外して伸縮可にする。
// SVG 全体を対象にすると <rect width height> や <use> の寸法まで消えてしまい、
// 特に clipPath 内の <rect> が寸法を失うと「クリップ範囲ゼロ = 何も描画されない」になる。
function stripSvgSize(svg: string): string {
  const end = svg.indexOf('>');
  if (end === -1) return svg;
  const head = svg
    .slice(0, end)
    .replace(/\s(width|height)="[^"]*"/g, '');
  return head + svg.slice(end);
}

// アイコン用: fill/stroke の実色を currentColor に置換（"none" は温存）＋サイズ除去。
// ただし <defs> / <mask> / <clipPath> / <filter> の中身は「構造としての白黒」であり、
// currentColor にすると形が消えるため置換対象から外す。
const SVG_STRUCTURAL_BLOCK_RE =
  /<(defs|mask|clipPath|filter|pattern)\b[\s\S]*?<\/\1>/g;

// 退避用の番兵。SVG テキストに絶対現れない綴りにする。
// 「空白+数字+空白」のような形にすると viewBox="0 0 24 24" の " 0 " に誤爆して SVG を壊す。
// （制御文字を使うとソースに NUL が混ざり grep / diff / エディタが壊れるので使わない）
const PH_OPEN = '%%NEPH';
const PH_CLOSE = '%%';
const PH_RE = /%%NEPH(\d+)%%/g;

function recolorToCurrentColor(svg: string): string {
  return svg.replace(/(fill|stroke)="#[0-9a-fA-F]{3,8}"/g, '$1="currentColor"');
}

function normalizeIconSvg(svg: string): string {
  // 構造ブロックを一旦プレースホルダに退避 → 本体だけ置換 → 戻す
  const kept: string[] = [];
  const masked = svg.replace(SVG_STRUCTURAL_BLOCK_RE, (m) => {
    kept.push(m);
    return `${PH_OPEN}${kept.length - 1}${PH_CLOSE}`;
  });
  const recolored = recolorToCurrentColor(masked);
  const restored = recolored.replace(
    PH_RE,
    (_m, i: string) => kept[Number(i)],
  );
  return stripSvgSize(restored);
}

async function buildIcons(): Promise<Dict> {
  const out: Dict = {};

  // 1 アイコンぶんの書き出し。名前は「Icons/xxx」の xxx 部分（従来のファイル名を維持する）
  const addIcon = async (target: ComponentNode, sourceName: string) => {
    try {
      const bytes = await target.exportAsync({ format: 'SVG' });
      const name = slug(sourceName.slice(sourceName.indexOf('/') + 1));
      if (!name) {
        validation.exportFailures.push(`icon "${sourceName}": 名前が空になった`);
        return;
      }
      if (out[name] !== undefined) {
        validation.exportFailures.push(`icon "${sourceName}": 名前 "${name}" が重複`);
        return;
      }
      out[name] = normalizeIconSvg(utf8Decode(bytes));
    } catch (e) {
      validation.exportFailures.push(`icon "${sourceName}": ${String(e)}`);
    }
  };

  // 単体 COMPONENT（バリアントを持たない従来のアイコン）
  const nodes = figma.root
    .findAllWithCriteria({ types: ['COMPONENT'] })
    .filter((c) => c.name.toLowerCase().indexOf(ICON_PREFIX) === 0);
  for (const node of nodes) {
    await addIcon(node, node.name);
  }

  // バリアント付き（COMPONENT_SET。例: fill = Filled / Outlined）。
  // 子の名前は "fill=Filled" になり ICON_PREFIX に一致しないため、**セット名**で拾う。
  // これが無いとバリアント化されたアイコンは 1 つも書き出されず、**エラーも出ずに
  // icons.json が bundle ごと消える**（assets/ には前回の書き出しが残るので差分も出ない）。
  // 書き出すのは**既定バリアント** — どれを「顔」にするかは Figma 側の事実であり、
  // プラグインが選ぶものではない（並び順で拾わない）。
  const sets = figma.root
    .findAllWithCriteria({ types: ['COMPONENT_SET'] })
    .filter((s) => s.name.toLowerCase().indexOf(ICON_PREFIX) === 0);
  for (const set of sets) {
    const dv =
      set.defaultVariant ??
      (set.children.find((c) => c.type === 'COMPONENT') as ComponentNode | undefined);
    if (!dv) {
      validation.exportFailures.push(`icon "${set.name}": バリアントが 1 つも無い`);
      continue;
    }
    await addIcon(dv, set.name);
  }
  return out;
}

// 名前に "logo" を含む COMPONENT_SET を対象に、各カラー variant を SVG 化。
// ロゴはブランド色を保持するため currentColor 化はしない（ルートのサイズのみ除去）。
// 出力: { "<logo-slug>": { "<color-slug>": "<svg>" } }
async function buildLogos(): Promise<Dict> {
  const out: Dict = {};
  const sets = figma.root
    .findAllWithCriteria({ types: ['COMPONENT_SET'] })
    // 「単語としての logo」だけを対象にする。部分一致だと **logout**（ログアウト）の
    // アイコンをロゴとして書き出してしまい、assets/logos/ に混入する
    // （消しても次の書き出しで復活するので、原因がここだと分かりにくい）
    .filter((s) => /(^|[^a-z])logos?([^a-z]|$)/.test(s.name.toLowerCase()));
  for (const set of sets) {
    const variants: Dict = {};
    for (const child of set.children) {
      if (child.type !== 'COMPONENT') continue;
      try {
        const bytes = await child.exportAsync({ format: 'SVG' });
        const props = variantProps(child as ComponentNode);
        const key = slug(String(props.Color ?? props.color ?? child.name));
        if (!key) {
          validation.exportFailures.push(`logo "${set.name} / ${child.name}": 名前が空になった`);
          continue;
        }
        variants[key] = stripSvgSize(utf8Decode(bytes));
      } catch (e) {
        validation.exportFailures.push(`logo "${set.name} / ${child.name}": ${String(e)}`);
      }
    }
    if (Object.keys(variants).length > 0) out[slug(set.name)] = variants;
  }
  return out;
}

// ---- 参照整合性チェック ----
// bundle 内の全ての "{a.b.c}" が、bundle 内に定義のあるトークンを指しているか検査する。
// ここを通さないと、下流（Style Dictionary）で初めて壊れて原因が分からなくなる。
function collectDefinedPaths(tree: unknown, prefix: string, acc: { [p: string]: true }): void {
  if (!tree || typeof tree !== 'object') return;
  if (isLeaf(tree)) {
    if (prefix) acc[prefix] = true;
    return;
  }
  for (const key of Object.keys(tree as Dict)) {
    if (key.charAt(0) === '$') continue;
    collectDefinedPaths((tree as Dict)[key], prefix ? `${prefix}.${key}` : key, acc);
  }
}

const REF_RE = /^\{([^}]+)\}$/;

function checkRefs(node: unknown, defined: { [p: string]: true }, where: string): void {
  if (typeof node === 'string') {
    const m = REF_RE.exec(node);
    if (m && !defined[m[1]]) {
      validation.danglingRefs.push(`${where} → {${m[1]}}`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => checkRefs(v, defined, `${where}[${i}]`));
    return;
  }
  if (node && typeof node === 'object') {
    for (const key of Object.keys(node as Dict)) {
      // layout はレイヤー名などの生テキストなので参照検査の対象外
      // （`{something}` という名前のレイヤーを誤って未解決参照として拾わないため）
      if (key === 'layout') continue;
      checkRefs((node as Dict)[key], defined, where ? `${where}.${key}` : key);
    }
  }
}

// ---- リモート変数の解決 ----
// 購読ライブラリ等の変数はローカル一覧に出てこないが、エイリアス先や
// コンポーネントの束縛としては参照される。名前だけ解決して値を出さないと
// 「定義の無い参照」になり下流が壊れるので、到達できるものは値まで取り込む。
async function collectRemoteVariables(
  seedIds: string[],
  localById: { [id: string]: Variable },
): Promise<{ [id: string]: Variable }> {
  const remote: { [id: string]: Variable } = {};
  let frontier = seedIds.filter((id) => localById[id] === undefined);
  for (let depth = 0; depth < 10 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (remote[id] !== undefined) continue;
      let v: Variable | null = null;
      try {
        v = await figma.variables.getVariableByIdAsync(id);
      } catch {
        v = null;
      }
      if (!v) {
        validation.unresolvedAliases.push(id);
        continue;
      }
      remote[id] = v;
      validation.remoteVariables.push(`${v.name} (${id})`);
      for (const modeId of Object.keys(v.valuesByMode)) {
        const raw = v.valuesByMode[modeId];
        if (isAlias(raw) && localById[raw.id] === undefined && remote[raw.id] === undefined) {
          next.push(raw.id);
        }
      }
    }
    frontier = next;
  }
  return remote;
}

async function buildBundle(): Promise<Dict> {
  // dynamic-page モードでは、ページを読み込む前に figma.root.findAll* を呼べない。
  // 古い API バージョンには存在しないので、存在確認してから呼ぶ。
  const maybeLoad = (figma as unknown as { loadAllPagesAsync?: () => Promise<void> })
    .loadAllPagesAsync;
  if (typeof maybeLoad === 'function') await maybeLoad.call(figma);

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  // id -> Variable（エイリアス参照名の解決に使う）
  const localById: { [id: string]: Variable } = {};
  for (const v of variables) localById[v.id] = v;

  // コンポーネント走査対象を先に確定する（束縛 id の収集にも使う）
  const sets0 = figma.root.findAllWithCriteria({ types: ['COMPONENT_SET'] });
  const singles0 = figma.root
    .findAllWithCriteria({ types: ['COMPONENT'] })
    .filter((c) => !c.parent || c.parent.type !== 'COMPONENT_SET');

  // 解決が必要な id を全部集める: ①ローカル変数のエイリアス先 ②コンポーネントの束縛
  const seeds: { [id: string]: true } = {};
  for (const v of variables) {
    for (const modeId of Object.keys(v.valuesByMode)) {
      const raw = v.valuesByMode[modeId];
      if (isAlias(raw)) seeds[raw.id] = true;
    }
  }
  for (const set of sets0)
    if (inComponentScope(set.name))
      for (const v of set.children)
        if (v.type === 'COMPONENT') gatherVarIds(v as SceneNode, seeds);
  for (const c of singles0)
    if (inComponentScope(c.name)) gatherVarIds(c as SceneNode, seeds);

  const remoteById = await collectRemoteVariables(Object.keys(seeds), localById);
  const allById: { [id: string]: Variable } = {};
  for (const id of Object.keys(localById)) allById[id] = localById[id];
  for (const id of Object.keys(remoteById)) allById[id] = remoteById[id];

  // 解決できなければ id を温存（`@` プレフィックスで未解決と分かるように）。
  const resolve = (id: string): string =>
    allById[id] !== undefined ? refOf(allById[id]) : `@${id}`;

  function dtcgValue(v: Variable, modeId: string, where: string): Leaf {
    const raw = v.valuesByMode[modeId];

    if (raw === undefined) {
      validation.missingValues.push(`${where}: モード "${modeId}" に値が無い`);
      return { $value: null, $type: dtcgType(v) };
    }

    // エイリアス（他変数参照）は「参照のまま」保持する。これが Dark 対応・改名耐性の要。
    if (isAlias(raw)) {
      const target = allById[raw.id];
      if (!target) {
        // 名前が取れないものを空文字で埋めると、下流で「値の無い CSS 変数」に化けて
        // 誰も気付けない。未解決であることを値と検証結果の両方に残す。
        validation.unresolvedAliases.push(`${where} → ${raw.id}`);
        return { $value: `@${raw.id}`, $type: dtcgType(v) };
      }
      return { $value: refOf(target), $type: dtcgType(target) };
    }

    switch (v.resolvedType) {
      case 'COLOR': {
        const hex = toHex(raw as RGBA);
        if (hex === null) {
          validation.missingValues.push(`${where}: 色として読めない値`);
          return { $value: null, $type: 'color' };
        }
        return { $value: hex, $type: 'color' };
      }
      case 'FLOAT':
        return floatLeaf(v.name, raw as number);
      case 'STRING':
        return { $value: raw as string, $type: 'string' };
      case 'BOOLEAN':
        return { $value: raw as boolean, $type: 'boolean' };
      default:
        return { $value: raw, $type: 'other' };
    }
  }

  const bundle: Dict = {};
  // ファイル名 → 由来（コレクション / モード）。モードが増えてファイル名が変わっても
  // 下流がファイル名を推測しなくて済むようにする。
  const files: { file: string; collection: string; mode: string | null }[] = [];

  function putFile(fileName: string, tree: Dict, collection: string, mode: string | null): void {
    if (bundle[fileName] !== undefined) {
      validation.fileConflicts.push(
        `"${fileName}" が重複（コレクション "${collection}"）。上書きを避けて別名で出力する`,
      );
      let i = 2;
      while (bundle[`${fileName.replace(/\.json$/, '')}-${i}.json`] !== undefined) i++;
      fileName = `${fileName.replace(/\.json$/, '')}-${i}.json`;
    }
    bundle[fileName] = tree;
    files.push({ file: fileName, collection, mode });
  }

  for (const col of collections) {
    const colVars = variables.filter((v) => v.variableCollectionId === col.id);
    const singleMode = col.modes.length <= 1;
    const colSlug = slug(COLLECTION_ALIAS[col.name] ?? col.name);

    for (const mode of col.modes) {
      const tree: Dict = {};
      for (const v of colVars) {
        const path = normalizePath(toPath(v.name));
        setLeaf(tree, path, dtcgValue(v, mode.modeId, `${col.name} / ${v.name}`), col.name);
      }
      const fileName = singleMode
        ? `${colSlug}.json`
        : `${colSlug}.${slug(mode.name)}.json`;
      putFile(fileName, tree, col.name, singleMode ? null : mode.name);
    }
  }

  // ローカルに無いが参照されている変数（購読ライブラリ等）を remote.json として出す。
  // これが無いと {ref} だけが残り、Style Dictionary が解決できない。
  //
  // ただし **ローカルに同名（同じトークンパス）の変数がある場合は出さない**。
  // ファイルが自分自身の公開ライブラリを購読していると、同じ変数がローカル版と
  // ライブラリ版で別 id として存在し、コンポーネントがライブラリ版に束縛される。
  // その場合 {ref} はパスで解決するのでローカル定義で足りており、remote 側に
  // 出すと同じパスの二重定義になって Style Dictionary の結合が後勝ちになる。
  {
    const localPaths: { [p: string]: true } = {};
    for (const v of variables) localPaths[normalizePath(toPath(v.name))] = true;

    const tree: Dict = {};
    const emitted: { [p: string]: string } = {}; // path -> 採用した変数名
    const shadowed: { [p: string]: true } = {};
    let emittedCount = 0;

    for (const id of Object.keys(remoteById)) {
      const v = remoteById[id];
      const path = normalizePath(toPath(v.name));

      if (localPaths[path]) {
        // ローカルに同じパスがある = ライブラリ版に束縛されているだけ。出力不要
        shadowed[path] = true;
        continue;
      }
      if (emitted[path] !== undefined) {
        // 複数のリモート id が同じパスに落ちる（ライブラリを重複購読している等）
        continue;
      }

      // リモートコレクションのモード id は手元で判別できないので先頭の値を採用する。
      // モードが複数ある場合は 2 つ目以降を落としているので、必ず記録に残す。
      const modeIds = Object.keys(v.valuesByMode);
      const modeId = modeIds[0];
      if (modeIds.length > 1) {
        validation.droppedRemoteModes.push(
          `${v.name}: リモート側に ${modeIds.length} モードあるが先頭のみ採用した`,
        );
      }
      setLeaf(tree, path, dtcgValue(v, modeId, `remote / ${v.name}`), 'remote');
      emitted[path] = v.name;
      emittedCount++;
    }

    const shadowedPaths = Object.keys(shadowed);
    if (shadowedPaths.length > 0) {
      // Figma 側の状態として報告する（出力は壊れないが、依存の実態として知る価値がある）
      validation.libraryBoundToLocalNames.push(
        `${shadowedPaths.length} 件のトークンで、コンポーネントがローカル変数ではなく` +
          `購読ライブラリ版に束縛されている（例: ${shadowedPaths.slice(0, 5).join(', ')}）`,
      );
    }
    if (emittedCount > 0) putFile('remote.json', tree, '(remote: 購読ライブラリ等)', null);
  }

  // Styles（Typography / Elevation / Paint / Grid）を core.json ツリーへマージ。
  const styles = await buildStyles();
  const styleGroups = Object.keys(styles);
  if (styleGroups.length > 0) {
    let coreTree = bundle[STYLES_TARGET_FILE] as Dict | undefined;
    if (coreTree === undefined) {
      coreTree = {};
      bundle[STYLES_TARGET_FILE] = coreTree;
      files.push({ file: STYLES_TARGET_FILE, collection: '(styles only)', mode: null });
    }
    for (const key of styleGroups) {
      if (coreTree[key] !== undefined) {
        validation.pathConflicts.push(
          `${STYLES_TARGET_FILE}: スタイル群 "${key}" が変数と同じ名前で衝突している`,
        );
        continue;
      }
      coreTree[key] = styles[key];
    }
  }

  // 適用スタイル id → core.json 内のスタイルトークン参照（typography/elevation/...）。
  // ここのパスは buildStyles() の stylePath() と必ず同じ規則にする（ズレると dangling になる）。
  const styleRef: { [id: string]: string } = {};
  for (const s of await figma.getLocalTextStylesAsync())
    styleRef[s.id] = `{typography.${stylePath(s.name, 'typography')}}`;
  for (const s of await figma.getLocalEffectStylesAsync())
    styleRef[s.id] = `{elevation.${stylePath(s.name, 'elevation')}}`;
  for (const s of await figma.getLocalPaintStylesAsync())
    styleRef[s.id] = `{paint.${stylePath(s.name, 'paint')}}`;
  for (const s of await figma.getLocalGridStylesAsync())
    styleRef[s.id] = `{grid.${stylePath(s.name, 'grid')}}`;

  // Components（仕様 JSON）はトークンではないので専用ファイルに分ける。
  const components = buildComponents(sets0, singles0, resolve, styleRef);
  const componentNames = Object.keys(components);
  if (componentNames.length > 0) bundle['components.json'] = components;

  // Icons（SVG 文字列）を icons.json にまとめる。
  const icons = await buildIcons();
  const iconNames = Object.keys(icons);
  if (iconNames.length > 0) bundle['icons.json'] = icons;

  // Logos（SVG 文字列・カラー variant 別）を logos.json にまとめる。
  const logos = await buildLogos();
  const logoNames = Object.keys(logos);
  if (logoNames.length > 0) bundle['logos.json'] = logos;

  // 参照整合性の検査（トークンツリー + components の両方を対象にする）
  const defined: { [p: string]: true } = {};
  for (const f of files) collectDefinedPaths(bundle[f.file], '', defined);
  for (const f of files) checkRefs(bundle[f.file], defined, f.file);
  if (componentNames.length > 0) checkRefs(bundle['components.json'], defined, 'components.json');

  // ファイルをまたいだ同一パスの二重定義を検出する。
  // Style Dictionary は全ファイルを結合するため、別コレクションが同じパスを定義していると
  // 無言の後勝ちになる。ただし「同じコレクションのモード別ファイル」は互いに代替なので除外する。
  {
    const ownersByPath: { [p: string]: { [collection: string]: true } } = {};
    for (const f of files) {
      const paths: { [p: string]: true } = {};
      collectDefinedPaths(bundle[f.file], '', paths);
      for (const p of Object.keys(paths)) {
        const owners = (ownersByPath[p] = ownersByPath[p] || {});
        owners[f.collection] = true;
      }
    }
    for (const p of Object.keys(ownersByPath)) {
      const owners = Object.keys(ownersByPath[p]);
      if (owners.length > 1) {
        validation.crossFileDuplicates.push(`"${p}" が ${owners.join(' と ')} の両方で定義されている`);
      }
    }
  }

  bundle['$meta.json'] = {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: 'Airis Design Tokens Export (Figma plugin)',
    // 開発モードで読み込んだプラグインでは null になることが多い。
    // manifest の permissions で開ける値ではないため（"fileKey" は無効な権限名）、
    // null のときは受け取り側がファイルの URL からキーを補う前提にする。
    figmaFileKey: figma.fileKey || null,
    collections: collections.map((c) => ({
      name: c.name,
      modes: c.modes.map((m) => m.name),
    })),
    // 下流はファイル名を推測せずこの対応表を読む（モード追加でファイル名が変わっても壊れない）
    files,
    styles: {
      target: STYLES_TARGET_FILE,
      groups: styleGroups,
    },
    components: {
      allowlist: COMPONENT_ALLOWLIST,
      denylist: COMPONENT_DENYLIST,
      names: componentNames,
    },
    icons: {
      count: iconNames.length,
      names: iconNames,
    },
    logos: {
      count: logoNames.length,
      names: logoNames,
    },
    // 「無言で壊れない」ための検証結果。空でないものは Figma 側かプラグイン側の要対応。
    validation,
  };

  return bundle;
}

buildBundle()
  .then((bundle) =>
    figma.ui.postMessage({
      type: 'tokens',
      bundle,
      hasIssues: hasIssues(),
      validation,
    }),
  )
  .catch((err) =>
    figma.ui.postMessage({
      type: 'error',
      message: String((err && (err as Error).stack) || err),
    }),
  );

figma.ui.onmessage = (msg: { type: string }) => {
  if (msg.type === 'close') figma.closePlugin();
};
