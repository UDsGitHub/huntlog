import {
  createDraft,
  draftKey,
  DRAFT_MAX_AGE_MS,
  isFresh,
  MAX_TITLE_LENGTH,
  parseDraft,
  sanitizeTitle,
  sanitizeUrl,
  capturedDetailFields,
} from './captureDraft';

const now = new Date('2026-10-15T12:00:00.000Z');

describe('draftKey', () => {
  it('is distinct per window', () => {
    expect(draftKey(1)).toBe('captureDraft:1');
    expect(draftKey(1)).not.toBe(draftKey(2));
  });
});

describe('sanitizeUrl', () => {
  it.each([
    ['https://boards.greenhouse.io/acme/jobs/1', 'https://boards.greenhouse.io/acme/jobs/1'],
    ['  http://example.com  ', 'http://example.com/'],
    [
      'https://www.linkedin.com/jobs/view/?currentJobId=42',
      'https://www.linkedin.com/jobs/view/?currentJobId=42',
    ],
  ])('keeps %j', (input, expected) => {
    expect(sanitizeUrl(input)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [42],
    [{}],
    [''],
    ['   '],
    ['javascript:alert(1)'],
    ['data:text/html,<b>x</b>'],
    ['chrome://extensions'],
    ['chrome-extension://abc/sidepanel.html'],
    ['file:///Users/me/job.html'],
    ['mailto:jobs@acme.com'],
    ['about:blank'],
    ['not a url'],
    [`https://example.com/${'a'.repeat(3000)}`],
    // Short as typed, but over the limit once percent-encoded.
    [`https://example.com/${'職'.repeat(1000)}`],
  ])('drops %j', (input) => {
    expect(sanitizeUrl(input)).toBeUndefined();
  });
});

describe('sanitizeTitle', () => {
  it('collapses whitespace and trims', () => {
    expect(sanitizeTitle('  Senior\n\tEngineer   at  Acme ')).toBe('Senior Engineer at Acme');
  });

  it.each([[undefined], [null], [5], [''], [' \n ']])('drops %j', (input) => {
    expect(sanitizeTitle(input)).toBeUndefined();
  });

  it('caps very long titles', () => {
    const title = sanitizeTitle('x'.repeat(100_000));
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
  });

  it('never splits an emoji at the length cap', () => {
    const title = sanitizeTitle(`${'x'.repeat(MAX_TITLE_LENGTH - 1)}🚀🚀`)!;
    expect(Array.from(title)).toHaveLength(MAX_TITLE_LENGTH);
    expect(title.endsWith('🚀')).toBe(true);
    expect(title.isWellFormed()).toBe(true);
  });

  it('keeps unicode', () => {
    expect(sanitizeTitle('エンジニア 🚀 Ünïcødé')).toBe('エンジニア 🚀 Ünïcødé');
  });
});

describe('createDraft', () => {
  it('builds a versioned draft with only the valid fields', () => {
    expect(createDraft('page', { url: 'https://a.com/j', title: ' Job ' }, now)).toEqual({
      v: 1,
      source: 'page',
      url: 'https://a.com/j',
      title: 'Job',
      capturedAt: '2026-10-15T12:00:00.000Z',
    });
  });

  it('omits invalid fields instead of storing them', () => {
    const draft = createDraft('link', { url: 'javascript:alert(1)', title: 7 }, now);
    expect(draft).toEqual({ v: 1, source: 'link', capturedAt: now.toISOString() });
  });

  it('marks failed page reads', () => {
    expect(createDraft('command', { url: 'chrome://newtab', readFailed: true }, now)).toEqual({
      v: 1,
      source: 'command',
      capturedAt: now.toISOString(),
      readFailed: true,
    });
  });
});

describe('parseDraft', () => {
  const valid = {
    v: 1,
    source: 'page',
    url: 'https://a.com/',
    title: 'T',
    capturedAt: now.toISOString(),
  };

  it('round-trips a valid draft', () => {
    expect(parseDraft(valid)).toEqual(valid);
    expect(parseDraft(createDraft('link', { url: 'https://a.com/' }, now))).toEqual({
      v: 1,
      source: 'link',
      url: 'https://a.com/',
      capturedAt: now.toISOString(),
    });
  });

  it.each([
    [null],
    [undefined],
    ['captureDraft'],
    [[]],
    [{ ...valid, v: 2 }],
    [{ ...valid, v: undefined }],
    [{ ...valid, source: 'tab' }],
    [{ ...valid, capturedAt: 'yesterday' }],
    [{ ...valid, capturedAt: undefined }],
  ])('rejects %j', (input) => {
    expect(parseDraft(input)).toBeNull();
  });

  it('strips fields that would be unsafe to prefill', () => {
    expect(
      parseDraft({ ...valid, url: 'javascript:alert(1)', title: { evil: true }, extra: 'x' }),
    ).toEqual({ v: 1, source: 'page', capturedAt: now.toISOString() });
  });

  it('keeps readFailed only when it is exactly true', () => {
    expect(parseDraft({ ...valid, readFailed: true })?.readFailed).toBe(true);
    expect(parseDraft({ ...valid, readFailed: 'yes' })).not.toHaveProperty('readFailed');
  });
});

describe('isFresh', () => {
  const at = (ms: number) => createDraft('page', {}, new Date(now.getTime() - ms));

  it.each([
    ['just captured', 0, true],
    ['one ms under the limit', DRAFT_MAX_AGE_MS - 1, true],
    ['exactly at the limit', DRAFT_MAX_AGE_MS, false],
    ['an hour old', 60 * 60 * 1000, false],
    ['from the future (clock skew)', -60 * 1000, true],
  ])('%s → %s', (_label, ageMs, expected) => {
    expect(isFresh(at(ageMs), now)).toBe(expected);
  });
});

describe('capturedDetailFields', () => {
  it.each([['page'], ['link'], ['command']] as const)(
    "doesn't mistake a %s draft's gesture source for the Source field",
    (source) => {
      expect(
        capturedDetailFields(createDraft(source, { url: 'https://a.com/', title: 'T' })),
      ).toEqual([]);
    },
  );
});
