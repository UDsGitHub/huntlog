import {
  sameFiltersAndSort,
  activeFilterCount,
  dateFilterRange,
  DEFAULT_QUERY,
  foldText,
  groupState,
  NO_SOURCE,
  queryApplications,
  sourceKey,
  sourceOptions,
  toggleSource,
  rankOf,
  toggleGroup,
  toggleStatus,
  withoutFilters,
  type ListQuery,
  type QueryContext,
} from './listQuery';
import { ACTIVE_STATUSES, CLOSED_STATUSES, STATUSES } from './status';
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
// Friday Oct 16 2026, weeks starting Sunday.
const context: QueryContext = { now: new Date(2026, 9, 16, 15), weekStartsOn: 0 };
const run = (
  apps: Application[],
  query: ListQuery,
  frozen?: ReadonlyMap<string, number>,
  keep?: ReadonlySet<string>,
) => queryApplications(apps, query, context, frozen, keep);
const ids = (apps: Application[]) => apps.map((a) => a.id);

beforeEach(() => {
  n = 0;
});

describe('status filter', () => {
  const all = STATUSES.map((status) => app({ status }));

  it('no status chosen shows everything', () => {
    expect(run(all, q())).toHaveLength(9);
  });

  it('Active and Closed split the 9 statuses with no overlap', () => {
    const active = run(all, q({ statuses: ACTIVE_STATUSES })).map((a) => a.status);
    const closed = run(all, q({ statuses: CLOSED_STATUSES })).map((a) => a.status);
    expect(active.sort()).toEqual(['applied', 'interviewing', 'offer', 'saved', 'screening']);
    expect(closed.sort()).toEqual(['accepted', 'ghosted', 'rejected', 'withdrawn']);
  });

  it.each(STATUSES)('a single status: %s', (status: Status) => {
    expect(run(all, q({ statuses: [status] })).map((a) => a.status)).toEqual([status]);
  });

  it('several statuses at once', () => {
    const shown = run(all, q({ statuses: ['offer', 'saved'] })).map((a) => a.status);
    expect(shown.sort()).toEqual(['offer', 'saved']);
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
  const search = (text: string) => run(rows, q({ search: text })).map((a) => a.company);

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
    expect(ids(run([rows[0]!, offer], q({ search: 'acme', statuses: CLOSED_STATUSES })))).toEqual(
      [],
    );
    expect(
      run([rows[0]!, offer], q({ search: 'acme', statuses: ACTIVE_STATUSES })).map(
        (a) => a.company,
      ),
    ).toEqual(['Acme']);
  });
});

