# ネイティブ変換ルール

ネイティブアプリ向けのルール。**既定のフレームワークは設けません。**
Claude はプラットフォーム判定でネイティブと判断（または判断困難）な場合、
**必ずデザイナーにフレームワークを確認**してから、該当する節に従います。

> このファイルはテンプレートです。実際に使うフレームワークの節を自社規約で拡充してください。

## 0. 共通（ネイティブ全般）

- `common.md` のデザイントークン方針を踏襲。色・余白・タイポはトークン/テーマとして扱う。
- 各フレームワークのトークンファイル（下記の各出力先）は、正本 `tokens/`（`common.md` §2 の構造）から **Style Dictionary で生成**する（手で書き写さない）。
- 生成物は **Push 先リポジトリの作業ツリーへ直接書く**（`CLAUDE.md` ステップ 8）。下記の出力先は配置先ディレクトリを起点とした相対パス。
- **コード生成の前に変換前診断を行う**（`common.md` §9 の 3 カテゴリすべて。ネイティブ固有の照合はセーフエリア・タップ領域・標準 UI への置き換え = §9.3）。デザインソース側の不備は推測で埋めず、直し方を添えて操作者に返す。
- 端末セーフエリア（ノッチ・ホームインジケータ）を考慮する。
- ネイティブ標準のナビゲーション/コンポーネントがある場合は自作より標準を優先。
- 出力先の構成はフレームワークごとに下記へ。

---

## React Native

- 言語: TypeScript。関数コンポーネント + Hooks。
- レイアウト: Flexbox（`View` の `style`）。Auto Layout → flexDirection/gap/padding。
- スタイル: `StyleSheet.create` またはテーマ経由。値はトークン参照。
- 出力先: `components/PascalCase.tsx`, トークンは `theme/tokens.ts`。

## Flutter

- 言語: Dart。`StatelessWidget` を基本、状態が必要なら `StatefulWidget`。
- レイアウト: `Row` / `Column` / `Padding` / `SizedBox`。Auto Layout → Row/Column + spacing。
- スタイル: `ThemeData` とトークン定数。色は `ColorScheme`、余白は定数へ。
- 出力先: `lib/widgets/snake_case.dart`, トークンは `lib/theme/tokens.dart`。

## SwiftUI (iOS)

- 言語: Swift。`View` プロトコル準拠の struct。
- レイアウト: `VStack` / `HStack` / `ZStack` + `padding` / `spacing`。
- スタイル: `Color`/`Font` の拡張でトークンを定義し参照。
- 出力先: `Sources/Views/PascalCase.swift`, トークンは `Sources/DesignTokens.swift`。

## Kotlin (Jetpack Compose, Android)

- 言語: Kotlin。`@Composable` 関数（PascalCase）。
- レイアウト: `Row` / `Column` / `Box` + `Arrangement`/`padding`。
- スタイル: `MaterialTheme` とトークン定義。色/タイポはテーマ経由。
- 出力先: `src/ui/PascalCase.kt`, トークンは `src/ui/theme/Tokens.kt`。

---

## Storybook / プレビュー（ネイティブ）

Storybook はもともと Web 向けです。ネイティブでは以下を「ストーリー相当」として生成する（対応する仕組みが無い場合は省略し、その旨を報告）:

| フレームワーク | ストーリー相当 | 出力例 |
| --- | --- | --- |
| React Native | Storybook（`@storybook/react-native`）: `PascalCase.stories.tsx` | Web と同じ CSF3 形式 |
| Flutter | Widgetbook（`widgetbook`）のユースケース、または各 Widget のサンプル | `snake_case.usecase.dart` |
| SwiftUI | `#Preview` マクロ（Xcode プレビュー） | 各 View ファイル末尾に `#Preview {}` |
| Kotlin (Compose) | `@Preview` 付き Composable | `PascalCasePreview.kt` または同ファイル内 |

Web と同様に、Figma のバリアント・状態を可能な範囲でプレビュー/ストーリーとして列挙する。

## 確認事項（ネイティブと判断したとき）

1. どのフレームワークか（React Native / Flutter / SwiftUI / Kotlin / その他）。
2. 既存アプリへの組み込みか、新規か（命名やディレクトリ規約に影響）。
3. 対応 OS/バージョンの制約があるか。
