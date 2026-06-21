// App.tsx
import 'react-native-gesture-handler';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider, useSelector } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { View, Text, ActivityIndicator, Platform, TouchableOpacity, StyleSheet, SafeAreaView, DeviceEventEmitter } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { ThemeProvider } from '@react-navigation/native';
import { BrandLoading } from './components/brand/BrandLoading';
import { BrandIntro } from './components/brand/BrandIntro';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastContainer } from './components/Toast';
import ChatNotifications from './components/ChatNotifications';
import { OrbitFAB, type OrbitAction } from './components/OrbitFAB';
import { BrandMark } from './components/BrandMark';
import NetworkService from './services/NetworkService';
import { preloadFeedback } from './utils/feedback';

import { store, persistor } from './store';
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
import WalletListScreen from './screens/WalletListScreen';
import AddWalletScreen from './screens/AddWalletScreen';
import WalletSettingsScreen from './screens/WalletSettingsScreen';
import DashboardScreen from './screens/DashboardScreen';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import QRScannerScreen from './screens/QRScannerScreen';
import AssetsScreen from './screens/AssetsScreen';
import SettingsScreen from './screens/SettingsScreen';
import AIAssistantScreen from './screens/AIAssistantScreen';
import MapScreen from './screens/MapScreen';
import ContactsScreen from './screens/ContactsScreen';
import ChatScreen from './screens/ChatScreen';
import SwapScreen from './screens/SwapScreen';
import NostrSettingsScreen from './screens/NostrSettingsScreen';
import AssetDetailScreen from './screens/AssetDetailScreen';
import PaymentConfirmationScreen from './screens/PaymentConfirmationScreen';
import PaymentSuccessScreen, { PaymentSuccessParams } from './screens/PaymentSuccessScreen';
import SecuritySetupScreen from './screens/SecuritySetupScreen';
import NostrSetupScreen from './screens/NostrSetupScreen';
import HistoryScreen from './screens/HistoryScreen';
import LSPScreen from './screens/LSPScreen';
import PairDesktopScreen from './screens/PairDesktopScreen';
import MindSettingsScreen from './screens/MindSettingsScreen';
import NWCConnectScreen from './screens/NWCConnectScreen';

type RootStackParamList = {
  InitialLoad: undefined;
  WalletSetup: undefined;
  WalletRestore: undefined;
  WalletList: undefined;
  AddWallet: undefined;
  WalletSettings: { walletId: number };
  SecuritySetup: { walletId?: number; isInitialSetup?: boolean };
  NostrSetup: { isInitialSetup?: boolean } | undefined;
  Dashboard: undefined;
  Settings: undefined;
  Send: { selectedAsset?: any } | undefined;
  Receive: { selectedAsset?: any } | undefined;
  QRScanner: { mode?: 'payment' | 'contact'; returnScreen?: string } | undefined;
  PaymentConfirmation: { paymentData: any };
  PaymentSuccess: PaymentSuccessParams;
  AIAssistant: undefined;
  Assets: undefined;
  Swap: undefined;
  NostrSettings: undefined;
  AssetDetail: { asset: any };
  History: undefined;
  LSP: undefined;
  OpenChannel: undefined;
  IssueAsset: undefined;
  Channels: undefined;
  PairDesktop: undefined;
  MindSettings: undefined;
  NWCConnect: { scanned?: string } | undefined;
  Chat: { pubkey: string; name?: string; npub?: string; avatarUrl?: string };
};