describe('sort', () => {
  it('Last activity: most recently updated first', () => {
    const rows = [app(), app(), app()];
    expect(ids(run(rows, q({ sort: 'activity' })))).toEqual(['a3', 'a2', 'a1']);
  });

  it('Date applied: newest first, undated last', () => {
    const rows = [
      app({ appliedAt: '2026-09-01' }),
      app({ appliedAt: undefined, status: 'saved' }),
      app({ appliedAt: '2026-10-01' }),
    ];
    expect(ids(run(rows, q({ sort: 'applied' })))).toEqual(['a3', 'a1', 'a2']);
  });

  it('Company: alphabetical, ignoring case and accents, numbers in order', () => {
    const rows = [
      app({ company: 'beta' }),
      app({ company: 'Ångström' }),
      app({ company: 'Acme' }),
      app({ company: 'Agency 10' }),
      app({ company: 'Agency 9' }),
    ];
    expect(run(rows, q({ sort: 'company' })).map((a) => a.company)).toEqual([
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
    expect(ids(run(rows, q({ sort: 'activity' })))).toEqual(['a1', 'a2', 'a3']);
  });
});

describe('frozen order', () => {
  it('keeps a row in place after its status change bumps updatedAt', () => {
    const rows = [app(), app(), app()];
    const frozen = rankOf(run(rows, q()));
    const changed = rows.map((r) =>
      r.id === 'a1' ? { ...r, updatedAt: '2026-11-01T00:00:00.000Z' } : r,
    );
    expect(ids(run(changed, q()))).toEqual(['a1', 'a3', 'a2']);
    expect(ids(run(changed, q(), frozen))).toEqual(['a3', 'a2', 'a1']);
  });

  it('puts rows new since the freeze first, newest first', () => {
    const rows = [app(), app()];
    const frozen = rankOf(run(rows, q()));
    const added = [...rows, app(), app()];
    expect(ids(run(added, q(), frozen))).toEqual(['a4', 'a3', 'a2', 'a1']);
  });

  it('orders rows new since the freeze newest first, whatever the sort', () => {
    const rows = [app({ company: 'Mid' })];
    const frozen = rankOf(rows);
    const added = [
      ...rows,
      app({ company: 'Zeta', updatedAt: '2026-11-01T10:00:00.000Z' }),
      app({ company: 'Acme', updatedAt: '2026-11-01T10:05:00.000Z' }),
    ];
    expect(run(added, q({ sort: 'company' }), frozen).map((a) => a.company)).toEqual([
      'Acme',
      'Zeta',
      'Mid',
    ]);
  });

  it('keeps showing a row whose status no longer matches the filter', () => {
    const rows = [app(), app()];
    const changed = [{ ...rows[0]!, status: 'screening' as const }, rows[1]!];
    expect(ids(run(changed, q({ statuses: ['applied'] })))).toEqual(['a2']);
    expect(
      ids(run(changed, q({ statuses: ['applied'] }), undefined, new Set(['a1']))).sort(),
    ).toEqual(['a1', 'a2']);
  });

  it('still filters', () => {
    const rows = [app(), app({ status: 'rejected' })];
    const frozen = rankOf(rows);
    expect(ids(run(rows, q({ statuses: CLOSED_STATUSES }), frozen))).toEqual(['a2']);
  });
});

describe('date applied filter', () => {
  const rows = () => [
    app({ appliedAt: '2026-10-11' }), // this week (Sunday)
    app({ appliedAt: '2026-10-05' }), // this month, last week
    app({ appliedAt: '2026-09-20' }), // last 30 days, last month
    app({ appliedAt: '2026-08-01' }), // older
    app({ status: 'saved', appliedAt: undefined }), // never applied
  ];

  it.each([
    ['any', ['a1', 'a2', 'a3', 'a4', 'a5']],
    ['this-week', ['a1']],
    ['this-month', ['a1', 'a2']],
    ['last-30-days', ['a1', 'a2', 'a3']],
  ] as const)('%s', (kind, expected) => {
    expect(ids(run(rows(), q({ dates: { kind }, sort: 'applied' }))).sort()).toEqual([...expected]);
  });

  it('a preset ignores Custom dates kept from before', () => {
    const kept = { kind: 'this-week' as const, from: '2026-08-01', to: '2026-08-31' };
    expect(ids(run(rows(), q({ dates: kept })))).toEqual(['a1']);
  });

  it('leaves out a malformed Date applied, like Stats does', () => {
    const list = [app({ appliedAt: '2026-10-1' }), app({ appliedAt: '2026-10-12' })];
    expect(ids(run(list, q({ dates: { kind: 'this-month' } })))).toEqual(['a2']);
  });

  it('Custom keeps both days, in either order', () => {
    const custom = { kind: 'custom' as const, from: '2026-10-05', to: '2026-09-20' };
    expect(ids(run(rows(), q({ dates: custom }))).sort()).toEqual(['a2', 'a3']);
  });

  it('an unfinished or invalid Custom range filters nothing yet', () => {
    expect(run(rows(), q({ dates: { kind: 'custom', from: '2026-10-01' } }))).toHaveLength(5);
    expect(
      dateFilterRange({ kind: 'custom', from: '2026-10-01', to: '2099-01-01' }, context),
    ).toBeUndefined();
  });

  it('follows the first day of the week', () => {
    const monday = { ...context, weekStartsOn: 1 as const };
    expect(dateFilterRange({ kind: 'this-week' }, monday)).toEqual({
      from: '2026-10-12',
      to: '2026-10-18',
    });
  });

  it('combines with the status filter and search', () => {
    const list = [
      app({ appliedAt: '2026-10-12', company: 'Acme' }),
      app({ appliedAt: '2026-10-12', company: 'Acme', status: 'rejected' }),
      app({ appliedAt: '2026-09-01', company: 'Acme' }),
    ];
    const query = q({ dates: { kind: 'this-week' }, statuses: ['applied'], search: 'acme' });
    expect(ids(run(list, query))).toEqual(['a1']);
  });
});

describe('status chips', () => {
  it('toggles one status, keeping the fixed order', () => {
    expect(toggleStatus([], 'offer')).toEqual(['offer']);
    expect(toggleStatus(['offer'], 'saved')).toEqual(['saved', 'offer']);
    expect(toggleStatus(['saved', 'offer'], 'saved')).toEqual(['offer']);
  });

  it('reports a group as all, some or none', () => {
    expect(groupState([], 'active')).toBe('none');
    expect(groupState(['applied'], 'active')).toBe('some');
    expect(groupState([...ACTIVE_STATUSES], 'active')).toBe('all');
    expect(groupState([...ACTIVE_STATUSES], 'closed')).toBe('none');
  });

  it('a group chip turns its statuses all on, or all off when they all were', () => {
    expect(toggleGroup(['offer', 'rejected'], 'active')).toEqual([
      'saved',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'rejected',
    ]);
    expect(toggleGroup([...ACTIVE_STATUSES, 'rejected'], 'active')).toEqual(['rejected']);
    // Some on: the press turns the rest on, rather than everything off.
    expect(groupState(toggleGroup(['applied'], 'closed'), 'closed')).toBe('all');
  });
});

describe('filter count and clearing', () => {
  it("doesn't count a Custom range until it's valid", () => {
    expect(activeFilterCount(q({ dates: { kind: 'custom' } }), context)).toBe(0);
    expect(activeFilterCount(q({ dates: { kind: 'custom', from: '2026-09-01' } }), context)).toBe(
      0,
    );
    const valid = { kind: 'custom' as const, from: '2026-09-01', to: '2026-09-30' };
    expect(activeFilterCount(q({ dates: valid }), context)).toBe(1);
  });

  it('counts a date range and a status filter, never the sort or search', () => {
    expect(activeFilterCount(q(), context)).toBe(0);
    expect(activeFilterCount(q({ sort: 'company', search: 'acme' }), context)).toBe(0);
    expect(activeFilterCount(q({ statuses: ['offer', 'saved'] }), context)).toBe(1);
    expect(
      activeFilterCount(q({ statuses: ['offer'], dates: { kind: 'this-week' } }), context),
    ).toBe(2);
  });

  it('clears the filters but keeps search and sort', () => {
    const query = q({
      search: 'acme',
      sort: 'company',
      statuses: ['offer'],
      dates: { kind: 'this-week' },
    });
    expect(withoutFilters(query)).toEqual(q({ search: 'acme', sort: 'company' }));
  });
});

describe('sameFiltersAndSort', () => {
  const base = { ...DEFAULT_QUERY, statuses: ['applied'] as Status[] };
  it('ignores the search, and Custom dates kept while a preset is picked', () => {
    expect(sameFiltersAndSort(base, { ...base, search: 'acme' })).toBe(true);
    expect(
      sameFiltersAndSort(base, {
        ...base,
        dates: { kind: 'any', from: '2026-09-01', to: '2026-09-30' },
      }),
    ).toBe(true);
  });
  it('sees a different sort, statuses, date filter or Custom range', () => {
    expect(sameFiltersAndSort(base, { ...base, sort: 'company' })).toBe(false);
    expect(sameFiltersAndSort(base, { ...base, statuses: ['applied', 'saved'] })).toBe(false);
    expect(sameFiltersAndSort(base, { ...base, statuses: [] })).toBe(false);
    expect(sameFiltersAndSort(base, { ...base, dates: { kind: 'this-week' } })).toBe(false);
    const custom = {
      ...base,
      dates: { kind: 'custom' as const, from: '2026-09-01', to: '2026-09-30' },
    };
    expect(sameFiltersAndSort(custom, { ...custom })).toBe(true);
    expect(
      sameFiltersAndSort(custom, { ...custom, dates: { ...custom.dates, to: '2026-10-01' } }),
    ).toBe(false);
  });
});

describe('source filter', () => {
  it('offers only used sources: built-ins in the form’s order, others A–Z, then Not set', () => {
    expect(
      sourceOptions([
        'Recruiter',
        'glassdoor',
        undefined,
        'Glassdoor ',
        'LinkedIn',
        'Wellfound',
        '  ',
        'Ángel list',
        'linkedin',
      ]),
    ).toEqual(['LinkedIn', 'Recruiter', 'Ángel list', 'glassdoor', 'Wellfound', NO_SOURCE]);
  });

  it('names a built-in by its own name however it was typed', () => {
    expect(sourceOptions(['company SITE'])).toEqual(['Company site']);
  });

  it('keeps a chosen source no one uses any more, so it can be turned off', () => {
    expect(sourceOptions(['LinkedIn'], ['Dice', NO_SOURCE])).toEqual([
      'LinkedIn',
      'Dice',
      NO_SOURCE,
    ]);
    expect(sourceOptions([])).toEqual([]);
  });

  it('toggles by folded key', () => {
    expect(toggleSource([], 'Glassdoor')).toEqual(['Glassdoor']);
    expect(toggleSource(['glassdoor'], 'Glassdoor')).toEqual([]);
    expect(toggleSource(['Glassdoor'], NO_SOURCE)).toEqual(['Glassdoor', NO_SOURCE]);
    expect(sourceKey(' Société  Générale ')).toBe('societe generale');
  });

  it('shows any of the chosen sources, Not set for none, and combines with other filters', () => {
    const linkedIn = app({ source: 'LinkedIn' });
    const glassdoor = app({ source: 'glassdoor' });
    const none = app();
    const savedLinkedIn = app({ source: 'linkedin', status: 'saved' });
    const all = [linkedIn, glassdoor, none, savedLinkedIn];
    const ids = (query: ListQuery) =>
      run(all, query)
        .map((a) => a.id)
        .sort();
    expect(ids(q({ sources: ['LinkedIn'] }))).toEqual([linkedIn.id, savedLinkedIn.id].sort());
    expect(ids(q({ sources: ['Glassdoor', NO_SOURCE] }))).toEqual([glassdoor.id, none.id].sort());
    expect(ids(q({ sources: ['LinkedIn'], statuses: ['saved'] }))).toEqual([savedLinkedIn.id]);
    expect(ids(q())).toHaveLength(4);
  });

  it('counts as one filter, is cleared with the others, and compares by key', () => {
    expect(activeFilterCount(q({ sources: ['LinkedIn', 'Dice'] }), context)).toBe(1);
    expect(activeFilterCount(q({ sources: ['Dice'], statuses: ['applied'] }), context)).toBe(2);
    expect(withoutFilters(q({ sources: ['Dice'] })).sources).toEqual([]);
    expect(
      sameFiltersAndSort(
        q({ sources: ['Dice', 'LinkedIn'] }),
        q({ sources: ['linkedin', 'DICE'] }),
      ),
    ).toBe(true);
    expect(sameFiltersAndSort(q({ sources: ['Dice'] }), q())).toBe(false);
    expect(sameFiltersAndSort(q({ sources: [NO_SOURCE] }), q())).toBe(false);
  });
});
