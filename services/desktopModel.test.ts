import * as SecureStore from 'expo-secure-store';
import { createOpenAICompatibleProvider } from '@kaleidorg/mind/openai';
import type { LLMProvider, TurnInput, TurnOutput } from '@kaleidorg/mind';
import {
  PairingError,
  __resetDesktopModelForTests,
  checkDesktopHealth,
  createDesktopRoutingProvider,
  forgetPairing,
  getDesktopStatus,
  isPairingPayload,
  loadPairing,
  parsePairingPayload,
  savePairing,
  validatePairing,
  type DesktopPairing,
} from './desktopModel';

const TOKEN = 'tok_SECRET-5f2a9c1e7b3d4a6f8e0c2b4d6f8a0c2e';
const qr = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'kaleido-mind-remote',
    v: 1,
    name: 'KaleidoSwap Desktop',
    model: 'Qwen3.5 2B',
    host: '192.168.1.20',
    port: 47615,
    baseUrl: 'http://192.168.1.20:47615/v1',
    token: TOKEN,
    tls: false,
    ...over,
  });
const PAIRING: DesktopPairing = { host: '192.168.1.20', port: 47615, token: TOKEN, model: 'Qwen3.5 2B' };

const secure = SecureStore as jest.Mocked<typeof SecureStore>;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

const modelsOk = jest.fn(async () => jsonResponse(200, { object: 'list', data: [{ id: 'qwen3.5-2b-q4_k_m', object: 'model' }] }));

function turnInput(over: Partial<TurnInput> = {}): TurnInput {
  return { messages: [{ role: 'user', content: 'what is my balance?' }], tools: [], ...over };
}
const out = (text: string): TurnOutput => ({ text, rawContent: text, toolCalls: [] });

function fakeProvider(name: string, impl?: (i: TurnInput) => Promise<TurnOutput>): jest.Mocked<LLMProvider> {
  return { name, runTurn: jest.fn(impl ?? (async () => out(name))), cancel: jest.fn(async () => {}) } as any;
}

async function paired() {
  secure.getItemAsync.mockResolvedValue(JSON.stringify(PAIRING));
  await loadPairing();
}

beforeEach(() => {
  __resetDesktopModelForTests();
  jest.clearAllMocks();
  secure.getItemAsync.mockResolvedValue(null);
});

describe('pairing QR', () => {
  it('parses the desktop payload', () => {
    expect(parsePairingPayload(qr())).toEqual({
      host: '192.168.1.20',
      port: 47615,
      token: TOKEN,
      model: 'Qwen3.5 2B',
      name: 'KaleidoSwap Desktop',
    });
    expect(isPairingPayload(qr())).toBe(true);
    expect(isPairingPayload('lnbc1...')).toBe(false);
  });

  it('accepts loopback, private, link-local and .local hosts', () => {
    for (const host of ['127.0.0.1', '10.0.2.2', '172.16.4.1', '172.31.255.1', '192.168.0.9', '169.254.1.1', 'my-mac.local', 'localhost']) {
      expect(parsePairingPayload(qr({ host })).host).toBe(host);
    }
  });

  it.each([
    ['not JSON', 'hello'],
    ['another QR type', qr({ type: 'nostr' })],
    ['a newer version', qr({ v: 2 })],
    ['TLS', qr({ tls: true })],
    ['a public address', qr({ host: '8.8.8.8' })],
    ['a CGNAT address', qr({ host: '100.64.1.2' })],
    ['172.32/12 outside RFC 1918', qr({ host: '172.32.0.1' })],
    ['a public hostname', qr({ host: 'evil.example.com' })],
    ['an out-of-range port', qr({ port: 70000 })],
    ['a missing token', qr({ token: '' })],
    ['a token with spaces', qr({ token: 'abc def ghi jkl mno pqr' })],
  ])('rejects %s', (_label, raw) => {
    expect(() => parsePairingPayload(raw)).toThrow(PairingError);
  });

  it('builds the pairing from manual entry with a string port', () => {
    expect(validatePairing({ host: ' 192.168.1.20 ', port: '47615', token: TOKEN })).toMatchObject({ host: '192.168.1.20', port: 47615 });
  });

  it('never puts the token in an error message', () => {
    for (const raw of [qr({ host: '8.8.8.8' }), qr({ port: 0 }), qr({ v: 3 }), qr({ tls: true })]) {
      try {
        parsePairingPayload(raw);
      } catch (e) {
        expect(String((e as Error).message)).not.toContain(TOKEN);
      }
    }
  });
});

