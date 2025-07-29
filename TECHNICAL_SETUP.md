# Rate - Technical Setup Guide

## Prerequisites

Before setting up the Rate app, you need to have the RGB Lightning Node binary available. The app expects the binary to be bundled with the mobile application.

### 1. Build RGB Lightning Node

First, clone and build the RGB Lightning Node:

```bash
# Clone the RGB Lightning Node repository
git clone https://github.com/RGB-Tools/rgb-lightning-node.git
cd rgb-lightning-node

# Build for mobile targets
# For Android
rustup target add aarch64-linux-android armv7-linux-androideabi
cargo ndk --target aarch64-linux-android --platform 21 -- build --release

# For iOS
rustup target add aarch64-apple-ios x86_64-apple-ios
cargo build --target aarch64-apple-ios --release
```

### 2. Copy Binary to React Native Project

Copy the built binary to your React Native project:

```bash
# Create assets directory in your Rate project
mkdir -p Rate/assets

# Copy the binary (adjust path based on your build)
cp target/aarch64-linux-android/release/rgb-lightning-node Rate/assets/
# or for iOS
cp target/aarch64-apple-ios/release/rgb-lightning-node Rate/assets/
```

## App Installation

### 1. Create the Expo Project

```bash
# Create new Expo app with TypeScript template
npx create-expo-app Rate --template blank-typescript
cd Rate
```

### 2. Install Dependencies

```bash
# Install navigation dependencies
npm install @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
npx expo install react-native-screens react-native-safe-area-context

# Install state management
npm install @reduxjs/toolkit react-redux redux-persist
npm install @react-native-async-storage/async-storage

# Install crypto and security
npm install crypto-js
npm install @types/crypto-js

# Install UI and utilities
npm install @expo/vector-icons
npm install react-native-qrcode-svg react-native-svg
npm install @react-native-picker/picker
npm install axios

# Install Expo modules
npx expo install expo-sqlite expo-secure-store expo-camera expo-local-authentication expo-clipboard

# Install Nostr and AI dependencies
npm install @nostr-dev-kit/ndk nostr-tools
npm install openai
npm install @react-native-voice/voice
```

### 3. Configure App Permissions

Update your `app.json` with the provided configuration that includes camera permissions, biometric authentication, and SQLite encryption.

### 4. Project Structure

Create the following directory structure:

```
Rate/
├── services/
│   ├── RGBNodeService.ts
│   ├── RGBApiService.ts
│   ├── DatabaseService.ts
│   ├── NostrService.ts
│   └── AIService.ts
├── store/
│   ├── index.ts
│   └── slices/
│       ├── walletSlice.ts
│       ├── nodeSlice.ts
│       ├── nostrSlice.ts
│       └── settingsSlice.ts
├── screens/
│   ├── WalletSetupScreen.tsx
│   ├── DashboardScreen.tsx
│   ├── SendScreen.tsx
│   ├── ReceiveScreen.tsx
│   ├── QRScannerScreen.tsx
│   ├── AssetsScreen.tsx
│   ├── AIAssistantScreen.tsx
│   ├── MapScreen.tsx
│   ├── NostrContactsScreen.tsx
│   └── SettingsScreen.tsx
├── types/
├── utils/
├── components/
├── navigation/
├── theme/
├── assets/
│   └── rgb-lightning-node (binary)
├── App.tsx
├── app.json
└── package.json
```

## Bitcoin Node Setup

### 1. Local Bitcoin Node (Regtest)

For development, set up a local Bitcoin node in regtest mode:

```bash
# Install Bitcoin Core
# On macOS: brew install bitcoin
# On Ubuntu: sudo apt-get install bitcoin

# Create bitcoin.conf
mkdir -p ~/.bitcoin
cat > ~/.bitcoin/bitcoin.conf << EOF
regtest=1
server=1
rpcuser=user
rpcpassword=password
rpcport=18443
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
EOF

# Start Bitcoin daemon
bitcoind -daemon

# Generate initial blocks
bitcoin-cli -regtest generatetoaddress 101 $(bitcoin-cli -regtest getnewaddress)
```

### 2. Electrum Server (Optional)

For better performance, you can run an Electrum server:

```bash
# Using electrs
git clone https://github.com/romanz/electrs.git
cd electrs
cargo build --release

# Run electrs
./target/release/electrs --network regtest --daemon-dir ~/.bitcoin
```

## RGB Node Configuration

The app will automatically configure the RGB Lightning Node with these default settings:

- **API Port**: 3001 (REST API)
- **Lightning Port**: 9735 (P2P communications)
- **Network**: Regtest (for development)
- **Data Directory**: App's documents directory

### Default Configuration

```json
{
  "bitcoind_rpc_host": "localhost",
  "bitcoind_rpc_port": 18443,
  "bitcoind_rpc_username": "user",
  "bitcoind_rpc_password": "password",
  "indexer_url": "127.0.0.1:50001",
  "proxy_endpoint": "rpc://127.0.0.1:3000/json-rpc"
}
```

