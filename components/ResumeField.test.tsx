import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import { addResume, deleteResume, purgeDeletedResumeData, setResumeArchived } from '@/lib/resumes';
import App from '@/entrypoints/sidepanel/App';
import { resumeOptionLabels } from './ResumeField';

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46];
const DOCX_HEAD = [0x50, 0x4b, 0x03, 0x04];
const picked = (name: string, head = PDF_HEAD) => {
  const bytes = new Uint8Array([...head, 1, 2, 3]);
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer };
};
function realFile(name: string, head = PDF_HEAD): File {
  const bytes = new Uint8Array([...head, 1, 2, 3]);
  const file = new File([bytes], name);
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return file;
}

beforeEach(async () => {
  fakeBrowser.reset();
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

type User = ReturnType<typeof userEvent.setup>;
// By role: the Resumes tab (mounted while hidden) has other fields labelled "Resume…".
const resumeSelect = () => screen.getByRole('combobox', { name: /^Resume/ });
const optionLabels = () =>
  [...(resumeSelect() as HTMLSelectElement).options].map((option) => option.textContent);

/** Opens Add. Resumes load asynchronously: tests that need one wait for its option. */
async function openAdd(user: User, waitForOption?: string) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ Add application' }));
  if (waitForOption) await waitFor(() => expect(optionLabels()).toContain(waitForOption));
}

describe('resumeOptionLabels', () => {
  it('adds format and date only where names repeat', async () => {
    const a = await addResume(picked('Backend v3.pdf'), {}, db, new Date(2026, 9, 2));
    const b = await addResume(picked('Backend v3.docx', DOCX_HEAD), {}, db, new Date(2026, 9, 5));
    const c = await addResume(picked('Frontend.pdf'), {}, db);
    const labels = resumeOptionLabels([a, b, c]);
    expect(labels.get(a.id)).toBe('Backend v3 · PDF · Oct 2, 2026');
    expect(labels.get(b.id)).toBe('Backend v3 · DOCX · Oct 5, 2026');
    expect(labels.get(c.id)).toBe('Frontend');
  });
});

describe('Resume field', () => {
  it('sits in the top section: no resume, active resumes newest first, then Upload new', async () => {
    await addResume(picked('Old.pdf'), {}, db, new Date(2026, 0, 1));
    await addResume(picked('New.pdf'), {}, db, new Date(2026, 5, 1));
    const archived = await addResume(picked('Gone.pdf'), {}, db, new Date(2026, 6, 1));
    await setResumeArchived(archived.id, true, db);
    const user = userEvent.setup();
    await openAdd(user, 'Old');
    expect(optionLabels()).toEqual(['No resume', 'New', 'Old']);
    expect(screen.getByRole('button', { name: 'Upload new…' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(resumeSelect().closest('[hidden]')).toBeNull();
  });

  it('shows a gentle tip while none is picked, and never blocks saving', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    expect(resumeSelect()).toHaveAccessibleDescription(
      'Tip: pick the resume you sent, so you can find it later.',
    );
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme{Enter}');
    await screen.findByRole('button', { name: /^Acme/ });
    expect((await db.applications.toArray())[0]).not.toHaveProperty('resumeId');
  });

  it('links the picked resume, shows it in the row and the detail view', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const user = userEvent.setup();
    await openAdd(user, 'Backend v3');
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.selectOptions(resumeSelect(), resume.id);
    expect(resumeSelect()).not.toHaveAccessibleDescription(/Tip/);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const row = (await screen.findByRole('button', { name: /^Acme/ })).closest('li')!;
    expect(row).toHaveTextContent('Backend v3');
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    const detail = await screen.findByRole('region', { name: 'Acme' });
    await waitFor(() =>
      expect(
        within(detail).getByRole('button', { name: 'Open resume Backend v3' }),
      ).toBeInTheDocument(),
    );
    expect((await db.applications.toArray())[0]).toMatchObject({
      resumeId: resume.id,
      resumeNameSnapshot: 'Backend v3',
    });
  });

  it('uploads a new resume from the form and selects it', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new…' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    expect(within(group).getByLabelText('Resume file')).toHaveFocus();
    await user.upload(within(group).getByLabelText('Resume file'), realFile('Data v2.pdf'));
    expect(within(group).getByLabelText('Name')).toHaveValue('Data v2');
    await user.click(within(group).getByRole('button', { name: 'Upload and use' }));

    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Upload a new resume' })).toBeNull(),
    );
    const [resume] = await db.resumes.toArray();
    expect(resumeSelect()).toHaveValue(resume!.id);
    expect(optionLabels()).toContain('Data v2');
    // Focus returns to the select, now showing the new resume.
    expect(resumeSelect()).toHaveFocus();
  });

  it('keeps the current choice when the inline upload is cancelled', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const user = userEvent.setup();
    await openAdd(user, 'Backend v3');
    await user.selectOptions(resumeSelect(), resume.id);
    await user.click(screen.getByRole('button', { name: 'Upload new…' }));
    await user.click(screen.getByRole('button', { name: 'Cancel upload' }));
    expect(screen.queryByRole('group', { name: 'Upload a new resume' })).toBeNull();
    expect(resumeSelect()).toHaveValue(resume.id);
    expect(screen.getByRole('button', { name: 'Upload new…' })).toHaveFocus();
    expect(screen.getByRole('form', { name: 'Add application' })).toBeInTheDocument();
  });

  it('in Edit keeps an archived resume selectable, marked archived', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { resumeId: resume.id, resumeNameSnapshot: 'Backend v3' });
    await setResumeArchived(resume.id, true, db);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(optionLabels()).toContain('Backend v3 (archived)'));
    expect(resumeSelect()).toHaveValue(resume.id);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await db.applications.get(app.id))?.resumeId).toBe(resume.id);
  });

  it('shows the snapshot name when the resume itself is gone', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { resumeId: resume.id, resumeNameSnapshot: 'Backend v3' });
    // Gone, e.g. after a partial import: deleted and its file purged.
    await db.applications.update(app.id, { deletedAt: '2020-01-01T00:00:00.000Z' });
    await deleteResume(resume.id, db, new Date('2021-01-01'));
    await purgeDeletedResumeData({ olderThanMs: 0 }, db);
    await db.applications.update(app.id, { deletedAt: undefined });
    const user = userEvent.setup();
    render(<App />);
    const row = (await screen.findByRole('button', { name: /^Acme/ })).closest('li')!;
    expect(row).toHaveTextContent('Backend v3');
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    const detail = await screen.findByRole('region', { name: 'Acme' });
    expect(await within(detail).findByText('Backend v3 (file not available)')).toBeInTheDocument();
    expect(within(detail).queryByRole('button', { name: /Open resume/ })).toBeNull();
  });

  it('Enter in the inline upload uploads; it does not save the application', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Upload new…' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('cv.pdf'));
    await user.type(within(group).getByLabelText('Name'), '{Enter}');
    await waitFor(async () => expect(await db.resumes.count()).toBe(1));
    expect(await db.applications.count()).toBe(0);
    expect(screen.getByRole('form', { name: 'Add application' })).toBeInTheDocument();
  });

  it('follows the picked file with the suggested name in the inline upload too', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new…' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('old.pdf'));
    await user.upload(within(group).getByLabelText('Resume file'), realFile('Backend v3.pdf'));
    expect(within(group).getByLabelText('Name')).toHaveValue('Backend v3');
  });

  it('links inline upload errors to their fields and focuses the first', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new…' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('cv.pdf', DOCX_HEAD));
    await user.click(within(group).getByRole('button', { name: 'Upload and use' }));
    const fileInput = within(group).getByLabelText('Resume file');
    await waitFor(() => expect(fileInput).toHaveAccessibleDescription(/doesn't look like a PDF/));
    expect(fileInput).toHaveFocus();
  });

  it('shows a picked resume archived in another window as archived, not as No resume', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const user = userEvent.setup();
    await openAdd(user, 'Backend v3');
    await user.selectOptions(resumeSelect(), resume.id);
    await act(async () => {
      await setResumeArchived(resume.id, true, db);
    });
    await waitFor(() => expect(optionLabels()).toContain('Backend v3 (archived)'));
    expect(resumeSelect()).toHaveValue(resume.id);
    expect(resumeSelect()).not.toHaveAccessibleDescription(/Tip/);
  });
});
