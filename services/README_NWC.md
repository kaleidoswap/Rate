# Nostr Wallet Connect for RGB Lightning Node

This implementation provides a complete Nostr Wallet Connect (NWC) interface for the RGB Lightning Node, following the NIP-47 specification.

## Overview

The NWC implementation allows external Nostr clients to interact with the RGB Lightning Node through encrypted direct messages over Nostr relays. This enables:

- **Remote wallet control**: Control your RGB Lightning Node from any NWC-compatible client
- **Secure communication**: All messages are encrypted using NIP-04
- **Permission-based access**: Fine-grained control over what operations clients can perform
- **RGB asset support**: Extended functionality for RGB asset transactions

## Architecture

The implementation consists of three main components:

1. **NWCService**: Core NIP-47 protocol implementation
2. **NostrService**: Integration with existing Nostr functionality
3. **RGB API Integration**: Mapping NWC methods to RGB Lightning Node endpoints

## Supported NWC Methods

### Standard Lightning Methods
- `pay_invoice` - Pay Lightning invoices
- `make_invoice` - Create Lightning invoices
- `lookup_invoice` - Look up invoice status
- `list_transactions` - List payment history
- `get_balance` - Get Bitcoin balance
- `get_info` - Get node information
- `pay_keysend` - Send spontaneous payments (planned)

### RGB-Specific Extensions (Planned)
- `pay_rgb_invoice` - Pay invoices for RGB assets
- `make_rgb_invoice` - Create invoices for RGB assets
- `get_rgb_balance` - Get RGB asset balances
- `list_rgb_assets` - List available RGB assets

## Usage

### 1. Initialize the Service

```typescript
import { initializeNostrWalletConnect } from './services/initializeServices';

// Initialize NWC service
const success = await initializeNostrWalletConnect();
if (success) {
  console.log('NWC service is running');
}
```

### 2. Generate Connection String

```typescript
import NostrService from './services/NostrService';

const nostrService = NostrService.getInstance();

// Generate connection string with specific permissions
const connectionString = await nostrService.getWalletConnectInfo(
  ['pay_invoice', 'make_invoice', 'get_balance', 'get_info'],
  'user@domain.com' // Optional Lightning Address
);

console.log('Share this connection string with your client:');
console.log(connectionString);
```

### 3. Client Usage (React Native/JavaScript)

```javascript
// Example client implementation
import NDK from '@nostr-dev-kit/ndk';
import { nip04 } from 'nostr-tools';

class NWCClient {
  constructor(connectionString) {
    const parsed = this.parseConnectionString(connectionString);
    this.walletPubkey = parsed.pubkey;
    this.clientSecret = parsed.secret;
    this.relays = parsed.relay;
    
    this.ndk = new NDK({
      explicitRelayUrls: this.relays,
    });
  }

  async connect() {
    await this.ndk.connect();
  }

  async payInvoice(invoice) {
    const request = {
      method: 'pay_invoice',
      params: { invoice }
    };
    
    return await this.sendRequest(request);
  }

  async makeInvoice(amount, description) {
    const request = {
      method: 'make_invoice',
      params: { 
        amount: amount * 1000, // Convert to msat
        description 
      }
    };
    
    return await this.sendRequest(request);
  }

  async getBalance() {
    const request = {
      method: 'get_balance',
      params: {}
    };
    
    return await this.sendRequest(request);
  }

  async sendRequest(request) {
    const event = new NDKEvent(this.ndk);
    event.kind = 23194; // NWC_REQUEST
    event.content = await nip04.encrypt(
      this.clientSecret, 
      this.walletPubkey, 
      JSON.stringify(request)
    );
    event.tags = [['p', this.walletPubkey]];
    
    await event.publish();
    
    // Listen for response
    return new Promise((resolve, reject) => {
      const subscription = this.ndk.subscribe({
        kinds: [23195], // NWC_RESPONSE
        '#p': [getPublicKey(this.clientSecret)],
        '#e': [event.id],
      });
      
      subscription.on('event', async (responseEvent) => {
        const decrypted = await nip04.decrypt(
          this.clientSecret,
          this.walletPubkey,
          responseEvent.content
        );
        
        const response = JSON.parse(decrypted);
        subscription.stop();
        
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        subscription.stop();
        reject(new Error('Request timeout'));
      }, 30000);
    });
  }

  parseConnectionString(connectionString) {
    const url = new URL(connectionString);
    return {
      pubkey: url.hostname,
      secret: url.searchParams.get('secret'),
      relay: url.searchParams.getAll('relay'),
      lud16: url.searchParams.get('lud16'),
    };
  }
}

// Usage example
const client = new NWCClient('nostr+walletconnect://...');
await client.connect();

const balance = await client.getBalance();
console.log('Balance:', balance.balance, 'sats');

const invoice = await client.makeInvoice(1000, 'Test payment');
console.log('Invoice:', invoice.invoice);
```

