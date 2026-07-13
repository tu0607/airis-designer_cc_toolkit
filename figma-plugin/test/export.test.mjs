// Figma API をスタブして dist/code.js を実行し、書き出しの挙動を検証する。
// Figma の GUI を使わずに回せるので、src/code.ts を触ったら必ずこれを通す。
//   使い方: npm run build && npm test
import fs from 'node:fs';
import vm from 'node:vm';

const CODE = fs.readFileSync(
  new URL('../dist/code.js', import.meta.url),
  'utf8',
);

// figma.mixed の番兵。スタブと検査で同一の値を共有する必要がある
const MIXED = Symbol('figma.mixed');

let pass = 0,
  fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    results.push(`  ✅ ${name}`);
  } else {
    fail++;
    results.push(`  ❌ ${name}${detail ? ' … ' + detail : ''}`);
  }
}

// ---- Figma スタブ ----
function makeFigma(fixture = {}) {
  const posted = [];
  const {
    collections = [],
    variables = [],
    textStyles = [],
    effectStyles = [],
    paintStyles = [],
    gridStyles = [],
    componentSets = [],
    components = [],
    remote = {},
    fileKey = 'FAKEKEY',
  } = fixture;

  const figma = {
    // fontSize 等が 1 レイヤー内で不統一のとき Figma が返す番兵
    mixed: MIXED,
    fileKey,
    showUI() {},
    ui: { postMessage: (m) => posted.push(m), onmessage: null },
    closePlugin() {},
    loadAllPagesAsync: async () => {},
    variables: {
      getLocalVariableCollectionsAsync: async () => collections,
      getLocalVariablesAsync: async () => variables,
      getVariableByIdAsync: async (id) => remote[id] || null,
    },
    getLocalTextStylesAsync: async () => textStyles,
    getLocalEffectStylesAsync: async () => effectStyles,
    getLocalPaintStylesAsync: async () => paintStyles,
    getLocalGridStylesAsync: async () => gridStyles,
    root: {
      findAllWithCriteria: ({ types }) => {
        if (types.includes('COMPONENT_SET')) return componentSets;
        if (types.includes('COMPONENT')) return components;
        return [];
      },
    },
  };
  return { figma, posted };
}

function run(fixture) {
  const { figma, posted } = makeFigma(fixture);
  const ctx = vm.createContext({ figma, __html__: '<html></html>', console });
  vm.runInContext(CODE, ctx, { filename: 'code.js' });
  return { ctx, posted, figma };
}

// ============ ① 純関数の検査（Figma 不要）============
const { ctx } = run({});

console.log('=== ① SVG 処理 ===');
{
  // ルートの width/height だけ落ちる。clipPath 内の <rect width height> は残る
  const svg =
    '<svg width="300" height="56" viewBox="0 0 300 56" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    '<g clip-path="url(#c)"><path d="M0 0"/></g>' +
    '<defs><clipPath id="c"><rect width="300" height="56" fill="white"/></clipPath></defs></svg>';
  const out = ctx.stripSvgSize(svg);
  check('ルート <svg> の width/height を除去', !/^<svg[^>]*\swidth=/.test(out), out.slice(0, 60));
  check('viewBox は残る', out.includes('viewBox="0 0 300 56"'));
  check(
    '★ clipPath 内 <rect> の width/height を残す（ロゴが消えるバグの修正）',
    out.includes('<rect width="300" height="56"'),
    out.match(/<rect[^>]*>/)?.[0],
  );
}
{
  // アイコン: 本体の色は currentColor に、mask/clipPath 内の白は温存
  const svg =
    '<svg viewBox="0 0 24 24" fill="none"><mask id="m"><rect width="24" height="24" fill="#ffffff"/></mask>' +
    '<g mask="url(#m)"><path d="M0 0" fill="#1a73e8"/></g></svg>';
  const out = ctx.normalizeIconSvg(svg);
  check('本体の fill を currentColor 化', out.includes('fill="currentColor"'));
  check(
    '★ mask 内の fill="#ffffff" は温存（アイコンが消えるバグの修正）',
    out.includes('<mask id="m"><rect width="24" height="24" fill="#ffffff"/></mask>'),
    out,
  );
  check('★ viewBox="0 0 24 24" が壊れない（番兵の誤爆なし）', out.includes('viewBox="0 0 24 24"'), out);
  check('fill="none" は温存', out.includes('fill="none"'));
}

