# Rate App - Swaps Implementation TODOs

## 🔄 **Kaleidoswap Integration Overview**

The swaps functionality will integrate:
1. **Kaleidoswap APIs** - For market data, quotes, and order management
2. **RGB Lightning Node APIs** - For executing swaps via Lightning channels
3. **Fallback to On-chain** - When Lightning swaps aren't available

## 🔴 **Critical Missing Components for Swaps**

### 1. **Kaleidoswap API Service**
**Status**: Not implemented
**Priority**: High

```typescript
// services/KaleidoswapApiService.ts - NEW FILE NEEDED
class KaleidoswapApiService {
  // Market APIs
  async getAssets(): Promise<AssetsResponse>
  async getPairs(): Promise<PairResponse>
  async getQuote(request: PairQuoteRequest): Promise<PairQuoteResponse>
  
  // Swap APIs  
  async initiateSwap(request: SwapRequest): Promise<SwapResponse>
  async confirmSwap(request: ConfirmSwapRequest): Promise<ConfirmSwapResponse>
  async getSwapStatus(request: SwapStatusRequest): Promise<SwapStatusResponse>
  
  // LSP APIs (Lightning Service Provider)
  async getInfo(): Promise<GetInfoResponseModel>
  async getNetworkInfo(): Promise<NetworkInfoResponse>
  async createOrder(request: CreateOrderRequest): Promise<OrderResponse>
  async getOrder(request: GetOrderRequest): Promise<OrderResponse>
}
```

### 2. **Swap Flow Orchestration Service**
**Status**: Not implemented
**Priority**: High

```typescript
// services/SwapOrchestrationService.ts - NEW FILE NEEDED
class SwapOrchestrationService {
  // Main swap flow coordination
  async executeSwap(params: SwapParams): Promise<SwapResult>
  
  // Lightning swap path
  async executeLightningSwap(rfqId: string, swapData: SwapData): Promise<SwapResult>
  
  // On-chain fallback path
  async executeOnChainSwap(rfqId: string, swapData: SwapData): Promise<SwapResult>
  
  // Channel management for swaps
  async ensureChannelForSwap(assetId: string, amount: number): Promise<boolean>
}
```

## 🟡 **Major Feature Implementation**

### 3. **Swap Screens and UI Components**
**Status**: Not implemented
**Priority**: High

```typescript
// screens/SwapScreen.tsx - NEW FILE NEEDED
// - Asset pair selection
// - Amount input with balance validation
// - Quote display with price and fees
// - Swap execution with progress tracking
// - Transaction confirmation

// screens/SwapHistoryScreen.tsx - NEW FILE NEEDED  
// - List of completed/pending swaps
// - Swap status tracking
// - Filter by asset pairs and dates

// components/SwapQuoteCard.tsx - NEW FILE NEEDED
// - Display quote details (price, fees, expiry)
// - Accept/decline quote actions
// - Real-time quote updates

// components/AssetPairSelector.tsx - NEW FILE NEEDED
// - Available trading pairs
// - Asset search and filtering
// - Balance display for selected assets
```

### 4. **Enhanced RGB Lightning Node Integration**
**Status**: Partially implemented, needs swap methods
**Priority**: High

```typescript
// services/RGBApiService.ts - ADD MISSING SWAP METHODS
export class RGBApiService {
  // Add missing swap-related methods:
  
  // Maker side (providing liquidity)
  async makerInit(request: MakerInitRequest): Promise<MakerInitResponse>
  async makerExecute(request: MakerExecuteRequest): Promise<void>
  
  // Taker side (consuming liquidity)  
  async taker(request: TakerRequest): Promise<void>
  
  // Swap management
  async getSwap(request: GetSwapRequest): Promise<GetSwapResponse>
  async listSwaps(): Promise<ListSwapsResponse>
}
```

### 5. **Market Data Management**
**Status**: Not implemented
**Priority**: Medium

```typescript
// services/MarketDataService.ts - NEW FILE NEEDED
class MarketDataService {
  // Cache and manage market data
  async loadAvailableAssets(): Promise<ClientAsset[]>
  async loadTradingPairs(): Promise<Pair[]>
  async subscribeToQuoteUpdates(pairId: string): Promise<void>
  
  // Price calculations
  calculateSwapAmount(fromAsset: string, toAsset: string, amount: number): Promise<number>
  estimateSwapFees(fromAsset: string, toAsset: string, amount: number): Promise<Fee>
}
```

