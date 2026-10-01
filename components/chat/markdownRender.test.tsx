// Guards the markdown-it 10 -> 14 security override (pnpm-workspace.yaml):
// react-native-markdown-display declares markdown-it ^10, so make sure chat
// messages still render through the newer parser.
import React from 'react';
import { render } from '@testing-library/react-native';
import Markdown from 'react-native-markdown-display';
import MarkdownIt from 'markdown-it';

const MESSAGE = [
  '# Payment sent',
  'Paid **2,500 sats** to _coffee shop_ with `lnbc1xyz`.',
  '',
  '- first',
  '- second',
  '',
  'Details: https://kaleidoswap.com or mail support@kaleidoswap.com',
  '',
  '```',
  'txid: abc123',
  '```',
].join('\n');

describe('chat markdown rendering (markdown-it override)', () => {
  it('uses the patched markdown-it major', () => {
    expect(require('markdown-it/package.json').version.split('.')[0]).toBe('14');
  });

  it('renders headings, emphasis, inline code, lists and code blocks', () => {
    const { getByText } = render(<Markdown>{MESSAGE}</Markdown>);
    expect(getByText('Payment sent')).toBeTruthy();
    expect(getByText('2,500 sats')).toBeTruthy();
    expect(getByText('coffee shop')).toBeTruthy();
    expect(getByText('lnbc1xyz')).toBeTruthy();
    expect(getByText('first')).toBeTruthy();
    expect(getByText(/txid: abc123/)).toBeTruthy();
  });

  it('linkifies URLs and emails when linkify is on', () => {
    const md = MarkdownIt({ linkify: true });
    const { getByText } = render(<Markdown markdownit={md}>{MESSAGE}</Markdown>);
    expect(getByText('https://kaleidoswap.com')).toBeTruthy();
    expect(getByText('support@kaleidoswap.com')).toBeTruthy();
  });

  it('stays fast on input shaped like the patched quadratic cases', () => {
    const hostile = 'mailto:' + 'a'.repeat(20_000) + ' ' + '"'.repeat(20_000);
    const start = Date.now();
    render(<Markdown markdownit={MarkdownIt({ linkify: true, typographer: true })}>{hostile}</Markdown>);
    expect(Date.now() - start).toBeLessThan(5_000);
  });
});
