const mockDirs = new Map<string, string[]>()
jest.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///data/app/Documents/' } },
  Directory: class {
    uri: string
    constructor(...parts: Array<string | { uri: string }>) {
      this.uri = parts.map(p => (typeof p === 'string' ? p : p.uri.replace(/\/$/, ''))).join('/') + '/'
    }
    get exists() { return mockDirs.has(this.uri) }
    list() { return mockDirs.get(this.uri) ?? [] }
    create() { mockDirs.set(this.uri, []) }
  },
}))

import {
  BARK_ENABLED,
  barkWalletKey,
  buildBarkConfig,
  resolveBarkHostConfig,
  toFilesystemPath,
} from '../services/protocols/bark'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
const KEY = barkWalletKey(MNEMONIC)
const DIR_URI = `file:///data/app/Documents/bark/${KEY}-signet/`

beforeEach(() => mockDirs.clear())

describe('bark host config', () => {
  it('is on by default', () => {
    expect(BARK_ENABLED).toBe(true)
  })

  it('defaults to Second signet endpoints', () => {
    expect(resolveBarkHostConfig({})).toEqual({
      network: 'signet',
      arkServerUrl: 'https://ark.signet.2nd.dev',
      esploraUrl: 'https://esplora.signet.2nd.dev',
    })
  })

  it('requires explicit endpoints for mainnet', () => {
    expect(resolveBarkHostConfig({ EXPO_PUBLIC_BARK_NETWORK: 'mainnet' })).toBeNull()
    expect(resolveBarkHostConfig({
      EXPO_PUBLIC_BARK_NETWORK: 'mainnet',
      EXPO_PUBLIC_BARK_SERVER_URL: 'https://ark.example',
      EXPO_PUBLIC_BARK_ESPLORA_URL: 'https://esplora.example',
    })).toEqual({ network: 'mainnet', arkServerUrl: 'https://ark.example', esploraUrl: 'https://esplora.example' })
  })

  it('ignores networks the Bark adapter does not support', () => {
    expect(resolveBarkHostConfig({ EXPO_PUBLIC_BARK_NETWORK: 'regtest' })?.network).toBe('signet')
  })

  it('turns file URIs into absolute paths', () => {
    expect(toFilesystemPath('file:///data/My%20App/bark/')).toBe('/data/My App/bark')
    expect(toFilesystemPath('/already/a/path')).toBe('/already/a/path')
  })
})

describe('barkWalletKey', () => {
  it('is stable per seed, distinct across seeds, and does not contain the seed', () => {
    expect(barkWalletKey(MNEMONIC)).toBe(KEY)
    expect(barkWalletKey(`  ${MNEMONIC}\n`)).toBe(KEY)
    expect(barkWalletKey(OTHER)).not.toBe(KEY)
    expect(KEY).toMatch(/^[0-9a-f]{32}$/)
    expect(KEY).not.toContain('abandon')
  })
})

describe('buildBarkConfig', () => {
  it('creates a wallet only for an empty data directory', () => {
    expect(buildBarkConfig(MNEMONIC)).toEqual({
      protocol: 'BARK',
      mnemonic: MNEMONIC,
      network: 'signet',
      arkServerUrl: 'https://ark.signet.2nd.dev',
      esploraUrl: 'https://esplora.signet.2nd.dev',
      dataDir: `/data/app/Documents/bark/${KEY}-signet`,
      createIfMissing: true,
    })
    expect(mockDirs.has(DIR_URI)).toBe(true)
  })

  it('opens an existing wallet without create', () => {
    mockDirs.set(DIR_URI, ['db.sqlite'])
    expect(buildBarkConfig(MNEMONIC)?.createIfMissing).toBe(false)
  })

  it('gives each seed its own directory', () => {
    expect(buildBarkConfig(OTHER)?.dataDir).not.toBe(buildBarkConfig(MNEMONIC)?.dataDir)
  })
})

test('a dev client without Bark native support does not try to load its enforcing module', () => {
  const { isBarkNativeAvailable } = require('../services/protocols/bark');
  const rn = require('react-native');
  const previous = rn.TurboModuleRegistry;
  rn.TurboModuleRegistry = { get: jest.fn(() => null) };
  expect(isBarkNativeAvailable()).toBe(false);
  rn.TurboModuleRegistry.get.mockReturnValue({});
  expect(isBarkNativeAvailable()).toBe(true);
  rn.TurboModuleRegistry = previous;
});
