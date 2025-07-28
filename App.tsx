// App.tsx
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Ionicons } from '@expo/vector-icons';
import { View, ActivityIndicator } from 'react-native';

import { store, persistor } from './store';
import InitialLoadScreen from './screens/InitialLoadScreen';
import WalletSetupScreen from './screens/WalletSetupScreen';
import DashboardScreen from './screens/DashboardScreen';
import SendScreen from './screens/SendScreen';
import ReceiveScreen from './screens/ReceiveScreen';
import QRScannerScreen from './screens/QRScannerScreen';
import AssetsScreen from './screens/AssetsScreen';
import SettingsScreen from './screens/SettingsScreen';

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
        tabBarActiveTintColor: '#007AFF',
        tabBarInactiveTintColor: 'gray',
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
              size={size} 
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
              size={size} 
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
              size={size} 
              color={color} 
            />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

function AppNavigator() {
  return (
    <NavigationContainer>
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
          }}
        />
        <Stack.Screen 
          name="Receive" 
          component={ReceiveScreen}
          options={{
            presentation: 'modal',
          }}
        />
        <Stack.Screen 
          name="QRScanner" 
          component={QRScannerScreen}
          options={{
            presentation: 'modal',
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

export default function App() {
  return (
    <Provider store={store}>
      <PersistGate loading={<LoadingScreen />} persistor={persistor}>
        <StatusBar style="auto" />
        <AppNavigator />
      </PersistGate>
    </Provider>
  );
}

