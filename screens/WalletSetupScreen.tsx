// screens/WalletSetupScreen.tsx
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
  TouchableOpacity,
  Animated,
  StatusBar,
  Keyboard,
  Platform,
  KeyboardAvoidingView,
  Clipboard,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import { createNewWallet, setInitialized, setUnlocked } from '../store/slices/walletSlice';
import { setDisclosureLevel } from '../store/slices/settingsSlice';
import type { DisclosureLevel } from '@kaleidorg/wallet-engine';
import { theme } from '../theme';
import { NetworkType, NetworkConfig } from '../services/DatabaseService';
import { buildDefaultNetworkConfig } from '../services/protocols/networkConfig';
import { Button, Card, Input, ScreenHeader } from '../components';
import { NetworkIcon } from '../components/NetworkIcon';
import { AlertBanner } from '@kaleidorg/kaleido-ui/native';
import { NWCClient, parseNwcUri } from '../services/nwc/NWCExternalClient';

/** SecureStore key shared with NwcRgbAdapter + NWCConnectScreen. */
const NWC_CONNECTION_KEY = 'nwc_connection_string';

interface Props {
  navigation: any;
}

type SetupStep = 'welcome' | 'mode' | 'rln' | 'networks' | 'creating' | 'backup' | 'confirmBackup' | 'success';

