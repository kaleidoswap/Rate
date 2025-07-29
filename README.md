# Rate - Smart RGB Lightning Wallet

A next-generation non-custodial mobile wallet that integrates RGB assets, Lightning Network, AI assistance, and social features into a unified Bitcoin experience.

## Overview

Rate is a React Native mobile application that provides a complete self-custodial wallet solution for Bitcoin and RGB assets. The wallet features an embedded RGB Lightning Node, AI-powered natural language interface, Nostr social integration, and local business discovery through BTC Map integration.

## Key Features

### 💰 **Wallet Core**
- **Non-custodial**: Users control their private keys
- **Multi-asset support**: Bitcoin and RGB assets (stablecoins, tokens, NFTs)
- **Lightning Network**: Fast, low-cost payments
- **On-chain transactions**: Full Bitcoin blockchain support
- **HD wallet**: BIP39 mnemonic seed phrase backup

### 🤖 **AI Assistant**
- **Natural language interface**: Control wallet with voice or text
- **Smart commands**: "Send 100,000 sats to Alice" or "Create invoice for $50"
- **MCP server integration**: Direct AI-to-wallet communication
- **Location services**: Find Bitcoin-accepting businesses with AI

### 🌐 **Social Features (Nostr)**
- **Contact management**: Sync contacts via Nostr protocol
- **Lightning Zaps**: Social micropayments
- **Lightning Address**: Send to username@domain.com
- **Wallet Connect**: Connect to external applications
- **Social payments**: Pay friends directly from contact list

### 🗺️ **Local Discovery**
- **BTC Map integration**: Find nearby Bitcoin merchants
- **Real-world utility**: Bridge digital assets to physical commerce
- **Merchant payments**: Direct payments to discovered businesses
- **Stablecoin support**: Spend RGB stablecoins locally

### ⚡ **Advanced Features**
- **Atomic swaps**: Exchange assets via Kaleidoswap integration
- **LSP integration**: Automated Lightning liquidity management
- **QR code support**: Scan Bitcoin addresses, Lightning invoices, RGB invoices
- **Biometric security**: Face ID, Touch ID, Fingerprint authentication

## Technology Stack

- **Frontend**: React Native with Expo
- **State Management**: Redux Toolkit
- **Database**: SQLite with SQLCipher encryption
- **Security**: Expo SecureStore, biometric authentication
- **AI**: OpenAI GPT integration with custom MCP server
- **Bitcoin/RGB**: Embedded RGB Lightning Node binary
- **Nostr**: NDK (Nostr Development Kit)
- **Maps**: BTC Map API integration

## Architecture

### Node Options
- **Local Mode**: RGB Lightning Node runs as embedded binary in the app
- **Cloud Mode**: Connect to remote Thunderstack nodes for demo/production

### Security
- Hardware security module integration
- Multi-layer encryption (SQLCipher + AES)
- Secure key derivation and storage
- Background app protection

## Quick Start

### Installation

```bash
git clone https://github.com/kaleidoswap/rate.git
cd Rate
npm install
npx expo start
```

### Development Setup

For detailed development setup including RGB node compilation and Bitcoin node configuration, see [TECHNICAL_SETUP.md](TECHNICAL_SETUP.md).

### Demo Mode

The app comes pre-configured to work with Thunderstack demo nodes - no additional setup required for testing.

## Usage

### First Time Setup

1. **Create Wallet**: Generate new wallet or restore from backup
2. **Secure Wallet**: Set password and enable biometric authentication
3. **Backup Phrase**: Securely store your 12-word recovery phrase
4. **Configure Node**: Choose local or cloud node connection

### Basic Operations

#### Send Bitcoin/RGB Assets
```
1. Tap "Send" on dashboard
2. Select asset type (Bitcoin/RGB)
3. Enter amount and recipient
4. Confirm transaction
```

#### AI Commands
```
Voice: "Send 50,000 sats to John"
Text: "Create an invoice for $25"
Location: "Find coffee shops that accept Bitcoin"
```

#### Social Payments
```
1. Go to Contacts (Nostr)
2. Select friend
3. Tap "Zap" for Lightning payment
4. Enter amount and send
```

### Asset Management

- **View Balances**: Dashboard shows all Bitcoin and RGB assets
- **Transaction History**: Complete history with transaction details
- **Asset Details**: Detailed information for each RGB asset
- **Atomic Swaps**: Exchange assets through integrated DEX

## API Integration

### AI Service
The wallet integrates with OpenAI GPT through a custom MCP (Model Context Protocol) server that provides secure access to wallet functions.

### Nostr Integration
Uses NDK for Nostr protocol integration, enabling social features and wallet connect functionality.

### BTC Map API
Integrates with BTC Map to discover local Bitcoin-accepting merchants and enable location-based payments.

## Security Considerations

### Key Management
- Private keys never leave the device
- Hardware security module integration
- Secure enclave storage on supported devices

### Data Protection
- SQLCipher database encryption
- AES encryption for sensitive data
- TLS/SSL for network communications

### Authentication
- Biometric authentication (Face ID, Touch ID, Fingerprint)
- PIN protection with attempt limiting
- Session management with automatic locks

## Development

### Project Structure
```
Rate/
├── screens/          # React Native screens
├── services/         # Business logic and API integrations
├── store/           # Redux state management
├── components/      # Reusable UI components
├── navigation/      # Navigation configuration
├── utils/          # Helper functions
├── types/          # TypeScript definitions
└── assets/         # Static assets and RGB node binary
```

### Building

#### Development
```bash
npx expo start --android  # Android
npx expo start --ios      # iOS
```

#### Production
```bash
eas build --platform android
eas build --platform ios
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- **Documentation**: See [TECHNICAL_SETUP.md](TECHNICAL_SETUP.md) for detailed setup
- **Issues**: Report bugs via GitHub Issues
- **Hackathon Info**: See [HACKATHON.md](HACKATHON.md) for presentation details

## Roadmap

- [x] Core wallet functionality
- [x] AI assistant integration
- [x] Nostr social features
- [x] BTC Map integration
- [ ] Enhanced AI capabilities
- [ ] Plugin architecture
- [ ] Multi-language support
- [ ] Hardware wallet integration

---

*Rate: Making Bitcoin and RGB assets accessible through conversational AI and social integration.*