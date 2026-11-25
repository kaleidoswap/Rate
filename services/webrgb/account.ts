import { AppState } from 'react-native';
import { getStore } from '../../store/storeProvider';
import { isAppUnlocked } from '../appLockState';
import { protocolManager, rgbAccountIsOnDevice } from '../protocols';
import { isRgbConnecting } from '../protocols/wdk';
import { rgbL1WalletKey } from '../protocols/rgbL1WalletKey';
import type { RgbLibRnAccount } from '../protocols/rgbLibRn';

export function currentWebRgbAccount() {
  const state = getStore().getState().wallet;
  if (AppState.currentState !== 'active' || !isAppUnlocked() || !state?.isUnlocked) {
    throw new Error('Open and unlock KaleidoSwap Wallet to connect a dApp.');
  }
  const wallet = state.activeWallet;
  const adapter = protocolManager.getAdapterIfAvailable('RGB_L1');
  const account = (adapter as { account?: RgbLibRnAccount } | undefined)?.account;
  if (!wallet?.id || !wallet.encrypted_mnemonic || isRgbConnecting() || !rgbAccountIsOnDevice() || !adapter?.isConnected() ||
      !account?.network || account.ownerKey !== rgbL1WalletKey(wallet.encrypted_mnemonic)) {
    throw new Error('Enable RGB on this phone for the active wallet, then scan the code again.');
  }
  return { account, walletName: typeof wallet.name === 'string' ? wallet.name : '', key: `webrgb-wc-v1-${wallet.id}-${account.ownerKey}-${account.network}` };
}
