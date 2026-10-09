const path = require('path');
const { requiredAddons, missingAddons } = require('./qvac-addon-coverage');

const projectRoot = path.resolve(__dirname, '..');

describe('qvac-addon-coverage', () => {
  it('reads exact addon versions from a worker bundle', () => {
    const src = JSON.stringify({
      addons: [
        'linked:bare-ffmpeg.1.2.3.framework/bare-ffmpeg.1.2.3',
        'linked:libbare-ffmpeg.1.2.3.so',
        'linked:libqvac__llm-llamacpp.0.55.0.so',
        'linked:librocksdb-native.3.18.1.so',
      ],
    });
    expect(requiredAddons(src)).toEqual(['bare-ffmpeg.1.2.3', 'qvac__llm-llamacpp.0.55.0', 'rocksdb-native.3.18.1']);
  });

  it('the installed worker bundle only loads addons the app links', async () => {
    const missing = await missingAddons(
      projectRoot,
      path.join(projectRoot, 'qvac', 'worker.bundle.js'),
      path.join(projectRoot, 'qvac', 'addons.manifest.json'),
    );
    expect(missing).toEqual([]);
  }, 30000);
});