console.log('=== ② スタイル名の二重ネスト ===');
check('elevation/card → card に畳む', ctx.stylePath('elevation/card', 'elevation') === 'card');
check('display はそのまま', ctx.stylePath('display', 'typography') === 'display');
check('elevation 単体は潰さない', ctx.stylePath('elevation', 'elevation') === 'elevation');
check('大文字でも畳む', ctx.stylePath('Elevation/overlay', 'elevation') === 'overlay');

console.log('=== ③ dimension / line-height 判定 ===');
check('space/2 → 16px dimension', JSON.stringify(ctx.floatLeaf('space/2', 16)) === '{"$value":"16px","$type":"dimension"}');
check(
  '★ line-height 1.6 は倍率（"1.6px" にしない）',
  JSON.stringify(ctx.floatLeaf('character/line-height', 1.6)) === '{"$value":1.6,"$type":"number"}',
  JSON.stringify(ctx.floatLeaf('character/line-height', 1.6)),
);
check('line-height 24 は px', JSON.stringify(ctx.floatLeaf('line-height', 24)) === '{"$value":"24px","$type":"dimension"}');
check('float 誤差を丸める', ctx.floatLeaf('line-height', 1.600000023841858).$value === 1.6);
check('opacity は number', JSON.stringify(ctx.floatLeaf('opacity/50', 50)) === '{"$value":50,"$type":"number"}');

console.log('=== ④ letterSpacing / fontStyle ===');
check('0% → normal', ctx.letterSpacingValue({ unit: 'PERCENT', value: 0 }) === 'normal');
check('2% → 0.02em', ctx.letterSpacingValue({ unit: 'PERCENT', value: 2 }) === '0.02em');
check('fontStyle: Bold → normal', ctx.fontStyle('Bold') === 'normal');
check('fontStyle: Bold Italic → italic', ctx.fontStyle('Bold Italic') === 'italic');
check('fontWeight: Bold → 700', ctx.fontWeight('Bold') === 700);
check('fontWeight: Bold Italic → 700', ctx.fontWeight('Bold Italic') === 700);

console.log('=== ⑤ toHex の防御 ===');
check('undefined → null（例外にしない）', ctx.toHex(undefined) === null);
check('不正な形 → null', ctx.toHex({ x: 1 }) === null);
check('通常色', ctx.toHex({ r: 0, g: 0.6, b: 1, a: 1 }) === '#0099ff');
check('半透明は 8 桁', ctx.toHex({ r: 0, g: 0, b: 0, a: 0.1 }) === '#0000001a');

console.log('=== ⑥ setLeaf の衝突検出 ===');
{
  const t = {};
  ctx.setLeaf(t, 'color.blue', { $value: '#00f', $type: 'color' }, 'test');
  ctx.setLeaf(t, 'color.blue.500', { $value: '#00f', $type: 'color' }, 'test');
  check(
    '★ 葉の下に枝を作らせない（壊れた木を防ぐ）',
    JSON.stringify(t) === '{"color":{"blue":{"$value":"#00f","$type":"color"}}}',
    JSON.stringify(t),
  );
}

console.log('=== ⑦ 参照整合性チェック ===');
{
  const defined = {};
  ctx.collectDefinedPaths({ color: { blue: { 500: { $value: '#00f', $type: 'color' } } } }, '', defined);
  check('葉のパスを集められる', defined['color.blue.500'] === true, JSON.stringify(defined));
  check('枝はパスに入れない', defined['color.blue'] === undefined);
}

console.log(results.join('\n'));
console.log(`\n① 純関数: ${pass} 件成功 / ${fail} 件失敗`);

// ============ ⑧ buildBundle 全体（実データを模した fixture）============
console.log('\n=== ⑧ buildBundle: end-to-end ===');
const results2 = [];
const p0 = pass, f0 = fail;

const V = (id, name, type, valuesByMode, collectionId) => ({
  id,
  name,
  resolvedType: type,
  valuesByMode,
  variableCollectionId: collectionId,
});

const ALIAS = (id) => ({ type: 'VARIABLE_ALIAS', id });

