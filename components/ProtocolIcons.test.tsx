import React from 'react';
import { render } from '@testing-library/react-native';
import { getProtocolIcon, NostrIcon, RgbIcon, RgbNodeIcon } from './ProtocolIcons';
import { NetworkIcon } from './NetworkIcon';

describe('protocol marks', () => {
  it('draws the RGB node as the RGB logo with a Lightning badge', () => {
    const { toJSON } = render(<RgbNodeIcon size={24} />);
    expect(toJSON()).toBeTruthy();
    expect(getProtocolIcon('RLN')).toBe(RgbNodeIcon);
    expect(getProtocolIcon('RGB')).toBe(RgbIcon);
  });

  it('has a Nostr mark', () => {
    expect(render(<NostrIcon size={20} />).toJSON()).toBeTruthy();
    expect(getProtocolIcon('nostr')).toBe(NostrIcon);
  });

  it('NetworkIcon renders nostr and rln with their marks', () => {
    expect(render(<NetworkIcon network="nostr" />).UNSAFE_getByType(NostrIcon)).toBeTruthy();
    expect(render(<NetworkIcon network="rln" />).UNSAFE_getByType(RgbNodeIcon)).toBeTruthy();
  });
});
