import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  FORM_DEFAULTS_KEY,
  parseFormDefaults,
  readFormDefaults,
  onFormDefaultsChanged,
  rememberFormDefaults,
  usableFormDefaults,
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

  it('keeps a valid source, work mode and resume', () => {
    expect(parseFormDefaults({ source: ' LinkedIn ', workMode: 'hybrid', resumeId: 'r1' })).toEqual(
      {
        source: 'LinkedIn',
        workMode: 'hybrid',
        resumeId: 'r1',
      },
    );
  });

  it.each([
    [null],
    [undefined],
    ['LinkedIn'],
    [42],
    [{ workMode: 'office' }],
    [{ workMode: 42 }],
    [{ source: 42 }],
    [{ source: '   ' }],
    [{ source: 'x'.repeat(101) }],
    [{ resumeId: 7 }],
    [{ resumeId: '' }],
  ])('drops malformed %j', (raw) => {
    expect(parseFormDefaults(raw)).toEqual({});
  });
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

  it('remembers the source and resume too', async () => {
    await rememberFormDefaults({ source: 'Referral', workMode: 'remote', resumeId: 'r1' });
    expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({
      source: 'Referral',
      workMode: 'remote',
      resumeId: 'r1',
    });
  });

  it('after a capture, keeps the old source and resume where the capture had none', async () => {
    await rememberFormDefaults({ source: 'LinkedIn', resumeId: 'r1' });
    expect(await rememberFormDefaults({ resumeId: 'r2' }, { captured: true })).toEqual({
      source: 'LinkedIn',
      resumeId: 'r2',
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

describe('usableFormDefaults', () => {
  const resumes = [
    { id: 'live', archived: false },
    { id: 'old', archived: true },
    { id: 'gone', archived: false, deletedAt: '2026-10-01T00:00:00Z' },
  ];

  it('keeps a remembered resume the picker still offers', () => {
    const defaults = { source: 'LinkedIn', resumeId: 'live' };
    expect(usableFormDefaults(defaults, resumes)).toEqual(defaults);
  });

  it.each(['old', 'gone', 'missing'])('drops a resume that is %s, keeping the rest', (resumeId) => {
    expect(usableFormDefaults({ source: 'LinkedIn', resumeId }, resumes)).toEqual({
      source: 'LinkedIn',
    });
  });
});
