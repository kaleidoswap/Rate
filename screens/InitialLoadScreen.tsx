import React, { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import DatabaseService, { NetworkConfig } from '../services/DatabaseService';
import { setUnlocked, setInitialized, setActiveWallet } from '../store/slices/walletSlice';
import { autoRestoreNostrConnection, initializeProtocolServices } from '../services/initializeServices';
import { BrandLoading } from '../components/brand/BrandLoading';
import { hasBalanceSnapshot } from '../services/balanceSnapshot';

const STARTUP_WAIT_MS = 8000;
const SNAPSHOT_STARTUP_WAIT_MS = 1000;

export default function InitialLoadScreen({ navigation }: { navigation: any }) {
  const dispatch = useDispatch();

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      // Initialize database first
      const dbService = DatabaseService.getInstance();
      await dbService.initializeDatabase();
      
      // Load active wallet
      let activeWallet = await dbService.getActiveWallet();

      // If no active wallet, try to find any wallet and make it active (Single Wallet enforcement)
      if (!activeWallet) {
        const wallets = await dbService.getAllWallets();
        if (wallets.length > 0) {
          await dbService.setActiveWallet(wallets[0].id!);
          activeWallet = await dbService.getActiveWallet();
        }
      }

      if (activeWallet) {
        // Set active wallet in Redux
        dispatch(setActiveWallet(activeWallet));

        // Initialize protocol services — timeout after 8s so a slow/unreachable
        // node never blocks the load screen on Android or low-connectivity devices.
        // With last balances to show, the dashboard can open almost at once.
        const startupWaitMs = (await hasBalanceSnapshot(activeWallet)) ? SNAPSHOT_STARTUP_WAIT_MS : STARTUP_WAIT_MS;
        let startupTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            initializeProtocolServices(),
            new Promise<void>((resolve) => {
              startupTimer = setTimeout(resolve, startupWaitMs);
            }),
          ]);
        } catch (e) {
          console.warn('Protocol initialization failed:', e instanceof Error ? e.message : String(e));
        } finally {
          if (startupTimer) clearTimeout(startupTimer);
        }
        // Slow connections continue in the background. Dashboard joins the same initialization.

        dispatch(setInitialized(true));
        dispatch(setUnlocked(true));

        // Attempt to auto-restore Nostr connection in parallel
        autoRestoreNostrConnection().catch(error => {
          console.log('Nostr auto-restore failed (non-blocking):', error);
        });

        navigation.replace('Dashboard');
        return;
      }

      // If absolutely no wallets, go to WalletSetup (Onboarding)
      navigation.replace('WalletSetup');

    } catch (error) {
      console.error('Initial state check error:', error);
      // Fallback to Setup if something critical fails
      navigation.replace('WalletSetup');
    }
  };

  // Branded loader that visually continues the BrandIntro (same dark
  // kaleidoscope background) so the launch feels like one seamless moment
  // instead of flashing a white screen with a blue spinner.
  return <BrandLoading />;
}
