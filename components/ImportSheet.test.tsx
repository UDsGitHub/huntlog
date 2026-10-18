import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import { readSettings, updateSettings } from '@/lib/settings';
import App from '@/entrypoints/sidepanel/App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  fakeBrowser.reset();
  // Sheets close at once, so tests don't wait for their slide.
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

const T = '2026-10-01T10:00:00.000Z';
const backupFile = (fields: Record<string, unknown> = {}, name = 'huntlog-backup.json') =>
  new File(
    [
      JSON.stringify({
        format: 'huntlog-backup',
        version: 1,
        exportedAt: '2026-10-12T12:00:00.000Z',
        settings: { theme: 'dark' },
        applications: [
          {
            id: 'from-backup',
            url: 'https://initech.com/jobs/9',
            company: 'Initech',
            status: 'applied',
            statusHistory: [{ status: 'applied', at: T }],
            appliedAt: '2026-10-01',
            createdAt: T,
            updatedAt: T,
          },
        ],
        resumes: [],
        ...fields,
      }),
    ],
    name,
    { type: 'application/json' },
  );

async function openImport(user: User) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  const settings = await screen.findByRole('dialog', { name: 'Settings' });
  await user.click(within(settings).getByRole('button', { name: 'Import…' }));
  return screen.findByRole('dialog', { name: 'Import' });
}

const pick = (user: User, sheet: HTMLElement, file: File) =>
  user.upload(within(sheet).getByLabelText('Backup file'), file);

describe('Import', () => {
  it('merges a backup, then shows its rows on the list', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await updateSettings({ theme: 'light' });
    const user = userEvent.setup();
    const sheet = await openImport(user);
    const button = within(sheet).getByRole('button', { name: 'Import' });
    expect(button).toBeDisabled();
    await pick(user, sheet, backupFile());
    expect(await within(sheet).findByText(/1 application and 0 resumes\./)).toHaveTextContent(
      'Backup from Oct 12, 2026: 1 application and 0 resumes.',
    );
    expect(within(sheet).getByRole('radio', { name: 'Merge' })).toBeChecked();
    await user.click(within(sheet).getByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText('Backup merged: 1 application and 0 resumes added or updated.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
    // Merge keeps the settings.
    expect((await readSettings()).theme).toBe('light');
    await user.keyboard('{Escape}');
    const list = screen.getByRole('tabpanel', { name: 'Applications' });
    expect(await within(list).findByText('Initech')).toBeInTheDocument();
    expect(within(list).getByText('Acme')).toBeInTheDocument();
  });

  it('says so when everything was already there', async () => {
    const user = userEvent.setup();
    const sheet = await openImport(user);
    await pick(user, sheet, backupFile());
    await user.click(await within(sheet).findByRole('button', { name: 'Import' }));
    await screen.findByText(/Backup merged/);
    await user.click(
      within(screen.getByRole('dialog', { name: 'Settings' })).getByRole('button', {
        name: 'Import…',
      }),
    );
    const again = await screen.findByRole('dialog', { name: 'Import' });
    await pick(user, again, backupFile());
    await user.click(await within(again).findByRole('button', { name: 'Import' }));
    expect(
      await screen.findByText('Everything in the backup was already here.'),
    ).toBeInTheDocument();
  });

  it('replaces all data after a confirmation naming the counts', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await addApplication({ url: 'https://globex.com/1', company: 'Globex' });
    const user = userEvent.setup();
    const sheet = await openImport(user);
    await pick(user, sheet, backupFile());
    await user.click(await within(sheet).findByRole('radio', { name: 'Replace all' }));
    await user.click(within(sheet).getByRole('button', { name: 'Replace all data…' }));
    const confirm = await screen.findByRole('dialog', { name: 'Replace all data?' });
    expect(confirm).toHaveAccessibleDescription(
      "This replaces your 2 applications and 0 resumes with the 1 application and 0 resumes in this backup, and restores its settings. It can't be undone.",
    );
    // Not focused first: the destructive button needs a deliberate press.
    expect(within(confirm).getByRole('button', { name: 'Replace all data' })).not.toHaveFocus();
    await user.click(within(confirm).getByRole('button', { name: 'Replace all data' }));
    expect(
      await screen.findByText('Backup restored: 1 application and 0 resumes.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Import' })).toBeNull();
    expect((await readSettings()).theme).toBe('dark');
    await user.keyboard('{Escape}');
    const list = screen.getByRole('tabpanel', { name: 'Applications' });
    expect(await within(list).findByText('Initech')).toBeInTheDocument();
    expect(within(list).queryByText('Acme')).toBeNull();
  });

  it('leaving the confirmation changes nothing', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    const sheet = await openImport(user);
    await pick(user, sheet, backupFile());
    await user.click(await within(sheet).findByRole('radio', { name: 'Replace all' }));
    await user.click(within(sheet).getByRole('button', { name: 'Replace all data…' }));
    await screen.findByRole('dialog', { name: 'Replace all data?' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Replace all data?' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Replace all data…' })).toHaveFocus();
    expect(await db.applications.count()).toBe(1);
  });

  it('lists why a file is refused, and imports nothing', async () => {
    const user = userEvent.setup();
    const sheet = await openImport(user);
    const bad = (company: string) => ({
      id: company,
      url: 'javascript:alert(1)',
      company,
      status: 'applied',
      statusHistory: [{ status: 'applied', at: T }],
      createdAt: T,
      updatedAt: T,
    });
    await pick(
      user,
      sheet,
      backupFile({ applications: ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(bad) }),
    );
    const alert = await within(sheet).findByRole('alert');
    expect(alert).toHaveTextContent('This backup can’t be imported:');
    expect(within(alert).getAllByRole('listitem')).toHaveLength(5);
    expect(alert).toHaveTextContent(
      'Application 1 (A) has a job posting URL that isn’t a web address',
    );
    expect(alert).toHaveTextContent('…and 2 more.');
    expect(within(sheet).getByLabelText('Backup file')).toHaveAttribute('aria-invalid', 'true');
    expect(within(sheet).getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it.each([
    ['not JSON', new File(['hello'], 'notes.json'), 'This file isn’t valid JSON.'],
    [
      'a newer backup',
      backupFile({ version: 2 }),
      'This backup is from a newer version of Huntlog. Update Huntlog, then try again.',
    ],
  ])('refuses %s with one message', async (_label, file, message) => {
    const user = userEvent.setup();
    const sheet = await openImport(user);
    await pick(user, sheet, file);
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(message);
  });

  it('a later file replaces an earlier one’s result', async () => {
    const user = userEvent.setup();
    const sheet = await openImport(user);
    await pick(user, sheet, new File(['nope'], 'bad.json'));
    await within(sheet).findByRole('alert');
    await pick(user, sheet, backupFile());
    await waitFor(() => expect(within(sheet).queryByRole('alert')).toBeNull());
    expect(within(sheet).getByRole('button', { name: 'Import' })).toBeEnabled();
  });

  it('says nothing changed when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.applications, 'bulkPut').mockRejectedValue(new Error('disk full'));
    const user = userEvent.setup();
    const sheet = await openImport(user);
    await pick(user, sheet, backupFile());
    await user.click(await within(sheet).findByRole('button', { name: 'Import' }));
    expect(await within(sheet).findByRole('alert')).toHaveTextContent(
      "Couldn't import the backup. Nothing was changed. Try again.",
    );
  });
});
