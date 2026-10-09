import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const FILES = [
  'services/mindIntents', 'services/mindExplain.ts', 'services/insights.ts',
  'components/mind', 'hooks/useIntentRunner.ts', 'hooks/useInsights.ts',
].flatMap((p) => {
  const abs = path.join(ROOT, p);
  return fs.statSync(abs).isDirectory()
    ? fs.readdirSync(abs).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => path.join(abs, f))
    : [abs];
});

test.each(FILES.map((f) => [path.relative(ROOT, f), f]))('%s has no regex syntax older Hermes rejects', (_name, file) => {
  const src = fs.readFileSync(file, 'utf8');
  expect(src).not.toContain('(?<');
  expect(src).not.toContain('\\p{');
});