export default function WalletSetupScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const dispatch = useDispatch();
  const [step, setStep] = useState<SetupStep>('welcome');
  const [name, setName] = useState('');
  const [createdWalletId, setCreatedWalletId] = useState<number | null>(null);
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string>('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [mnemonicCopied, setMnemonicCopied] = useState(false);

  // Disclosure level chosen at creation (default 'lite', reversible in Settings).
  const [mode, setMode] = useState<DisclosureLevel>('lite');

  // Network selection state — enable all protocols by default (matching extension)
  const [networks, setNetworks] = useState<{ [key in NetworkType]: boolean }>({
    spark: true,
    liquid: false,
    arkade: true,
    rln: true,
  });

  // RLN (RGB Lightning Node) over NWC — paste/scan a connection string to drive a
  // remote node. Optional: the user can skip and add it later in Settings.
  const [nwcUri, setNwcUri] = useState('');
  const [rlnConnected, setRlnConnected] = useState(false);
  const [rlnConnecting, setRlnConnecting] = useState(false);
  const [rlnError, setRlnError] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Animation values
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0)).current;

  const animateTransition = useCallback((nextStep: SetupStep) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -30,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start(() => {
      setStep(nextStep);
      slideAnim.setValue(30);
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        })
      ]).start();
    });
  }, [fadeAnim, slideAnim]);

  const animateSuccess = useCallback(() => {
    scaleAnim.setValue(0);
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 4,
      tension: 40,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handleNext = () => {
    Keyboard.dismiss();

    if (step === 'welcome') {
      if (!name.trim()) {
        Alert.alert('Wallet Name Required', 'Please give your wallet a name to continue.');
        return;
      }
      animateTransition('mode');
    } else if (step === 'mode') {
      // Persist the chosen disclosure level; reversible later in Settings.
      dispatch(setDisclosureLevel(mode));
      if (mode === 'lite') {
        // Lite hides network management, but Spark and Arkade are both WDK-backed
        // and should be available on Android. Liquid remains disabled by default
        // because it requires the native lwk-rn binding.
        setNetworks((prev) => ({
          ...prev,
          spark: true,
          arkade: true,
          liquid: Platform.OS !== 'android',
        }));
      }
      // Both modes go through the RLN-over-NWC step (skippable).
      animateTransition('rln');
    } else if (step === 'networks') {
      handleCreate();
    }
  };

  /** Advance past the RLN step: Lite goes straight to backup, Advanced picks networks. */
  const proceedAfterRln = () => {
    if (mode === 'lite') {
      handleCreate();
    } else {
      animateTransition('networks');
    }
  };

  const handleConnectRln = async () => {
    Keyboard.dismiss();
    const uri = nwcUri.trim();
    setRlnError('');
    try {
      parseNwcUri(uri); // validate shape before hitting the network
    } catch (e) {
      setRlnError(e instanceof Error ? e.message : 'Invalid connection string');
      return;
    }
    setRlnConnecting(true);
    let client: NWCClient | null = null;
    try {
      client = new NWCClient(uri, { timeoutMs: 20_000 });
      await client.getInfo(); // live connection test
      await SecureStore.setItemAsync(NWC_CONNECTION_KEY, uri);
      setRlnConnected(true);
      proceedAfterRln();
    } catch (e) {
      setRlnError(e instanceof Error ? e.message : 'Could not reach the node');
    } finally {
      client?.close();
      setRlnConnecting(false);
    }
  };

  const handleSkipRln = async () => {
    Keyboard.dismiss();
    setRlnConnected(false);
    // Drop any previously stored string so a skipped setup doesn't reuse a stale node.
    await SecureStore.deleteItemAsync(NWC_CONNECTION_KEY).catch(() => {});
    proceedAfterRln();
  };

  const handleOpenScanner = async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        setRlnError('Camera permission is required to scan the QR code');
        return;
      }
    }
    setRlnError('');
    setShowScanner(true);
  };

  const handleScanned = (data: string) => {
    setShowScanner(false);
    setNwcUri(data.trim());
  };

  const handleBack = () => {
    Keyboard.dismiss();
    if (step === 'networks') {
      animateTransition('rln');
    } else if (step === 'rln') {
      animateTransition('mode');
    } else if (step === 'mode') {
      animateTransition('welcome');
    } else if (step === 'welcome') {
      navigation.goBack();
    }
  };

  const handleCreate = async () => {
    try {
      // Generate mnemonic
      const bip39 = require('bip39');
      const mnemonic = bip39.generateMnemonic(); // 12 words default
      
      setGeneratedMnemonic(mnemonic);
      console.log('Generated Mnemonic:', mnemonic);
      
      // Show backup screen first
      animateTransition('backup');
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate wallet');
    }
  };

  const handleProceedWithBackup = () => {
    animateTransition('confirmBackup');
  };

  const handleConfirmBackup = async () => {
    if (!backupConfirmed) {
      Alert.alert(
        'Backup Required', 
        'Please confirm that you have safely stored your recovery phrase before continuing.'
      );
      return;
    }

    animateTransition('creating');

    try {
      const selectedNetworks: Omit<NetworkConfig, 'id' | 'wallet_id'>[] = [];

      if (networks.spark) {
        selectedNetworks.push({ type: 'spark', enabled: true, config: buildDefaultNetworkConfig('spark') });
      }
      if (networks.liquid) {
        selectedNetworks.push({ type: 'liquid', enabled: true, config: buildDefaultNetworkConfig('liquid') });
      }
      if (networks.arkade) {
        selectedNetworks.push({ type: 'arkade', enabled: true, config: buildDefaultNetworkConfig('arkade') });
      }
      // RLN is reached over NWC: enable it only when the user connected a node.
      // The NwcRgbAdapter reads the connection string from SecureStore.
      if (rlnConnected) {
        selectedNetworks.push({
          type: 'rln',
          enabled: true,
          config: JSON.stringify({ via: 'nwc', network: 'regtest' })
        });
      }

      // @ts-ignore
      const resultAction = await dispatch(createNewWallet({
        name,
        mnemonic: generatedMnemonic,
        networks: selectedNetworks
      }));

      if (createNewWallet.fulfilled.match(resultAction)) {
        const wallet = resultAction.payload;
        if (wallet) {
          setCreatedWalletId(wallet.id || null);
          dispatch(setInitialized(true));
          dispatch(setUnlocked(true));

          // Show success screen
          setStep('success');
          animateSuccess();
        }
      } else {
        throw new Error('Failed to create wallet');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to create wallet');
      animateTransition('confirmBackup');
    }
  };

  const handleSetupSecurity = () => {
    navigation.replace('SecuritySetup', { walletId: createdWalletId, isInitialSetup: true });
  };

  const handleSkipSecurity = () => {
    navigation.replace('NostrSetup', { isInitialSetup: true });
  };

  const renderStepIndicator = () => {
    const steps: SetupStep[] = mode === 'advanced'
      ? ['welcome', 'mode', 'rln', 'networks']
      : ['welcome', 'mode', 'rln'];
    const currentIdx = steps.indexOf(step);

    if (step === 'creating' || step === 'success') return null;

    return (
      <View style={styles.stepIndicatorContainer}>
        {steps.map((s, idx) => (
          <View key={s} style={styles.stepDotContainer}>
            <View style={[
              styles.stepDot,
              idx <= currentIdx ? styles.stepDotActive : styles.stepDotInactive
            ]}>
              {idx < currentIdx && (
                <Ionicons name="checkmark" size={10} color="white" />
              )}
            </View>
            {idx < steps.length - 1 && (
              <View style={[
                styles.stepLine,
                idx < currentIdx ? styles.stepLineActive : styles.stepLineInactive
              ]} />
            )}
          </View>
        ))}
      </View>
    );
  };

  const renderWelcomeStep = () => (
    <ScrollView
      style={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.iconHeader}>
        <View style={styles.welcomeIconContainer}>
          <Ionicons name="wallet" size={32} color={theme.colors.primary[500]} />
        </View>
      </View>

      <Text style={styles.stepTitle}>Create Your Wallet</Text>
      <Text style={styles.stepDescription}>
        Give your wallet a name. You can always change it later in settings.
      </Text>

      <View style={styles.inputWrapper}>
        <Input
          label="Wallet Name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. My Lightning Wallet"
          returnKeyType="done"
          onSubmitEditing={handleNext}
          autoCapitalize="words"
          autoCorrect={false}
          variant="outlined"
          size="lg"
        />
      </View>

      <View style={styles.tipContainer}>
        <View style={styles.tipIcon}>
          <Ionicons name="bulb-outline" size={18} color={theme.colors.warning[500]} />
        </View>
        <Text style={styles.tipText}>
          Tip: Choose a name that helps you identify this wallet if you create multiple ones.
        </Text>
      </View>
    </ScrollView>
  );

  const renderModeStep = () => {
    const options: Array<{
      value: DisclosureLevel;
      title: string;
      recommended?: boolean;
      icon: keyof typeof Ionicons.glyphMap;
      desc: string;
    }> = [
      {
        value: 'lite',
        title: 'Lite',
        recommended: true,
        icon: 'sparkles-outline',
        desc: 'Simple view — just BTC, USD and your assets. No networks or channels to manage.',
      },
      {
        value: 'advanced',
        title: 'Advanced',
        icon: 'options-outline',
        desc: 'Full control — see every network, pick send routes and manage Lightning channels.',
      },
    ];

    return (
      <ScrollView
        style={styles.stepContent}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.iconHeader}>
          <View style={[styles.welcomeIconContainer, { backgroundColor: theme.colors.primary[50] }]}>
            <Ionicons name="contrast-outline" size={32} color={theme.colors.primary[500]} />
          </View>
        </View>

        <Text style={styles.stepTitle}>Choose Your Experience</Text>
        <Text style={styles.stepDescription}>
          Pick how much detail you want to see. You can change this anytime in Settings.
        </Text>

        {options.map((option) => {
          const selected = mode === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              style={[styles.modeOption, selected && styles.modeOptionActive]}
              onPress={() => setMode(option.value)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, { backgroundColor: theme.colors.primary[50] }]}>
                <Ionicons name={option.icon} size={22} color={theme.colors.primary[500]} />
              </View>
              <View style={styles.modeTextContainer}>
                <View style={styles.modeTitleRow}>
                  <Text style={styles.networkName}>{option.title}</Text>
                  {option.recommended && (
                    <View style={styles.recommendedBadge}>
                      <Text style={styles.recommendedText}>Recommended</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.networkDesc}>{option.desc}</Text>
              </View>
              <View style={[styles.modeRadio, selected && styles.modeRadioActive]}>
                {selected && <Ionicons name="checkmark" size={14} color="white" />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    );
  };

  const renderNetworksStep = () => (
    <ScrollView
      style={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.iconHeader}>
        <View style={[styles.welcomeIconContainer, { backgroundColor: theme.colors.secondary[50] }]}>
          <Ionicons name="git-network" size={32} color={theme.colors.secondary[500]} />
        </View>
      </View>

      <Text style={styles.stepTitle}>Choose Networks</Text>
      <Text style={styles.stepDescription}>
        Select which protocols to enable. You can change these anytime.
      </Text>

      <Card style={styles.networkCard}>
        <TouchableOpacity
          style={styles.networkItem}
          onPress={() => setNetworks(prev => ({ ...prev, spark: !prev.spark }))}
          activeOpacity={0.7}
        >
          <View style={styles.networkInfo}>
            <View style={[styles.iconContainer, { backgroundColor: '#FEF3C7' }]}>
              <NetworkIcon network="spark" size={24} />
            </View>
            <View style={styles.networkTextContainer}>
              <Text style={styles.networkName}>Spark</Text>
              <Text style={styles.networkDesc}>Fast Lightning payments</Text>
            </View>
          </View>
          <Switch
            value={networks.spark}
            onValueChange={(v) => setNetworks(prev => ({ ...prev, spark: v }))}
            trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[400] }}
            thumbColor={networks.spark ? theme.colors.primary[500] : theme.colors.gray[100]}
          />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.networkItem}
          onPress={() => setNetworks(prev => ({ ...prev, liquid: !prev.liquid }))}
          activeOpacity={0.7}
        >
          <View style={styles.networkInfo}>
            <View style={[styles.iconContainer, { backgroundColor: '#E0F2FE' }]}>
              <Ionicons name="water" size={22} color="#0EA5E9" />
            </View>
            <View style={styles.networkTextContainer}>
              <Text style={styles.networkName}>Liquid</Text>
              <Text style={styles.networkDesc}>Sidechain for faster settlements</Text>
            </View>
          </View>
          <Switch
            value={networks.liquid}
            onValueChange={(v) => setNetworks(prev => ({ ...prev, liquid: v }))}
            trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[400] }}
            thumbColor={networks.liquid ? theme.colors.primary[500] : theme.colors.gray[100]}
          />
        </TouchableOpacity>

        <View style={styles.divider} />

        <TouchableOpacity
          style={styles.networkItem}
          onPress={() => setNetworks(prev => ({ ...prev, arkade: !prev.arkade }))}
          activeOpacity={0.7}
        >
          <View style={styles.networkInfo}>
            <View style={[styles.iconContainer, { backgroundColor: '#E0E7FF' }]}>
              <NetworkIcon network="arkade" size={24} />
            </View>
            <View style={styles.networkTextContainer}>
              <Text style={styles.networkName}>Arkade</Text>
              <Text style={styles.networkDesc}>Virtual UTXOs on Bitcoin</Text>
            </View>
          </View>
          <Switch
            value={networks.arkade}
            onValueChange={(v) => setNetworks(prev => ({ ...prev, arkade: v }))}
            trackColor={{ false: theme.colors.gray[300], true: theme.colors.primary[400] }}
            thumbColor={networks.arkade ? theme.colors.primary[500] : theme.colors.gray[100]}
          />
        </TouchableOpacity>
      </Card>
    </ScrollView>
  );

  const renderRlnStep = () => (
    <ScrollView
      style={styles.stepContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.iconHeader}>
        <View style={[styles.welcomeIconContainer, { backgroundColor: '#D1FAE5' }]}>
          <NetworkIcon network="rgb" size={32} />
        </View>
      </View>

      <Text style={styles.stepTitle}>RGB Lightning Node</Text>
      <Text style={styles.stepDescription}>
        Hold RGB assets and open Lightning channels via your own RLN node. Connect it over
        Nostr Wallet Connect — or skip and add it later in Settings.
      </Text>

      <View style={styles.experimentalBadge}>
        <Ionicons name="flask-outline" size={14} color={theme.colors.warning[600]} />
        <Text style={styles.experimentalText}>Experimental · Test network only</Text>
      </View>

      <View style={styles.inputWrapper}>
        <Input
          label="NWC connection string"
          value={nwcUri}
          onChangeText={(t) => { setNwcUri(t); if (rlnError) setRlnError(''); }}
          placeholder="nostr+walletconnect://..."
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          editable={!rlnConnecting}
          variant="outlined"
        />
      </View>

      <TouchableOpacity style={styles.scanButton} onPress={handleOpenScanner} disabled={rlnConnecting}>
        <Ionicons name="qr-code-outline" size={18} color={theme.colors.primary[600]} />
        <Text style={styles.scanButtonText}>Scan QR code</Text>
      </TouchableOpacity>

      {!!rlnError && (
        <AlertBanner variant="error" style={styles.rlnErrorBox}>
          <Ionicons name="alert-circle" size={20} color={theme.colors.error[500]} />
          <Text style={styles.rlnErrorText}>{rlnError}</Text>
        </AlertBanner>
      )}

      <View style={styles.tipContainer}>
        <View style={styles.tipIcon}>
          <Ionicons name="bulb-outline" size={18} color={theme.colors.info[500]} />
        </View>
        <Text style={styles.tipText}>
          Get a connection string from the KaleidoSwap desktop app (or your self-hosted node).
        </Text>
      </View>
    </ScrollView>
  );

  const renderCreatingStep = () => (
    <View style={styles.centerContent}>
      <View style={styles.loadingContainer}>
        <Animated.View style={[styles.loadingRing, styles.loadingRing1]} />
        <Animated.View style={[styles.loadingRing, styles.loadingRing2]} />
        <View style={styles.loadingIcon}>
          <Ionicons name="wallet" size={36} color={theme.colors.primary[500]} />
        </View>
      </View>
      <Text style={styles.creatingTitle}>Creating Your Wallet</Text>
      <Text style={styles.creatingDesc}>Setting up your secure environment...</Text>
    </View>
  );

  const renderBackupStep = () => {
    const words = generatedMnemonic.split(' ');

    return (
      <ScrollView
        style={styles.stepContent}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.iconHeader}>
          <View style={[styles.welcomeIconContainer, { backgroundColor: theme.colors.warning[50] }]}>
            <Ionicons name="shield-checkmark-outline" size={32} color={theme.colors.warning[500]} />
          </View>
        </View>

        <Text style={styles.stepTitle}>Backup Recovery Phrase</Text>
        <Text style={styles.stepDescription}>
          Write down these 12 words in order. You'll need them to restore your wallet if you lose access.
        </Text>

        <View style={styles.warningBox}>
          <Ionicons name="warning" size={20} color={theme.colors.warning[600]} />
          <Text style={styles.warningText}>
            Never share your recovery phrase. Anyone with these words can access your funds.
          </Text>
        </View>

        <Card style={styles.mnemonicCard}>
          <View style={styles.mnemonicGrid}>
            {words.map((word, index) => (
              <View key={index} style={styles.mnemonicItem}>
                <Text style={styles.mnemonicNumber}>{index + 1}.</Text>
                <Text style={styles.mnemonicWord}>{word}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={styles.copyButton}
            onPress={() => {
              Clipboard.setString(generatedMnemonic);
              setMnemonicCopied(true);
              Alert.alert('Copied!', 'Recovery phrase copied to clipboard. Make sure to store it safely!');
            }}
          >
            <Ionicons 
              name={mnemonicCopied ? 'checkmark-circle' : 'copy-outline'} 
              size={18} 
              color={mnemonicCopied ? theme.colors.success[500] : theme.colors.primary[500]} 
            />
            <Text style={[styles.copyButtonText, mnemonicCopied && styles.copyButtonTextSuccess]}>
              {mnemonicCopied ? 'Copied' : 'Copy to Clipboard'}
            </Text>
          </TouchableOpacity>
        </Card>

        <View style={styles.tipContainer}>
          <View style={styles.tipIcon}>
            <Ionicons name="bulb-outline" size={18} color={theme.colors.info[500]} />
          </View>
          <Text style={styles.tipText}>
            Tip: Write these words on paper and store them in a safe place. Don't save them digitally.
          </Text>
        </View>
      </ScrollView>
    );
  };

  const renderConfirmBackupStep = () => (
    <ScrollView
      style={styles.stepContent}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
    >
      <View style={styles.iconHeader}>
        <View style={[styles.welcomeIconContainer, { backgroundColor: theme.colors.success[50] }]}>
          <Ionicons name="checkbox-outline" size={32} color={theme.colors.success[500]} />
        </View>
      </View>

      <Text style={styles.stepTitle}>Confirm Backup</Text>
      <Text style={styles.stepDescription}>
        Please confirm that you have safely stored your recovery phrase.
      </Text>

      <Card style={styles.confirmCard}>
        <TouchableOpacity
          style={styles.checkboxRow}
          onPress={() => setBackupConfirmed(!backupConfirmed)}
          activeOpacity={0.7}
        >
          <View style={[styles.checkbox, backupConfirmed && styles.checkboxChecked]}>
            {backupConfirmed && (
              <Ionicons name="checkmark" size={18} color="white" />
            )}
          </View>
          <Text style={styles.checkboxText}>
            I have written down my 12-word recovery phrase and stored it in a safe place
          </Text>
        </TouchableOpacity>
      </Card>

      <AlertBanner variant="warning" style={styles.reminderBox}>
        <Ionicons name="information-circle" size={24} color={theme.colors.warning[500]} />
        <View style={styles.reminderContent}>
          <Text style={styles.reminderTitle}>Important Reminder</Text>
          <Text style={styles.reminderText}>
            • Your recovery phrase is the ONLY way to restore your wallet{'\n'}
            • KaleidoSwap cannot recover your wallet if you lose this phrase{'\n'}
            • Keep it private and secure at all times
          </Text>
        </View>
      </AlertBanner>
    </ScrollView>
  );

  const renderSuccessStep = () => (
    <ScrollView
      style={styles.stepContent}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.centerContent, { paddingBottom: insets.bottom + 24 }]}
    >
      <Animated.View style={[
        styles.successIconContainer,
        { transform: [{ scale: scaleAnim }] }
      ]}>
        <LinearGradient
          colors={['#10B981', '#059669']}
          style={styles.successGradient}
        >
          <Ionicons name="checkmark" size={48} color="white" />
        </LinearGradient>
      </Animated.View>

      <Text style={styles.successTitle}>Wallet Created!</Text>
      <Text style={styles.successDesc}>
        Your wallet "{name}" is ready to use.
      </Text>

      <View style={styles.securityPrompt}>
        <View style={styles.securityHeader}>
          <Ionicons name="shield-checkmark" size={24} color={theme.colors.primary[500]} />
          <Text style={styles.securityTitle}>Add Security?</Text>
        </View>
        <Text style={styles.securityDesc}>
          Protect your wallet with a PIN code or biometric authentication (Face ID / Fingerprint).
        </Text>

        <View style={styles.securityButtons}>
          <Button
            title="Set Up Security"
            onPress={handleSetupSecurity}
            style={styles.securityButton}
          />
          <TouchableOpacity
            style={styles.skipButton}
            onPress={handleSkipSecurity}
          >
            <Text style={styles.skipButtonText}>Skip for now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  );

  const getButtonTitle = () => {
    if (step === 'welcome') return 'Continue';
    if (step === 'mode') return 'Continue';
    if (step === 'networks') return 'Generate Wallet';
    if (step === 'backup') return 'I\'ve Backed It Up';
    if (step === 'confirmBackup') return 'Create Wallet';
    return '';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={step === 'success' ? 'Success' : 'New Wallet'}
        showBack={step !== 'creating' && step !== 'success'}
      />
      {(step !== 'creating' && step !== 'success') ? renderStepIndicator() : null}

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 20}
      >
        <Animated.View
          style={[
            styles.contentContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          <View style={styles.animatedContent}>
            {step === 'welcome' && renderWelcomeStep()}
            {step === 'mode' && renderModeStep()}
            {step === 'rln' && renderRlnStep()}
            {step === 'networks' && renderNetworksStep()}
            {step === 'backup' && renderBackupStep()}
            {step === 'confirmBackup' && renderConfirmBackupStep()}
            {step === 'creating' && renderCreatingStep()}
            {step === 'success' && renderSuccessStep()}
          </View>
        </Animated.View>

        {(step === 'welcome' || step === 'mode' || step === 'networks' || step === 'backup' || step === 'confirmBackup') && (
          <View style={styles.footer}>
            <Button
              title={getButtonTitle()}
              onPress={
                step === 'backup' ? handleProceedWithBackup :
                step === 'confirmBackup' ? handleConfirmBackup :
                handleNext
              }
              disabled={step === 'confirmBackup' && !backupConfirmed}
              style={styles.nextButton}
            />
          </View>
        )}

        {step === 'rln' && (
          <View style={styles.footer}>
            <Button
              title={rlnConnecting ? 'Connecting…' : 'Connect RLN'}
              onPress={handleConnectRln}
              disabled={rlnConnecting || !nwcUri.trim()}
              loading={rlnConnecting}
              style={styles.nextButton}
            />
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkipRln}
              disabled={rlnConnecting}
            >
              <Text style={styles.skipButtonText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {showScanner && (
        <View style={styles.scannerOverlay}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => handleScanned(data)}
          />
          <SafeAreaView style={styles.scannerControls}>
            <Text style={styles.scannerHint}>Scan the NWC connection QR code</Text>
            <TouchableOpacity style={styles.scannerClose} onPress={() => setShowScanner(false)}>
              <Ionicons name="close" size={24} color="white" />
              <Text style={styles.scannerCloseText}>Cancel</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.secondary,
  },
  headerGradient: {
    paddingBottom: theme.spacing[6],
  },
  safeArea: {
    marginBottom: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: 'white',
  },
  placeholder: {
    width: 40,
  },
  stepIndicatorContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: theme.spacing[4],
  },
  stepDotContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: {
    backgroundColor: 'white',
    borderColor: 'white',
  },
  stepDotInactive: {
    backgroundColor: 'transparent',
  },
  stepLine: {
    width: 60,
    height: 2,
    marginHorizontal: 8,
  },
  stepLineActive: {
    backgroundColor: 'white',
  },
  stepLineInactive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  keyboardAvoid: {
    flex: 1,
    marginTop: -theme.spacing[4],
  },
  contentContainer: {
    flex: 1,
  },
  animatedContent: {
    flex: 1,
    backgroundColor: theme.colors.surface.primary,
    borderTopLeftRadius: theme.borderRadius['2xl'],
    borderTopRightRadius: theme.borderRadius['2xl'],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  stepContent: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing[6],
    paddingBottom: 180,
  },
  iconHeader: {
    alignItems: 'center',
    marginBottom: theme.spacing[4],
  },
  welcomeIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    textAlign: 'center',
    marginBottom: theme.spacing[2],
  },
  stepDescription: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    textAlign: 'center',
    marginBottom: theme.spacing[6],
    lineHeight: 24,
    paddingHorizontal: theme.spacing[2],
  },
  inputWrapper: {
    marginBottom: theme.spacing[4],
  },
  tipContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.warning[50],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    marginTop: theme.spacing[2],
  },
  tipIcon: {
    marginRight: theme.spacing[3],
    marginTop: 2,
  },
  tipText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning[700] || theme.colors.warning[600],
    lineHeight: 20,
  },
  networkCard: {
    padding: 0,
    overflow: 'hidden',
  },
  modeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1.5,
    borderColor: theme.colors.border.light,
    backgroundColor: theme.colors.surface.primary,
    marginBottom: theme.spacing[3],
  },
  modeOptionActive: {
    borderColor: theme.colors.primary[500],
    backgroundColor: theme.colors.primary[50],
  },
  modeTextContainer: {
    flex: 1,
    marginRight: theme.spacing[2],
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginBottom: 2,
  },
  recommendedBadge: {
    backgroundColor: theme.colors.primary[100],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.full,
  },
  recommendedText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  modeRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeRadioActive: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
  },
  networkItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing[4],
  },
  networkInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing[3],
  },
  networkTextContainer: {
    flex: 1,
  },
  networkName: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: 2,
  },
  networkDesc: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.tertiary,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border.light,
    marginLeft: theme.spacing[4] + 44 + theme.spacing[3],
  },
  experimentalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: theme.spacing[2],
    backgroundColor: theme.colors.warning[50],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    marginBottom: theme.spacing[5],
  },
  experimentalText: {
    fontSize: theme.typography.fontSize.xs,
    fontWeight: '700',
    color: theme.colors.warning[700] || theme.colors.warning[600],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scanButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: theme.colors.primary[200],
    backgroundColor: theme.colors.primary[50],
    marginTop: theme.spacing[3],
  },
  scanButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  rlnErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
    marginTop: theme.spacing[4],
  },
  rlnErrorText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.error[600] || theme.colors.error[500],
    lineHeight: 20,
  },
  scannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'black',
    zIndex: 100,
  },
  scannerControls: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing[10],
  },
  scannerHint: {
    color: 'white',
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.full,
    overflow: 'hidden',
  },
  scannerClose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: theme.spacing[5],
    paddingVertical: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
  },
  scannerCloseText: {
    color: 'white',
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing[6],
  },
  loadingContainer: {
    width: 100,
    height: 100,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing[6],
  },
  loadingRing: {
    position: 'absolute',
    borderRadius: 50,
    borderWidth: 3,
    borderColor: theme.colors.primary[200],
  },
  loadingRing1: {
    width: 100,
    height: 100,
    borderTopColor: theme.colors.primary[500],
  },
  loadingRing2: {
    width: 80,
    height: 80,
    borderBottomColor: theme.colors.primary[400],
  },
  loadingIcon: {
    width: 60,
    height: 60,
    backgroundColor: theme.colors.primary[50],
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatingTitle: {
    fontSize: theme.typography.fontSize.xl,
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  creatingDesc: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
  },
  successIconContainer: {
    marginBottom: theme.spacing[6],
  },
  successGradient: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  successTitle: {
    fontSize: theme.typography.fontSize['2xl'],
    fontWeight: '700',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  successDesc: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.secondary,
    marginBottom: theme.spacing[8],
    textAlign: 'center',
  },
  securityPrompt: {
    width: '100%',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.borderRadius.xl,
    padding: theme.spacing[5],
  },
  securityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  securityTitle: {
    fontSize: theme.typography.fontSize.lg,
    fontWeight: '600',
    color: theme.colors.text.primary,
  },
  securityDesc: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    lineHeight: 20,
    marginBottom: theme.spacing[4],
  },
  securityButtons: {
    gap: theme.spacing[3],
  },
  securityButton: {
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: theme.spacing[3],
  },
  skipButtonText: {
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.tertiary,
    fontWeight: '500',
  },
  footer: {
    padding: theme.spacing[5],
    paddingBottom: Platform.OS === 'ios' ? theme.spacing[8] : theme.spacing[5],
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  nextButton: {
    shadowColor: theme.colors.primary[500],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.warning[50],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    marginBottom: theme.spacing[4],
    gap: theme.spacing[3],
  },
  warningText: {
    flex: 1,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.warning[700] || theme.colors.warning[600],
    lineHeight: 20,
  },
  mnemonicCard: {
    padding: theme.spacing[5],
    marginBottom: theme.spacing[4],
  },
  mnemonicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: theme.spacing[4],
  },
  mnemonicItem: {
    width: '50%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  mnemonicNumber: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.text.tertiary,
    width: 24,
  },
  mnemonicWord: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '500',
    color: theme.colors.text.primary,
    flex: 1,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    backgroundColor: theme.colors.primary[50],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.primary[200],
  },
  copyButtonText: {
    fontSize: theme.typography.fontSize.sm,
    fontWeight: '600',
    color: theme.colors.primary[600],
  },
  copyButtonTextSuccess: {
    color: theme.colors.success[600],
  },
  confirmCard: {
    padding: theme.spacing[4],
    marginBottom: theme.spacing[4],
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.spacing[3],
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.border.medium,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary[500],
    borderColor: theme.colors.primary[500],
  },
  checkboxText: {
    flex: 1,
    fontSize: theme.typography.fontSize.base,
    color: theme.colors.text.primary,
    lineHeight: 24,
  },
  reminderBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: theme.colors.info[50],
    padding: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    gap: theme.spacing[3],
  },
  reminderContent: {
    flex: 1,
  },
  reminderTitle: {
    fontSize: theme.typography.fontSize.base,
    fontWeight: '600',
    color: theme.colors.text.primary,
    marginBottom: theme.spacing[2],
  },
  reminderText: {
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.text.secondary,
    lineHeight: 20,
  },
});
