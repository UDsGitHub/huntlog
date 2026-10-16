import { normalizeUrl } from './normalizeUrl';

describe('normalizeUrl', () => {
  it.each([
    // Tracking parameters are stripped, in any case.
    ['https://acme.com/jobs/1?utm_source=x&utm_medium=y&utm_campaign=z', 'https://acme.com/jobs/1'],
    ['https://acme.com/jobs/1?UTM_Source=x&Utm_Term=y', 'https://acme.com/jobs/1'],
    ['https://acme.com/jobs/1?ref=feed&refId=abc&trk=t&trackingId=q', 'https://acme.com/jobs/1'],
    ['https://acme.com/jobs/1?REFID=abc&TrackingID=q', 'https://acme.com/jobs/1'],
    ['https://acme.com/jobs/1#apply', 'https://acme.com/jobs/1'],
    // Job-identifying and unknown parameters are kept.
    [
      'https://www.linkedin.com/jobs/view/4012345678/?refId=abc&trackingId=xyz&trk=public',
      'https://www.linkedin.com/jobs/view/4012345678',
    ],
    [
      'https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=engineer&refId=a',
      'https://www.linkedin.com/jobs/search?currentJobId=4012345678&keywords=engineer',
    ],
    [
      'https://www.indeed.com/viewjob?jk=abc123&from=serp&utm_source=x',
      'https://www.indeed.com/viewjob?from=serp&jk=abc123',
    ],
    [
      'https://boards.greenhouse.io/acme/jobs/4567?gh_jid=4567&gh_src=abc123',
      'https://boards.greenhouse.io/acme/jobs/4567?gh_jid=4567',
    ],
    [
      'https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb/',
      'https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb',
    ],
    [
      'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R123?source=LinkedIn',
      'https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Remote/Engineer_R123?source=LinkedIn',
    ],
    // Host is lowercased; path case is kept.
    ['https://Jobs.ACME.com/Careers/Job-42', 'https://jobs.acme.com/Careers/Job-42'],
    // Trailing slashes go, except the root path.
    ['https://acme.com/jobs/1///', 'https://acme.com/jobs/1'],
    ['https://acme.com/', 'https://acme.com/'],
    ['https://acme.com', 'https://acme.com/'],
    // Scheme and default ports.
    ['http://acme.com/jobs/1', 'https://acme.com/jobs/1'],
    ['http://acme.com:80/jobs/1', 'https://acme.com/jobs/1'],
    ['https://acme.com:443/jobs/1', 'https://acme.com/jobs/1'],
    // An explicit port makes http and https different origins, so the scheme stays.
    ['http://acme.com:443/jobs/1', 'http://acme.com:443/jobs/1'],
    ['http://acme.com:8080/jobs/1', 'http://acme.com:8080/jobs/1'],
    ['https://acme.com:8443/jobs/1', 'https://acme.com:8443/jobs/1'],
    // Hash routing keeps the fragment; ordinary anchors are dropped.
    ['https://careers.acme.com/#/jobs/123', 'https://careers.acme.com/#/jobs/123'],
    ['https://careers.acme.com/?utm_source=x#!/job/5', 'https://careers.acme.com/#!/job/5'],
    ['https://careers.acme.com/jobs/1#description', 'https://careers.acme.com/jobs/1'],
    // Parameter order doesn't matter; repeated and empty values are kept.
    ['https://acme.com/j?b=2&a=1', 'https://acme.com/j?a=1&b=2'],
    ['https://acme.com/j?a=2&a=1', 'https://acme.com/j?a=1&a=2'],
    ['https://acme.com/j?jk=&utm_source=x', 'https://acme.com/j?jk='],
    ['https://acme.com/j?', 'https://acme.com/j'],
    // Non-ASCII and percent-encoding.
    ['https://acme.com/emplois/ingénieur', 'https://acme.com/emplois/ing%C3%A9nieur'],
    ['https://acme.com/emplois/ing%C3%A9nieur', 'https://acme.com/emplois/ing%C3%A9nieur'],
    ['https://bücher.example/jobs', 'https://xn--bcher-kva.example/jobs'],
    ['  https://acme.com/jobs/1  ', 'https://acme.com/jobs/1'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)).toBe(expected);
  });

  it('treats URLs that differ only in tracking, scheme, case or order as equal', () => {
    const variants = [
      'https://boards.greenhouse.io/acme/jobs/4567?gh_jid=4567',
      'http://boards.greenhouse.io/acme/jobs/4567/?gh_src=x&gh_jid=4567#top',
      'https://BOARDS.greenhouse.io/acme/jobs/4567?utm_source=linkedin&gh_jid=4567',
    ];
    expect(new Set(variants.map(normalizeUrl)).size).toBe(1);
  });

  it('keeps hash-routed jobs on the same page apart', () => {
    expect(normalizeUrl('https://careers.acme.com/#/jobs/123')).not.toBe(
      normalizeUrl('https://careers.acme.com/#/jobs/456'),
    );
  });

  it.each([[undefined], [null], [42], [{}]])(
    'returns an empty string for non-string %j',
    (input) => {
      expect(normalizeUrl(input)).toBe('');
    },
  );

  it('keeps different job IDs apart', () => {
    expect(normalizeUrl('https://www.indeed.com/viewjob?jk=1')).not.toBe(
      normalizeUrl('https://www.indeed.com/viewjob?jk=2'),
    );
  });

  it.each([
    [''],
    ['   '],
    ['not a url'],
    ['javascript:alert(1)'],
    ['mailto:jobs@acme.com'],
    ['chrome://settings'],
    ['http://'],
  ])('returns non-web input %j trimmed, without throwing', (input) => {
    expect(() => normalizeUrl(input)).not.toThrow();
    expect(normalizeUrl(input)).toBe(input.trim());
  });

  it.each([
    ['https://www.linkedin.com/jobs/search/?keywords=a%20b&currentJobId=1&refId=x'],
    ['https://acme.com/j?q=a+b&x=%2B'],
    ['http://Acme.com:80/Path/?utm_source=x&b=2&a=1#h'],
    ['https://acme.com/emplois/ingénieur?ville=Montréal'],
  ])('is idempotent for %s', (input) => {
    const once = normalizeUrl(input);
    expect(normalizeUrl(once)).toBe(once);
  });
});
