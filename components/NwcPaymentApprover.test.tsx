import { Alert } from 'react-native';
import { confirmNwcPayment } from './NwcPaymentApprover';
import { setAppUnlocked } from '../services/appLockState';

jest.mock('../services/NWCService', () => ({ __esModule: true, default: { getInstance: jest.fn() } }));

const request = { amountSats: 2_500, description: 'coffee', invoice: 'lnbc1x' };

describe('confirmNwcPayment', () => {
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    alertSpy.mockRestore();
    setAppUnlocked(false);
  });

  const buttons = () => alertSpy.mock.calls[0][2] as Array<{ text: string; onPress: () => void }>;

  it('refuses without prompting while the app is locked', async () => {
    setAppUnlocked(false);
    await expect(confirmNwcPayment(request)).resolves.toBe(false);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows the amount and memo, and pays only on "Pay"', async () => {
    setAppUnlocked(true);
    const pending = confirmNwcPayment(request);
    expect(alertSpy.mock.calls[0][1]).toContain('2,500 sats');
    expect(alertSpy.mock.calls[0][1]).toContain('coffee');
    buttons().find((b) => b.text === 'Pay')!.onPress();
    await expect(pending).resolves.toBe(true);
  });

  it('declines on "Decline" or dismiss, and ignores a later tap', async () => {
    setAppUnlocked(true);
    const pending = confirmNwcPayment(request);
    (alertSpy.mock.calls[0][3] as { onDismiss: () => void }).onDismiss();
    buttons().find((b) => b.text === 'Pay')!.onPress();
    await expect(pending).resolves.toBe(false);
  });
});
