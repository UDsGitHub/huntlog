import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as applications from '@/lib/applications';
import { addApplication, softDeleteApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import { chooseSource } from '@/tests/formHelpers';
import App from '@/entrypoints/sidepanel/App';
import { postingSite } from './ApplicationDetail';

beforeEach(async () => {
  // Sheets open and close at once, so focus and views settle without waiting for a slide.
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function seed() {
  return addApplication({
    url: 'https://acme.com/jobs/1',
    company: 'Acme',
    title: 'Senior Engineer',
    location: 'Berlin',
    workMode: 'hybrid',
    salaryMin: 85000,
    salaryMax: 95000,
    salaryCurrency: 'EUR',
    salaryPeriod: 'year',
    source: 'Referral',
    notes: 'Met the team\n<b>not bold</b>',
    appliedAt: '2026-10-01',
  });
}

async function openDetail(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  const list = await screen.findByRole('list', { name: 'Applications' });
  await user.click(within(list).getByRole('button', { name: /Acme/ }));
  return screen.findByRole('heading', { level: 2, name: 'Acme' });
}

/** Leaves the form with its Back button, confirming the discard when something was typed. */
async function leaveForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Back' }));
  const discard = screen.queryByRole('button', { name: 'Discard' });
  if (discard) await user.click(discard);
}

describe('Detail view', () => {
  it('shows every field and focuses the heading', async () => {
    await seed();
    const user = userEvent.setup();
    const heading = await openDetail(user);
    expect(heading).toHaveFocus();
    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
    // The posting as a button naming its site.
    const posting = screen.getByRole('link', { name: 'Open job posting on acme.com' });
    expect(posting).toHaveAttribute('href', 'https://acme.com/jobs/1');
    expect(posting).toHaveTextContent('acme.com');
    // The header: Back, Edit as a pencil, and Delete tucked in a ⋯ menu.
    expect(screen.getByRole('button', { name: 'Back to applications' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'More actions for Acme' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    const terms = Object.fromEntries(
      screen.getAllByRole('term').map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
    );
    expect(terms).toMatchObject({
      Status: 'Applied',
      'Date applied': 'Oct 1, 2026',
      Location: 'Berlin',
      'Work mode': 'Hybrid',
      Salary: '€85,000–€95,000 per year',
      Source: 'Referral',
    });
  });

  it('shows notes as plain text with line breaks, never as markup', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    const notes = screen.getByText(/Met the team/);
    expect(notes.textContent).toBe('Met the team\n<b>not bold</b>');
    expect(notes.querySelector('b')).toBeNull();
    expect(notes).toHaveClass('whitespace-pre-wrap');
  });

  it('leaves out empty optional fields', async () => {
    await addApplication({ url: 'https://beta.com/1', company: 'Beta' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Beta/ }));
    // The detail view loads asynchronously; wait for it before reading it.
    await screen.findByRole('heading', { level: 2, name: 'Beta' });
    const terms = screen.getAllByRole('term').map((dt) => dt.textContent);
    expect(terms).toEqual(['Status', 'Date applied', 'Added']);
    expect(screen.queryByRole('heading', { name: 'Notes' })).toBeNull();
  });

  it('Back returns to the list with focus on the same row', async () => {
    await seed();
    await addApplication({ url: 'https://beta.com/1', company: 'Beta' });
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Back to applications' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());
  });

  it('Escape goes back to the list too, but closes only an open menu first', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'More actions for Acme' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();

    // With focus anywhere on the page, or on nothing (after a click on plain text).
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());
  });

  it("a held Escape that closed the menu doesn't then leave the page", async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'More actions for Acme' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    // The key's auto-repeat, now that the menu has gone.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape', repeat: true });
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();
  });

  it('Escape does nothing while another tab is showing', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('tab', { name: /Stats/ }));
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('tab', { name: /Applications/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();
  });

  it('says so when the application was deleted in another window', async () => {
    const app = await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await act(async () => {
      await softDeleteApplication(app.id);
    });
    expect(
      await screen.findByRole('heading', { name: "This application isn't available" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back to applications' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add application' })).toHaveFocus(),
    );
  });
});

