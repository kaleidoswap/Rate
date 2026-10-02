import { useWindowDimensions } from 'react-native';
import { breakpoint } from '../theme/kaleido-source/breakpoints';

/** React Native dimensions already use logical pixels. */
export function useIsNarrow(at: keyof typeof breakpoint = 'md') {
  return useWindowDimensions().width < parseFloat(breakpoint[at]) * 16;
}
