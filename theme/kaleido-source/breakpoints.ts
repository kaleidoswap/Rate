/**
 * Viewport breakpoints. These are the widths the library's `sm:` / `md:` …
 * classes switch at — Tailwind's defaults, which kaleido-ui has always used
 * without naming them. Named here so script-side checks (`useIsNarrow`) and
 * the classes agree on one number.
 */
export const breakpoint = {
  sm: '40rem', // 640px
  md: '48rem', // 768px
  lg: '64rem', // 1024px
  xl: '80rem', // 1280px
} as const
