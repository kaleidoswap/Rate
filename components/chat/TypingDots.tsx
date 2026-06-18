// components/chat/TypingDots.tsx
//
// Thin re-export of the shared kaleido-ui/native TypingDots so the KaleidoMind
// chat uses the same typing indicator as the web assistant (rate-extension).
// Kept as a local module to preserve existing import paths; the implementation
// now lives in @kaleidorg/kaleido-ui. useKaleidoTheme falls back to the dark
// palette when no KaleidoUIProvider is mounted, which is the app default.
export { TypingDots as default, type TypingDotsProps } from '@kaleidorg/kaleido-ui/native';
