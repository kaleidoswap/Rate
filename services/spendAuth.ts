// Second factor for assistant-initiated spends above the threshold: the
// wallet's own lock (biometrics, then the wallet PIN), else the device lock.

import SecurityService from './SecurityService';

export type SpendAuthResult = 'approved' | 'denied' | 'pin';

type Security = Pick<
  SecurityService,
  'getSecuritySettings' | 'authenticateWithBiometric' | 'isDeviceAuthAvailable' | 'authenticateForReveal'
>;

/** 'pin' means: ask for the wallet PIN and check it with SecurityService.verifyPin. */
export async function authorizeSpend(
  prompt: string,
  security: Security = SecurityService.getInstance(),
): Promise<SpendAuthResult> {
  const settings = await security
    .getSecuritySettings()
    .catch(() => ({ pinEnabled: false, biometricEnabled: false }));
  if (settings.biometricEnabled) {
    const ok = await security.authenticateWithBiometric(prompt, { allowDeviceFallback: !settings.pinEnabled });
    if (ok) return 'approved';
    return settings.pinEnabled ? 'pin' : 'denied';
  }
  if (settings.pinEnabled) return 'pin';
  if (await security.isDeviceAuthAvailable()) {
    return (await security.authenticateForReveal(prompt)) ? 'approved' : 'denied';
  }
  return 'approved';
}
