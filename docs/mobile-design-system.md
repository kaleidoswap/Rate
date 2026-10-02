# Kaleido UI on mobile

The app follows the merged [Kaleido UI design system](https://github.com/kaleidoswap/kaleido-ui/commit/843ce241538c4ff35427132b6326b712ee8ce672), version 0.1.129. The feature branch targets `hack/universal-bolt12`.

## Tokens

`theme/partner.ts` adapts the shared slate semantic palette, typography and radii to the existing `ThemeType` contract. Existing screens importing `theme` receive the new dark palette; shared components use `useAppTheme()`. Both light and dark tokens are defined, but the application remains dark by default. This change does not enable an application-wide light-mode setting because some older screens still import the static theme.

The merged package was not yet available on npm. `theme/kaleido-source/` contains exact copies of the five token modules, source revision and MIT license. Fonts and network identity colors continue to come from the installed package. Replace the snapshot imports with package exports when that version is published.

## Native components

Import from `components/ui`, or the individual modules to avoid loading unrelated component families.

| Module | Components |
| --- | --- |
| `typography` | Role-based Satoshi text, Geist Mono, eyebrow labels |
| `surfaces` | Surface, PageHeader, MetricCard, SummaryRows, ToneBadge, InfoChip, Avatar, FormField, Collapsible, Copyable, CodeBlock |
| `overlays` | Dialog, Drawer, DrawerNavGroup, Popover, DropdownMenu, NoticeBar, FloatingNotice |
| `lists` | QueryState, RecordList, RecordItem, RecordField, FilterBar, Pager, DateRangeFilter, ValueList, EventTimeline, Table |
| `charts` | BarChart, BarList, DonutChart, LineChart, Sparkline, Meter, ScatterChart, TrendChart |
| Existing wrappers | Button, Input, Card, Badge, Callout, CopyButton, SectionHeader, MainHeader, OptionSheet, SegmentedTabs/SegmentedControl, EmptyState |
| Hooks | `useCopyToClipboard`, `useIsNarrow` |

These are native adaptations, with React Native props rather than DOM/Tailwind APIs. Drawers, popovers and menus use native modal sheets, safe-area padding, a scrollable body, Android back handling and an accessible heading. Tables scroll horizontally. Date filters use labeled YYYY-MM-DD inputs with calendar and range validation. Floating notices belong inside a screen's safe-area layout.

Charts use the shared six-color palette (scatter: three series maximum), expose text/data views and handle empty and zero values. Excess categorical series are combined into Other. Category charts accept finite nonnegative values; line/scatter charts accept finite signed values. Callers supply correctly ordered time buckets. No financial history or chart data is synthesized for wallet screens.

General copy controls provide success/failure feedback and cancel stale feedback when their value changes or they unmount. Recovery phrases and other secret exports must continue using `utils/sensitiveClipboard`.

## Integration

- All existing theme consumers receive the new surfaces, brand/status colors, type sizes and radii.
- Shared buttons, inputs, cards, headers, badges, callouts, copy controls and settings option sheets use the updated components/tokens.
- Bark uses metric and summary cards, status badges, form fields, notices, segmented receive methods and activity records. Its receive, boarding confirmation and Send routing handlers are retained.
- Merchant QR uses labeled fields, offer summary rows, receipt records and notices. Persistence-before-display and receipt fetching remain unchanged.

## Review on a device

1. Check out `feat/general-component-update`; install using `pnpm install --frozen-lockfile` and the repository's native setup instructions.
2. Start the development client with `npx expo start --dev-client`.
3. Open **Settings → Component preview** in a development build. Inspect both themes, large system text, dialogs, menus, dates, copy feedback and chart data views. This route is omitted from release navigation.
4. Check wallet setup, dashboard, Send, Receive, Swap, History and settings sheets at the smallest supported screen size.
5. On a configured test wallet, verify Bark receive-method changes clear the old QR, Send selects Bark, and boarding requires confirmation. Verify the merchant QR reopens the saved offer and displays receipts.

Automated checks cover token mapping, disabled controls, query-state precedence, clipboard failure/stale completion, date validation, pagination, modal dismissal, chart edge cases and the existing wallet regression suite. Android/iOS JavaScript exports check Metro and Hermes compilation. They do not replace native device, VoiceOver/TalkBack or live payment testing.
