import { chatErrorMessage } from './aiErrors';

describe('chatErrorMessage', () => {
  it('passes wallet errors written for the user through', () => {
    expect(chatErrorMessage(new Error("Your SPARK wallet isn't connected yet."))).toBe("Your SPARK wallet isn't connected yet.");
    expect(chatErrorMessage(new Error('That invoice is for 1,000 sats, not 5,000. Nothing was sent.'))).toContain('Nothing was sent.');
  });

  it('turns known engine failures into a next step', () => {
    expect(chatErrorMessage(new Error('prompt tokens exceed the context window'))).toMatch(/Clear the chat/);
    expect(chatErrorMessage(new Error('Network request failed'))).toMatch(/network/i);
    expect(chatErrorMessage(new Error('model not loaded'))).toMatch(/reload/i);
  });

  it('never shows a raw technical error', () => {
    for (const raw of ["TypeError: Cannot read property 'x' of undefined", 'ERR_RGB_WALLET_BUSY', '{"code":12}', 'failed at foo.js:12:3']) {
      expect(chatErrorMessage(new Error(raw))).toBe("I couldn't do that just now. Please try again.");
    }
    expect(chatErrorMessage(undefined)).toBe("I couldn't do that just now. Please try again.");
  });
});
