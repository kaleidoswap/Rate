/**
 * scripts/ui-preview.test.tsx
 *
 * UI previews without running the app: renders the wallet's real components
 * under jest (with the shared mocks) and serializes the React Native tree
 * into a single dark HTML gallery. Layout, colors, type and copy come from
 * the components and the design tokens themselves.
 *
 *   npm run ui-preview
 *   open output/ui-preview.html
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import * as fs from 'fs';
import * as path from 'path';
import { theme } from '../theme';

jest.mock('../store/hooks', () => ({
  useAppSelector: (f: any) => f({
    wallet: { activeWallet: { id: 1 } },
    swap: { swapHistory: [] },
    assets: { rgbAssets: [] },
    contacts: { contacts: [] },
  }),
  useAppDispatch: () => jest.fn(),
}));
jest.mock('../localization/useAppLanguage', () => ({ useAppLanguage: () => ({ language: 'en' }) }));
jest.mock('../hooks/useFiatRates', () => ({ useFiatRates: () => ({ usd: 100000 }) }));
jest.mock('../utils/feedback', () => ({ feedback: { tap: jest.fn(), select: jest.fn(), send: jest.fn(), receive: jest.fn(), error: jest.fn(), warning: jest.fn(), success: jest.fn() } }));
jest.mock('../hooks/useActivityFeed', () => ({ useActivityFeed: jest.fn(() => ({ items: [], updating: false, result: null, refresh: jest.fn() })) }));
jest.mock('../services/kaleidoPay/activity', () => ({ PAYMENT_ATTEMPT_KIND: 'payment-attempt', loadSwapAttemptActivity: async () => [], paymentAttemptIdOf: () => undefined }));
jest.mock('../components/ActivityDetailSheet', () => ({ ActivityDetailSheet: () => null }));

const { AmountPad } = require('../components/AmountPad');
const { AmountEditorModal } = require('../components/AmountEditorModal');
const PaymentSuccessOverlay = require('../components/PaymentSuccessOverlay').default;
const DepositSuccessOverlay = require('../components/DepositSuccessOverlay').default;
const { RecentActivityWidget } = require('../components/RecentActivityWidget');

// ---------------------------------------------------------------- HTML sink

type Json = { type?: string; props?: any; children?: (Json | string)[] } | string | null | undefined | false;

const NO_UNIT = new Set(['flex', 'flexGrow', 'flexShrink', 'flexBasis', 'opacity', 'zIndex', 'fontWeight', 'aspectRatio']);

const cssValue = (key: string, value: any): string => {
  if (key === 'transform' && Array.isArray(value)) return value.map((t: any) => {
    const [[k, v]] = Object.entries(t);
    return `${k}(${typeof v === 'number' ? `${v}px` : v})`;
  }).join(' ');
  if (key === 'fontVariant') return value.join(' ');
  if (key === 'shadowOffset' || key === 'elevation' || key === 'includeFontPadding' || key === 'textAlignVertical') return '';
  if (typeof value === 'number' && !NO_UNIT.has(key)) return `${value}px`;
  return String(value);
};

const fontFamily = (value: string): string =>
  /mono/i.test(value) ? "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
  : /geist/i.test(value) ? "'Geist', -apple-system, 'Segoe UI', system-ui, sans-serif"
  : /ionicons/i.test(value) ? "'Ionicons', sans-serif"
  : value;

const css = (style: any): string => {
  const arr = (Array.isArray(style) ? style : [style]).filter(Boolean);
  const out: string[] = [];
  for (const s of arr) for (const [k, v] of Object.entries(s ?? {})) {
    if (v == null) continue;
    if (k === 'fontFamily') { out.push(`font-family: ${fontFamily(String(v))}`); continue; }
    if (k.startsWith('shadow')) continue;
    const val = cssValue(k, v);
    if (val !== '') out.push(`${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${val}`);
  }
  return out.join('; ');
};

const GLYPH: Record<string, string> = {
  'arrow-down': '↓', 'arrow-up': '↑', 'swap-horizontal': '⇄', 'add-circle-outline': '⊕',
  'close-circle-outline': '⊘', 'ellipse-outline': '•', checkmark: '✓', 'backspace-outline': '⌫',
  'close': '✕', search: '⌕', 'chevron-down': '⌄', 'chevron-forward': '›', 'chevron-up': '⌃',
  'time-outline': '◷', layers_outline: '❐', 'swap-vertical': '⇅', 'alert-circle-outline': '⚠',
  'git-branch-outline': '⑂', refresh: '⟳', flash: '⚡', scan: '▣', wallet: '👛',
};
const ionGlyph = (name?: string) => GLYPH[name ?? ''] ?? '●';

function renderNode(node: Json): string {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderNode).join('');
  const props = node.props ?? {};
  const children = (node.children ?? []).map(renderNode).join('');
  const style = css(props.style);
  switch (node.type) {
    case 'Text':
      return `<span style="${style}">${children}</span>`;
    case 'TextInput':
      return `<input style="${style}" placeholder="${props.placeholder ?? ''}" value="${props.value ?? ''}" />`;
    case 'Switch':
      return `<span class="switch ${props.value ? 'on' : 'off'}"></span>`;
    case 'ActivityIndicator':
      return `<span class="spinner" style="border-top-color: ${props.color ?? theme.colors.primary[500]}"></span>`;
    case 'Ionicons':
      return `<span style="display:inline-block; font-size:${props.size ?? 20}px; line-height:1; color:${props.color ?? 'inherit'}">${ionGlyph(props.name)}</span>`;
    case 'Image':
      return `<span style="display:inline-block; ${style}; border:1px dashed #ffffff33"></span>`;
    case 'StatusBar':
    case 'RefreshControl':
      return '';
    default:
      // View, ScrollView, touchables, Modal, SectionList…: boxes that stack.
      return `<div style="display:flex; flex-direction:column; box-sizing:border-box; ${style}">${children}</div>`;
  }
}

const phoneFrame = (inner: string, frameStyle = '') =>
  `<div class="phone" style="${frameStyle}">${inner}</div>`;

function sceneToHtml(element: React.ReactElement, frameStyle = ''): string {
  const screen = render(element);
  const tree = screen.toJSON() as Json[];
  screen.unmount();
  const inner = (Array.isArray(tree) ? tree : [tree]).map(renderNode).join('');
  return phoneFrame(inner, frameStyle);
}

// ------------------------------------------------------------------ scenes

const rates = { usd: 100000 };
const widgetItems = [
  { id: 'a', type: 'receive', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '12,000', rawSats: 12000, txid: 'h1', status: 'confirmed', layer: 'LN', timestamp: Date.now() - 2 * 3600_000, contactName: 'Alice' },
  { id: 'b', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '2,100', rawSats: 2100, txid: 'h2', status: 'pending', layer: 'Spark', timestamp: Date.now() - 40 * 60_000, contactName: 'Mario' },
  { id: 'c', type: 'swap', source: 'swap', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '5,000', txid: 'h3', status: 'confirmed', layer: 'Swap', timestamp: Date.now() - 26 * 3600_000 },
  { id: 'd', type: 'send', source: 'payment', asset: 'BTC', assetTicker: 'sats', assetPrecision: 0, amount: '800', rawSats: 800, txid: 'h4', status: 'failed', layer: 'LN', timestamp: Date.now() - 3 * 86400_000 },
];
require('../hooks/useActivityFeed').useActivityFeed.mockImplementation(() => ({ items: widgetItems, updating: false, result: null, refresh: jest.fn() }));

test('renders the UI gallery to output/ui-preview.html', () => {
  const scenes: { title: string; caption: string; html: string }[] = [
    {
      title: 'The wallet’s number pad — sats',
      caption: 'AmountPad with integer amounts: no decimal key, thousands group as you type.',
      html: sceneToHtml(<View><AmountPad value="12500" onChange={() => {}} /></View>, 'justify-content:center; padding: 28px'),
    },
    {
      title: 'The wallet’s number pad — asset decimals',
      caption: 'AmountPad with a two-decimal asset (e.g. USDB): the point belongs where it may.',
      html: sceneToHtml(<View><AmountPad value="2.5" onChange={() => {}} maxDecimals={2} /></View>, 'justify-content:center; padding: 28px'),
    },
    {
      title: 'Amount sheet — send bitcoin',
      caption: 'One editor everywhere: big display, sats ⇄ USD, the number pad, then Set amount.',
      html: sceneToHtml(<AmountEditorModal visible onClose={() => {}} initialSats={21000} rates={rates} bitcoinUnit="sats" onConfirm={() => {}} />),
    },
    {
      title: 'Amount sheet — send a Spark token',
      caption: 'Asset mode: the ticker is the unit, Max fills the balance, the available amount answers.',
      html: sceneToHtml(<AmountEditorModal visible onClose={() => {}} rates={rates} bitcoinUnit="sats"
        asset={{ unit: 'USDB', maxUnits: 123.45, availableLabel: '123.45 USDB available', decimals: 2 }}
        onConfirm={() => {}} onConfirmAssetUnits={() => {}} />),
    },
    {
      title: 'Amount sheet — receive (request)',
      caption: 'Request mode: amount optional, note, invoice expiry and countdown — one sheet.',
      html: sceneToHtml(<AmountEditorModal visible onClose={() => {}} rates={rates} bitcoinUnit="sats"
        requestOptions={{ expirySeconds: 3600, showCountdown: true, note: 'Pizza on Friday' }} onConfirm={() => {}} />),
    },
    {
      title: 'Payment sent — the shared celebration',
      caption: 'PaymentSuccessOverlay on a completed send: check, amount, recipient, what it cost. See receipt stays one tap away.',
      html: sceneToHtml(<PaymentSuccessOverlay visible title="Sent" amountLabel="2,100 sats" subtitle="to Mario"
        rows={[{ label: 'From', value: 'Account Spark' }, { label: 'Total', value: '2,101 sats' }, { label: 'Fee', value: '1 sat' }]}
        onDone={() => {}} secondary={{ label: 'See receipt', onPress: () => {} }} />),
    },
    {
      title: 'Payment received — the same overlay',
      caption: 'DepositSuccessOverlay wraps the same component for the receive side.',
      html: sceneToHtml(<DepositSuccessOverlay visible amountLabel="12,000 sats" ticker="BTC" account="Spark" network="Spark"
        amountIsBalanceChange onDone={() => {}} onActivity={() => {}} />),
    },
    {
      title: 'Recent activity — one payment, one story',
      caption: 'Unified names, signs and ages from utils/activity-presentation; fiat under BTC amounts; Payment · Contact titles.',
      html: sceneToHtml(<RecentActivityWidget onViewAll={() => {}} />, 'padding: 20px; justify-content:center'),
    },
  ];

  const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>KaleidoSwap — UI previews</title>
<style>
  body { margin: 0; padding: 48px 40px; background: #05070c; color: ${theme.colors.text.primary}; font-family: 'Geist', -apple-system, 'Segoe UI', system-ui, sans-serif; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: ${theme.colors.text.secondary}; font-size: 13px; margin: 0 0 40px; }
  .grid { display: flex; flex-wrap: wrap; gap: 48px; align-items: flex-start; }
  .scene h2 { font-size: 15px; margin: 0 0 2px; }
  .scene p { color: ${theme.colors.text.tertiary}; font-size: 12px; max-width: 390px; margin: 0 0 12px; }
  .phone { position: relative; width: 390px; min-height: 560px; border-radius: 28px; overflow: hidden; padding: 14px; box-sizing: border-box;
           background: ${theme.colors.background.primary}; outline: 1px solid #ffffff14; display: flex; flex-direction: column; }
  .switch { display: inline-block; width: 40px; height: 24px; border-radius: 999px; box-sizing: border-box; }
  .switch.on { background: ${theme.colors.primary[500]}; }
  .switch.off { background: ${theme.colors.surface.tertiary}; }
  .spinner { display: inline-block; width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent;
             border-top-color: ${theme.colors.primary[500]}; animation: spin 0.8s linear infinite; box-sizing: border-box; }
  @keyframes spin { to { transform: rotate(360deg); } }
  input { background: transparent; border: none; outline: none; }
</style></head><body>
<h1>KaleidoSwap — UI previews</h1>
<p class="sub">Rendered from the real components via jest (npm run ui-preview) · layout, tokens and copy are the app’s own · interactive bits are inert.</p>
<div class="grid">
${scenes.map(s => `<section class="scene"><h2>${s.title}</h2><p>${s.caption}</p>${s.html}</section>`).join('\n')}
</div></body></html>`;

  const outDir = path.resolve(__dirname, '..', 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'ui-preview.html');
  fs.writeFileSync(outPath, page);
  // eslint-disable-next-line no-console
  console.log(`[ui-preview] wrote ${outPath} (${Math.round(page.length / 1024)} kB, ${scenes.length} scenes)`);

  expect(page.length).toBeGreaterThan(10_000);
  expect(page).toContain('The wallet’s number pad — sats');
  expect(page).toContain('Payment ·');
});

// The View import is only for wrapping scenes; keep it honest for the linter.
import { View } from 'react-native';
