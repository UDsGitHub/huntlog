/**
 * The Source a capture can tell from the job's address (spec §4.1): the job board it was
 * captured on. Only well-known boards, matched on the site's own domain in any country
 * (indeed.co.uk, de.indeed.com, glassdoor.ca); anything else (a company site, an ATS, an unknown
 * board) gives nothing, and Source stays for the user to pick. LinkedIn and Indeed are Source
 * chips; the others fill Other.
 */
const BOARDS: { brand: string; source: string }[] = [
  { brand: 'linkedin', source: 'LinkedIn' },
  { brand: 'indeed', source: 'Indeed' },
  { brand: 'glassdoor', source: 'Glassdoor' },
  { brand: 'ziprecruiter', source: 'ZipRecruiter' },
  { brand: 'wellfound', source: 'Wellfound' },
  { brand: 'dice', source: 'Dice' },
  { brand: 'monster', source: 'Monster' },
];

/** `brand` as the site's own name: brand.com, brand.de, brand.co.uk, brand.com.au, any subdomain. */
function isSite(host: string, brand: string): boolean {
  return new RegExp(`(^|\\.)${brand}\\.(com|[a-z]{2}|co\\.[a-z]{2}|com\\.[a-z]{2})$`).test(host);
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
  return BOARDS.find(({ brand }) => isSite(host, brand))?.source;
}
