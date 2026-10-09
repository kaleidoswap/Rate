const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const script = resolve(__dirname, 'sync-mind.sh');

test('normal installs never overlay a same-version local checkout', () => {
  const root = mkdtempSync(join(tmpdir(), 'rate-mind-pin-'));
  const app = join(root, 'app');
  const local = join(root, 'kaleido-mind/packages/core');
  const installed = join(app, 'node_modules/@kaleidorg/mind');
  try {
    for (const dir of [local, installed]) {
      mkdirSync(join(dir, 'dist'), { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.11.0' }));
    }
    writeFileSync(join(local, 'dist/index.js'), 'development');
    writeFileSync(join(installed, 'dist/index.js'), 'published');
    const env = { ...process.env };
    delete env.SYNC_MIND_LOCAL; delete env.SYNC_MIND_FORCE;
    const result = spawnSync('bash', [script], { cwd: app, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(installed, 'dist/index.js'), 'utf8'), 'published');
    const optedIn = spawnSync('bash', [script], { cwd: app, env: { ...env, SYNC_MIND_LOCAL: '1' }, encoding: 'utf8' });
    assert.equal(optedIn.status, 0, optedIn.stderr);
    assert.equal(readFileSync(join(installed, 'dist/index.js'), 'utf8'), 'development');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
