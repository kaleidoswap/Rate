import {
  activityStatusVisual,
  swapStatusVisual,
  humanizeStatus,
  ACTIVITY_STATUS_VISUAL,
} from './paymentStatus';

describe('humanizeStatus', () => {
  it('title-cases and de-snakes tokens', () => {
    expect(humanizeStatus('transfer_returned')).toBe('Transfer returned');
    expect(humanizeStatus('TRANSFER-EXPIRED')).toBe('Transfer expired');
    expect(humanizeStatus('executing')).toBe('Executing');
  });

  it('handles empty/undefined', () => {
    expect(humanizeStatus('')).toBe('Unknown');
    expect(humanizeStatus(undefined)).toBe('Unknown');
  });
});

describe('swapStatusVisual', () => {
  it('gives every lifecycle state an honest human label (no raw UPPERCASE)', () => {
    expect(swapStatusVisual('pending').label).toBe('Requested');
    expect(swapStatusVisual('whitelisted').label).toBe('Preparing channels');
    expect(swapStatusVisual('executing').label).toBe('Swapping');
    expect(swapStatusVisual('completed').label).toBe('Completed');
    expect(swapStatusVisual('failed').label).toBe('Failed');
  });

  it('falls back to neutral + humanized for unknown states (never fake success/fail)', () => {
    const v = swapStatusVisual('transfer_status_unknown');
    expect(v.label).toBe('Transfer status unknown');
    // must NOT reuse the success or error colour
    expect(v.color).not.toBe(ACTIVITY_STATUS_VISUAL.confirmed.color);
    expect(v.color).not.toBe(ACTIVITY_STATUS_VISUAL.failed.color);
  });
});

describe('activityStatusVisual', () => {
  it('maps the 3 canonical activity states', () => {
    expect(activityStatusVisual('confirmed').label).toBe('Confirmed');
    expect(activityStatusVisual('pending').label).toBe('Pending');
    expect(activityStatusVisual('failed').label).toBe('Failed');
  });

  it('falls back gracefully for an out-of-vocabulary status', () => {
    expect(activityStatusVisual('cancelled').label).toBe('Cancelled');
  });
});
