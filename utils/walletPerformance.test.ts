const original = Object.getOwnPropertyDescriptor(globalThis, 'performance');

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'performance', original);
});

test('reports Dashboard visibility only once layout and unlock are ready', () => {
  let now = 40;
  const measure = jest.fn();
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => now, measure, rnStartupTiming: { startTime: 5 } },
  });
  jest.isolateModules(() => {
    const { startWalletStartup, markWalletStartup, markWalletUnlocked } = require('./walletPerformance');
    startWalletStartup();
    now = 50;
    markWalletStartup('pin-visible');
    now = 60;
    markWalletStartup('dashboard-visible');
    expect(measure).toHaveBeenCalledTimes(1);
    now = 100;
    markWalletUnlocked();
    markWalletStartup('dashboard-visible');
    expect(measure.mock.calls).toEqual([
      ['rate.startup.pin-visible', { start: 5, end: 50 }],
      ['rate.startup.dashboard-visible', { start: 5, end: 100 }],
      ['rate.startup.unlock-to-dashboard', { start: 100, end: 100 }],
    ]);
  });
});

test('records only the first usable quote in a request and replaces the prior measurement', () => {
  let now = 20;
  const measure = jest.fn(), clearMeasures = jest.fn();
  Object.defineProperty(globalThis, 'performance', {
    configurable: true,
    value: { now: () => now, measure, clearMeasures },
  });
  jest.isolateModules(() => {
    const { startWalletPerformance } = require('./walletPerformance');
    const firstQuote = startWalletPerformance('swap-quote');
    now = 30;
    firstQuote();
    now = 50;
    firstQuote();
    expect(clearMeasures).toHaveBeenCalledWith('rate.swap-quote');
    expect(measure.mock.calls).toEqual([['rate.swap-quote', { start: 20, end: 30 }]]);
  });
});