## Running the App

### 1. Development Mode

```bash
# Start the development server
npx expo start

# Run on specific platform
npx expo start --android  # Android
npx expo start --ios      # iOS
```

### 2. Building for Production

```bash
# Install EAS CLI
npm install -g @expo/eas-cli

# Configure EAS
eas build:configure

# Build for Android
eas build --platform android

# Build for iOS
eas build --platform ios
```

## First Time Setup

When you first run the app:

1. **Initialize Wallet**: The app will prompt you to create a new wallet or restore from backup
2. **Set Password**: Choose a strong password for wallet encryption
3. **Save Mnemonic**: Write down the 12-word recovery phrase
4. **Configure Node**: Set up Bitcoin node connection details
5. **Unlock Wallet**: Use your password or biometric authentication

## Core Features Implementation

### Wallet Management
- **Wallet Creation**: HD wallet with BIP39 mnemonic
- **Key Management**: Secure key storage using Expo SecureStore
- **Backup/Restore**: Encrypted backup with cloud sync options

### RGB Assets
- **Asset Issuance**: Create new RGB assets (NIA, UDA, CFA)
- **Asset Transfers**: Send and receive RGB assets
- **Asset Management**: View balances and transaction history

### Lightning Network
- **Channel Management**: Open, close, and manage Lightning channels
- **Payment Processing**: Send and receive Lightning payments
- **Invoice Generation**: Create and manage Lightning invoices

### AI Integration
- **OpenAI Integration**: Natural language processing for wallet operations
- **Voice Commands**: Speech-to-text for hands-free operation
- **MCP Server**: Custom server for AI-wallet communication

### Nostr Integration
- **Contact Management**: Sync contacts via Nostr
- **Social Payments**: Send zaps and payments to Nostr contacts
- **Wallet Connect**: Connect to external apps via Nostr Wallet Connect

### BTC Map Integration
- **Merchant Discovery**: Find Bitcoin-accepting businesses
- **Location Services**: GPS-based merchant search
- **Payment Integration**: Direct payment to discovered merchants

## Security Features

### Encryption
- **SQLCipher**: Encrypted local database
- **AES Encryption**: Additional layer for sensitive data
- **Key Derivation**: PBKDF2 for password-based keys

### Authentication
- **Biometric Auth**: Face ID, Touch ID, Fingerprint
- **PIN Protection**: Numeric PIN for quick access
- **Session Management**: Automatic lockout and re-authentication

### Network Security
- **TLS/SSL**: All network communications encrypted
- **Certificate Pinning**: Prevent man-in-the-middle attacks
- **Request Signing**: Cryptographic signatures for API calls

## Troubleshooting

### Common Issues

1. **Node Binary Not Found**: Ensure the RGB Lightning Node binary is in the `assets` folder
2. **Permission Denied**: Make sure the binary has execute permissions
3. **Network Connection**: Check Bitcoin node connectivity
4. **Database Issues**: Clear app data if SQLite corruption occurs

### Debug Mode

Enable debug logging by setting:

```typescript
// In your service files
const DEBUG = __DEV__;
if (DEBUG) {
  console.log('Debug info:', data);
}
```

### Reset Wallet

To completely reset the wallet:

1. Go to Settings > Reset Wallet
2. Confirm the action
3. All local data will be deleted
4. RGB node process will be stopped

## Production Considerations

### Security
- Use production Bitcoin network (mainnet/testnet)
- Implement proper error handling
- Add crash reporting (Sentry, Bugsnag)
- Enable SSL/TLS for all network communications

### Performance
- Optimize RGB node startup time
- Implement proper caching strategies
- Use lazy loading for screens
- Monitor memory usage

### Distribution
- Configure app store metadata
- Add proper icons and splash screens
- Test on various device sizes
- Implement update mechanisms

## API Documentation

### RGB Node API

The RGB Lightning Node exposes a REST API on port 3001:

```bash
# Get node info
GET /info

# Get wallet balance
GET /wallet/balance

# Send Bitcoin
POST /wallet/send
{
  "address": "string",
  "amount": number
}

# Generate invoice
POST /invoice
{
  "amount": number,
  "description": "string"
}
```

### Service Integration

#### AI Service
```typescript
interface AIService {
  processCommand(text: string): Promise<WalletAction>;
  generateResponse(action: WalletAction): Promise<string>;
  getLocationSuggestions(query: string): Promise<Merchant[]>;
}
```

#### Nostr Service
```typescript
interface NostrService {
  connect(): Promise<void>;
  getContacts(): Promise<Contact[]>;
  sendZap(contact: Contact, amount: number): Promise<string>;
  generateWalletConnect(): Promise<string>;
}
```

This technical setup provides comprehensive guidance for developers working on the Rate wallet codebase. 