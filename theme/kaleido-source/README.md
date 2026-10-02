# Shared token snapshot

Copied without modification from [kaleido-ui main](https://github.com/kaleidoswap/kaleido-ui/commit/843ce241538c4ff35427132b6326b712ee8ce672), commit `843ce241538c4ff35427132b6326b712ee8ce672`, package version `0.1.129` (2026-10-02). This version was not published on npm when the mobile port was made. The MIT license is included here.

Files: `src/tokens/{app-semantic,typography,radius,chart,breakpoints}.ts`. These files are the source of truth for `theme/partner.ts`; the installed UI package still supplies fonts, icons and network colors. Once this version is published, replace these local imports with the package's `/tokens` exports. Do not independently tune the copied values.
