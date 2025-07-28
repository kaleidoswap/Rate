// App.tsx
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator, Platform } from 'react-native';

import { store, persistor } from './store';
import { theme } from './theme';
import InitialLoadScreen from './screens/InitialLoadScreen';
import WalletSetupScreen from './screens/WalletSetupScreen';
import DashboardScreen from './screens/DashboardScreen';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import QRScannerScreen from './screens/QRScannerScreen';
import AssetsScreen from './screens/AssetsScreen';
import SettingsScreen from './screens/SettingsScreen';
import AIAssistantScreen from './screens/AIAssistantScreen';
import MapScreen from './screens/MapScreen';

type TabBarIconProps = {
  focused: boolean;
  color: string;
  size: number;
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function DashboardTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary[500],
        tabBarInactiveTintColor: theme.colors.gray[400],
        tabBarStyle: {
          backgroundColor: theme.colors.surface.primary,
          borderTopColor: theme.colors.border.light,
          borderTopWidth: 1,
          paddingTop: Platform.OS === 'ios' ? 8 : 4,
          paddingBottom: Platform.OS === 'ios' ? 25 : 8,
          height: Platform.OS === 'ios' ? 85 : 65,
          elevation: 0,
          shadowColor: theme.colors.gray[900],
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.1,
          shadowRadius: 8,
        },
        tabBarLabelStyle: {
          fontSize: theme.typography.fontSize.xs,
          fontWeight: '500',
          marginTop: 4,
        },
        tabBarIconStyle: {
          marginTop: 4,
        },
        headerShown: false,
      }}
    >
      <Tab.Screen 
        name="DashboardTab"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons 
              name={focused ? 'home' : 'home-outline'} 
              size={focused ? size + 2 : size} 
              color={color} 
            />
          ),
        }}
      />
      <Tab.Screen 
        name="Assets" 
        component={AssetsScreen}
        options={{
          tabBarLabel: 'Assets',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons 
              name={focused ? 'diamond' : 'diamond-outline'} 
              size={focused ? size + 2 : size} 
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
              size={focused ? size + 2 : size} 
              color={color} 
            />
          ),
        }}
      />
      <Tab.Screen 
        name="Settings" 
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ focused, color, size }: TabBarIconProps) => (
            <Ionicons 
              name={focused ? 'settings' : 'settings-outline'} 
              size={focused ? size + 2 : size} 
              color={color} 
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  const navigationTheme = {
    dark: false,
    colors: {
      primary: theme.colors.primary[500],
      background: theme.colors.background.primary,
      card: theme.colors.surface.primary,
      text: theme.colors.text.primary,
      border: theme.colors.border.light,
      notification: theme.colors.primary[500],
    },
  };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        initialRouteName="InitialLoad"
        screenOptions={{
          headerShown: false,
          gestureEnabled: false,
        }}
      >
        <Stack.Screen name="InitialLoad" component={InitialLoadScreen} />
        <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
        <Stack.Screen name="Dashboard" component={DashboardTabs} />
        <Stack.Screen 
          name="Send" 
          component={SendScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Send Payment',
            headerStyle: {
              backgroundColor: theme.colors.surface.primary,
            },
            headerTitleStyle: {
              color: theme.colors.text.primary,
              fontWeight: '600',
            },
            headerTintColor: theme.colors.primary[500],
          }}
        />
        <Stack.Screen 
          name="Receive" 
          component={ReceiveScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Receive Payment',
            headerStyle: {
              backgroundColor: theme.colors.surface.primary,
            },
            headerTitleStyle: {
              color: theme.colors.text.primary,
              fontWeight: '600',
            },
            headerTintColor: theme.colors.primary[500],
          }}
        />
        <Stack.Screen 
          name="QRScanner" 
          component={QRScannerScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Scan QR Code',
            headerStyle: {
              backgroundColor: theme.colors.surface.primary,
            },
            headerTitleStyle: {
              color: theme.colors.text.primary,
              fontWeight: '600',
            },
            headerTintColor: theme.colors.primary[500],
          }}
        />
        <Stack.Screen 
          name="AIAssistant" 
          component={AIAssistantScreen}
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'AI Assistant',
            headerStyle: {
              backgroundColor: theme.colors.surface.primary,
            },
            headerTitleStyle: {
              color: theme.colors.text.primary,
              fontWeight: '600',
            },
            headerTintColor: theme.colors.primary[500],
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function LoadingScreen() {
  return (
    <View style={{ 
      flex: 1, 
      justifyContent: 'center', 
      alignItems: 'center',
      backgroundColor: theme.colors.background.secondary,
    }}>
      <ActivityIndicator size="large" color={theme.colors.primary[500]} />
    </View>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <PersistGate loading={<LoadingScreen />} persistor={persistor}>
        <StatusBar style="dark" backgroundColor={theme.colors.background.primary} />
        <AppNavigator />
      </PersistGate>
    </Provider>
  );
}

