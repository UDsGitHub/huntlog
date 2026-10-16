import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addApplication, softDeleteApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
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

describe('Detail view', () => {
  it('shows every field and focuses the heading', async () => {
    await seed();
    const user = userEvent.setup();
    const heading = await openDetail(user);
    expect(heading).toHaveFocus();
    expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open job posting' })).toHaveAttribute(
      'href',
      'https://acme.com/jobs/1',
    );
    const terms = Object.fromEntries(
      screen.getAllByRole('term').map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
    );
    expect(terms).toMatchObject({
      Status: 'Applied',
      'Date applied': '2026-10-01',
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
    await user.click(screen.getByRole('button', { name: '← Back to applications' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());
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
    await user.click(screen.getByRole('button', { name: '← Back to applications' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add application' })).toHaveFocus(),
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
    expect(screen.getByLabelText('Minimum')).toHaveValue('85000');
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Met the team\n<b>not bold</b>');

    await user.clear(screen.getByLabelText(/Location/));
    await user.type(screen.getByLabelText(/Location/), 'Remote');
    await user.clear(screen.getByLabelText(/Source/));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('heading', { level: 2, name: 'Acme' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('Saved changes.');
    const [saved] = await db.applications.toArray();
    expect(saved?.location).toBe('Remote');
    expect(saved).not.toHaveProperty('source');
  });

  it('Cancel goes back to the detail view without saving', async () => {
    await seed();
    const user = userEvent.setup();
    await openDetail(user);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Company'));
    await user.type(screen.getByLabelText('Company'), 'Changed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

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
    expect(screen.getByLabelText('Company')).toHaveAccessibleDescription('Enter the company name.');
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
    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Deleted Acme.')).toBeInTheDocument();
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add application' })).toHaveFocus(),
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
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Deleted Acme.');
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect((await db.applications.get(app.id))?.deletedAt).toBeDefined();
  });
});