## Configuration

### Environment Variables

```bash
# Nostr relays for NWC communication
NOSTR_RELAYS=wss://relay.damus.io,wss://relay.snort.social,wss://nos.lol

# RGB Lightning Node API endpoint
RGB_NODE_URL=http://localhost:3001

# Optional Lightning Address for the wallet
LUD16=wallet@domain.com
```

### Service Configuration

```typescript
// In your app initialization
const settings = {
  nostrRelays: [
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://nos.lol',
  ],
  remoteNodeUrl: 'http://localhost:3001',
  lud16: 'wallet@domain.com',
};

// Initialize services
await initializeRGBApiService();
await initializeNostrWalletConnect();
```

## Security Considerations

1. **Key Management**: Each client connection uses a unique secret key
2. **Permissions**: Granular control over what methods clients can access
3. **Encryption**: All communication is encrypted with NIP-04
4. **Relay Security**: Use trusted relays for sensitive operations
5. **Connection Expiry**: Consider implementing connection expiration

## Error Handling

The implementation includes comprehensive error handling with standardized error codes:

```typescript
// Error codes defined in NIP-47
const ERROR_CODES = {
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED', 
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  RESTRICTED: 'RESTRICTED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INTERNAL: 'INTERNAL',
  OTHER: 'OTHER',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  NOT_FOUND: 'NOT_FOUND',
};
```

## Monitoring and Status

```typescript
import { getNostrWalletConnectStatus } from './services/initializeServices';

// Check service status
const status = await getNostrWalletConnectStatus();
console.log('NWC Status:', status);
// Output: { isRunning: true, connections: 2, supportedMethods: [...] }
```

## Future Extensions

### RGB Asset Support

The implementation is designed to be extended with RGB-specific functionality:

```typescript
// Planned RGB extensions
interface RGBNWCMethods {
  pay_rgb_invoice(params: { invoice: string, asset_id?: string }): Promise<any>;
  make_rgb_invoice(params: { asset_id: string, amount: number }): Promise<any>;
  get_rgb_balance(params: { asset_id?: string }): Promise<any>;
  list_rgb_assets(params: {}): Promise<any>;
  send_rgb_asset(params: { asset_id: string, amount: number, address: string }): Promise<any>;
}
```

### Multi-Asset Transactions

Support for complex transactions involving multiple RGB assets:

```typescript
interface MultiAssetTransaction {
  inputs: Array<{ asset_id: string; amount: number }>;
  outputs: Array<{ asset_id: string; amount: number; address: string }>;
  fee_asset?: string; // Which asset to use for fees
}
```

## Troubleshooting

### Common Issues

1. **Connection Timeout**: Check relay connectivity and firewall settings
2. **Unauthorized Error**: Verify connection string and permissions
3. **Payment Failed**: Check node balance and invoice validity
4. **Internal Error**: Check RGB Lightning Node status and logs

### Debugging

Enable debug logging:

```typescript
// In development
console.log('NWC Debug mode enabled');
localStorage.setItem('nwc_debug', 'true');
```

### Logs

Monitor service logs for debugging:

```bash
# Service logs will show:
# - NWC connection events
# - Request/response processing
# - Error conditions
# - RGB API interactions
```

## Integration Examples

### React Native App

```typescript
import { useEffect, useState } from 'react';
import { initializeNostrWalletConnect } from './services/initializeServices';

function WalletScreen() {
  const [nwcStatus, setNwcStatus] = useState(null);
  const [connectionString, setConnectionString] = useState('');

  useEffect(() => {
    // Initialize NWC on app start
    initializeNostrWalletConnect().then(success => {
      if (success) {
        // Generate connection string for display
        NostrService.getInstance()
          .getWalletConnectInfo(['pay_invoice', 'make_invoice', 'get_balance'])
          .then(setConnectionString);
      }
    });
  }, []);

  return (
    <View>
      <Text>Nostr Wallet Connect</Text>
      <Text>Status: {nwcStatus?.isRunning ? 'Running' : 'Stopped'}</Text>
      <Text>Connections: {nwcStatus?.connections || 0}</Text>
      <QRCode value={connectionString} />
    </View>
  );
}
```

### Web Dashboard

```typescript
// Express.js API endpoint
app.get('/api/nwc/status', async (req, res) => {
  const status = await getNostrWalletConnectStatus();
  res.json(status);
});

app.post('/api/nwc/connection', async (req, res) => {
  const { permissions, lud16 } = req.body;
  const nostrService = NostrService.getInstance();
  
  const connectionString = await nostrService.getWalletConnectInfo(
    permissions,
    lud16
  );
  
  res.json({ connectionString });
});
```

This NWC implementation provides a secure, standards-compliant way to expose RGB Lightning Node functionality to external Nostr clients while maintaining the flexibility to add RGB-specific features in the future. 