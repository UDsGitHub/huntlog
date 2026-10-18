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
 * 1. JSON-LD `JobPosting` (also inside `@graph`, arrays and `mainEntity`).
 * 2. Microdata (`itemtype` …/JobPosting).
 * 3. The document title, for the title.
 * Selected text, when there is some, becomes the title: selecting it was the user's choice.
 * `url` is the tab's, or its canonical URL when that's on the same site.
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

    /** Text as shown: entities decoded, tags dropped, whitespace collapsed. Too long isn't a field. */
    const clean = (value: unknown, max = 300): string | undefined => {
      if (typeof value !== 'string') return undefined;
      let text = value;
      if (/[&<]/.test(text)) {
        try {
          text = new DOMParser().parseFromString(text, 'text/html').body.textContent ?? text;
        } catch {
          // Kept as it was.
        }
      }
      text = text.replace(/\s+/g, ' ').trim();
      return text && text.length <= max ? text : undefined;
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
     * An amount as a page writes it: 85000, "85000", "85,000", "$85,000.00". A string holding
     * more than one number ("85000-95000") isn't one amount.
     */
    const amount = (value: unknown): number | undefined => {
      let number = NaN;
      if (typeof value === 'number') number = value;
      else if (typeof value === 'string') {
        const match = /^\D*?(\d{1,3}(?:[,\s]\d{3})+|\d+)(\.\d+)?\D*$/.exec(value.trim());
        if (match) number = Number(match[1]!.replace(/\D/g, '') + (match[2] ?? ''));
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
        .map((part) => clean(part, 100))
        .filter((part): part is string => Boolean(part));
      return names.length ? clean([...new Set(names)].join(', '), 200) : undefined;
    };

    // 1. JSON-LD.
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
          // Comment wrappers, and raw line breaks inside strings (invalid JSON some sites write).
          const unwrapped = (script.textContent ?? '')
            .replace(/^\s*(<!--|\/\*\s*<!\[CDATA\[\s*\*\/)/, '')
            .replace(/(-->|\/\*\s*\]\]>\s*\*\/)\s*$/, '');
          // Control characters (raw line breaks, tabs) become spaces: harmless between tokens.
          const text = Array.from(unwrapped, (char) => (char < ' ' ? ' ' : char)).join('');
          visit(JSON.parse(text), 0);
        }),
      );
      const posting = postings[0];
      if (!posting) return;
      fill('title', clean(posting.title) ?? clean(posting.name));
      const organization = list(posting.hiringOrganization)[0];
      fill('company', clean(asObject(organization)?.name ?? organization, 200));

      const remote = list(posting.jobLocationType).some(
        (type) => typeof type === 'string' && /telecommute/i.test(type),
      );
      if (remote) fill('workMode', 'remote');
      for (const location of list(posting.jobLocation)) {
        const address = asObject(location)?.address ?? location;
        const fields = asObject(address);
        const place = fields
          ? placeOf({
              locality: fields.addressLocality,
              region: fields.addressRegion,
              country: fields.addressCountry,
            })
          : clean(address, 200);
        if (place) {
          fill('location', place);
          break;
        }
      }
      if (remote && !page.location) {
        const required = list(posting.applicantLocationRequirements)[0];
        fill('location', clean(asObject(required)?.name ?? required, 200));
      }

      for (const pay of [...list(posting.baseSalary), ...list(posting.estimatedSalary)]) {
        const money = asObject(pay);
        const value = asObject(money?.value);
        const salary = money
          ? salaryOf({
              value: value ? value.value : money.value,
              min: value?.minValue ?? money.minValue,
              max: value?.maxValue ?? money.maxValue,
              currency: money.currency ?? posting.salaryCurrency,
              unit: value?.unitText ?? money.unitText,
            })
          : salaryOf({ value: pay, currency: posting.salaryCurrency });
        if (salary) {
          fill('salary', salary);
          break;
        }
      }
    });

    // 2. Microdata.
    attempt(() => {
      const scope = Array.from(document.querySelectorAll('[itemscope][itemtype]')).find((element) =>
        /JobPosting\s*$/i.test(element.getAttribute('itemtype') ?? ''),
      );
      if (!scope) return;
      const prop = (root: Element | undefined, name: string) =>
        root?.querySelector(`[itemprop~="${name}"]`) ?? undefined;
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
      if (place) {
        fill(
          'location',
          placeOf({
            locality: valueOf(prop(place, 'addressLocality')),
            region: valueOf(prop(place, 'addressRegion')),
            country: valueOf(prop(place, 'addressCountry')),
          }),
        );
      }
      const pay = prop(scope, 'baseSalary');
      if (pay) {
        fill(
          'salary',
          salaryOf({
            value: valueOf(prop(pay, 'value')),
            min: valueOf(prop(pay, 'minValue')),
            max: valueOf(prop(pay, 'maxValue')),
            currency: valueOf(prop(pay, 'currency')),
            unit: valueOf(prop(pay, 'unitText')),
          }),
        );
      }
    });

    // 3. The document title.
    attempt(() => fill('title', clean(document.title)));

    // Selected text is the title the user chose.
    attempt(() => {
      const selected = clean(window.getSelection()?.toString(), 200);
      if (selected) page.title = selected;
    });

    // The canonical URL, when it's on the same site and not just the home page.
    attempt(() => {
      const link = document.querySelector('link[rel~="canonical"][href]');
      if (!link) return;
      const current = new URL(href);
      const canonical = new URL(link.getAttribute('href') ?? '', href);
      const host = (url: URL) => url.hostname.replace(/^www\./, '');
      if (
        (canonical.protocol === 'https:' || canonical.protocol === 'http:') &&
        host(canonical) === host(current) &&
        !(canonical.pathname === '/' && current.pathname !== '/')
      ) {
        page.url = canonical.href;
      }
    });

    return page;
  } catch {
    return null;
  }
}
