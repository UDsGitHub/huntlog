import fs from 'node:fs';
import path from 'node:path';
import { extractPage, type ExtractedPage } from './extract';

const FIXTURES = path.resolve(import.meta.dirname, '../tests/fixtures/pages');
const URL_ = 'https://boards.example.com/acme/jobs/4012?gh_jid=4012&utm_source=x';

/** Puts a saved page in the document, at `url`, as the tab the extractor would run in. */
function load(html: string, url = URL_) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  document.title = parsed.title;
  vi.spyOn(location, 'href', 'get').mockReturnValue(url);
}
const fixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** Runs the extractor as executeScript does: rebuilt from its source, with no closure. */
function extract(): ExtractedPage | null {
  const rebuilt = new Function(`return (${extractPage.toString()})`)() as typeof extractPage;
  return rebuilt();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.title = '';
  window.getSelection()?.removeAllRanges();
});

describe('extractPage: JSON-LD', () => {
  it('reads a full JobPosting: decoded title, company, place, salary and canonical URL', () => {
    load(fixture('jsonld-full.html'));
    expect(extract()).toEqual({
      url: 'https://boards.example.com/jobs/4012?gh_jid=4012',
      title: 'Platform Engineer & Tech Lead',
      company: 'Acme Robotics',
      location: 'Berlin, Germany',
      salary: { min: 85000, max: 95000, currency: 'EUR', period: 'year' },
    });
  });

  it('finds a posting inside @graph, with @type as a list, and reads remote work', () => {
    load(fixture('jsonld-graph-remote.html'));
    expect(extract()).toEqual({
      url: URL_,
      title: 'Senior Product Designer',
      company: 'Globex',
      workMode: 'remote',
      location: 'United States',
      salary: { min: 62.5, max: 62.5, currency: 'USD', period: 'hour' },
    });
  });

  it('gets past broken JSON, comment wrappers and raw line breaks, and leaves out a weekly salary', () => {
    load(fixture('jsonld-messy.html'));
    expect(extract()).toEqual({
      url: URL_,
      title: 'Data Analyst (Contract)',
      company: 'Initech',
      location: 'Remote',
    });
  });

  it.each([
    [{ value: '85000-95000' }, undefined],
    [
      { value: { value: '$85,000.00', unitText: 'yearly' } },
      { min: 85000, max: 85000, period: 'year' },
    ],
    [{ value: { minValue: 120, maxValue: 90 } }, { min: 90, max: 120 }],
    [{ value: { maxValue: 100000 }, currency: 'Euro' }, { max: 100000 }],
    [{ value: { value: 400, unitText: 'DAY' } }, undefined],
    [{ value: { value: -5 } }, undefined],
  ])('reads baseSalary %j as %j', (baseSalary, salary) => {
    load(
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'JobPosting',
        title: 'Engineer',
        baseSalary: { '@type': 'MonetaryAmount', ...baseSalary },
      })}</script>`,
    );
    expect(extract()?.salary).toEqual(salary);
  });

  it('prefers the first source: JSON-LD over microdata', () => {
    load(
      `<script type="application/ld+json">{"@type":"JobPosting","title":"From JSON-LD"}</script>` +
        fixture('microdata.html'),
    );
    expect(extract()).toMatchObject({ title: 'From JSON-LD', company: 'Umbrella Health' });
  });

  it('drops a value too long to be a field (a description in the title)', () => {
    load(
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'JobPosting',
        title: 'x'.repeat(400),
      })}</script><title>Fallback title</title>`,
    );
    expect(extract()?.title).toBe('Fallback title');
  });
});

describe('extractPage: microdata', () => {
  it('reads a JobPosting marked up with itemprops', () => {
    load(fixture('microdata.html'));
    expect(extract()).toEqual({
      url: URL_,
      title: 'Lab Technician',
      company: 'Umbrella Health',
      location: 'Raccoon City, MO',
      workMode: 'remote',
      salary: { min: 4200, max: 4200, currency: 'USD', period: 'month' },
    });
  });
});

describe('extractPage: everything else', () => {
  it('falls back to the trimmed document title', () => {
    load('<title>  Senior Engineer at Acme | LinkedIn  </title>');
    expect(extract()).toEqual({ url: URL_, title: 'Senior Engineer at Acme | LinkedIn' });
  });

  it('takes selected text as the title', () => {
    load(fixture('jsonld-full.html'));
    const heading = document.querySelector('h1')!;
    const range = document.createRange();
    range.selectNodeContents(heading);
    window.getSelection()!.addRange(range);
    expect(extract()?.title).toBe('Platform Engineer');
  });

  it.each([
    ['another site', 'https://elsewhere.example/jobs/1'],
    ['the home page', '/'],
    ['a script URL', 'javascript:alert(1)'],
  ])('keeps the tab URL when the canonical one is %s', (_label, canonical) => {
    load(`<link rel="canonical" href="${canonical}"><title>x</title>`);
    expect(extract()?.url).toBe(URL_);
  });

  it('takes a canonical URL on the same site with or without www', () => {
    load('<link rel="canonical" href="https://www.boards.example.com/jobs/1">');
    expect(extract()?.url).toBe('https://www.boards.example.com/jobs/1');
  });

  it('returns just the URL for a junk page, without throwing', () => {
    load(fixture('junk.html'));
    expect(extract()).toEqual({ url: URL_ });
  });

  it('never throws when the page’s getters do', () => {
    load(fixture('jsonld-full.html'));
    vi.spyOn(document, 'title', 'get').mockImplementation(() => {
      throw new Error('hostile page');
    });
    vi.spyOn(document, 'querySelectorAll').mockImplementation(() => {
      throw new Error('hostile page');
    });
    vi.spyOn(window, 'getSelection').mockImplementation(() => {
      throw new Error('hostile page');
    });
    expect(() => extract()).not.toThrow();
    expect(extract()).toMatchObject({ url: expect.any(String) });
  });

  it('returns null instead of throwing when location is unreadable', () => {
    vi.spyOn(location, 'href', 'get').mockImplementation(() => {
      throw new Error('detached');
    });
    expect(extract()).toBeNull();
  });
});
