import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addApplication, saveApplication, setStatus } from '@/lib/applications';
import { db } from '@/lib/db';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDraft, draftKey } from '@/lib/captureDraft';
import App from '@/entrypoints/sidepanel/App';
import { SEARCH_DEBOUNCE_MS } from './useDebouncedSearch';

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

/** Applies the sheet's choices (only Apply changes the list, spec §4.4). */
async function apply(user: User, sheet: HTMLElement) {
  await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
}

/** Opens the sheet, presses each named chip or radio, and applies. */
async function filterBy(user: User, ...names: string[]) {
  const sheet = await openFilters(user);
  for (const name of names) {
    const control =
      within(sheet).queryByRole('radio', { name }) ?? within(sheet).getByRole('button', { name });
    await user.click(control);
  }
  await apply(user, sheet);
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
    await apply(user, sheet);
    expect(rows()).toEqual(['Société Générale', 'Acme', 'Gamma', 'beta']);
    await filterBy(user, 'Company');
    expect(rows()).toEqual(['Acme', 'beta', 'Gamma', 'Société Générale']);
    // Sort isn't a filter: no count, nothing hidden.
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('filters by status chips, several at once, and says how many show', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await filterBy(user, 'Closed');
    expect(rows()).toEqual(['Gamma']);
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters, 1 on' })).toBeInTheDocument();
    await filterBy(user, 'Closed', 'Active');
    expect(rows()).toEqual(['beta', 'Société Générale', 'Acme']);
    await filterBy(user, 'Active', 'Saved');
    expect(rows()).toEqual(['beta']);
    await filterBy(user, 'Rejected');
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
      let sheet = await openFilters(user);
      await user.click(within(sheet).getByRole('radio', { name: 'Last 30 days' }));
      expect(within(sheet).getByText(/Jobs without a date applied/)).toBeInTheDocument();
      await apply(user, sheet);
      expect(rows()).toEqual(['Société Générale']);

      sheet = await openFilters(user);
      await user.click(within(sheet).getByRole('radio', { name: 'Custom' }));
      // Starts from the last 30 days, already valid: no errors before anything is typed.
      const from = within(sheet).getByLabelText('From');
      const to = within(sheet).getByLabelText('To');
      expect(from).toHaveValue('2026-09-17');
      expect(to).toHaveValue('2026-10-16');
      expect(from).not.toHaveAttribute('aria-invalid');

      await user.clear(from);
      expect(from).toHaveAccessibleDescription('Enter a date.');
      expect(within(sheet).queryByText(/Jobs without a date applied/)).toBeNull();
      // An unfinished range isn't applied: the sheet stays open on the date that's wrong.
      await user.click(to);
      await apply(user, sheet);
      expect(sheet).toHaveAttribute('open');
      expect(from).toHaveFocus();
      // The list keeps what was applied before (Last 30 days).
      expect(rows()).toEqual(['Société Générale']);

      await user.type(within(sheet).getByLabelText('From'), '2026-08-01');
      await user.clear(within(sheet).getByLabelText('To'));
      await user.type(within(sheet).getByLabelText('To'), '2026-09-05');
      await apply(user, sheet);
      expect(rows()).toEqual(['Gamma', 'Acme']);
      // A preset keeps the Custom range for later.
      sheet = await openFilters(user);
      await user.click(within(sheet).getByRole('radio', { name: 'This month' }));
      await user.click(within(sheet).getByRole('radio', { name: 'Custom' }));
      expect(within(sheet).getByLabelText('From')).toHaveValue('2026-08-01');
      expect(within(sheet).getByLabelText('To')).toHaveValue('2026-09-05');
      await apply(user, sheet);
      expect(screen.getByRole('button', { name: 'Filters, 1 on' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('changes nothing until Apply; Escape or a click outside discards the choices', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    let sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('radio', { name: 'Company' }));
    await user.click(within(sheet).getByRole('button', { name: 'Closed' }));
    // Still a draft: the list and the button's count are as they were.
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);
    expect(screen.getByRole('button', { name: 'Filters', hidden: true })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(sheet).not.toHaveAttribute('open');
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();

    // Reopened, it starts from what the list shows, not the discarded draft.
    sheet = await openFilters(user);
    expect(within(sheet).getByRole('radio', { name: 'Last activity' })).toBeChecked();
    expect(within(sheet).getByRole('button', { name: 'Closed' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(within(sheet).getByRole('button', { name: 'Closed' }));
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(rows()).toHaveLength(4);
  });

  it('Reset clears the choices, applied only with Apply', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await filterBy(user, 'Company', 'Closed', 'This week');
    expect(screen.getByRole('button', { name: 'Filters, 2 on' })).toBeInTheDocument();
    const sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('button', { name: 'Reset' }));
    expect(within(sheet).getByRole('radio', { name: 'Last activity' })).toBeChecked();
    expect(within(sheet).getByRole('radio', { name: 'Any time' })).toBeChecked();
    expect(within(sheet).getByRole('button', { name: 'Reset' })).toBeDisabled();
    // Not yet applied.
    expect(screen.getByRole('button', { name: 'Filters, 2 on', hidden: true })).toBeInTheDocument();
    await apply(user, sheet);
    expect(sheet).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveFocus();
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);
  });

  it('Apply keeps the search, which the sheet leaves alone', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.type(screen.getByLabelText('Search'), 'a');
    await filterBy(user, 'Active');
    expect(screen.getByLabelText('Search')).toHaveValue('a');
    expect(rows()).toEqual(['beta', 'Société Générale', 'Acme']);
  });

  it('slides the sort marker to the chosen option', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const sheet = await openFilters(user);
    const marker = sheet.querySelector<HTMLElement>('[data-marker]')!;
    expect(marker.style.transform).toBe('translateX(calc(0 * (100% + var(--seg-gap))))');
    await user.click(within(sheet).getByRole('radio', { name: 'Company' }));
    expect(marker.style.transform).toBe('translateX(calc(2 * (100% + var(--seg-gap))))');
    expect(marker).toHaveAttribute('aria-hidden', 'true');
  });

  it("an Apply that changes nothing in effect doesn't refresh the frozen list", async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await filterBy(user, 'Applied');
    expect(rows()).toEqual(['Société Générale', 'Acme']);
    const acme = (await db.applications.toArray()).find((a) => a.company === 'Acme')!;
    await act(async () => {
      await setStatus(acme.id, 'offer');
    });
    await waitFor(() => expect(chipOf('Acme')).toHaveTextContent('Offer'));
    // Custom then back to Any time leaves Custom dates behind, with the same effect.
    await filterBy(user, 'Custom', 'Any time');
    expect(rows()).toEqual(['Société Générale', 'Acme']);
  });

  it('a capture closes the filter sheet, its draft discarded', async () => {
    await seed();
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({
      id: 3,
    } satisfies Partial<Browser.windows.Window> as never);
    const user = userEvent.setup();
    await renderList();
    const sheet = await openFilters(user);
    await user.click(within(sheet).getByRole('button', { name: 'Closed' }));
    await act(async () => {
      await fakeBrowser.storage.session.set({
        [draftKey(3)]: createDraft('page', { url: 'https://acme.com/new' }),
      });
    });
    expect(await screen.findByRole('dialog', { name: 'Add application' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Filter and sort' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rows()).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('searches company, title, location and notes, ignoring accents', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    const search = screen.getByLabelText('Search');
    await user.type(search, 'societe');
    // The list filters once typing pauses, not per keystroke.
    expect(rows()).toHaveLength(4);
    await waitFor(() => expect(rows()).toEqual(['Société Générale']));
    // Clearing shows everything at once.
    await user.clear(search);
    expect(rows()).toHaveLength(4);
    await user.type(search, 'c++ berlin');
    await waitFor(() => expect(rows()).toEqual(['Acme']));
    await user.clear(search);
    await user.type(search, 'dana');
    await waitFor(() => expect(rows()).toEqual(['beta']));
  });

  it('says when nothing matches, separately from an empty list, and clears', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await filterBy(user, 'Offer');
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
    await filterBy(user, 'Company', 'Closed');
    // Cleared before the search has even applied: the box empties and nothing applies later.
    await user.type(screen.getByLabelText('Search'), 'gam');
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(rows()).toEqual(['Acme', 'beta', 'Gamma', 'Société Générale']);
    expect(screen.queryByText(/^Showing/)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50));
    expect(rows()).toEqual(['Acme', 'beta', 'Gamma', 'Société Générale']);
  });

  it('keeps search and filters after opening a job and coming back', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.type(screen.getByLabelText('Search'), 'acme');
    await waitFor(() => expect(rows()).toEqual(['Acme']));
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Back to applications' }));
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
    await user.click(await screen.findByRole('button', { name: 'Back to applications' }));
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
    await filterBy(user, 'Applied');
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
    await filterBy(user, 'Saved');
    expect(rows()).toEqual(['beta', 'Société Générale']);
  });

  it('keeps focus in the controls after Clear search and filters', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.type(screen.getByLabelText('Search'), 'nothing matches this');
    await user.click(await screen.findByRole('button', { name: 'Clear search and filters' }));
    expect(screen.getByLabelText('Search')).toHaveFocus();
  });

  it("doesn't leave focus waiting for a restored row the search hides", async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.click(screen.getByRole('button', { name: /^Gamma/ }));
    await user.click(await screen.findByRole('button', { name: /^More actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.type(await screen.findByLabelText('Search'), 'acme');
    await waitFor(() => expect(rows()).toEqual(['Acme']));
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