## 🔧 **Technical Implementation Details**

### 6. **Swap State Management (Redux)**
**Status**: Not implemented
**Priority**: High

```typescript
// store/slices/swapsSlice.ts - NEW FILE NEEDED
interface SwapsState {
  // Available markets
  availableAssets: ClientAsset[]
  tradingPairs: Pair[]
  
  // Active quotes
  activeQuotes: Map<string, PairQuoteResponse>
  
  // Swap history
  swapHistory: SwapRecord[]
  pendingSwaps: SwapRecord[]
  
  // UI state
  selectedFromAsset: string | null
  selectedToAsset: string | null
  swapAmount: string
  currentQuote: PairQuoteResponse | null
  
  // Loading states
  isLoadingQuote: boolean
  isExecutingSwap: boolean
  isLoadingMarketData: boolean
}

// Async thunks needed:
export const loadMarketData = createAsyncThunk(...)
export const requestQuote = createAsyncThunk(...)
export const executeSwap = createAsyncThunk(...)
export const loadSwapHistory = createAsyncThunk(...)
```

### 7. **Database Schema Extensions**
**Status**: Not implemented
**Priority**: Medium

```sql
-- Add to DatabaseService.ts

-- Swap records table
CREATE TABLE IF NOT EXISTS swaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_id INTEGER NOT NULL,
  rfq_id TEXT NOT NULL,
  payment_hash TEXT,
  swapstring TEXT,
  from_asset TEXT NOT NULL,
  to_asset TEXT NOT NULL,
  from_amount INTEGER NOT NULL,
  to_amount INTEGER NOT NULL,
  quote_price INTEGER NOT NULL,
  fee_amount INTEGER NOT NULL,
  fee_asset TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'completed', 'failed', 'expired')),
  swap_type TEXT NOT NULL CHECK(swap_type IN ('lightning', 'onchain')),
  created_at INTEGER NOT NULL,
  executed_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  FOREIGN KEY (wallet_id) REFERENCES wallets(id) ON DELETE CASCADE
);

-- Market data cache
CREATE TABLE IF NOT EXISTS market_pairs (
  id TEXT PRIMARY KEY,
  base_asset TEXT NOT NULL,
  base_asset_id TEXT NOT NULL,
  quote_asset TEXT NOT NULL,  
  quote_asset_id TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  min_base_order_size INTEGER NOT NULL,
  max_base_order_size INTEGER NOT NULL,
  last_updated INTEGER NOT NULL
);

-- Quote cache for recent quotes
CREATE TABLE IF NOT EXISTS quote_cache (
  rfq_id TEXT PRIMARY KEY,
  from_asset TEXT NOT NULL,
  to_asset TEXT NOT NULL,
  from_amount INTEGER NOT NULL,
  to_amount INTEGER NOT NULL,
  price INTEGER NOT NULL,
  fee_data TEXT NOT NULL, -- JSON serialized Fee object
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
```

## 🚀 **Swap Flow Implementation**

### 8. **Main Swap Flow Orchestration**
**Status**: Not implemented
**Priority**: High

```typescript
// Detailed swap execution flow:

async executeSwap(params: SwapExecutionParams): Promise<SwapResult> {
  try {
    // 1. Validate swap parameters
    await this.validateSwapParams(params)
    
    // 2. Check if Lightning swap is possible
    const canUseLightning = await this.checkLightningAvailability(params)
    
    if (canUseLightning) {
      // Lightning swap path
      return await this.executeLightningSwap(params)
    } else {
      // On-chain fallback path  
      return await this.executeOnChainSwap(params)
    }
  } catch (error) {
    // Handle swap failure
    await this.handleSwapError(params, error)
    throw error
  }
}

async executeLightningSwap(params: SwapExecutionParams): Promise<SwapResult> {
  // 1. Call Kaleidoswap /api/v1/swaps/init
  const swapResponse = await kaleidoswapApi.initiateSwap({
    rfq_id: params.rfqId,
    from_asset: params.fromAsset,
    from_amount: params.fromAmount,
    to_asset: params.toAsset,
    to_amount: params.toAmount
  })
  
  // 2. Call RGB Lightning Node /taker endpoint
  await rgbApi.taker({
    swapstring: swapResponse.swapstring
  })
  
  // 3. Call RGB Lightning Node /makerexecute 
  await rgbApi.makerExecute({
    swapstring: swapResponse.swapstring,
    payment_secret: params.paymentSecret,
    taker_pubkey: params.takerPubkey
  })
  
  // 4. Confirm swap with Kaleidoswap
  const confirmResult = await kaleidoswapApi.confirmSwap({
    swapstring: swapResponse.swapstring,
    taker_pubkey: params.takerPubkey,
    payment_hash: swapResponse.payment_hash
  })
  
  return {
    success: true,
    txId: confirmResult.message,
    swapHash: swapResponse.payment_hash
  }
}
```

