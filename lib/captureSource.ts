/**
 * The Source a capture can tell from the job's address (spec §4.1): the job board it was
 * captured on. Only well-known boards, matched on the site's own domain (and, for boards with
 * country sites, those: indeed.co.uk, de.indeed.com, glassdoor.ca); anything else (a company
 * site, an ATS, an unknown board) gives nothing, and Source stays for the user to pick. LinkedIn
 * and Indeed are Source chips; the others fill Other.
 */
const BOARDS: { brand: string; source: string; countries?: boolean; aliases?: string[] }[] = [
  { brand: 'linkedin', source: 'LinkedIn', aliases: ['lnkd.in'] },
  { brand: 'indeed', source: 'Indeed', countries: true },
  { brand: 'glassdoor', source: 'Glassdoor', countries: true },
  { brand: 'ziprecruiter', source: 'ZipRecruiter', countries: true },
  { brand: 'wellfound', source: 'Wellfound', aliases: ['angel.co'] },
  { brand: 'dice', source: 'Dice' },
  { brand: 'monster', source: 'Monster', countries: true },
];

/** `domain` itself or any subdomain of it. */
const within = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/**
 * The board's own site: brand.com, plus brand.de, brand.co.uk or brand.com.au for boards that run
 * country sites (short brands like "dice" are other businesses' names on country domains).
 */
function isSite(host: string, board: (typeof BOARDS)[number]): boolean {
  if (within(host, `${board.brand}.com`)) return true;
  if (board.aliases?.some((alias) => within(host, alias))) return true;
  return (
    !!board.countries &&
    new RegExp(`(^|\\.)${board.brand}\\.([a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})$`).test(host)
  );
}

export function sourceFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let host: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return undefined;
  }
  return BOARDS.find((board) => isSite(host, board))?.source;
}
