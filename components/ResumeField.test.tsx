import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // Sheets open and close at once, so focus and views settle without waiting for a slide.
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
  fakeBrowser.reset();
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

type User = ReturnType<typeof userEvent.setup>;
// By role: the Resumes tab (mounted while hidden) has other fields labelled "Resume…".
const resumeSelect = () => screen.getByRole('combobox', { name: /^Resume/ });
/** The options the resume dropdown lists (opened and closed again to read them). */
function optionLabels() {
  const field = resumeSelect();
  if (field.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(screen.getByRole('button', { name: 'Show resumes', hidden: true }));
  }
  const labels = within(screen.getByRole('listbox', { name: 'Resumes' }))
    .getAllByRole('option')
    .map((option) => option.textContent);
  fireEvent.keyDown(field, { key: 'Escape' });
  return labels;
}
/** Picks a resume in the dropdown by its label. */
async function pickResume(user: User, label: string) {
  await user.click(resumeSelect());
  await user.click(
    within(screen.getByRole('listbox', { name: 'Resumes' })).getByRole('option', { name: label }),
  );
}

/** Opens Add. Resumes load asynchronously: tests that need one wait for its option. */
async function openAdd(user: User, waitForOption?: string) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Add application' }));
  if (waitForOption) {
    // Open once and wait for the option to arrive (polling open/close in waitFor is costly).
    await user.click(resumeSelect());
    await within(screen.getByRole('listbox', { name: 'Resumes' })).findByRole('option', {
      name: waitForOption,
    });
    await user.keyboard('{Escape}');
  }
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
  it('sits in the top section: no resume, active resumes newest first, then a + to upload', async () => {
    await addResume(picked('Old.pdf'), {}, db, new Date(2026, 0, 1));
    await addResume(picked('New.pdf'), {}, db, new Date(2026, 5, 1));
    const archived = await addResume(picked('Gone.pdf'), {}, db, new Date(2026, 6, 1));
    await setResumeArchived(archived.id, true, db);
    const user = userEvent.setup();
    await openAdd(user, 'Old');
    expect(optionLabels()).toEqual(['No resume', 'New', 'Old']);
    expect(screen.getByRole('button', { name: 'Upload new resume' })).toHaveAttribute(
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

  it('links the picked resume, and shows it in the detail view (not on the row)', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const user = userEvent.setup();
    await openAdd(user, 'Backend v3');
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await pickResume(user, 'Backend v3');
    expect(resumeSelect()).not.toHaveAccessibleDescription(/Tip/);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const row = (await screen.findByRole('button', { name: /^Acme/ })).closest('li')!;
    // Spec §4.4: the row leaves the resume out; Detail shows it.
    expect(row).not.toHaveTextContent('Backend v3');
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
    await user.click(screen.getByRole('button', { name: 'Upload new resume' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    expect(within(group).getByLabelText('Resume file')).toHaveFocus();
    await user.upload(within(group).getByLabelText('Resume file'), realFile('Data v2.pdf'));
    expect(within(group).getByLabelText('Name')).toHaveValue('Data v2');
    await user.click(within(group).getByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Upload a new resume' })).toBeNull(),
    );
    // Picked, and the field shows it; focus returns to it.
    expect(resumeSelect()).toHaveValue('Data v2');
    expect(resumeSelect()).toHaveFocus();
    expect(optionLabels()).toContain('Data v2');
    expect((await db.resumes.toArray())[0]?.name).toBe('Data v2');
  });

  it('keeps the current choice when the inline upload is closed, by − or Escape', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const user = userEvent.setup();
    await openAdd(user, 'Backend v3');
    await pickResume(user, 'Backend v3');
    const toggle = screen.getByRole('button', { name: 'Upload new resume' });
    // The + opens the upload and turns into a − that closes it (there's no Cancel).
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    expect(within(group).queryByRole('button', { name: /Cancel/ })).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Upload a new resume' })).toBeNull();
    expect(resumeSelect()).toHaveValue('Backend v3');
    expect(resume.id).toBeTruthy();
    expect(toggle).toHaveFocus();

    // Escape inside the upload closes just the upload, not the form's sheet.
    await user.click(toggle);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('group', { name: 'Upload a new resume' })).toBeNull();
    expect(toggle).toHaveFocus();
    expect(resumeSelect()).toHaveValue('Backend v3');
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
    // Wait on what the field shows, then read the options once.
    await waitFor(() => expect(resumeSelect()).toHaveValue('Backend v3 (archived)'));
    expect(optionLabels()).toContain('Backend v3 (archived)');
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
    // Spec §4.4: the row leaves the resume out; Detail shows it.
    expect(row).not.toHaveTextContent('Backend v3');
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
    await user.click(screen.getByRole('button', { name: 'Upload new resume' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('cv.pdf'));
    await user.type(within(group).getByLabelText('Name'), '{Enter}');
    await waitFor(async () => expect(await db.resumes.count()).toBe(1));
    expect(await db.applications.count()).toBe(0);
    expect(screen.getByRole('form', { name: 'Add application' })).toBeInTheDocument();
  });

  it('Enter on the file field is left to the picker, not taken as Upload', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new resume' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    const fileInput = within(group).getByLabelText('Resume file');
    expect(fileInput).toHaveFocus();
    await user.keyboard('{Enter}');
    // No "Choose a file" error: nothing tried to upload.
    expect(fileInput).not.toHaveAttribute('aria-invalid');
  });

  it('follows the picked file with the suggested name in the inline upload too', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new resume' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('old.pdf'));
    await user.upload(within(group).getByLabelText('Resume file'), realFile('Backend v3.pdf'));
    expect(within(group).getByLabelText('Name')).toHaveValue('Backend v3');
  });

  it('links inline upload errors to their fields and focuses the first', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new resume' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('cv.pdf', DOCX_HEAD));
    await user.click(within(group).getByRole('button', { name: 'Upload' }));
    const fileInput = within(group).getByLabelText('Resume file');
    await waitFor(() => expect(fileInput).toHaveAccessibleDescription(/doesn't look like a PDF/));
    expect(fileInput).toHaveFocus();
  });

  it('shows a picked resume archived in another window as archived, not as No resume', async () => {
    const resume = await addResume(picked('cv.pdf'), { name: 'Backend v3' }, db);
    const user = userEvent.setup();
    await openAdd(user, 'Backend v3');
    await pickResume(user, 'Backend v3');
    await act(async () => {
      await setResumeArchived(resume.id, true, db);
    });
    // Wait on what the field shows, then read the options once.
    await waitFor(() => expect(resumeSelect()).toHaveValue('Backend v3 (archived)'));
    expect(optionLabels()).toContain('Backend v3 (archived)');
    expect(resumeSelect()).not.toHaveAccessibleDescription(/Tip/);
  });

  it('offers a resume just uploaded here only until the live list has it', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Upload new resume' }));
    const group = screen.getByRole('group', { name: 'Upload a new resume' });
    await user.upload(within(group).getByLabelText('Resume file'), realFile('Data v2.pdf'));
    await user.click(within(group).getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(resumeSelect()).toHaveValue('Data v2'));
    const [resume] = await db.resumes.toArray();
    // Deleted in another window: no longer offered as a live resume.
    await act(async () => {
      await deleteResume(resume!.id, db);
    });
    await waitFor(() => expect(resumeSelect()).toHaveValue('Resume (file not available)'));
    expect(optionLabels()).not.toContain('Data v2');
  });
});
