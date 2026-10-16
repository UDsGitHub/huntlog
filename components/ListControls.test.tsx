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

/** Companies in list order: each row's open button starts with the company name. */
const rows = () =>
  within(screen.getByRole('list', { name: 'Applications' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('button span')?.textContent);

async function renderList() {
  render(<App />);
  await screen.findByRole('list', { name: 'Applications' });
}

describe('List controls', () => {
  it('sorts by last activity by default, and by date applied or company', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    expect(rows()).toEqual(['Gamma', 'beta', 'Société Générale', 'Acme']);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'applied');
    expect(rows()).toEqual(['Société Générale', 'Acme', 'Gamma', 'beta']);
    await user.selectOptions(screen.getByLabelText('Sort by'), 'company');
    expect(rows()).toEqual(['Acme', 'beta', 'Gamma', 'Société Générale']);
  });

  it('filters by Active, Closed and a single status, and says how many show', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.selectOptions(screen.getByLabelText('Show'), 'closed');
    expect(rows()).toEqual(['Gamma']);
    expect(screen.getByText('Showing 1 of 4')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), 'active');
    expect(rows()).toEqual(['beta', 'Société Générale', 'Acme']);
    await user.selectOptions(screen.getByLabelText('Show'), 'saved');
    expect(rows()).toEqual(['beta']);
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
    await user.selectOptions(screen.getByLabelText('Show'), 'offer');
    expect(screen.getByText('No applications match.')).toBeInTheDocument();
    expect(screen.queryByText(/No applications yet/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear search and filter' }));
    expect(rows()).toHaveLength(4);
    expect(screen.getByLabelText('Show')).toHaveValue('all');
  });

  it('keeps search and filter after opening a job and coming back', async () => {
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
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: /^Acme/ }).parentElement!).getByRole('button', {
          name: /^Status: Screening/,
        }),
      ).toBeInTheDocument(),
    );
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
    await user.selectOptions(screen.getByLabelText('Show'), 'applied');
    expect(rows()).toEqual(['Société Générale', 'Acme']);
    const chip = within(screen.getByRole('button', { name: /^Acme/ }).parentElement!).getByRole(
      'button',
      { name: /^Status: / },
    );
    await user.click(chip);
    await user.click(screen.getByRole('menuitemradio', { name: 'Offer' }));
    await waitFor(() => expect(chip).toHaveTextContent('Offer'));
    expect(rows()).toEqual(['Société Générale', 'Acme']);
    expect(chip).toHaveFocus();
    // Changing the query refreshes membership.
    await user.selectOptions(screen.getByLabelText('Show'), 'all');
    await user.selectOptions(screen.getByLabelText('Show'), 'applied');
    expect(rows()).toEqual(['Société Générale']);
  });

  it('keeps focus in the controls after Clear search and filter', async () => {
    await seed();
    const user = userEvent.setup();
    await renderList();
    await user.type(screen.getByLabelText('Search'), 'nothing matches this');
    await user.click(screen.getByRole('button', { name: 'Clear search and filter' }));
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
