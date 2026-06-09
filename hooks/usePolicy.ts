import { useSelector } from 'react-redux';
import { policyFor, type DisclosurePolicy } from '@kaleidorg/wallet-engine';
import { selectDisclosureLevel } from '../store/slices/settingsSlice';

/**
 * Resolves the active disclosure policy (Lite / Advanced) from settings.
 *
 * This is the single place screens should read progressive-disclosure flags
 * (`showNetworks`, `showRouteSelector`, `showChannelManagement`,
 * `showExperimental`, `showRawIds`) — gate advanced surfaces on these rather
 * than branching on the raw level string ad-hoc.
 */
export function usePolicy(): DisclosurePolicy {
  const level = useSelector(selectDisclosureLevel);
  return policyFor(level);
}
