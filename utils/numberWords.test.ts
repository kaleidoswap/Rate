import { numberWordsToDigits } from './numberWords';

describe('numberWordsToDigits', () => {
  const cases: [string, string][] = [
    ['send Walter one satoshi', 'send Walter 1 satoshi'],
    ['pay Bob twenty-one sats', 'pay Bob 21 sats'],
    ['send twenty one sats to Alice', 'send 21 sats to Alice'],
    ['create an invoice for a hundred sats', 'create an invoice for 100 sats'],
    ['send five thousand sats', 'send 5000 sats'],
    ['two hundred and fifty', '250'],
    ['one million sats', '1000000 sats'],
  ];
  it.each(cases)('%s → %s', (input, expected) => {
    expect(numberWordsToDigits(input)).toBe(expected);
  });

  it('leaves non-number words alone (no false positives)', () => {
    expect(numberWordsToDigits('often someone wants a coffee')).toBe('often someone wants a coffee');
    expect(numberWordsToDigits('tell me about Bitcoin')).toBe('tell me about Bitcoin');
  });

  it('does not swallow a trailing filler word', () => {
    expect(numberWordsToDigits('one and done')).toBe('1 and done');
  });
});
