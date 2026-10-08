import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const flush = () => new Promise(r => setImmediate(r));

function freshEngine() {
  let engine!: typeof import('./sounds').soundEngine;
  jest.isolateModules(() => { engine = require('./sounds').soundEngine; });
  return engine;
}

beforeEach(() => jest.clearAllMocks());

test('plays a payment chime from the start, re-asserting the playback session each time', async () => {
  const engine = freshEngine();
  await engine.play('receive');
  await engine.play('receive');
  const player = (createAudioPlayer as jest.Mock).mock.results[0].value;
  expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  expect(player.seekTo).toHaveBeenCalledWith(0);
  expect(player.play).toHaveBeenCalledTimes(2);
  expect(setAudioModeAsync).toHaveBeenCalledTimes(2);
  expect(setAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ playsInSilentMode: true, interruptionMode: 'mixWithOthers' }));
});

test('a failed audio-mode call does not silence later sounds', async () => {
  const engine = freshEngine();
  (setAudioModeAsync as jest.Mock).mockRejectedValueOnce(new Error('session busy'));
  await engine.play('send');
  await engine.play('send');
  await flush();
  const player = (createAudioPlayer as jest.Mock).mock.results[0].value;
  expect(player.play).toHaveBeenCalledTimes(2);
});

test('stays silent when sound effects are off', async () => {
  const engine = freshEngine();
  engine.setEnabled(false);
  await engine.play('send');
  expect(createAudioPlayer).not.toHaveBeenCalled();
});
