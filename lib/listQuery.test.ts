import {
  DEFAULT_QUERY,
  foldText,
  isSortKey,
  isStatusFilter,
  queryApplications,
  rankOf,
  type ListQuery,
} from './listQuery';
import { STATUSES } from './status';
import type { Application, Status } from './types';

let n = 0;
function app(overrides: Partial<Application> = {}): Application {
  n += 1;
  const at = `2026-10-${String(n).padStart(2, '0')}T10:00:00.000Z`;
  return {
    id: `a${n}`,
    url: `https://x.com/${n}`,
    urlNormalized: `https://x.com/${n}`,
    company: `Company ${n}`,
    status: 'applied',
    statusHistory: [],
    appliedAt: at.slice(0, 10),
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}
const q = (overrides: Partial<ListQuery> = {}): ListQuery => ({ ...DEFAULT_QUERY, ...overrides });
const ids = (apps: Application[]) => apps.map((a) => a.id);

beforeEach(() => {
  n = 0;
});

describe('filter', () => {
  const all = STATUSES.map((status) => app({ status }));

  it('All shows everything', () => {
    expect(queryApplications(all, q())).toHaveLength(9);
  });

  it('Active and Closed split the 9 statuses with no overlap', () => {
    const active = queryApplications(all, q({ filter: 'active' })).map((a) => a.status);
    const closed = queryApplications(all, q({ filter: 'closed' })).map((a) => a.status);
    expect(active.sort()).toEqual(['applied', 'interviewing', 'offer', 'saved', 'screening']);
    expect(closed.sort()).toEqual(['accepted', 'ghosted', 'rejected', 'withdrawn']);
  });

  it.each(STATUSES)('a single status: %s', (status: Status) => {
    expect(queryApplications(all, q({ filter: status })).map((a) => a.status)).toEqual([status]);
  });

  it.each([
    ['all', true],
    ['active', true],
    ['closed', true],
    ['offer', true],
    ['Offer', false],
    ['', false],
    [null, false],
  ])('isStatusFilter(%j) → %s', (value, expected) => {
    expect(isStatusFilter(value)).toBe(expected);
  });
});

describe('search', () => {
  const rows = [
    app({ company: 'Société Générale', title: 'Ingénieur' }),
    app({ company: 'Acme', title: 'C++ Developer', location: 'Berlin' }),
    app({ company: 'Beta', notes: 'Referred by Dana.\nUses .NET' }),
    app({ company: 'Gamma', title: undefined, location: undefined, notes: undefined }),
  ];
  // Rows are built at collection time, so assert on companies rather than generated ids.
  const search = (text: string) =>
    queryApplications(rows, q({ search: text })).map((a) => a.company);

  it('matches company, title, location and notes', () => {
    expect(search('societe')).toEqual(['Société Générale']);
    expect(search('developer')).toEqual(['Acme']);
    expect(search('berlin')).toEqual(['Acme']);
    expect(search('dana')).toEqual(['Beta']);
  });

  it('ignores case and accents in both directions', () => {
    expect(search('SOCIÉTÉ ingenieur')).toEqual(['Société Générale']);
    // Accents go; ø isn't a letter plus an accent, so it stays.
    expect(foldText('  Ünïcødé  Café ')).toBe('unicøde cafe');
  });

  it('requires every word, in any field and order', () => {
    expect(search('acme berlin')).toEqual(['Acme']);
    expect(search('berlin acme')).toEqual(['Acme']);
    expect(search('acme dana')).toEqual([]);
  });

  it('treats regex characters literally', () => {
    expect(search('c++')).toEqual(['Acme']);
    expect(search('.net')).toEqual(['Beta']);
    expect(search('(')).toEqual([]);
    expect(search('.*')).toEqual([]);
  });

  it('shows everything for empty or whitespace-only search', () => {
    expect(search('')).toHaveLength(4);
    expect(search('   \n ')).toHaveLength(4);
  });

  it('keeps non-Latin marks and symbols literal', () => {
    expect(foldText('バ')).not.toBe(foldText('ハ'));
    expect(foldText('a^b')).toBe('a^b');
  });

  it('copes with missing fields', () => {
    expect(search('gamma')).toEqual(['Gamma']);
  });

  it('combines with the filter', () => {
    const offer = { ...rows[1]!, status: 'offer' as const };
    expect(
      ids(queryApplications([rows[0]!, offer], q({ search: 'acme', filter: 'closed' }))),
    ).toEqual([]);
    expect(
      queryApplications([rows[0]!, offer], q({ search: 'acme', filter: 'active' })).map(
        (a) => a.company,
      ),
    ).toEqual(['Acme']);
  });
});

describe('sort', () => {
  it('Last activity: most recently updated first', () => {
    const rows = [app(), app(), app()];
    expect(ids(queryApplications(rows, q({ sort: 'activity' })))).toEqual(['a3', 'a2', 'a1']);
  });

  it('Date applied: newest first, undated last', () => {
    const rows = [
      app({ appliedAt: '2026-09-01' }),
      app({ appliedAt: undefined, status: 'saved' }),
      app({ appliedAt: '2026-10-01' }),
    ];
    expect(ids(queryApplications(rows, q({ sort: 'applied' })))).toEqual(['a3', 'a1', 'a2']);
  });

  it('Company: alphabetical, ignoring case and accents, numbers in order', () => {
    const rows = [
      app({ company: 'beta' }),
      app({ company: 'Ångström' }),
      app({ company: 'Acme' }),
      app({ company: 'Agency 10' }),
      app({ company: 'Agency 9' }),
    ];
    expect(queryApplications(rows, q({ sort: 'company' })).map((a) => a.company)).toEqual([
      'Acme',
      'Agency 9',
      'Agency 10',
      'Ångström',
      'beta',
    ]);
  });

  it('keeps input order for ties', () => {
    const same = '2026-10-05T00:00:00.000Z';
    const rows = [app({ updatedAt: same }), app({ updatedAt: same }), app({ updatedAt: same })];
    expect(ids(queryApplications(rows, q({ sort: 'activity' })))).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('frozen order', () => {
  it('keeps a row in place after its status change bumps updatedAt', () => {
    const rows = [app(), app(), app()];
    const frozen = rankOf(queryApplications(rows, q()));
    const changed = rows.map((r) =>
      r.id === 'a1' ? { ...r, updatedAt: '2026-11-01T00:00:00.000Z' } : r,
    );
    expect(ids(queryApplications(changed, q()))).toEqual(['a1', 'a3', 'a2']);
    expect(ids(queryApplications(changed, q(), frozen))).toEqual(['a3', 'a2', 'a1']);
  });

  it('puts rows new since the freeze first, newest first', () => {
    const rows = [app(), app()];
    const frozen = rankOf(queryApplications(rows, q()));
    const added = [...rows, app(), app()];
    expect(ids(queryApplications(added, q(), frozen))).toEqual(['a4', 'a3', 'a2', 'a1']);
  });

  it('orders rows new since the freeze newest first, whatever the sort', () => {
    const rows = [app({ company: 'Mid' })];
    const frozen = rankOf(rows);
    const added = [
      ...rows,
      app({ company: 'Zeta', updatedAt: '2026-11-01T10:00:00.000Z' }),
      app({ company: 'Acme', updatedAt: '2026-11-01T10:05:00.000Z' }),
    ];
    expect(queryApplications(added, q({ sort: 'company' }), frozen).map((a) => a.company)).toEqual([
      'Acme',
      'Zeta',
      'Mid',
    ]);
  });

  it('keeps showing a row whose status no longer matches the filter', () => {
    const rows = [app(), app()];
    const changed = [{ ...rows[0]!, status: 'screening' as const }, rows[1]!];
    expect(ids(queryApplications(changed, q({ filter: 'applied' })))).toEqual(['a2']);
    expect(
      ids(queryApplications(changed, q({ filter: 'applied' }), undefined, new Set(['a1']))).sort(),
    ).toEqual(['a1', 'a2']);
  });

  it('still filters', () => {
    const rows = [app(), app({ status: 'rejected' })];
    const frozen = rankOf(rows);
    expect(ids(queryApplications(rows, q({ filter: 'closed' }), frozen))).toEqual(['a2']);
  });
});

it.each([
  ['activity', true],
  ['applied', true],
  ['company', true],
  ['date', false],
  [undefined, false],
])('isSortKey(%j) → %s', (value, expected) => {
  expect(isSortKey(value)).toBe(expected);
});
