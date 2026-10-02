/**
 * KaleidoSwap App Semantic Color System (slate identity)
 *
 * The canonical, mode-switchable semantic palette shared across KaleidoSwap
 * surfaces. Values are stored as space-separated RGB channels ("R G B") so the
 * generated CSS can expose them through Tailwind utilities with full
 * `<alpha-value>` opacity support (e.g. `bg-surface-overlay`, `text-content-primary/60`,
 * `bg-status-danger/10`) that composites identically to straight rgba() alpha.
 *
 * Dark is the brand default ("dark backgrounds anchor everything"); light is a
 * fully-specified counterpart. The CSS generator emits dark under `:root, .dark`
 * and light under `.light` to match the runtime convention (a single
 * `.dark` / `.light` class is toggled on the document root).
 *
 * These channels live in the `--app-*` CSS-variable namespace so they never
 * collide with the component-facing full-color vars (`--primary`, `--card`,
 * `--background`, …) that web components consume via raw `var()` references.
 */

/** Ordered token keys → CSS-variable suffix. Drives both the `--app-*`
 *  declarations and the `@theme inline` utility mappings. */
export type AppSemanticToken =
  | 'surface-base'
  | 'surface-raised'
  | 'surface-overlay'
  | 'surface-elevated'
  | 'surface-high'
  | 'primary'
  | 'primary-emphasis'
  | 'primary-foreground'
  | 'secondary'
  | 'secondary-emphasis'
  | 'secondary-foreground'
  | 'content-primary'
  | 'content-secondary'
  | 'content-tertiary'
  | 'content-inverse'
  | 'border-subtle'
  | 'border-default'
  | 'border-strong'
  | 'status-success'
  | 'status-danger'
  | 'status-warning'
  | 'status-info'
  | 'divider'

type AppSemanticChannels = Record<AppSemanticToken, string>

/** Dark mode — emitted under `:root, .dark`. */
export const appSemanticDark: AppSemanticChannels = {
  // Body is notably darker than cards — clear depth without full-black.
  'surface-base': '18 19 28', //  #12131C — deepest bg, sidebar
  'surface-raised': '24 25 36', // #181924 — page body bg
  'surface-overlay': '36 38 56', // #242638 — card bg (~14 lighter than body)
  'surface-elevated': '50 52 72', // #323448 — sections inside cards
  'surface-high': '66 68 90', //    #42445A — hover/active highlights
  primary: '21 233 154', //         #15E99A
  'primary-emphasis': '18 201 126', // #12C97E
  'primary-foreground': '18 19 28',
  secondary: '139 92 246', //       #8B5CF6
  'secondary-emphasis': '124 58 237',
  'secondary-foreground': '255 255 255',
  'content-primary': '232 233 242', // #E8E9F2 — slightly cool white
  'content-secondary': '142 146 172', // #8E92AC
  'content-tertiary': '88 92 116', // #585C74
  'content-inverse': '18 19 28',
  'border-subtle': '40 42 60', //   #282A3C
  'border-default': '54 56 76', //  #36384C
  'border-strong': '21 233 154',
  'status-success': '34 197 94',
  'status-danger': '248 113 113',
  'status-warning': '245 158 11',
  'status-info': '56 189 248',
  divider: '86 89 108', //          #56596C
}

/** Light mode — emitted under `.light`. */
export const appSemanticLight: AppSemanticChannels = {
  // Cards = white on a cool-gray page for clear depth.
  'surface-base': '218 220 234', // #DADCEA — sidebar/deep backgrounds
  'surface-raised': '234 236 248', // #EAECF8 — page body bg
  'surface-overlay': '255 255 255', // #FFFFFF — card bg (white)
  'surface-elevated': '246 247 253', // #F6F7FD — sections inside cards
  'surface-high': '228 230 246', // #E4E6F6 — hover/active highlights
  primary: '23 181 129', //         #17B581
  'primary-emphasis': '19 138 100', // #138A64
  'primary-foreground': '255 255 255',
  secondary: '111 50 255', //       #6F32FF
  'secondary-emphasis': '90 31 229', // #5A1FE5
  'secondary-foreground': '255 255 255',
  'content-primary': '18 19 30', //  #12131E
  'content-secondary': '70 74 105', // #464A69
  'content-tertiary': '118 122 152', // #767A98
  'content-inverse': '255 255 255',
  'border-subtle': '218 220 238', // #DADCEE
  'border-default': '200 203 224', // #C8CBE0
  'border-strong': '23 181 129',
  'status-success': '22 163 74',
  'status-danger': '220 38 38',
  'status-warning': '217 119 6',
  'status-info': '2 132 199',
  divider: '200 203 224', //         #C8CBE0
}

/** Fixed-alpha tinted intent surfaces (e.g. `bg-status-danger-subtle`). */
export const appStatusSubtleAlpha = '0.15'

/** Token keys in the order they should be emitted. */
export const appSemanticOrder = Object.keys(appSemanticDark) as AppSemanticToken[]