describe('secure storage', () => {
  it('stores the pairing in SecureStore only', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage');
    await savePairing(PAIRING);
    expect(secure.setItemAsync).toHaveBeenCalledWith('mind_desktop_pairing', expect.stringContaining(TOKEN), expect.any(Object));
    for (const call of (AsyncStorage.setItem as jest.Mock | undefined)?.mock?.calls ?? []) {
      expect(JSON.stringify(call)).not.toContain(TOKEN);
    }
  });

  it('forgets the pairing', async () => {
    await savePairing(PAIRING);
    await forgetPairing();
    expect(secure.deleteItemAsync).toHaveBeenCalledWith('mind_desktop_pairing', expect.any(Object));
    expect(await loadPairing()).toBeNull();
  });

  it('treats a corrupt stored value as unpaired', async () => {
    secure.getItemAsync.mockResolvedValue('{"host":"8.8.8.8"}');
    expect(await loadPairing()).toBeNull();
  });
});

describe('health check', () => {
  it('GETs /v1/models with the bearer token and no Origin header', async () => {
    const res = await checkDesktopHealth(PAIRING, { fetch: modelsOk as any });
    expect(res).toEqual({ ok: true, modelId: 'qwen3.5-2b-q4_k_m' });
    const [url, init] = (modelsOk.mock.calls[0] as unknown) as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:47615/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    expect(Object.keys(init.headers as object).map((k) => k.toLowerCase())).not.toContain('origin');
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [503, 'no_model'],
    [500, 'bad_response'],
  ])('maps HTTP %d to %s', async (status, reason) => {
    const res = await checkDesktopHealth(PAIRING, { fetch: (async () => jsonResponse(status, {})) as any });
    expect(res).toEqual({ ok: false, reason });
  });

  it('reports an unreachable desktop', async () => {
    const res = await checkDesktopHealth(PAIRING, { fetch: (async () => { throw new TypeError('Network request failed'); }) as any });
    expect(res).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('times out quickly', async () => {
    const hang = (_: string, init: RequestInit) =>
      new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const started = Date.now();
    const res = await checkDesktopHealth(PAIRING, { fetch: hang as any, timeoutMs: 30 });
    expect(res).toEqual({ ok: false, reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('provider selection', () => {
  it('runs on the device when the setting is off', async () => {
    await paired();
    const local = fakeProvider('local');
    const createRemote = jest.fn();
    const p = createDesktopRoutingProvider({ local, isEnabled: () => false, createRemote, fetch: modelsOk as any });
    await expect(p.runTurn(turnInput())).resolves.toMatchObject({ text: 'local' });
    expect(createRemote).not.toHaveBeenCalled();
    expect(modelsOk).not.toHaveBeenCalled();
  });

  it('runs on the device when nothing is paired', async () => {
    const local = fakeProvider('local');
    const createRemote = jest.fn();
    const p = createDesktopRoutingProvider({ local, isEnabled: () => true, createRemote, fetch: modelsOk as any });
    await expect(p.runTurn(turnInput())).resolves.toMatchObject({ text: 'local' });
    expect(createRemote).not.toHaveBeenCalled();
  });

  it('uses the desktop when enabled and reachable', async () => {
    await paired();
    const local = fakeProvider('local');
    const remote = fakeProvider('remote');
    const createRemote = jest.fn(() => remote);
    const p = createDesktopRoutingProvider({ local, isEnabled: () => true, createRemote, fetch: modelsOk as any });
    await expect(p.runTurn(turnInput())).resolves.toMatchObject({ text: 'remote' });
    expect(createRemote).toHaveBeenCalledWith({ baseUrl: 'http://192.168.1.20:47615/v1', apiKey: TOKEN, model: 'qwen3.5-2b-q4_k_m' });
    expect(local.runTurn).not.toHaveBeenCalled();
    expect(p.lastRoute()).toBe('desktop');
    expect(getDesktopStatus()).toEqual({ state: 'connected', modelId: 'qwen3.5-2b-q4_k_m' });
    await p.runTurn(turnInput());
    expect(modelsOk).toHaveBeenCalledTimes(1);
  });

  it('falls back to the device when the desktop is unreachable', async () => {
    await paired();
    const local = fakeProvider('local');
    const onFallback = jest.fn();
    const p = createDesktopRoutingProvider({
      local,
      isEnabled: () => true,
      createRemote: jest.fn(),
      onFallback,
      fetch: (async () => { throw new TypeError('Network request failed'); }) as any,
    });
    await expect(p.runTurn(turnInput())).resolves.toMatchObject({ text: 'local' });
    expect(onFallback).toHaveBeenCalledWith('unreachable');
    expect(getDesktopStatus()).toEqual({ state: 'fallback', reason: 'unreachable' });
  });

  it('falls back when the desktop fails before answering', async () => {
    await paired();
    const local = fakeProvider('local');
    const remote = fakeProvider('remote', async () => { throw new Error('connection reset'); });
    const onFallback = jest.fn();
    const p = createDesktopRoutingProvider({ local, isEnabled: () => true, createRemote: () => remote, onFallback, fetch: modelsOk as any });
    await expect(p.runTurn(turnInput())).resolves.toMatchObject({ text: 'local' });
    expect(onFallback).toHaveBeenCalledWith('error');
    expect(getDesktopStatus()).toEqual({ state: 'fallback', reason: 'error' });
    expect(p.lastRoute()).toBe('device');
  });

  it('does not rerun a turn the desktop already streamed', async () => {
    await paired();
    const local = fakeProvider('local');
    const remote = fakeProvider('remote', async (i) => {
      i.onToken?.('Your ');
      throw new Error('connection reset');
    });
    const p = createDesktopRoutingProvider({ local, isEnabled: () => true, createRemote: () => remote, fetch: modelsOk as any });
    await expect(p.runTurn(turnInput())).rejects.toThrow('connection reset');
    expect(local.runTurn).not.toHaveBeenCalled();
  });

  it('does not fall back after the user stops the turn', async () => {
    await paired();
    const local = fakeProvider('local');
    const controller = new AbortController();
    const remote = fakeProvider('remote', async () => {
      controller.abort();
      throw new Error('aborted');
    });
    const p = createDesktopRoutingProvider({ local, isEnabled: () => true, createRemote: () => remote, fetch: modelsOk as any });
    await expect(p.runTurn(turnInput({ signal: controller.signal }))).rejects.toThrow('aborted');
    expect(local.runTurn).not.toHaveBeenCalled();
  });

  it('sends the turn through the OpenAI-compatible client with the token', async () => {
    await paired();
    const chat = jest.fn(async (_url: string, _init: RequestInit) =>
      jsonResponse(200, { choices: [{ message: { role: 'assistant', content: 'You have 1,000 sats.' }, finish_reason: 'stop' }] }),
    );
    const p = createDesktopRoutingProvider({
      local: fakeProvider('local'),
      isEnabled: () => true,
      createRemote: (o) => createOpenAICompatibleProvider({ ...o, fetch: chat as any }),
      fetch: modelsOk as any,
    });
    const tools = [{ name: 'get_balance', description: 'Balance', parameters: { type: 'object', properties: {} } }];
    await expect(p.runTurn(turnInput({ tools: tools as any }))).resolves.toMatchObject({ text: 'You have 1,000 sats.' });
    const [url, init] = chat.mock.calls[0];
    expect(url).toBe('http://192.168.1.20:47615/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('origin');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('qwen3.5-2b-q4_k_m');
    expect(body.tools[0].function.name).toBe('get_balance');
  });
});

describe('token is never logged', () => {
  it('stays out of the console across pairing, health checks and fallbacks', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    try {
      parsePairingPayload(qr());
      try { parsePairingPayload(qr({ host: '8.8.8.8' })); } catch {}
      await savePairing(PAIRING);
      await checkDesktopHealth(PAIRING, { fetch: (async () => jsonResponse(401, { error: 'bad token' })) as any });
      await checkDesktopHealth(PAIRING, { fetch: (async () => { throw new Error('boom'); }) as any });
      const p = createDesktopRoutingProvider({
        local: fakeProvider('local'),
        isEnabled: () => true,
        createRemote: (o) => createOpenAICompatibleProvider({ ...o, fetch: (async () => jsonResponse(500, { error: 'x' })) as any }),
        fetch: modelsOk as any,
      });
      await p.runTurn(turnInput());
      await forgetPairing();
      for (const spy of spies) {
        for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });
});