// レイヤーノードの簡易ファクトリ
let _nodeSeq = 0;
const node = (name, type, boundVariables = {}, children = []) => ({
  id: `900:${++_nodeSeq}`, // Figma の実ノード id を模す
  name,
  type,
  boundVariables,
  children,
});

const fixture = {
  fileKey: 'xAy1U2WYy6gpr4RiJuWSCF',
  collections: [
    { id: 'C1', name: 'Primitives', modes: [{ modeId: 'm1', name: 'Value' }] },
    {
      id: 'C2',
      name: 'Colors: Components',
      modes: [
        { modeId: 'm2', name: 'Light' },
        { modeId: 'm3', name: 'Dark' },
      ],
    },
  ],
  variables: [
    V('v1', 'Color/blue/500', 'COLOR', { m1: { r: 0, g: 0.6, b: 1, a: 1 } }, 'C1'),
    V('v2', 'size/2', 'FLOAT', { m1: 16 }, 'C1'),
    // エイリアス先がローカルに無い（購読ライブラリ）ケース → 以前は $value:"" になった
    V('v3', 'text/high', 'COLOR', { m2: ALIAS('REMOTE1'), m3: ALIAS('REMOTE1') }, 'C2'),
    V('v4', 'brand/primary', 'COLOR', { m2: ALIAS('v1'), m3: ALIAS('v1') }, 'C2'),
  ],
  remote: {
    REMOTE1: V('REMOTE1', 'Color/gray/900', 'COLOR', { rm: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }, 'CR'),
    // コンポーネントが束縛している、どこにも定義が無い変数
    REMOTE2: V('REMOTE2', 'size/4_5', 'FLOAT', { rm: 36 }, 'CR'),
  },
  textStyles: [
    {
      id: 'S1',
      name: 'body-m',
      fontName: { family: 'Inter', style: 'Medium' },
      fontSize: 16,
      lineHeight: { unit: 'PERCENT', value: 160.0000023841858 },
      letterSpacing: { unit: 'PERCENT', value: 0 },
    },
  ],
  effectStyles: [
    {
      id: 'S2',
      name: 'elevation/card',
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.16 },
          offset: { x: 0, y: 4 },
          radius: 12,
          spread: 0,
        },
      ],
    },
  ],
  paintStyles: [],
  gridStyles: [
    {
      id: 'S3',
      name: 'Grid-12',
      layoutGrids: [
        {
          pattern: 'COLUMNS',
          alignment: 'STRETCH',
          gutterSize: 32,
          count: 12,
          offset: 154,
          visible: true,
          color: { r: 1, g: 0, b: 0, a: 0.1 },
          boundVariables: {},
        },
      ],
    },
  ],
  componentSets: [],
  components: [],
};

// Button 相当の COMPONENT_SET（同名 2 つで衝突も試す）
const buttonVariant = node(
  'Style=Solid Fill, State=Default',
  'COMPONENT',
  { fills: ALIAS('v1'), topLeftRadius: ALIAS('v2') },
  [node('ボタン', 'TEXT', {}, []), node('ボタン', 'TEXT', {}, [])],
);
buttonVariant.variantProperties = { Style: 'Solid Fill', State: 'Default' };
// 同名レイヤーの片方だけ束縛を持たせて #2 の付与を試す
buttonVariant.children[0].boundVariables = { fills: ALIAS('v1') };
buttonVariant.children[1].boundVariables = { fills: ALIAS('v1') };
buttonVariant.textStyleId = 'S1';

// レイアウトの事実（構造検査用）。Auto Layout・余白・間隔・固定サイズ
Object.assign(buttonVariant, {
  layoutMode: 'HORIZONTAL',
  itemSpacing: 4,
  paddingTop: 8, paddingRight: 16, paddingBottom: 8, paddingLeft: 16,
  width: 104, height: 36,
  layoutSizingHorizontal: 'HUG', layoutSizingVertical: 'FIXED',
  cornerRadius: 8, strokeWeight: 1,
  strokes: [{ type: 'SOLID', color: { r: 0, g: 0.6, b: 1 } }],
});
// テキストレイヤーの書式（Text Style 未適用の検出に使う）
for (const c of buttonVariant.children) {
  Object.assign(c, {
    fontSize: 16,
    fontName: { family: 'Inter', style: 'Medium' },
    lineHeight: { unit: 'PERCENT', value: 160 },
    width: 40, height: 19,
  });
}
// Auto Layout の中で絶対配置に逃がした無名レイヤー（構造違反の見本）
const strayLayer = node('Frame 12', 'FRAME', {}, []);
Object.assign(strayLayer, { layoutPositioning: 'ABSOLUTE', width: 20, height: 20,
  cornerRadius: MIXED, topLeftRadius: 4, topRightRadius: 0, bottomRightRadius: 4, bottomLeftRadius: 0 });
