// App.tsx
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { View, Text, ActivityIndicator, Platform, SafeAreaView, Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { WalletTabBar } from './components/WalletTabBar';
import { ThemeProvider } from '@react-navigation/native';
import { BrandLoading } from './components/brand/BrandLoading';
import { BrandIntro } from './components/brand/BrandIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import { PersistenceLoading } from './components/PersistenceLoading';
import { AppLockGate } from './components/AppLockGate';
import { KaleidoPayRecovery } from './components/KaleidoPayRecovery';
import { NwcPaymentApprover } from './components/NwcPaymentApprover';
import ChatNotifications from './components/ChatNotifications';
import PaymentNotifications from './components/PaymentNotifications';
import NetworkService from './services/NetworkService';
import { preloadFeedback } from './utils/feedback';

import { store, persistor } from './store';
import { closeAgentWallet, watchAgentWalletLifecycle } from './services/agentWallet/lifecycle';
import { selectAiMode } from './store/slices/settingsSlice';
import QVACService from './services/QVACService';
import { theme, createNavigationTheme } from './theme';
import { AppThemeProvider, useAppTheme } from './theme/ThemeProvider';
import { KaleidoThemeProvider } from '@kaleidorg/kaleido-ui/native';
import { useFonts } from 'expo-font';
import { kaleidoFonts } from '@kaleidorg/kaleido-ui/native/fonts';
// Side effect: apply Satoshi to every <Text>/<TextInput> app-wide.
import './theme/satoshiText';
import InitialLoadScreen from './screens/InitialLoadScreen';
import WalletSetupScreen from './screens/WalletSetupScreen';
import WalletRestoreScreen from './screens/WalletRestoreScreen';
import DashboardScreen from './screens/DashboardScreen';
import { asModalScreen } from './components/ModalPresentation';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import BridgeScreen from './screens/BridgeScreen';
import MerchantOfferScreen from './screens/MerchantOfferScreen';
import {useAppSelector} from './store/hooks';
import {isReceiverLink,canOpenReceiver} from './utils/receiver-link';
import DesignSystemScreen from './screens/DesignSystemScreen';
import QRScannerScreen from './screens/QRScannerScreen';
import AssetsScreen from './screens/AssetsScreen';
import SettingsScreen from './screens/SettingsScreen';
import AIAssistantScreen from './screens/AIAssistantScreen';
import MapScreen from './screens/MapScreen';
import ContactsScreen from './screens/ContactsScreen';
import ChatScreen from './screens/ChatScreen';
import SwapScreen from './screens/SwapScreen';
import NostrSettingsScreen from './screens/NostrSettingsScreen';
import ProfileEditScreen from './screens/ProfileEditScreen';
import ProfileScreen from './screens/ProfileScreen';
import AssetDetailScreen from './screens/AssetDetailScreen';
import SecuritySetupScreen from './screens/SecuritySetupScreen';
import HistoryScreen from './screens/HistoryScreen';
import LSPScreen from './screens/LSPScreen';
import LightningAddressScreen from './screens/LightningAddressScreen';
import MindSettingsScreen from './screens/MindSettingsScreen';
import AgentWalletScreen from './screens/AgentWalletScreen';
import NWCConnectScreen from './screens/NWCConnectScreen';
import RgbNodeScreen from './screens/RgbNodeScreen';

type RootStackParamList = {
  InitialLoad: undefined;
  WalletSetup: undefined;
  WalletRestore: undefined;
  SecuritySetup: { walletId?: number; isInitialSetup?: boolean; mode?: 'setup' | 'pin' | 'disablePin' };
  Dashboard: undefined;
  Settings: undefined;
  Send: { selectedAsset?: any; preferredAccount?: 'BARK'; prefilledAddress?: string; resumePayment?: boolean } | undefined;
  MerchantOffer: undefined;
  Receive: { selectedAsset?: any } | undefined;
  Bridge: undefined;
  QRScanner: { mode?: 'payment' | 'contact'; returnScreen?: string } | undefined;
  Assets: { issue?: boolean } | undefined;
  DesignSystem: undefined;
  Swap: undefined;
  NostrSettings: undefined;
  Profile: undefined;
  ProfileEdit: undefined;
  AssetDetail: { asset: any };
  Map: undefined;
  LSP: undefined;
  MindSettings: undefined;
  AgentWallet: undefined;
  LightningAddress: undefined;
  NWCConnect: { scanned?: string } | undefined;
  RgbNode: undefined;
  Chat: { pubkey: string; name?: string; npub?: string; avatarUrl?: string };
};

type TabBarIconProps = {
  focused: boolean;
  color: string;
  size: number;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Flows (send, receive, scan…) cover the whole screen and slide up, closed with
 * an X or a swipe down. Not iOS's native sheet: its card draws a light rim
 * along the rounded edges, and stacking sheets shrinks the ones below.
 */
const FLOW_OPTIONS = { animation: 'slide_from_bottom', gestureDirection: 'vertical' } as const;
const Tab = createBottomTabNavigator();

function DashboardTabs() {
  const theme = useAppTheme();

  return (
    <Tab.Navigator
      tabBar={(props) => <WalletTabBar {...props} />}
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary[600],
        tabBarInactiveTintColor: theme.colors.gray[400],
        tabBarStyle: {
          backgroundColor: theme.colors.surface.primary,
          borderTopWidth: 0,
          elevation: 0,
          height: Platform.OS === 'ios' ? 88 : 68,
          paddingTop: Platform.OS === 'ios' ? 8 : 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 12,
          shadowColor: theme.shadows.lg.shadowColor,
          shadowOffset: theme.shadows.lg.shadowOffset,
          shadowOpacity: theme.shadows.lg.shadowOpacity,
          shadowRadius: theme.shadows.lg.shadowRadius,
        },
        tabBarLabelStyle: {
          fontSize: theme.typography.fontSize.xs,
          fontWeight: '600',
          marginTop: 4,
        },
        tabBarIconStyle: {
          marginTop: 0,
        },
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="DashboardTab"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Wallet',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'wallet' : 'wallet-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Activity"
        component={HistoryScreen}
        options={{
          tabBarLabel: 'Activity',
          tabBarIcon: ({ focused, color }: TabBarIconProps) => (
            <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          tabBarLabel: 'Contacts',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'people' : 'people-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Mind"
        component={MindTabScreen}
        options={{
          tabBarLabel: 'Mind',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <MaterialCommunityIcons name="brain" size={24} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const receiverNavigation = React.useRef(createNavigationContainerRef<RootStackParamList>()).current;
  const pendingReceiverLink = React.useRef(false);
  const initialized = useAppSelector(s => s.wallet.isInitialized);
  const unlocked = useAppSelector(s => s.wallet.isUnlocked);
  const openPendingReceiver = React.useCallback(() => {
    const route = receiverNavigation.getCurrentRoute()?.name;
    if (!pendingReceiverLink.current || !receiverNavigation.isReady() || !canOpenReceiver(initialized, unlocked, route)) return;
    pendingReceiverLink.current = false;
    if (route !== 'MerchantOffer') receiverNavigation.navigate('MerchantOffer');
  }, [initialized, unlocked, receiverNavigation]);
  React.useEffect(() => {
    let active = true;
    const accept = (url: string | null) => { if (active && url && isReceiverLink(url)) { pendingReceiverLink.current = true; openPendingReceiver(); } };
    const subscription = Linking.addEventListener('url', event => accept(event.url));
    void Linking.getInitialURL().then(accept).catch(() => {});
    openPendingReceiver();
    return () => { active = false; subscription.remove(); };
  }, [openPendingReceiver]);
  const navigationTheme = createNavigationTheme();
  const theme = useAppTheme();

  return (
    <NavigationContainer ref={receiverNavigation} onReady={openPendingReceiver} onStateChange={openPendingReceiver} theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="InitialLoad"
        screenOptions={{
          headerShown: false,
          // One push transition on both platforms, and swipe back from anywhere on iOS.
          animation: 'slide_from_right',
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          contentStyle: { backgroundColor: theme.colors.background.primary },
        }}
      >
        {/* Root screens replace each other: they fade, and there is nothing to swipe back to. */}
        <Stack.Screen name="InitialLoad" component={InitialLoadScreen} options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="WalletSetup" component={WalletSetupScreen} options={{ animation: 'fade', gestureEnabled: false }} />
        <Stack.Screen name="WalletRestore" component={WalletRestoreScreen} />
        <Stack.Screen name="SecuritySetup" component={SecuritySetupScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="Dashboard" component={DashboardTabs} options={{ animation: 'fade', gestureEnabled: false }} />
        {/* Settings and its pages: full screen, slide in sideways, back arrow. */}
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
        <Stack.Screen name="NostrSettings" component={NostrSettingsScreen} />
        <Stack.Screen name="MindSettings" component={MindSettingsScreen} />
        <Stack.Screen name="AgentWallet" component={AgentWalletScreen} />
        <Stack.Screen name="NWCConnect" component={NWCConnectScreen} />
        <Stack.Screen name="RgbNode" component={RgbNodeScreen} />
        <Stack.Screen name="LightningAddress" component={LightningAddressScreen} />
        <Stack.Screen name="LSP" component={LSPScreen} />
        {__DEV__ && <Stack.Screen name="DesignSystem" component={DesignSystemScreen} />}
        {/* Short flows: full screen, slide up from the bottom, close button. */}
        <Stack.Screen name="Send" component={asModalScreen(SendScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="ProfileEdit" component={asModalScreen(ProfileEditScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="MerchantOffer" component={asModalScreen(MerchantOfferScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="Receive" component={asModalScreen(ReceiveScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="Bridge" component={asModalScreen(BridgeScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="QRScanner" component={asModalScreen(QRScannerScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="Assets" component={asModalScreen(AssetsScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="Swap" component={asModalScreen(SwapScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="AssetDetail" component={asModalScreen(AssetDetailScreen)} options={FLOW_OPTIONS} />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="Map" component={MapScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** A render error in KaleidoMind stays inside its tab instead of replacing the whole app. */
function MindTabScreen(props: React.ComponentProps<typeof AIAssistantScreen>) {
  return (
    <ErrorBoundary>
      <AIAssistantScreen {...props} />
    </ErrorBoundary>
  );
}

/**
 * Mirrors the persisted KaleidoMind mode (settings.aiMode) into the QVACService master
 * kill switch, so the on-device AI worklet can never start unless the user has
 * explicitly opted in. Rendered inside the Redux Provider + PersistGate.
 */
function QVACEnabledSync() {
  const aiMode = useSelector(selectAiMode);
  React.useEffect(() => {
    QVACService.getInstance().setEnabled(aiMode !== 'off');
  }, [aiMode]);
  return null;
}

function AppLoadingScreen() {
  // Same branded loader the BrandIntro fades into — keeps startup seamless.
  return <BrandLoading />;
}

export default function App() {
  const navigationTheme = createNavigationTheme();
  const [introDone, setIntroDone] = React.useState(false);
  // Load the Satoshi brand typeface (shipped by kaleido-ui) before first paint
  // so the app-wide Text patch resolves real faces rather than the system fallback.
  const [fontsLoaded] = useFonts(kaleidoFonts);

  React.useEffect(() => {
    // Initialize network monitoring
    const networkService = NetworkService.getInstance();
    networkService.initialize().catch(error => {
      console.error('Failed to initialize network monitoring:', error);
    });

    // Warm the UI sound cache so the first tap/chime plays without synthesis lag.
    preloadFeedback();

    const stopAgentLifecycle = watchAgentWalletLifecycle(store, closeAgentWallet);

    return () => {
      networkService.cleanup();
      stopAgentLifecycle();
    };
  }, []);

  // Hold on the branded loader until Satoshi is registered (all hooks above run first).
  if (!fontsLoaded) {
    return <AppLoadingScreen />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <Provider store={store}>
            <PersistGate loading={<PersistenceLoading />} persistor={persistor}>
              <QVACEnabledSync />
              <KaleidoPayRecovery />
              <ChatNotifications />
              <PaymentNotifications />
              <AppThemeProvider>
                <KaleidoThemeProvider>
                  <ThemeProvider value={navigationTheme}>
                    <StatusBar style="light" backgroundColor="transparent" translucent={true} />
                    <AppNavigator />
                    <ToastContainer />
                    <NwcPaymentApprover />
                    <AppLockGate />
                  </ThemeProvider>
                </KaleidoThemeProvider>
              </AppThemeProvider>
            </PersistGate>
          </Provider>
          {!introDone && <BrandIntro onFinish={() => setIntroDone(true)} />}
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

