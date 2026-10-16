import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

type User = ReturnType<typeof userEvent.setup>;
const dateHidden = () => screen.getByLabelText(/Date applied/).closest('[hidden]') !== null;

async function openAdd(user: User) {
  render(<App />);
  await screen.findByText(/No applications yet/);
  await user.click(screen.getByRole('button', { name: 'Add application' }));
}

describe('Status in the form', () => {
  it('sits in the top section, defaults to Applied, grouped Active and Closed', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    const status = screen.getByLabelText('Status');
    expect(status).toHaveValue('applied');
    expect(status.closest('[hidden]')).toBeNull();
    const groups = [...status.querySelectorAll('optgroup')].map((g) => [
      g.label,
      [...g.querySelectorAll('option')].map((o) => o.value),
    ]);
    expect(groups).toEqual([
      ['Active', ['saved', 'applied', 'screening', 'interviewing', 'offer']],
      ['Closed', ['accepted', 'rejected', 'withdrawn', 'ghosted']],
    ]);
  });

  it('logs a job as Saved, with Date applied hidden and not stored', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.selectOptions(screen.getByLabelText('Status'), 'saved');
    expect(dateHidden()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByRole('button', { name: /^Acme/ });
    const [saved] = await db.applications.toArray();
    expect(saved?.status).toBe('saved');
    expect(saved).not.toHaveProperty('appliedAt');
    expect(saved?.statusHistory.map((e) => e.status)).toEqual(['saved']);
  });

  it('shows Date applied again, as optional, for Withdrawn', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.selectOptions(screen.getByLabelText('Status'), 'withdrawn');
    expect(dateHidden()).toBe(false);
    expect(screen.getByText('Date applied').parentElement).toHaveTextContent('(optional)');
  });

  it('requires Date applied for other statuses', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.selectOptions(screen.getByLabelText('Status'), 'interviewing');
    await user.clear(screen.getByLabelText(/Date applied/));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText(/Date applied/)).toHaveFocus());
  });

  it('records a status changed in Edit in the history', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Status')).toHaveValue('applied');
    await user.selectOptions(screen.getByLabelText('Status'), 'interviewing');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const detail = await screen.findByRole('region', { name: 'Acme' });
    await waitFor(() =>
      expect(
        within(detail).getByRole('button', { name: /^Status: Interviewing/ }),
      ).toBeInTheDocument(),
    );
    const stored = await db.applications.get(app.id);
    expect(stored?.statusHistory.map((e) => e.status)).toEqual(['applied', 'interviewing']);
  });

  it('keeps the stored date when an existing job is switched to Saved', async () => {
    const app = await addApplication({
      url: 'https://acme.com/1',
      company: 'Acme',
      appliedAt: '2026-09-01',
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'saved');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await db.applications.get(app.id))?.appliedAt).toBe('2026-09-01');
  });

  it('sets today when a dateless Saved job is moved to Applied in Edit', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { status: 'saved', appliedAt: undefined });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'applied');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await db.applications.get(app.id))?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lets a job whose date was skipped be edited without adding one', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { status: 'screening', appliedAt: undefined });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: /More details/ }));
    await user.type(screen.getByLabelText(/Notes/), 'Phone screen Tuesday');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await db.applications.get(app.id))?.notes).toBe('Phone screen Tuesday');
  });
});