describe('Edit', () => {
  it('starts with the stored values, saves changes and returns focus to Edit', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('form', { name: 'Edit application' })).toBeInTheDocument();
    expect(screen.getByLabelText('Company')).toHaveValue('Acme');
    expect(screen.getByLabelText(/Location/)).toHaveValue('Berlin');
    // Shown grouped, as the number field shows it once left.
    expect(screen.getByLabelText('Minimum')).toHaveValue('85,000');
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR · Euro');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Met the team\n<b>not bold</b>');

    await user.clear(screen.getByLabelText(/Location/));
    await user.type(screen.getByLabelText(/Location/), 'Remote');
    await chooseSource(user, '');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('heading', { level: 2, name: 'Acme' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Saved changes.');
    const [saved] = await db.applications.toArray();
    expect(saved?.location).toBe('Remote');
    expect(saved).not.toHaveProperty('source');
  });

  it('saves with ⌘/Ctrl+Enter, without Escape on the form leaving the detail view', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.type(screen.getByLabelText('Company'), ' Corp');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await db.applications.toArray())[0]?.company).toBe('Acme Corp');

    // Escape in a form closes just the form: the detail view stays.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect(screen.getByRole('heading', { level: 2, name: 'Acme Corp' })).toBeInTheDocument();
  });

  it('Cancel goes back to the detail view without saving', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Company'));
    await user.type(screen.getByLabelText('Company'), 'Changed');
    await leaveForm(user);

    await screen.findByRole('heading', { level: 2, name: 'Acme' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await db.applications.toArray())[0]?.company).toBe('Acme');
  });

  it('shows field errors and keeps the form', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Company'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Company')).toHaveAccessibleDescription(
        'Enter the company name.',
      ),
    );
    expect(screen.getByLabelText('Company')).toHaveFocus();
  });

  it('explains when the application was deleted while being edited', async () => {
    const app = await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await act(async () => {
      await softDeleteApplication(app.id);
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This application was deleted, so the changes can't be saved.",
    );
  });

  it('shows a salary with decimals in the locale format', async () => {
    await addApplication({
      url: 'https://acme.com/2',
      company: 'Hourly',
      salaryMin: 45.5,
      salaryPeriod: 'hour',
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /Hourly/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Minimum')).toHaveValue('45.5');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 2, name: 'Hourly' });
    expect((await db.applications.toArray())[0]?.salaryMin).toBe(45.5);
  });
});

describe('Delete', () => {
  it('soft-deletes, returns to the list and offers Undo', async () => {
    const app = await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(await screen.findByRole('button', { name: /^More actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));

    expect(await screen.findByText('Deleted Acme.')).toBeInTheDocument();
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add application' })).toHaveFocus(),
    );
    expect((await db.applications.get(app.id))?.deletedAt).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('Acme');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Restored Acme.'));
    expect(await db.applications.get(app.id)).not.toHaveProperty('deletedAt');
  });

  it('stays deleted once the toast is gone', async () => {
    const app = await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(await screen.findByRole('button', { name: /^More actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByText('Deleted Acme.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect((await db.applications.get(app.id))?.deletedAt).toBeDefined();
  });
});

describe('focus after the review fixes', () => {
  it('Undo puts focus on the restored row; Dismiss puts it on + Add application', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(await screen.findByRole('button', { name: /^More actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());

    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: /^More actions for/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add application' })).toHaveFocus(),
    );
  });

  it("doesn't replay an old row focus when the list shows again later", async () => {
    await seed();
    await addApplication({ url: 'https://beta.com/1', company: 'Beta' });
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Back to applications' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());

    const focused: string[] = [];
    document.addEventListener('focusin', (e) =>
      focused.push((e.target as HTMLElement).textContent ?? ''),
    );
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    await leaveForm(user);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add application' })).toHaveFocus(),
    );
    expect(focused.some((text) => text.startsWith('Acme'))).toBe(false);
  });

  it('falls back to the heading when returning from an edit of a deleted row', async () => {
    const app = await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await act(async () => {
      await softDeleteApplication(app.id);
    });
    await leaveForm(user);
    expect(
      await screen.findByRole('heading', { name: "This application isn't available" }),
    ).toHaveFocus();
  });

  it('offers a way back when the row to edit is already gone', async () => {
    const app = await seed();
    const user = userEvent.setup();
    await openDetail(user);
    vi.spyOn(applications, 'getApplication').mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    // A sheet with nothing to edit focuses its Back button.
    const back = await screen.findByRole('button', { name: 'Back' });
    expect(back).toHaveFocus();
    expect(screen.getByText("This application isn't available any more.")).toBeInTheDocument();
    await user.click(back);
    expect(await screen.findByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();
    expect(app.id).toBeTruthy();
  });
});

describe('postingSite', () => {
  it.each([
    ['https://www.boards.greenhouse.io/acme/1', 'boards.greenhouse.io'],
    ['https://jobs.xn--mnchen-3ya.de/42', 'jobs.münchen.de'],
    ['http://acme.com:8080/jobs', 'acme.com'],
  ])('%s → %s', (href, site) => {
    expect(postingSite(href)).toBe(site);
  });
});
