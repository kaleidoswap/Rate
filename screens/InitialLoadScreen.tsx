import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDispatch } from 'react-redux';
import DatabaseService from '../services/DatabaseService';
import { setUnlocked, setInitialized, setActiveWallet } from '../store/slices/walletSlice';
import { autoRestoreNostrConnection, initializeProtocolServices } from '../services/initializeServices';
import { BrandLoading } from '../components/brand/BrandLoading';
import { Button } from '../components/Button';
import { hasBalanceSnapshot } from '../services/balanceSnapshot';
import { useAppTheme } from '../theme/ThemeProvider';

const STARTUP_WAIT_MS = 8000;
const SNAPSHOT_STARTUP_WAIT_MS = 1000;

export default function InitialLoadScreen({ navigation }: { navigation: any }) {
  const dispatch = useDispatch();
  const theme = useAppTheme();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const initializeApp = async () => {
      try {
        const dbService = DatabaseService.getInstance();
        await dbService.initializeDatabase();
        let activeWallet = await dbService.getActiveWallet();

        if (!activeWallet) {
          const wallets = await dbService.getAllWallets();
          if (!active) return;
          if (wallets.length === 0) {
            navigation.replace('WalletSetup');
            return;
          }
          const walletId = wallets[0].id;
          if (walletId == null) throw new Error('Saved wallet has no ID');
          await dbService.setActiveWallet(walletId);
          activeWallet = await dbService.getActiveWallet();
        }

        if (!active) return;
        // A SecureStore read failure can leave an existing record without its seed.
        if (!activeWallet?.encrypted_mnemonic) throw new Error('Saved wallet is unavailable');
        dispatch(setActiveWallet(activeWallet));

        // Give protocols a short head start. Slow connections continue in the background.
        const startupWaitMs = (await hasBalanceSnapshot(activeWallet)) ? SNAPSHOT_STARTUP_WAIT_MS : STARTUP_WAIT_MS;
        if (!active) return;
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

        if (!active) return;
        dispatch(setInitialized(true));
        dispatch(setUnlocked(true));

        autoRestoreNostrConnection().catch(error => {
          console.log('Nostr auto-restore failed (non-blocking):', error);
        });
        navigation.replace('Dashboard');
      } catch (error) {
        console.warn('Unable to open saved wallet:', error instanceof Error ? error.message : String(error));
        if (active) setFailed(true);
      }
    };

    void initializeApp();
    return () => { active = false; };
  }, [attempt, dispatch, navigation]);

  if (failed) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', backgroundColor: theme.colors.background.primary, paddingHorizontal: theme.spacing[6] }}>
        <View style={{ gap: theme.spacing[4] }}>
          <Text accessibilityRole="header" style={{ color: theme.colors.text.primary, fontSize: theme.typography.fontSize.xl, fontWeight: '700' }}>Couldn’t open your wallet</Text>
          <Text style={{ color: theme.colors.text.secondary, fontSize: theme.typography.fontSize.base }}>Unlock your device if needed, then try again.</Text>
          <Button title="Try again" onPress={() => { setFailed(false); setAttempt(value => value + 1); }} />
        </View>
      </SafeAreaView>
    );
  }

  return <BrandLoading />;
}
