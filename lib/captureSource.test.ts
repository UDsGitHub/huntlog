import { sourceFromUrl } from './captureSource';

describe('sourceFromUrl', () => {
  it.each([
    ['https://www.linkedin.com/jobs/view/123', 'LinkedIn'],
    ['https://linkedin.com/jobs/collections/?currentJobId=4', 'LinkedIn'],
    ['https://www.indeed.com/viewjob?jk=abc', 'Indeed'],
    ['https://uk.indeed.com/viewjob?jk=abc', 'Indeed'],
    ['https://www.indeed.co.uk/viewjob?jk=abc', 'Indeed'],
    ['https://de.indeed.com/Jobs', 'Indeed'],
    ['https://www.glassdoor.ca/job-listing/x', 'Glassdoor'],
    ['https://www.glassdoor.com.au/job-listing/x', 'Glassdoor'],
    ['https://www.ziprecruiter.com/c/Acme/Job/x', 'ZipRecruiter'],
    ['https://wellfound.com/jobs/1', 'Wellfound'],
    ['https://www.dice.com/job-detail/1', 'Dice'],
    ['https://www.monster.com/job-openings/1', 'Monster'],
    ['HTTPS://WWW.LINKEDIN.COM./jobs/view/1', 'LinkedIn'],
    ['https://lnkd.in/abc', 'LinkedIn'],
    ['https://angel.co/company/acme/jobs/1', 'Wellfound'],
    ['https://www.monster.de/stellenangebot/1', 'Monster'],
    ['https://www.ziprecruiter.co.uk/jobs/1', 'ZipRecruiter'],
  ])('%s is %s', (url, source) => {
    expect(sourceFromUrl(url)).toBe(source);
  });

  it.each([
    // Company sites and ATSs: where the job was found isn't known.
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://jobs.lever.co/acme/1',
    'https://acme.com/careers/1',
    // A board's name inside another domain isn't that board.
    'https://linkedin.example.com/jobs/1',
    'https://notindeed.com/job/1',
    'https://indeed.com.evil.test/job/1',
    'https://dicey.com/job/1',
    // Short brands on country domains are other businesses.
    'https://dice.fm/event/1',
    'https://www.linkedin.de/jobs/1',
    'https://wellfound.io/jobs/1',
    // Not a web page, or not an address at all.
    'chrome://settings',
    'file:///Users/me/linkedin.com.html',
    'not a url',
    '',
    undefined,
  ])('%s gives nothing', (url) => {
    expect(sourceFromUrl(url)).toBeUndefined();
  });
});
