/**
 * Which features a build ships and which ones the user has turned on.
 *
 * The build channel (EXPO_PUBLIC_CHANNEL) sets the ceiling:
 * - `dev` (default): everything exists and Labs features start on.
 * - `beta` / `store`: Held features are unavailable. Prismo and Contacts start
 *   on. The remaining Labs features start off.
 */

export type Channel = 'dev' | 'beta' | 'store';

/** The user can override the build defaults for these features. */
export const LABS_FEATURES = ['prismo', 'social', 'map', 'nwc', 'rgbNode', 'lsp'] as const;
/** Not shipped outside `dev`. */
export const HELD_FEATURES = ['makerSwaps', 'rgbOnDevice', 'merchantOffer'] as const;

export type LabsFeature = typeof LABS_FEATURES[number];
export type HeldFeature = typeof HELD_FEATURES[number];
export type Feature = LabsFeature | HeldFeature;
export type LabsState = Partial<Record<LabsFeature, boolean>>;

export function parseChannel(value: string | undefined): Channel {
  return value === 'beta' || value === 'store' ? value : 'dev';
}

// Direct member access: Expo inlines EXPO_PUBLIC_* only in this form.
export const CHANNEL: Channel = parseChannel(process.env.EXPO_PUBLIC_CHANNEL);

export function isLabsFeature(feature: Feature): feature is LabsFeature {
  return (LABS_FEATURES as readonly string[]).includes(feature);
}

/** Whether the build ships the feature at all. */
export function isAvailable(feature: Feature, channel: Channel = CHANNEL): boolean {
  return channel === 'dev' || isLabsFeature(feature);
}

/** Whether the feature is on, given the user's Labs choices. */
export function isFeatureOn(feature: Feature, labs: LabsState | undefined, channel: Channel = CHANNEL): boolean {
  if (!isAvailable(feature, channel)) return false;
  if (!isLabsFeature(feature)) return true;
  return labs?.[feature] ?? (channel === 'dev' || feature === 'prismo' || feature === 'social');
}

export const LABS_COPY: Record<LabsFeature, { label: string; description: string }> = {
  prismo: { label: 'Prismo', description: 'On-device assistant for chat and voice' },
  social: { label: 'Contacts and chat', description: 'Pay and message your Nostr contacts' },
  map: { label: 'Places to pay', description: 'Nearby businesses accepting bitcoin' },
  nwc: { label: 'Wallet connections', description: 'Connect an NWC wallet to this app' },
  rgbNode: { label: 'RGB Lightning node', description: 'Use your own RGB Lightning node' },
  lsp: { label: 'Lightning channels', description: 'Open channels with a liquidity provider' },
};
