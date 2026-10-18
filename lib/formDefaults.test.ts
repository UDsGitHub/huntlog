import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  FORM_DEFAULTS_KEY,
  parseFormDefaults,
  readFormDefaults,
  onFormDefaultsChanged,
  rememberFormDefaults,
} from './formDefaults';

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('parseFormDefaults', () => {
  it('keeps a valid work mode', () => {
    expect(parseFormDefaults({ workMode: 'remote' })).toEqual({ workMode: 'remote' });
  });

  it('ignores a source stored by an older version (the source is no longer remembered)', () => {
    expect(parseFormDefaults({ source: 'LinkedIn', workMode: 'hybrid' })).toEqual({
      workMode: 'hybrid',
    });
    expect(parseFormDefaults({ source: 'LinkedIn' })).toEqual({});
  });

  it.each([[null], [undefined], ['LinkedIn'], [42], [{ workMode: 'office' }], [{ workMode: 42 }]])(
    'drops malformed %j',
    (raw) => {
      expect(parseFormDefaults(raw)).toEqual({});
    },
  );
});

describe('reading and remembering', () => {
  it('starts blank when nothing is stored', async () => {
    expect(await readFormDefaults()).toEqual({});
  });

  it('remembers the last new application, including blanks', async () => {
    await rememberFormDefaults({ workMode: 'hybrid' });
    expect(await readFormDefaults()).toEqual({ workMode: 'hybrid' });
    await rememberFormDefaults({});
    expect(await readFormDefaults()).toEqual({});
    expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({});
  });

  it("doesn't remember the source", async () => {
    await rememberFormDefaults({ source: 'Referral', workMode: 'remote' } as never);
    expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({
      workMode: 'remote',
    });
  });

  it('after a capture, keeps old defaults where the capture had nothing', async () => {
    await rememberFormDefaults({ workMode: 'remote' });
    expect(await rememberFormDefaults({}, { captured: true })).toEqual({ workMode: 'remote' });
    await rememberFormDefaults({ workMode: 'onsite' }, { captured: true });
    expect(await readFormDefaults()).toEqual({ workMode: 'onsite' });
  });

  it('applies overlapping writes in the order they were made', async () => {
    const first = rememberFormDefaults({ workMode: 'remote' });
    const second = rememberFormDefaults({ workMode: 'hybrid' });
    await Promise.all([first, second]);
    expect(await readFormDefaults()).toEqual({ workMode: 'hybrid' });
  });

  it('ignores a malformed stored value', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { workMode: 'moon' } });
    expect(await readFormDefaults()).toEqual({});
  });

  it('never throws when storage fails', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('quota'));
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'));
    await expect(readFormDefaults()).resolves.toEqual({});
    await expect(rememberFormDefaults({ workMode: 'remote' })).resolves.toEqual({
      workMode: 'remote',
    });
  });
});

describe('onFormDefaultsChanged', () => {
  it('reports new defaults and their removal, until unsubscribed', async () => {
    const seen: unknown[] = [];
    const stop = onFormDefaultsChanged((defaults) => seen.push(defaults));
    await rememberFormDefaults({ workMode: 'remote' });
    await fakeBrowser.storage.local.remove(FORM_DEFAULTS_KEY);
    await fakeBrowser.storage.local.set({ other: 1 });
    stop();
    await rememberFormDefaults({ workMode: 'hybrid' });
    expect(seen).toEqual([{ workMode: 'remote' }, {}]);
  });
});
