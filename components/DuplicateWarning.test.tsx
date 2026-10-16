import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addApplication, softDeleteApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

type User = ReturnType<typeof userEvent.setup>;
const WARNING = 'You may have logged this already';

async function fillAndSave(user: User, fields: { url: string; company: string; title?: string }) {
  await user.click(await screen.findByRole('button', { name: '+ Add application' }));
  await user.type(screen.getByLabelText('Job posting URL'), fields.url);
  await user.type(screen.getByLabelText('Company'), fields.company);
  if (fields.title) await user.type(screen.getByLabelText(/Job title/), fields.title);
  await user.click(screen.getByRole('button', { name: 'Save' }));
}

const existing = () =>
  addApplication({
    url: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
    company: 'Acme',
    title: 'Senior Engineer',
    appliedAt: '2026-10-01',
  });

describe('Duplicate warning', () => {
  it('warns about a URL that differs only in tracking, and saves nothing yet', async () => {
    await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, {
      url: 'http://boards.greenhouse.io/acme/jobs/1/?utm_source=linkedin&gh_jid=1',
      company: 'Someone',
    });

    const warning = await screen.findByRole('group', { name: 'You may have logged this already' });
    expect(warning).toHaveTextContent('Acme · Senior Engineer, applied 2026-10-01');
    expect(warning).toHaveTextContent('Same job posting URL');
    expect(warning).toHaveFocus();
    expect(await db.applications.count()).toBe(1);
  });

  it('warns about the same company and title, ignoring case and spacing', async () => {
    await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, {
      url: 'https://acme.com/careers/42',
      company: '  ACME ',
      title: 'senior   engineer',
    });
    expect(await screen.findByRole('group', { name: WARNING })).toHaveTextContent(
      'Same company and title',
    );
  });

  it("doesn't warn about a different role at the same company", async () => {
    await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, { url: 'https://acme.com/2', company: 'Acme', title: 'Designer' });
    await screen.findByRole('button', { name: /Designer/ });
    expect(screen.queryByRole('group', { name: WARNING })).toBeNull();
  });

  it("doesn't warn about a soft-deleted application", async () => {
    const app = await existing();
    await softDeleteApplication(app.id);
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, { url: app.url, company: 'Acme', title: 'Senior Engineer' });
    expect(await screen.findByRole('list', { name: 'Applications' })).toHaveTextContent('Acme');
    expect(screen.queryByRole('group', { name: WARNING })).toBeNull();
  });

  it('Save anyway saves a second application', async () => {
    const app = await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, { url: app.url, company: 'Acme Again' });
    await user.click(await screen.findByRole('button', { name: 'Save anyway' }));

    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('Acme Again');
    expect(await db.applications.count()).toBe(2);
  });

  it('View existing opens the existing application and drops the new entry', async () => {
    await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, {
      url: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
      company: 'Duplicate Co',
    });
    await user.click(await screen.findByRole('button', { name: 'View existing' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Acme' })).toHaveFocus();
    expect(await db.applications.count()).toBe(1);
    await user.click(screen.getByRole('button', { name: '← Back to applications' }));
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    expect(screen.getByLabelText('Company')).toHaveValue('');
  });

  it('counts further matches', async () => {
    await existing();
    await addApplication({
      url: 'https://acme.com/other',
      company: 'Acme',
      title: 'Senior Engineer',
    });
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, {
      url: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
      company: 'Acme',
      title: 'Senior Engineer',
    });
    expect(await screen.findByRole('group', { name: WARNING })).toHaveTextContent(
      'and 1 more match',
    );
  });

  it('clears when the user changes what it matched on', async () => {
    const app = await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, { url: app.url, company: 'X' });
    await screen.findByRole('group', { name: WARNING });
    await user.type(screen.getByLabelText('Job posting URL'), '2');
    expect(screen.queryByRole('group', { name: WARNING })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('list', { name: 'Applications' })).toHaveTextContent('X');
  });

  it('shows field errors instead of checking duplicates when input is invalid', async () => {
    await existing();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '+ Add application' }));
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.type(screen.getByLabelText(/Job title/), 'Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('Job posting URL')).toHaveAccessibleDescription(
      'Enter the job posting URL.',
    );
    expect(screen.queryByRole('group', { name: WARNING })).toBeNull();
  });

  it("keeps a saved job's cleared date applied cleared when editing", async () => {
    const app = await addApplication({ url: 'https://beta.com/1', company: 'Beta' });
    await db.applications.update(app.id, { status: 'saved' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Beta/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText('Date applied'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect(await db.applications.get(app.id)).not.toHaveProperty('appliedAt');
  });

  it('is announced through focus, not as a second live region', async () => {
    await existing();
    const user = userEvent.setup();
    render(<App />);
    await fillAndSave(user, {
      url: 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
      company: 'X',
    });
    const warning = await screen.findByRole('group', { name: WARNING });
    expect(warning).toHaveFocus();
    expect(warning).not.toHaveAttribute('aria-live');
    expect(warning.getAttribute('role')).not.toBe('alert');
  });

  describe('when editing', () => {
    async function editFirst(user: User, name: RegExp) {
      render(<App />);
      await user.click(await screen.findByRole('button', { name }));
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
    }

    it("doesn't warn about the application itself", async () => {
      await existing();
      const user = userEvent.setup();
      await editFirst(user, /^Acme/);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
      expect(screen.queryByRole('group', { name: WARNING })).toBeNull();
    });

    it('says that View existing discards the unsaved changes', async () => {
      await existing();
      await addApplication({ url: 'https://beta.com/1', company: 'Beta', title: 'Designer' });
      const user = userEvent.setup();
      await editFirst(user, /^Beta/);
      await user.clear(screen.getByLabelText('Company'));
      await user.type(screen.getByLabelText('Company'), 'Acme');
      await user.clear(screen.getByLabelText(/Job title/));
      await user.type(screen.getByLabelText(/Job title/), 'Senior Engineer');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(
        await screen.findByRole('button', { name: 'Discard changes and view existing' }),
      ).toBeInTheDocument();
    });

    it("doesn't warn again on later edits of a job kept with Save anyway", async () => {
      const original = await existing();
      const user = userEvent.setup();
      render(<App />);
      await fillAndSave(user, { url: original.url, company: 'Kept Co' });
      await user.click(await screen.findByRole('button', { name: 'Save anyway' }));
      await user.click(await screen.findByRole('button', { name: /^Kept Co/ }));
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.type(screen.getByLabelText(/Notes/), 'Second round on Friday');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
      expect(screen.queryByRole('group', { name: WARNING })).toBeNull();
    });

    it('warns when the edit makes it match another application', async () => {
      await existing();
      await addApplication({ url: 'https://beta.com/1', company: 'Beta', title: 'Designer' });
      const user = userEvent.setup();
      await editFirst(user, /^Beta/);
      await user.clear(screen.getByLabelText('Job posting URL'));
      await user.type(
        screen.getByLabelText('Job posting URL'),
        'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1',
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('group', { name: WARNING })).toHaveTextContent(
        'Acme · Senior Engineer',
      );
    });
  });
});