### 9. **On-Chain Fallback Implementation**
**Status**: Not implemented  
**Priority**: Medium

```typescript
async executeOnChainSwap(params: SwapExecutionParams): Promise<SwapResult> {
  // 1. Create LSP order for channel funding
  const orderResponse = await kaleidoswapApi.createOrder({
    client_pubkey: params.clientPubkey,
    lsp_balance_sat: params.lspBalanceSat,
    client_balance_sat: params.clientBalanceSat,
    required_channel_confirmations: 1,
    funding_confirms_within_blocks: 6,
    channel_expiry_blocks: 144,
    asset_id: params.toAsset,
    lsp_asset_amount: params.toAmount,
    client_asset_amount: params.fromAmount
  })
  
  // 2. Pay the Lightning invoice or on-chain address
  if (params.fromAsset === 'BTC') {
    // Pay Lightning invoice
    await rgbApi.sendPayment({ 
      invoice: orderResponse.payment.bolt11.invoice 
    })
  } else {
    // Pay with RGB asset on-chain
    await rgbApi.sendAsset({
      asset_id: params.fromAsset,
      assignment: { type: 'Fungible', value: params.fromAmount },
      recipient_id: orderResponse.payment.onchain.address,
      fee_rate: 1,
      transport_endpoints: ['rpc://127.0.0.1:3000/json-rpc']
    })
  }
  
  // 3. Monitor order status until channel is opened
  return await this.monitorOrderCompletion(orderResponse.order_id)
}
```

## 📱 **UI/UX Implementation**

### 10. **Swap Screen Components**
**Status**: Not implemented
**Priority**: High

```typescript
// screens/SwapScreen.tsx - Main swap interface
const SwapScreen = () => {
  const [fromAsset, setFromAsset] = useState<string>('')
  const [toAsset, setToAsset] = useState<string>('')
  const [amount, setAmount] = useState<string>('')
  const [currentQuote, setCurrentQuote] = useState<PairQuoteResponse | null>(null)
  
  // Quote management
  const requestNewQuote = useCallback(async () => {
    if (!fromAsset || !toAsset || !amount) return
    
    const quote = await kaleidoswapApi.getQuote({
      from_asset: fromAsset,
      from_amount: parseAmount(amount, fromAsset),
      to_asset: toAsset
    })
    
    setCurrentQuote(quote)
    
    // Auto-refresh quote before expiry
    setTimeout(() => requestNewQuote(), quote.expires_at - Date.now() - 10000)
  }, [fromAsset, toAsset, amount])
  
  // Swap execution
  const executeSwap = useCallback(async () => {
    if (!currentQuote) return
    
    await swapOrchestration.executeSwap({
      rfqId: currentQuote.rfq_id,
      fromAsset: currentQuote.from_asset,
      fromAmount: currentQuote.from_amount,
      toAsset: currentQuote.to_asset,
      toAmount: currentQuote.to_amount,
      // ... other params
    })
  }, [currentQuote])
  
  return (
    <View>
      <AssetPairSelector 
        fromAsset={fromAsset}
        toAsset={toAsset}
        onFromAssetChange={setFromAsset}
        onToAssetChange={setToAsset}
      />
      
      <AmountInput
        amount={amount}
        asset={fromAsset}
        onAmountChange={setAmount}
        onRequestQuote={requestNewQuote}
      />
      
      {currentQuote && (
        <SwapQuoteCard
          quote={currentQuote}
          onExecuteSwap={executeSwap}
        />
      )}
    </View>
  )
}
```

