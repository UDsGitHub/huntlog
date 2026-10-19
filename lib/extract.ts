export interface ExtractedSalary {
  min?: number;
  max?: number;
  /** ISO 4217, as the page states it. */
  currency?: string;
  period?: 'year' | 'month' | 'hour';
}

/** What a page tells about its job posting (spec §7). Everything but `url` may be missing. */
export interface ExtractedPage {
  url: string;
  title?: string;
  company?: string;
  location?: string;
  workMode?: 'remote' | 'hybrid' | 'onsite';
  salary?: ExtractedSalary;
}

/**
 * Reads the job posting on the current page (spec §7). Injected into the tab with
 * `scripting.executeScript({ func })`, which serializes this function: it must stay fully
 * self-contained (no imports, no outer-scope references, helpers defined inside) and must never
 * throw. Each source that fails is skipped, and whatever was found is returned.
 *
 * Sources, each filling only what the ones before it left empty:
 * 1. JSON-LD `JobPosting` (also inside `@graph`, arrays and `mainEntity`; every posting on the
 *    page, in order).
 * 2. Microdata (`itemtype` …/JobPosting).
 * 3. The first `<h1>`, and what `og:title` and the document title say ("Title at Company",
 *    "Company hiring Title in Place", …).
 * 4. The company an ATS address names (Greenhouse, Lever, Workday, Ashby), then `og:site_name`
 *    unless the site is a job board.
 * 5. The document title as it is, for the title.
 * `url` is the tab's, or its canonical URL when that's on the same site and keeps the job's
 * query parameters. Selected text is the background script's to use (the context menu's
 * `selectionText`), so a stale selection never replaces the title.
 */
