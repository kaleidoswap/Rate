// __tests__/setup/jest-env-setup.js
// This file runs before the test environment is set up

// Set up global variables
global.__DEV__ = true;

// Silence specific warnings
const originalWarn = console.warn;
const originalError = console.error;

console.warn = (...args) => {
  const firstArg = args[0];
  if (
    typeof firstArg === 'string' &&
    (firstArg.includes('Require cycle:') ||
     firstArg.includes('Warning: React.createElement'))
  ) {
    return;
  }
  originalWarn.apply(console, args);
};

console.error = (...args) => {
  const firstArg = args[0];
  if (
    typeof firstArg === 'string' &&
    (firstArg.includes('Warning: ReactDOM.render') ||
     firstArg.includes('Not implemented: HTMLFormElement'))
  ) {
    return;
  }
  originalError.apply(console, args);
};
