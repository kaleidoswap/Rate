import { prismoAnimationHtml } from './prismoAnimationHtml';

async function renderer() {
  let frame: ((t: number) => void) | undefined;
  const values: Record<string, number> = {};
  const gl = new Proxy({}, { get: (_, key) => {
    if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
    if (key === 'getUniformLocation') return (_: any, name: string) => name;
    if (key === 'uniform1f') return (name: string, value: number) => { values[name] = value; };
    return () => ({});
  } });
  const canvas = { getContext: () => gl, addEventListener: jest.fn() };
  const window: any = { ReactNativeWebView: { postMessage: jest.fn() } };
  const Image = class { onload?: () => void; set src(_: string) { this.onload?.(); } };
  const html = prismoAnimationHtml(['data:a', 'data:b']);
  const script = html.split('<script type="module">')[1].split('</script>')[0];
  const AsyncFunction = new Function('return Object.getPrototypeOf(async function() {}).constructor')();
  await new AsyncFunction('document','window','Image','performance','requestAnimationFrame','cancelAnimationFrame', script)(
    { querySelector: () => canvas }, window, Image, { now: () => 0 }, (cb: any) => { frame = cb; return 1; }, jest.fn(),
  );
  return { values, window, tick: (time: number) => { const f = frame; frame = undefined; f?.(time); }, hasFrame: () => !!frame };
}
it('uses native energy for the mouth, and returns to the original smile after stop', async () => {
  const r = await renderer();
  expect(r.window.ReactNativeWebView.postMessage).toHaveBeenCalledWith('ready');
  r.window.prismoUpdate({ phase: 'speaking', level: 0 }); r.tick(50);
  expect(r.values.openness).toBeLessThan(1);
  r.window.prismoUpdate({ level: 1 }); r.tick(100);
  expect(r.values.openness).toBeGreaterThan(.7);
  r.window.prismoUpdate({ phase: 'idle' }); r.tick(150);
  expect(r.values.openness).toBeGreaterThan(.9);
});
it('stops rendering in background and resumes, respecting reduced motion', async () => {
  const r = await renderer();
  r.window.prismoUpdate({ paused: true }); r.tick(50); expect(r.hasFrame()).toBe(false);
  r.window.prismoUpdate({ paused: false, reduced: true }); expect(r.hasFrame()).toBe(true);
  r.tick(100); expect(r.values.breathe).toBe(0); expect(r.values.wave).toBe(0); expect(r.values.blink).toBe(0);
});
it('closes the mouth if the playback level stream goes stale', async () => {
  const r = await renderer(); r.window.prismoUpdate({ phase: 'speaking', level: 1 }); r.tick(50);
  r.tick(500); expect(r.values.openness).toBeLessThan(.4);
});