type TabBarIconProps = {
  focused: boolean;
  color: string;
  size: number;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

/**
 * Floating "island" tab bar (extension parity): a rounded, detached bar with a
 * lighter rounded pill behind the selected item's icon. The pill uses the same
 * rounded language as the island so the selection reads as part of it.
 */
function IslandTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  // Split the tabs so a gap opens in the middle for the center FAB.
  const mid = Math.ceil(routes.length / 2);
  // The floating "island" (scroll-under, rounded pill) is reserved for the
  // wallet. Every other tab uses a fixed, in-flow bar that reserves layout
  // space so the scene's interactive content sits above it.
  const isWallet = routes[state.index]?.name === 'DashboardTab';

  // Quick actions on the center FAB, clustered toward the right thumb (see the
  // arc on OrbitFAB below). Order = arcStart → arcEnd, so Voice sits lowest/right
  // (easiest reach). Scan also has a double-tap shortcut and Voice a hold
  // shortcut (doubleTapKey / holdKey below).
  const orbitActions: OrbitAction[] = [
    {
      key: 'swap',
      label: 'Swap',
      color: theme.colors.brand.violet,
      renderIcon: () => <Ionicons name="swap-horizontal" size={24} color="#FFFFFF" />,
      onSelect: () => navigation.navigate('Swap'),
    },
    {
      key: 'scan',
      label: 'Scan',
      color: theme.colors.info[500],
      renderIcon: () => <Ionicons name="qr-code" size={24} color="#FFFFFF" />,
      onSelect: () => navigation.navigate('QRScanner'),
    },
    {
      key: 'voice',
      label: 'Voice',
      color: theme.colors.primary[500],
      renderIcon: () => <Ionicons name="mic" size={24} color={theme.colors.primary[950]} />,
      onSelect: () => {
        // The voice overlay lives on the Wallet/dashboard screen — focus it, then open.
        navigation.navigate(routes[0].name);
        DeviceEventEmitter.emit('rate.openVoice');
      },
    },
  ];

  const renderItem = (route: typeof routes[number], index: number) => {
    const { options } = descriptors[route.key];
    const rawLabel = options.tabBarLabel ?? options.title ?? route.name;
    const label = typeof rawLabel === 'string' ? rawLabel : route.name;
    const focused = state.index === index;
    const color = focused ? theme.colors.primary[500] : theme.colors.text.muted;
    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
    };
    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={focused ? { selected: true } : {}}
        onPress={onPress}
        activeOpacity={0.7}
        style={[islandStyles.item, focused && islandStyles.itemActive]}
      >
        {options.tabBarIcon?.({ focused, color, size: 22 })}
        <Text style={[islandStyles.label, { color }]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  const centerFab = (
    <OrbitFAB
      renderCenterIcon={() => <BrandMark size={44} />}
      actions={orbitActions}
      // Even fan across the top now that there are three actions.
      arcStart={150}
      arcEnd={30}
      // Shortcuts: double-tap → Scan, press-and-hold → Voice/mic.
      doubleTapKey="scan"
      holdKey="voice"
    />
  );

  // Non-wallet tabs (Contacts / Map / Mind): a fixed, in-flow bar. Because the
  // root is NOT absolute, the navigator reserves its height and pushes scene
  // content above it (no overlap). The FAB stays centered within the bar bounds
  // so it remains tappable on Android.
  if (!isWallet) {
    return (
      <View style={[fixedStyles.outer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <View style={fixedStyles.row}>
          {routes.slice(0, mid).map((r, i) => renderItem(r, i))}
          <View style={islandStyles.centerGap} />
          {routes.slice(mid).map((r, i) => renderItem(r, i + mid))}
        </View>
        <View pointerEvents="box-none" style={fixedStyles.micWrap}>
          {centerFab}
        </View>
      </View>
    );
  }

  return (
    // box-none: the bar floats over the scene (absolute), so let touches pass
    // through everywhere except the actual island/mic/tabs below.
    <View pointerEvents="box-none" style={[islandStyles.outer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {/* "Scroll-out" gradient: sits BEHIND the island, fading from transparent
          at the top to the page background at the bottom, so content appears to
          scroll out of the page behind the floating nav. Never blocks touches. */}
      <LinearGradient
        colors={[`${theme.colors.background.primary}00`, theme.colors.background.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        pointerEvents="none"
        style={islandStyles.scrollOutGradient}
      />
      <View style={islandStyles.island}>
        {routes.slice(0, mid).map((r, i) => renderItem(r, i))}
        <View style={islandStyles.centerGap} />
        {routes.slice(mid).map((r, i) => renderItem(r, i + mid))}
      </View>
      {/* Center FAB — overflows the island top. Press for the quick-actions orbit. */}
      <View pointerEvents="box-none" style={islandStyles.micWrap}>
        {centerFab}
      </View>
    </View>
  );
}

const islandStyles = StyleSheet.create({
  outer: {
    // Float the nav so scene content scrolls UNDERNEATH it. Transparent so the
    // content + scroll-out gradient show through (no solid background here).
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    // Extra room above the island so the FAB can sit a touch higher and overflow.
    paddingTop: 32,
  },
  // Fades from transparent (top) to the page background (bottom), beginning the
  // fade ABOVE the island so content reads as scrolling out behind the nav.
  scrollOutGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 160,
  },
  island: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 360,
    // Fully-rounded pill (extension `rounded-full`), translucent card (card/60),
    // shadow, no border.
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 6,
    backgroundColor: `${theme.colors.surface.primary}`,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 10,
  },
  item: {
    // Active item nearly fills the island interior so the fully-rounded pill
    // reads as concentric with the island's curve (extension `h-52` in a `py-2`).
    width: 60,
    height: 58,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  itemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
  },
  centerGap: {
    // Snug to the FAB (68px) so the two tabs on each side sit close to it,
    // symmetrically — no extra gap pushing the right pair away.
    width: 68,
  },
  label: {
    fontSize: 10,
    fontWeight: theme.typography.fontWeight.semibold,
    marginTop: 1,
  },
  micWrap: {
    position: 'absolute',
    // Raised: FAB top sits near the outer's top edge, giving more overflow above
    // the island so the center button reads as lifted and clearly centered.
    top: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    // Let the orbit petals + scrim render beyond the bar's bounds.
    overflow: 'visible',
  },
});

// Fixed (non-island) bar used on every tab except the wallet. In-flow (not
// absolute) so React Navigation reserves its height and the scene's content
// sits above it instead of scrolling underneath.
const fixedStyles = StyleSheet.create({
  outer: {
    backgroundColor: theme.colors.surface.primary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border.light,
    paddingTop: 4,
    paddingHorizontal: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    minHeight: 58,
  },
  micWrap: {
    position: 'absolute',
    // Sit the FAB level with the tab icons rather than floating above them: a
    // larger top offset drops its centre into the row so it no longer reads as
    // riding too high above the (solid) non-dashboard bar.
    top: 14,
    height: 58,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
});

function DashboardTabs() {
  const theme = useAppTheme();

  return (
    <Tab.Navigator
      tabBar={(props) => <IslandTabBar {...props} />}
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
        name="Map"
        component={MapScreen}
        options={{
          tabBarLabel: 'Map',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons
              name={focused ? 'map' : 'map-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Mind"
        component={AIAssistantScreen}
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
  const navigationTheme = createNavigationTheme();
  const theme = useAppTheme();

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="InitialLoad"
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
          contentStyle: { backgroundColor: theme.colors.background.primary },
        }}
      >
        <Stack.Screen name="InitialLoad" component={InitialLoadScreen} />
        <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
        <Stack.Screen name="WalletRestore" component={WalletRestoreScreen} />
        <Stack.Screen name="WalletList" component={WalletListScreen} />
        <Stack.Screen name="AddWallet" component={AddWalletScreen} />
        <Stack.Screen name="WalletSettings" component={WalletSettingsScreen} />
        <Stack.Screen name="SecuritySetup" component={SecuritySetupScreen} />
        <Stack.Screen name="NostrSetup" component={NostrSetupScreen} />
        <Stack.Screen name="Dashboard" component={DashboardTabs} />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen name="Send" component={SendScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="NostrSettings" component={NostrSettingsScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Receive" component={ReceiveScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="QRScanner"
          component={QRScannerScreen}
          options={{ presentation: 'modal' }}
        />
        <Stack.Screen
          name="PairDesktop"
          component={PairDesktopScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="MindSettings"
          component={MindSettingsScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="NWCConnect"
          component={NWCConnectScreen}
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ presentation: 'card', headerShown: false }} />
        <Stack.Screen name="PaymentConfirmation" component={PaymentConfirmationScreen} />
        <Stack.Screen
          name="PaymentSuccess"
          component={PaymentSuccessScreen}
          options={{ presentation: 'fullScreenModal', headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="AIAssistant" component={AIAssistantScreen} />
        <Stack.Screen name="Assets" component={AssetsScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen
          name="Swap"
          component={SwapScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="AssetDetail"
          component={AssetDetailScreen}
          options={{
            presentation: 'modal',
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="History"
          component={HistoryScreen}
          options={{
            presentation: 'card',
            headerShown: false,
          }}
        />
        <Stack.Screen name="LSP" component={LSPScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="OpenChannel" component={LSPScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="Channels" component={LSPScreen} options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="IssueAsset" component={AssetsScreen} options={{ presentation: 'modal', headerShown: false }} />
      </Stack.Navigator>
    </NavigationContainer>
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
    const svc = QVACService.getInstance();
    svc.setEnabled(aiMode !== 'off');
    // Desktop mode => delegate to the paired provider; Local/Off => on-device.
    void svc.setDelegateEnabled(aiMode === 'delegate');
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

    return () => {
      networkService.cleanup();
    };
  }, []);

  // Hold on the branded loader until Satoshi is registered (all hooks above run first).
  if (!fontsLoaded) {
    return <AppLoadingScreen />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <Provider store={store}>
          <PersistGate loading={<AppLoadingScreen />} persistor={persistor}>
            <QVACEnabledSync />
            <ChatNotifications />
            <AppThemeProvider>
              <KaleidoThemeProvider>
                <ThemeProvider value={navigationTheme}>
                  <StatusBar style="light" backgroundColor="transparent" translucent={true} />
                  <AppNavigator />
                  <ToastContainer />
                </ThemeProvider>
              </KaleidoThemeProvider>
            </AppThemeProvider>
          </PersistGate>
        </Provider>
        {!introDone && <BrandIntro onFinish={() => setIntroDone(true)} />}
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}