### 11. **Quote Management Component**
**Status**: Not implemented
**Priority**: High

```typescript
// components/SwapQuoteCard.tsx
const SwapQuoteCard = ({ quote, onExecuteSwap }: SwapQuoteCardProps) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0)
  
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = quote.expires_at - Date.now()
      setTimeRemaining(Math.max(0, remaining))
      
      if (remaining <= 0) {
        // Quote expired, request new one
        onQuoteExpired()
      }
    }, 1000)
    
    return () => clearInterval(interval)
  }, [quote.expires_at])
  
  return (
    <View style={styles.quoteCard}>
      <View style={styles.quoteHeader}>
        <Text style={styles.quoteTitle}>Best Quote</Text>
        <Text style={styles.timeRemaining}>
          Expires in {Math.floor(timeRemaining / 1000)}s
        </Text>
      </View>
      
      <View style={styles.quoteDetails}>
        <Text>You Pay: {formatAmount(quote.from_amount, quote.from_asset)}</Text>
        <Text>You Get: {formatAmount(quote.to_amount, quote.to_asset)}</Text>
        <Text>Price: {formatPrice(quote.price)}</Text>
        <Text>Fee: {formatFee(quote.fee)}</Text>
      </View>
      
      <TouchableOpacity 
        style={styles.executeButton}
        onPress={onExecuteSwap}
        disabled={timeRemaining <= 0}
      >
        <Text style={styles.executeButtonText}>Execute Swap</Text>
      </TouchableOpacity>
    </View>
  )
}
```

## ⚙️ **Configuration and Settings**

### 12. **Kaleidoswap Configuration**
**Status**: Not implemented
**Priority**: Medium

```typescript
// Add to services/RGBApiService.ts or create new config
interface KaleidoswapConfig {
  baseUrl: string // Default: kaleidoswap API endpoint
  timeout: number
  retryAttempts: number
  quoteRefreshInterval: number // Auto-refresh quotes every N seconds
  maxSlippage: number // Maximum acceptable price slippage
}

// Add to Redux settings slice
interface SettingsState {
  // ... existing settings
  
  // Swap settings
  kaleidoswapConfig: KaleidoswapConfig
  autoAcceptQuotes: boolean
  maxSwapAmount: number
  preferredSwapMethod: 'lightning' | 'onchain' | 'auto'
  slippageTolerance: number // Percentage
}
```

## 🔍 **Testing and Validation**

### 13. **Swap Testing Framework**
**Status**: Not implemented
**Priority**: Medium

```typescript
// __tests__/swaps/SwapOrchestration.test.ts
describe('Swap Orchestration', () => {
  test('should execute Lightning swap successfully', async () => {
    // Mock Kaleidoswap APIs
    // Mock RGB Lightning Node APIs
    // Test full swap flow
  })
  
  test('should fallback to on-chain when Lightning unavailable', async () => {
    // Test fallback logic
  })
  
  test('should handle swap failures gracefully', async () => {
    // Test error scenarios
  })
})

// Integration tests with actual test networks
// Performance tests for quote refresh rates
// UI tests for swap screen interactions
```

## 📋 **Implementation Priority**

### **Phase 1 - Core Infrastructure** (2-3 weeks)
1. ✅ Create KaleidoswapApiService
2. ✅ Implement SwapOrchestrationService  
3. ✅ Add swap methods to RGBApiService
4. ✅ Create swapsSlice for Redux state
5. ✅ Extend database schema for swaps

### **Phase 2 - Basic UI** (1-2 weeks)  
1. ✅ Create SwapScreen with basic layout
2. ✅ Implement AssetPairSelector component
3. ✅ Add SwapQuoteCard component
4. ✅ Create swap history screen

### **Phase 3 - Advanced Features** (2-3 weeks)
1. ✅ Implement Lightning swap flow
2. ✅ Add on-chain fallback mechanism
3. ✅ Add real-time quote updates
4. ✅ Implement LSP order management

### **Phase 4 - Polish & Testing** (1-2 weeks)
1. ✅ Add comprehensive error handling
2. ✅ Implement swap status monitoring
3. ✅ Add UI animations and feedback
4. ✅ Write comprehensive tests

This implementation will provide users with seamless asset swapping capabilities, automatically choosing the best execution path (Lightning vs on-chain) based on availability and user preferences.