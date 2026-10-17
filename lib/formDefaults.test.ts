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
  it('keeps a valid source and work mode', () => {
    expect(parseFormDefaults({ source: ' LinkedIn ', workMode: 'remote' })).toEqual({
      source: 'LinkedIn',
      workMode: 'remote',
    });
  });

  it.each([
    [null],
    [undefined],
    ['LinkedIn'],
    [42],
    [{ source: 42, workMode: 'office' }],
    [{ source: '   ' }],
    [{ source: 'x'.repeat(101) }],
  ])('drops malformed %j', (raw) => {
    expect(parseFormDefaults(raw)).toEqual({});
  });
});

describe('reading and remembering', () => {
  it('starts blank when nothing is stored', async () => {
    expect(await readFormDefaults()).toEqual({});
  });

  it('remembers the last new application, including blanks', async () => {
    await rememberFormDefaults({ source: 'Referral', workMode: 'hybrid' });
    expect(await readFormDefaults()).toEqual({ source: 'Referral', workMode: 'hybrid' });
    await rememberFormDefaults({ workMode: 'remote' });
    expect(await readFormDefaults()).toEqual({ workMode: 'remote' });
    expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({
      workMode: 'remote',
    });
  });

  it('after a capture, keeps old defaults where the capture had nothing', async () => {
    await rememberFormDefaults({ source: 'LinkedIn', workMode: 'remote' });
    expect(await rememberFormDefaults({}, { captured: true })).toEqual({
      source: 'LinkedIn',
      workMode: 'remote',
    });
    await rememberFormDefaults({ workMode: 'onsite' }, { captured: true });
    expect(await readFormDefaults()).toEqual({ source: 'LinkedIn', workMode: 'onsite' });
  });

  it('applies overlapping writes in the order they were made', async () => {
    const first = rememberFormDefaults({ source: 'First' });
    const second = rememberFormDefaults({ source: 'Second' });
    await Promise.all([first, second]);
    expect(await readFormDefaults()).toEqual({ source: 'Second' });
  });

  it('ignores a malformed stored value', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { workMode: 'moon' } });
    expect(await readFormDefaults()).toEqual({});
  });

  it('never throws when storage fails', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('quota'));
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'));
    await expect(readFormDefaults()).resolves.toEqual({});
    await expect(rememberFormDefaults({ source: 'X' })).resolves.toEqual({ source: 'X' });
  });
});

describe('onFormDefaultsChanged', () => {
  it('reports new defaults and their removal, until unsubscribed', async () => {
    const seen: unknown[] = [];
    const stop = onFormDefaultsChanged((defaults) => seen.push(defaults));
    await rememberFormDefaults({ source: 'Referral' });
    await fakeBrowser.storage.local.remove(FORM_DEFAULTS_KEY);
    await fakeBrowser.storage.local.set({ other: 1 });
    stop();
    await rememberFormDefaults({ source: 'Indeed' });
    expect(seen).toEqual([{ source: 'Referral' }, {}]);
  });
});
