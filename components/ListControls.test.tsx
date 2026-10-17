import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addApplication, saveApplication, setStatus } from '@/lib/applications';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function seed() {
  const add = (company: string, extra: Record<string, string> = {}, at = '2026-10-01T10:00:00Z') =>
    saveApplication(
      { url: `https://${company.replace(/\W/g, '').toLowerCase()}.com/1`, company, ...extra },
      { allowDuplicate: true },
      undefined,
      new Date(at),
    );
  await add(
    'Acme',
    { title: 'C++ Engineer', location: 'Berlin', appliedAt: '2026-09-01' },
    '2026-10-01T10:00:00Z',
  );
  await add(
    'Société Générale',
    { title: 'Analyst', appliedAt: '2026-09-20' },
    '2026-10-02T10:00:00Z',
  );
  await add('beta', { status: 'saved', notes: 'Referred by Dana' }, '2026-10-03T10:00:00Z');
  await add('Gamma', { status: 'rejected', appliedAt: '2026-08-15' }, '2026-10-04T10:00:00Z');
}

/** Companies in list order. */
const rows = () =>
  within(screen.getByRole('list', { name: 'Applications' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.row-open')?.textContent);

/** The status chip on a company's row. */
const chipOf = (company: string) =>
  within(screen.getByRole('button', { name: new RegExp(`^${company}`) }).closest('li')!).getByRole(
    'button',
    { name: /^Status: / },
  );

type User = ReturnType<typeof userEvent.setup>;

async function renderList() {
  render(<App />);
  await screen.findByRole('list', { name: 'Applications' });
}

/** Opens the filter sheet and returns it. */
async function openFilters(user: User) {
  await user.click(screen.getByRole('button', { name: /^Filters/ }));
  return screen.getByRole('dialog', { name: 'Filter and sort' });
}

describe('List controls', () => {
  beforeEach(() => {
    // Sheets close at once, so tests don't wait for their slide.
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('sorts by last activity by default, and by date applied or company', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);
    const sheet = await openFilters(user);
    expect(within(sheet).getByRole('radio', { name: 'Last activity' })).toBeChecked();
    await user.click(within(sheet).getByRole('radio', { name: 'Date applied' }));
    expect(rows()).toEqual(['Société Générale', 'Acme', 'Gamma', 'beta']);
    await user.click(within(sheet).getByRole('radio', { name: 'Company' }));
    expect(rows()).toEqual(['Acme', 'beta', 'Gamma', 'Société Générale']);
    // Sort isn't a filter: no count, nothing hidden.
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('filters by status chips, several at once, and says how many show', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const sheet = await openFilters(user);
    const press = (name: string) => user.click(within(sheet).getByRole('button', { name }));

    await press('Closed');
    expect(rows()).toEqual(['Gamma']);
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters, 1 on' })).toBeInTheDocument();
    await press('Closed');
    await press('Active');
    expect(rows()).toEqual(['beta', 'Société Générale', 'Acme']);
    await press('Active');
    await press('Saved');
    expect(rows()).toEqual(['beta']);
    await press('Rejected');
    expect(rows()).toEqual(['Gamma', 'beta']);
  });

  it('shows a group as mixed when only part of it is on', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const sheet = await openFilters(user);
    const active = within(sheet).getByRole('button', { name: 'Active' });
    expect(active).toHaveAttribute('aria-pressed', 'false');
    await user.click(within(sheet).getByRole('button', { name: 'Saved' }));
    expect(active).toHaveAttribute('aria-pressed', 'mixed');
    // Pressing a mixed group turns the rest on.
    await user.click(active);
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Interviewing' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('filters by date applied, hiding jobs without one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 16, 15));
    try {
      await seed();
      const user = userEvent.setup();
      await renderList();
      const sheet = await openFilters(user);
      await user.click(within(sheet).getByRole('radio', { name: 'Last 30 days' }));
      expect(rows()).toEqual(['Société Générale']);
      expect(within(sheet).getByText(/Jobs without a date applied/)).toBeInTheDocument();

      await user.click(within(sheet).getByRole('radio', { name: 'Custom' }));
      // Starts from the last 30 days, already valid: no errors before anything is typed.
      const from = within(sheet).getByLabelText('From');
      const to = within(sheet).getByLabelText('To');
      expect(from).toHaveValue('2026-09-17');
      expect(to).toHaveValue('2026-10-16');
      expect(from).not.toHaveAttribute('aria-invalid');
      expect(rows()).toEqual(['Société Générale']);

      await user.clear(from);
      // Unfinished: filters nothing, and isn't counted.
      expect(rows()).toHaveLength(4);
      expect(from).toHaveAccessibleDescription('Enter a date.');
      expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
      expect(screen.queryByText(/^Showing/)).toBeNull();
      expect(within(sheet).queryByText(/Jobs without a date applied/)).toBeNull();

      await user.type(from, '2026-08-01');
      await user.clear(to);
      await user.type(to, '2026-09-05');
      expect(rows()).toEqual(['Gamma', 'Acme']);
      // A preset keeps the Custom range for later.
      await user.click(within(sheet).getByRole('radio', { name: 'This month' }));
      await user.click(within(sheet).getByRole('radio', { name: 'Custom' }));
      expect(within(sheet).getByLabelText('From')).toHaveValue('2026-08-01');
      expect(within(sheet).getByLabelText('To')).toHaveValue('2026-09-05');
      expect(screen.getByRole('button', { name: 'Filters, 1 on' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Reset clears the filters and sort; Done and Escape close the sheet', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    let sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('radio', { name: 'Company' }));
    await user.click(within(sheet).getByRole('button', { name: 'Closed' }));
    await user.click(within(sheet).getByRole('radio', { name: 'This week' }));
    expect(screen.getByRole('button', { name: 'Filters, 2 on' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Reset' }));
    expect(within(sheet).getByRole('radio', { name: 'Last activity' })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(within(sheet).getByRole('button', { name: 'Reset' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(sheet).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();

    sheet = await openFilters(user);
    await user.keyboard('{Escape}');
    expect(sheet).not.toHaveAttribute('open');
  });

  it('searches company, title, location and notes, ignoring accents', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const search = screen.getByLabelText('Search');
    await user.type(search, 'societe');
    expect(rows()).toEqual(['Société Générale']);
    await user.clear(search);
    await user.type(search, 'c++ berlin');
    expect(rows()).toEqual(['Acme']);
    await user.clear(search);
    await user.type(search, 'dana');
    expect(rows()).toEqual(['beta']);
  });

  it('says when nothing matches, separately from an empty list, and clears', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('button', { name: 'Offer' }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.getByText('No applications match.')).toBeInTheDocument();
    expect(screen.queryByText(/No applications yet/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('the Showing line has its own Clear, which keeps the sort', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('radio', { name: 'Company' }));
    await user.click(within(sheet).getByRole('button', { name: 'Closed' }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    await user.type(screen.getByLabelText('Search'), 'gam');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(rows()).toEqual(['Acme', 'beta', 'Gamma', 'Société Générale']);
    expect(screen.queryByText(/^Showing/)).toBeNull();
  });

  it('keeps search and filters after opening a job and coming back', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.type(screen.getByLabelText('Search'), 'acme');
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: '← Back to applications' }));
    await screen.findByRole('list', { name: 'Applications' });
    expect(screen.getByLabelText('Search')).toHaveValue('acme');
    expect(rows()).toEqual(['Acme']);
  });

  it('keeps a row in place when its status changes, until the list is shown again', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);
    const acme = (await db.applications.toArray()).find((a) => a.company === 'Acme')!;
    await act(async () => {
      await setStatus(acme.id, 'screening', {}, undefined, new Date('2026-10-10T10:00:00Z'));
    });
    await waitFor(() => expect(chipOf('Acme')).toHaveTextContent('Screening'));
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);

    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: '← Back to applications' }));
    await screen.findByRole('list', { name: 'Applications' });
    expect(rows()).toEqual(['Acme', 'Gamma', 'beta', 'Société Générale']);
  });

  it('shows a newly added job at the top even while the order is frozen', async () => {
    await seed();
    await renderList();
    await act(async () => {
      await addApplication({ url: 'https://new.com/1', company: 'Newco' });
    });
    await waitFor(() => expect(rows()[0]).toBe('Newco'));
  });

  it('keeps a row whose status changes under a status filter, with focus on its chip', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    let sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('button', { name: 'Applied' }));
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(rows()).toEqual(['Société Générale', 'Acme']);
    const chip = chipOf('Acme');
    await user.click(chip);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Change status' })).getByRole('button', {
        name: 'Offer',
      }),
    );
    await waitFor(() => expect(chip).toHaveTextContent('Offer'));
    expect(rows()).toEqual(['Société Générale', 'Acme']);
    expect(chip).toHaveFocus();
    // Changing the query refreshes membership.
    sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('button', { name: 'Applied' }));
    await user.click(within(sheet).getByRole('button', { name: 'Applied' }));
    expect(rows()).toEqual(['Société Générale']);
  });

  it('keeps focus in the controls after Clear search and filters', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.type(screen.getByLabelText('Search'), 'nothing matches this');
    await user.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByLabelText('Search')).toHaveFocus();
  });

  it("doesn't leave focus waiting for a restored row the search hides", async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.click(screen.getByRole('button', { name: /^Gamma/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.type(await screen.findByLabelText('Search'), 'acme');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add application' })).toHaveFocus(),
    );
    await user.clear(screen.getByLabelText('Search'));
    expect(screen.getByRole('button', { name: /^Gamma/ })).not.toHaveFocus();
  });
});

