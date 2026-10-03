import { transformSync } from '@babel/core';

const stripConsole = require('../scripts/babel-plugin-strip-console');

const run = (code: string) =>
  transformSync(code, { plugins: [stripConsole], babelrc: false, configFile: false })!.code!;

describe('strip-console babel plugin', () => {
  it('removes log/info/debug/trace statements', () => {
    const out = run(`console.log('invoice', inv); console.info(1); console.debug(2); console.trace();`);
    expect(out).not.toMatch(/console\./);
  });

  it('keeps warn and error', () => {
    const out = run(`console.warn('w'); console.error('e');`);
    expect(out).toContain("console.warn('w')");
    expect(out).toContain("console.error('e')");
  });

  it('replaces calls used as expressions with void 0', () => {
    const out = run(`p.catch(e => console.log(e)); ok && console.log('x');`);
    expect(out).not.toMatch(/console\.log/);
    expect(out).toContain('void 0');
  });

  it('leaves a shadowed local console alone', () => {
    const out = run(`function f(console) { console.log('mine'); }`);
    expect(out).toContain("console.log('mine')");
  });
});