export function extractPage(): ExtractedPage | null {
  try {
    const href = String(location.href);
    const page: ExtractedPage = { url: href };

    /** Runs one source; a source that throws (a hostile or odd page) is skipped. */
    const attempt = (read: () => void) => {
      try {
        read();
      } catch {
        // Skipped: the other sources still run.
      }
    };

    /** Whitespace collapsed, and cut (by character) to `max`, like the draft's own cleaning. */
    const clean = (value: unknown, max = 300): string | undefined => {
      if (typeof value !== 'string') return undefined;
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text) return undefined;
      const chars = Array.from(text);
      return chars.length > max ? chars.slice(0, max).join('').trimEnd() : text;
    };

    /**
     * A JSON-LD string, which may carry HTML: formatting tags dropped and entities decoded. Text
     * that only looks like a tag ("Dev <Backend>") is kept.
     */
    const cleanHtml = (value: unknown, max = 300): string | undefined => {
      if (typeof value !== 'string') return undefined;
      let text = value.replace(
        /<\/?(p|br|b|strong|em|i|u|span|div|a|li|ul|ol|h[1-6])(\s[^>]*)?\/?>/gi,
        ' ',
      );
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
        ndash: '–',
        mdash: '—',
        lsquo: '‘',
        rsquo: '’',
        ldquo: '“',
        rdquo: '”',
        hellip: '…',
      };
      text = text.replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, (entity, name: string) => {
        try {
          if (name[0] === '#') {
            const code =
              name[1] === 'x' || name[1] === 'X'
                ? parseInt(name.slice(2), 16)
                : parseInt(name.slice(1), 10);
            return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
          }
          // A rarer name: the entity alone through the parser, where no tag can form.
          return (
            named[name.toLowerCase()] ??
            new DOMParser().parseFromString(entity, 'text/html').body.textContent ??
            entity
          );
        } catch {
          return entity;
        }
      });
      return clean(text, max);
    };

    const fill = <K extends Exclude<keyof ExtractedPage, 'url'>>(
      field: K,
      value: ExtractedPage[K] | undefined,
    ) => {
      if (page[field] === undefined && value !== undefined) page[field] = value;
    };

    const list = (value: unknown): unknown[] =>
      Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

    const asObject = (value: unknown): Record<string, unknown> | undefined =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;

    /**
     * An amount as a page writes it: 85000, "85000", "85,000", "$85,000.00", "€85.000",
     * "85 000 €", "$85k". A separator followed by exactly three digits groups thousands (as the
     * form reads salaries, spec §5); one or two digits after it are decimals. A string holding
     * more than one number ("85000-95000") isn't one amount.
     */
    const amount = (value: unknown): number | undefined => {
      let number = NaN;
      if (typeof value === 'number') number = value;
      else if (typeof value === 'string') {
        const match = /^[^\d]*?(\d[\d.,\s\u00a0\u202f']*?)\s*(k(?![a-z]))?(?!\d)[^\d]*$/i.exec(
          value.trim(),
        );
        if (match) {
          const digits = match[1]!.replace(/[\s\u00a0\u202f']/g, '');
          if (/^\d{1,3}([.,]\d{3})+$/.test(digits)) number = Number(digits.replace(/[.,]/g, ''));
          else if (/^\d{1,3}(,\d{3})+\.\d{1,2}$/.test(digits)) {
            number = Number(digits.replace(/,/g, ''));
          } else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(digits)) {
            number = Number(digits.replace(/\./g, '').replace(',', '.'));
          } else if (/^\d+([.,]\d{1,2})?$/.test(digits)) number = Number(digits.replace(',', '.'));
          if (match[2]) number *= 1000;
        }
      }
      return Number.isFinite(number) && number > 0 && number <= 1_000_000_000 ? number : undefined;
    };

    /** A pay period Huntlog has (year, month, hour); `null` for one it hasn't (week, day). */
    const period = (unit: unknown): ExtractedSalary['period'] | null | undefined => {
      const text = typeof unit === 'string' ? unit.trim().toLowerCase() : '';
      if (!text) return undefined;
      if (/^(year|yearly|annual|annually|yr|p\.?a\.?)$/.test(text)) return 'year';
      if (/^(month|monthly|mo)$/.test(text)) return 'month';
      if (/^(hour|hourly|hr)$/.test(text)) return 'hour';
      return null;
    };

    /**
     * A salary from its parts. Only what's stated: a single figure is both ends, and a period
     * Huntlog can't hold (weekly, daily) drops the salary rather than store it as yearly.
     */
    const salaryOf = (parts: {
      value?: unknown;
      min?: unknown;
      max?: unknown;
      currency?: unknown;
      unit?: unknown;
    }): ExtractedSalary | undefined => {
      const unit = period(parts.unit);
      if (unit === null) return undefined;
      let min = amount(parts.min);
      let max = amount(parts.max);
      const single = amount(parts.value);
      if (min === undefined && max === undefined && single !== undefined) min = max = single;
      if (min === undefined && max === undefined) return undefined;
      if (min !== undefined && max !== undefined && min > max) [min, max] = [max, min];
      const salary: ExtractedSalary = {};
      if (min !== undefined) salary.min = min;
      if (max !== undefined) salary.max = max;
      const currency =
        typeof parts.currency === 'string' ? parts.currency.trim().toUpperCase() : '';
      if (/^[A-Z]{3}$/.test(currency)) salary.currency = currency;
      if (unit) salary.period = unit;
      return salary;
    };

    /** "Berlin, Germany", "San Francisco, CA": the place's town and region, or country. */
    const placeOf = (parts: { locality?: unknown; region?: unknown; country?: unknown }) => {
      const country = asObject(parts.country)?.name ?? parts.country;
      const names = [parts.locality, parts.region || country]
        .map((part) => cleanHtml(part, 100))
        .filter((part): part is string => Boolean(part));
      return names.length ? clean([...new Set(names)].join(', '), 200) : undefined;
    };

    // Control characters (raw line breaks, tabs) inside JSON-LD strings make it invalid JSON;
    // as spaces they're harmless. Built from char codes, so no control character sits in source.
    const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}]+`, 'g');

    // 1. JSON-LD: every posting, in order, each filling what the ones before it left empty.
    attempt(() => {
      const postings: Record<string, unknown>[] = [];
      const visit = (node: unknown, depth: number) => {
        if (depth > 8 || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach((item) => visit(item, depth + 1));
          return;
        }
        const object = node as Record<string, unknown>;
        const types = list(object['@type']);
        if (types.some((type) => typeof type === 'string' && /(^|[/#:])JobPosting$/.test(type))) {
          postings.push(object);
        }
        visit(object['@graph'], depth + 1);
        visit(object.mainEntity, depth + 1);
      };
      document.querySelectorAll('script[type="application/ld+json"]').forEach((script) =>
        attempt(() => {
          const text = (script.textContent ?? '')
            .replace(/^\s*(<!--|\/\*\s*<!\[CDATA\[\s*\*\/)/, '')
            .replace(/(-->|\/\*\s*\]\]>\s*\*\/)\s*$/, '')
            .replace(CONTROL, ' ');
          visit(JSON.parse(text), 0);
        }),
      );
      for (const posting of postings) {
        fill('title', cleanHtml(posting.title) ?? cleanHtml(posting.name));
        const organization = list(posting.hiringOrganization)[0];
        fill('company', cleanHtml(asObject(organization)?.name ?? organization, 200));

        const remote = list(posting.jobLocationType).some(
          (type) => typeof type === 'string' && /telecommute/i.test(type),
        );
        if (remote) fill('workMode', 'remote');
        for (const location of list(posting.jobLocation)) {
          if (page.location) break;
          const address = asObject(location)?.address ?? location;
          const fields = asObject(address);
          fill(
            'location',
            fields
              ? placeOf({
                  locality: fields.addressLocality,
                  region: fields.addressRegion,
                  country: fields.addressCountry,
                })
              : cleanHtml(address, 200),
          );
        }
        if (remote && !page.location) {
          const required = list(posting.applicantLocationRequirements)[0];
          fill('location', cleanHtml(asObject(required)?.name ?? required, 200));
        }

        for (const pay of [...list(posting.baseSalary), ...list(posting.estimatedSalary)]) {
          if (page.salary) break;
          const money = asObject(pay);
          const value = asObject(money?.value);
          fill(
            'salary',
            money
              ? salaryOf({
                  value: value ? value.value : money.value,
                  min: value?.minValue ?? money.minValue,
                  max: value?.maxValue ?? money.maxValue,
                  currency: money.currency ?? posting.salaryCurrency,
                  unit: value?.unitText ?? money.unitText,
                })
              : salaryOf({ value: pay, currency: posting.salaryCurrency }),
          );
        }
      }
    });

    // 2. Microdata.
    attempt(() => {
      const scope = Array.from(document.querySelectorAll('[itemscope][itemtype]')).find((element) =>
        /JobPosting\s*$/i.test(element.getAttribute('itemtype') ?? ''),
      );
      if (!scope) return;
      /** The item an element's property belongs to: the nearest itemscope above it. */
      const owner = (element: Element) => element.parentElement?.closest('[itemscope]');
      /** A property of `root` itself, never one of an item nested inside it. */
      const prop = (root: Element | undefined, name: string) =>
        root
          ? Array.from(root.querySelectorAll(`[itemprop~="${name}"]`)).find(
              (element) => owner(element) === root,
            )
          : undefined;
      const valueOf = (element: Element | undefined) =>
        element
          ? (element.getAttribute('content') ??
            element.getAttribute('datetime') ??
            element.textContent)
          : undefined;

      fill('title', clean(valueOf(prop(scope, 'title'))));
      const organization = prop(scope, 'hiringOrganization');
      fill('company', clean(valueOf(prop(organization, 'name') ?? organization), 200));
      const locationType = valueOf(prop(scope, 'jobLocationType'));
      if (locationType && /telecommute/i.test(locationType)) fill('workMode', 'remote');
      const place = prop(scope, 'jobLocation');
      const address = prop(place, 'address') ?? place;
      if (address) {
        fill(
          'location',
          placeOf({
            locality: valueOf(prop(address, 'addressLocality')),
            region: valueOf(prop(address, 'addressRegion')),
            country: valueOf(prop(address, 'addressCountry')),
          }),
        );
      }
      const pay = prop(scope, 'baseSalary');
      if (pay) {
        // The amount is the salary's own `value`, or a QuantitativeValue item under that name.
        const value = prop(pay, 'value');
        const quantity = value?.hasAttribute('itemscope') ? value : undefined;
        fill(
          'salary',
          salaryOf({
            value: valueOf(quantity ? prop(quantity, 'value') : value),
            min: valueOf(prop(quantity ?? pay, 'minValue')),
            max: valueOf(prop(quantity ?? pay, 'maxValue')),
            currency: valueOf(prop(pay, 'currency')),
            unit: valueOf(prop(quantity ?? pay, 'unitText') ?? prop(pay, 'unitText')),
          }),
        );
      }
    });

    // 3–4. Open Graph and meta tags, the first heading, title patterns and ATS addresses.
    const meta = (property: string) =>
      document
        .querySelector(`meta[property="${property}"], meta[name="${property}"]`)
        ?.getAttribute('content') ?? undefined;
    const host = (() => {
      try {
        return new URL(href).hostname.toLowerCase();
      } catch {
        return '';
      }
    })();
    const isLever = /(^|\.)lever\.co$/.test(host);

    /**
     * What a page title says, in the shapes job pages use: "Company hiring Title in Place |
     * Site", "Job Application for Title at Company", "Title at Company", "Title @ Company",
     * "Title - Company | Site", and on Lever "Company - Title".
     */
    const parseTitle = (raw: string | undefined) => {
      const text = clean(raw, 500);
      if (!text) return {};
      const hiring = /^(.+?) hiring (.+?)(?: in (.+?))?(?: [|·] [^|·]+)?$/.exec(text);
      if (hiring) return { company: hiring[1], title: hiring[2], location: hiring[3] };
      const segments = text.split(/ [|·] /);
      const head = segments[0]!.replace(/^job application for /i, '');
      const at = /^(.+?) (?:at|@) (.+)$/.exec(head);
      if (at) return { title: at[1], company: at[2] };
      const dash = head.split(/ [-–—] /);
      if (dash.length === 2 && isLever) return { company: dash[0], title: dash[1] };
      // "Title - Company" only with a site after it, so "Engineer - Remote" isn't a company.
      if (dash.length === 2 && segments.length > 1) return { title: dash[0], company: dash[1] };
      return { title: head };
    };

    /**
     * The company an ATS address names: boards.greenhouse.io/{company},
     * jobs.lever.co/{company}, {company}.wd5.myworkdayjobs.com, jobs.ashbyhq.com/{company}.
     * Shown as words: "acme-robotics" → "Acme Robotics".
     */
    const atsCompany = (): string | undefined => {
      const url = new URL(href);
      const first = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '');
      let slug: string | undefined;
      if (/(^|\.)greenhouse\.io$/.test(host) && /^(boards|job-boards)\./.test(host)) slug = first;
      else if (/^jobs(\.eu)?\.lever\.co$/.test(host)) slug = first;
      else if (host === 'jobs.ashbyhq.com') slug = first;
      else {
        const workday = /^([a-z0-9-]+)\.(wd\d+\.)?myworkdayjobs\.com$/.exec(host);
        if (workday) slug = workday[1];
      }
      if (!slug || !/^[\w-]{2,80}$/.test(slug) || slug === 'embed') return undefined;
      return slug
        .split(/[-_]+/)
        .filter(Boolean)
        .map((word) =>
          word === word.toLowerCase() ? word[0]!.toUpperCase() + word.slice(1) : word,
        )
        .join(' ');
    };

    attempt(() => {
      const fromOg = parseTitle(meta('og:title'));
      const fromDocument = parseTitle(document.title);
      const heading = clean(document.querySelector('h1')?.textContent, 200);
      fill('title', heading);
      fill('title', cleanHtml(fromOg.title));
      fill('title', clean(fromDocument.title));
      fill('company', clean(fromOg.company, 200) ?? clean(fromDocument.company, 200));
      fill('location', clean(fromOg.location, 200) ?? clean(fromDocument.location, 200));
    });
    attempt(() => fill('company', atsCompany()));
    // A site's own name, unless the site is a job board or ATS rather than the employer.
    attempt(() => {
      const site = cleanHtml(meta('og:site_name'), 200);
      const board =
        /^(linkedin|indeed|glassdoor|ziprecruiter|wellfound|angellist|dice|monster|greenhouse|lever|workday|ashby|smartrecruiters|jobvite|icims|workable|bamboohr|recruitee|teamtailor|personio|careers?|jobs?)\b/i;
      if (site && !board.test(site)) fill('company', site);
    });
    // Last resort for the title: the document title as it is.
    attempt(() => fill('title', clean(document.title)));

    // The canonical URL, when it's on the same site, isn't just the home page, and keeps every
    // query parameter of the tab's that isn't tracking: some boards' canonical leaves out the
    // job's id (`currentJobId`, `vjk`, `gh_jid`), and that URL would name no job.
    attempt(() => {
      const link = document.querySelector('link[rel~="canonical"][href]');
      if (!link) return;
      const current = new URL(href);
      const canonical = new URL(link.getAttribute('href') ?? '', href);
      const host = (url: URL) => url.hostname.replace(/^www\./, '');
      const tracking = /^(utm_.*|ref|refid|trk|trackingid|gh_src|fbclid|gclid|mc_[a-z]+)$/i;
      const keepsJob = Array.from(current.searchParams.keys()).every(
        (key) => tracking.test(key) || canonical.searchParams.has(key),
      );
      if (
        (canonical.protocol === 'https:' || canonical.protocol === 'http:') &&
        host(canonical) === host(current) &&
        !(canonical.pathname === '/' && current.pathname !== '/') &&
        keepsJob
      ) {
        page.url = canonical.href;
      }
    });

    return page;
  } catch {
    return null;
  }
}
