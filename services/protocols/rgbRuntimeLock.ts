/**
 * rgb-lib's runtime lock, from the JS side
 * ----------------------------------------
 * rgb-lib writes `rgb_runtime.lock` in a wallet's folder while a call uses the
 * wallet's RGB runtime (opening the wallet, refresh, send, the consistency check
 * in goOnline, …) and deletes it when the call ends. A process killed mid-call
 * leaves it behind, and from then on every open of that wallet waits up to an
 * hour for the lock, then fails with "unreleased lock file": RGB on this phone
 * never connects again, on that network, and the native module's single file
 * queue holds the other network's open behind it too.
 *
 * The native module (modules/kaleido-rgb, openWallet) removes such a lock when
 * no wallet in the process has the folder open. This is the same rule for
 * native builds without that fix (an OTA update can run on them): the caller
 * makes sure this JS runtime has no wallet open in the folder, and a lock
 * younger than STALE_LOCK_AGE_MS is left alone in case a call is still running.
 */
export const RGB_RUNTIME_LOCK = 'rgb_runtime.lock'
export const STALE_LOCK_AGE_MS = 60_000

/** `dataDir`: the absolute folder rgb-lib opens wallets in (kaleido-rgb `dataDir(subdir)`). True when a lock was removed. */
export async function clearStaleRgbRuntimeLock(dataDir: string, masterFingerprint: string, now = Date.now()): Promise<boolean> {
  if (!/^[0-9a-fA-F]{8}$/.test(masterFingerprint)) return false
  const { File } = require('expo-file-system') as typeof import('expo-file-system')
  const base = dataDir.startsWith('file://') ? dataDir : `file://${encodeURI(dataDir)}`
  const lock = new File(`${base.replace(/\/+$/, '')}/${masterFingerprint}/${RGB_RUNTIME_LOCK}`)
  if (!lock.exists) return false
  const modified = lock.modificationTime
  if (modified != null && now - modified < STALE_LOCK_AGE_MS) return false
  lock.delete()
  return true
}