describe('List rows', () => {
  it('shows the company with its status, then where, the title and the date', async () => {
    await saveApplication(
      {
        url: 'https://acme.com/1',
        company: 'Acme Corporation International',
        title: 'Senior Backend Engineer',
        location: 'Berlin',
        workMode: 'remote',
        appliedAt: '2026-10-01',
      },
      { allowDuplicate: true },
    );
    await saveApplication({ url: 'https://beta.com/1', company: 'Beta', status: 'saved' }, {});
    await renderList();
    const acme = screen.getByRole('button', {
      name: 'Acme Corporation International, Senior Backend Engineer',
    });
    // Its full name on hover, when the row cuts it off.
    expect(acme).toHaveAttribute('title', 'Acme Corporation International');
    const row = acme.closest('li')!;
    expect(row).toHaveTextContent('Berlin · Remote');
    expect(row).toHaveTextContent('Applied Oct 1, 2026');
    expect(within(row).getByRole('link', { name: /^Open job posting for Acme/ })).toHaveAttribute(
      'href',
      'https://acme.com/1',
    );
    // No date applied: when it was logged instead.
    expect(screen.getByRole('button', { name: 'Beta' }).closest('li')).toHaveTextContent(/Added /);
  });

  it('opens from anywhere on the card, but the chip and link keep their own actions', async () => {
    await saveApplication({ url: 'https://acme.com/1', company: 'Acme' }, {});
    const user = userEvent.setup();
    await renderList();
    await user.click(chipOf('Acme'));
    expect(screen.getByRole('dialog', { name: 'Change status' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Acme' })).toBeNull();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();
  });

  it("shows a URL that isn't a web link as text, never as a link", async () => {
    await saveApplication({ url: 'https://acme.com/1', company: 'Acme' }, {});
    const stored = (await db.applications.toArray())[0]!;
    // As an old or imported row might have it.
    await db.applications.update(stored.id, { url: 'file:///C:/jobs/acme.html' });
    await renderList();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Acme/ }).closest('li')).toHaveTextContent(
        'file:///C:/jobs/acme.html',
      ),
    );
    expect(screen.queryByRole('link', { name: /Open job posting/ })).toBeNull();
  });
});
