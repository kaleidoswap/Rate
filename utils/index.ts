import { useState, useEffect } from 'react';

// Cache for asset icons to prevent repeated downloads
const iconCache = new Map<string, string>();

// Constants
export const COIN_ICON_URL = 'https://raw.githubusercontent.com/kaleidoswap/coinmarketcap-icons-cryptos/refs/heads/main/icons/';

export const loadAssetIcon = async (
  assetTicker: string,
  defaultIcon?: string
): Promise<string | null> => {
  try {
    if (!assetTicker || assetTicker === 'None') {
      return defaultIcon || null;
    }
    if (assetTicker === 'SAT') {
      assetTicker = 'BTC';
    }

    // Check if icon is already in cache
    const cachedIcon = iconCache.get(assetTicker);
    if (cachedIcon) {
      return cachedIcon;
    }

    const iconUrl = `${COIN_ICON_URL}${assetTicker.toLowerCase()}.png`;
    const response = await fetch(iconUrl);
    if (response.ok) {
      // Cache the successful icon URL
      iconCache.set(assetTicker, iconUrl);
      return iconUrl;
    }
    throw new Error('Icon not found');
  } catch (error) {
    return defaultIcon || null;
  }
};

export const useAssetIcon = (ticker: string, defaultIcon?: string) => {
  const [iconUrl, setIconUrl] = useState<string | null>(defaultIcon || null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker || ticker === 'None') {
      setIconUrl(defaultIcon || null);
      return;
    }

    // Check cache first
    const cachedIcon = iconCache.get(ticker);
    if (cachedIcon) {
      setIconUrl(cachedIcon);
      return;
    }

    setLoading(true);
    loadAssetIcon(ticker, defaultIcon)
      .then(setIconUrl)
      .catch(() => setIconUrl(defaultIcon || null))
      .finally(() => setLoading(false));
  }, [ticker, defaultIcon]);

  return { iconUrl, loading };
};

// Generate random wallet names
const adjectives = [
  'swift',
  'bright',
  'cosmic',
  'digital',
  'electric',
  'quantum',
  'stellar',
  'crypto',
  'lunar',
  'solar',
  'atomic',
  'dynamic',
  'plasma',
  'cyber',
  'neural',
];

const nouns = [
  'wallet',
  'vault',
  'node',
  'beacon',
  'portal',
  'nexus',
  'circuit',
  'matrix',
  'pulse',
  'core',
  'sphere',
  'prism',
  'vector',
  'cipher',
  'token',
  'chain',
];

export const generateWalletName = (): string => {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective}-${noun}-${Math.floor(Math.random() * 1000)}`;
}; 