buttonVariant.children.push(strayLayer);

const set1 = {
  id: '48:2',
  name: 'Button',
  type: 'COMPONENT_SET',
  componentPropertyDefinitions: {
    Style: { type: 'VARIANT', defaultValue: 'Solid Fill', variantOptions: ['Solid Fill'] },
  },
  children: [buttonVariant],
};
const dupVariant = node('State=Default', 'COMPONENT', { height: ALIAS('REMOTE2') }, []);
dupVariant.variantProperties = { State: 'Default' };
const set2 = {
  id: '152:110',
  name: 'Button',
  type: 'COMPONENT_SET',
  componentPropertyDefinitions: {},
  children: [dupVariant],
};
fixture.componentSets = [set1, set2];

const { posted } = run(fixture);

await new Promise((r) => setTimeout(r, 50));

const msg = posted.find((m) => m.type === 'tokens');
const err = posted.find((m) => m.type === 'error');
if (err) {
  results2.push(`  ❌ buildBundle が例外: ${err.message}`);
  fail++;
} else if (!msg) {
  results2.push('  ❌ buildBundle が何も返さなかった');
  fail++;
} else {
  const b = msg.bundle;
  const meta = b['$meta.json'];
  // b のキーは "core.json" のようにドットを含むので、ファイル名とパスは分けて渡す
  const at = (file, path) =>
    path.split('.').reduce((o, k) => (o == null ? o : o[k]), b[file]);

  const t = (name, cond, detail = '') => {
    if (cond) { pass++; results2.push(`  ✅ ${name}`); }
    else { fail++; results2.push(`  ❌ ${name}${detail ? ' … ' + detail : ''}`); }
  };

  t('ファイル一覧', JSON.stringify(Object.keys(b)),  true);
  results2.push(`     → ${Object.keys(b).join(', ')}`);

  t('単一モードは core.json', !!b['core.json']);
  t('複数モードはモード別ファイル',
    !!b['colors-components.light.json'] && !!b['colors-components.dark.json'],
    Object.keys(b).join(','));

  t('★ エイリアス先がローカルに無くても空文字にしない',
    b['colors-components.light.json'].text.high.$value === '{color.gray.900}',
    JSON.stringify(b['colors-components.light.json'].text?.high));

  // fixture は r=g=b=0.1 → 0.1*255=25.5 → 四捨五入 26 = 0x1a なので #1a1a1a が正
  t('★ リモート変数を remote.json に出力して参照を解決可能にする',
    !!b['remote.json'] && b['remote.json'].color?.gray?.['900']?.$value === '#1a1a1a',
    JSON.stringify(b['remote.json']));

  t('★ コンポーネントが束縛するリモート変数も remote.json に入る',
    b['remote.json'].space?.['4_5']?.$value === '36px',
    JSON.stringify(b['remote.json'].space));

  t('★ dangling reference が 0 件になる',
    meta.validation.danglingRefs.length === 0,
    JSON.stringify(meta.validation.danglingRefs));

  t('★ elevation の二重ネストが解消',
    at('core.json', 'elevation.card') !== undefined &&
      at('core.json', 'elevation.elevation') === undefined,
    JSON.stringify(b['core.json'].elevation));

  t('★ typography の lineHeight が丸められる',
    b['core.json'].typography['body-m'].$value.lineHeight === 1.6,
    String(b['core.json'].typography['body-m'].$value.lineHeight));

  t('★ fontStyle が normal（Figma の "Medium" を持ち込まない）',
    b['core.json'].typography['body-m'].$value.fontStyle === 'normal' &&
      b['core.json'].typography['body-m'].$extensions['airis.design-system'].figmaFontStyle === 'Medium');

  t('★ letterSpacing 0% → normal',
    b['core.json'].typography['body-m'].$value.letterSpacing === 'normal');

  t('★ grid が Figma 生オブジェクトでなく整形済み',
    !JSON.stringify(b['core.json'].grid).includes('boundVariables') &&
      b['core.json'].grid['Grid-12'].$value[0].gutterSize === '32px',
    JSON.stringify(b['core.json'].grid));

  t('style:text が typography 参照になる',
    JSON.stringify(b['components.json'].Button.variants[0].bindings).includes('{typography.body-m}'),
    JSON.stringify(b['components.json'].Button.variants[0].bindings));

  t('★ 同名レイヤーが上書きされず #2 で残る',
    Object.keys(b['components.json'].Button.variants[0].bindings).filter((k) => k.indexOf('layer:') === 0).length === 2,
    Object.keys(b['components.json'].Button.variants[0].bindings).join(','));

  t('★ 同名コンポーネントが検証結果に報告される',
    meta.validation.pathConflicts.some((s) => s.indexOf('同名コンポーネント') === 0),
    JSON.stringify(meta.validation.pathConflicts));

  t('$meta に schemaVersion がある', meta.schemaVersion === 4, String(meta.schemaVersion));
  t('$meta.files にファイル→モードの対応表がある',
    Array.isArray(meta.files) && meta.files.some((f) => f.mode === 'Dark'),
    JSON.stringify(meta.files));
  t('fileKey が入る', meta.figmaFileKey === 'xAy1U2WYy6gpr4RiJuWSCF');
  t('validation が $meta に入る', !!meta.validation);

  // ---- レイアウトの事実（schemaVersion 3 で追加）----
  const bl = b['components.json'].Button.variants[0].layout;
  t('★ variant に layout が付く', !!bl, JSON.stringify(bl));
  t('★ Auto Layout の方向と間隔が取れる', bl.mode === 'HORIZONTAL' && bl.gap === 4, JSON.stringify(bl));
  t('★ 余白が [上,右,下,左] で取れる', JSON.stringify(bl.pad) === '[8,16,8,16]', JSON.stringify(bl.pad));
  t('★ 固定サイズか内容に合わせるかが取れる', bl.wSize === 'HUG' && bl.hSize === 'FIXED');
  t('★ ノード ID が入る（Figma へ直リンクできる）',
    typeof bl.id === 'string' && bl.id === buttonVariant.id && /^\d+:\d+$/.test(bl.id),
    String(bl.id));
  t('★ COMPONENT_SET にも id が入る', b['components.json'].Button.id === '48:2');
  t('★ variant に id が入る',
    b['components.json'].Button.variants[0].id === buttonVariant.id,
    String(b['components.json'].Button.variants[0].id));

  const stray = (bl.children || []).find((c) => c.name === 'Frame 12');
  t('★ 絶対配置の子を検出できる', !!stray && stray.abs === true, JSON.stringify(stray));
  t('★ 無名レイヤー名がそのまま残る（判定は下流で行う）', !!stray && stray.name === 'Frame 12');

  const textChild = (bl.children || []).find((c) => c.type === 'TEXT');
  t('★ テキストの書式が取れる（Text Style 未適用の検出用）',
    !!textChild && textChild.font.size === 16 && textChild.font.family === 'Inter' &&
      textChild.font.lineHeight === '160%',
    JSON.stringify(textChild && textChild.font));

  t('★ 角丸の実測値が取れる（未バインドの判定に使う）', bl.r === 8, JSON.stringify(bl.r));
  t('★ 枠線の太さが取れる', bl.sw === 1, JSON.stringify(bl.sw));
  t('★ 枠線が無いノードには sw を出さない（全ノード誤検知の再発防止）',
    !!stray && stray.sw === undefined, JSON.stringify(stray && stray.sw));
  t('★ 四隅が不揃いな角丸は配列で取れる',
    !!stray && JSON.stringify(stray.r) === '[4,0,4,0]', JSON.stringify(stray && stray.r));

  t('layout のレイヤー名は参照検査の対象外（誤検知しない）',
    meta.validation.danglingRefs.length === 0,
    JSON.stringify(meta.validation.danglingRefs));
}

console.log(results2.join('\n'));
console.log(`\n⑧ end-to-end: ${pass - p0} 件成功 / ${fail - f0} 件失敗`);
console.log(`\n=== 合計: ${pass} 件成功 / ${fail} 件失敗 ===`);
process.exit(fail > 0 ? 1 : 0);
