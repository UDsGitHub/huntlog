import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import { addResume, type PickedFile } from '@/lib/resumes';
import App from '@/entrypoints/sidepanel/App';

const PDF_HEAD = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37];
const DOCX_HEAD = [0x50, 0x4b, 0x03, 0x04];

/** A real File, as the picker gives (happy-dom File lacks arrayBuffer, so add it). */
function pickedFile(name: string, head = PDF_HEAD, extra = 100): File {
  const bytes = new Uint8Array([...head, ...new Array(extra).fill(0x20)]);
  const file = new File([bytes], name, { type: '' });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return file;
}
const asPicked = (file: File): PickedFile => file as unknown as PickedFile;

beforeEach(async () => {
  fakeBrowser.reset();
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

async function openResumesTab(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole('tab', { name: 'Resumes' }));
  return screen.getByRole('tabpanel', { name: 'Resumes' });
}

describe('Resumes tab', () => {
  it('uploads a file, suggesting its name, and lists it with format, size and date', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.upload(within(panel).getByLabelText('Resume file'), pickedFile('Backend v3.pdf'));
    expect(within(panel).getByLabelText('Name')).toHaveValue('Backend v3');
    await user.type(within(panel).getByLabelText(/Note/), 'For SRE roles');
    await user.click(within(panel).getByRole('button', { name: 'Upload' }));

    const list = await within(panel).findByRole('list', { name: 'Resumes' });
    expect(list).toHaveTextContent('Backend v3');
    expect(list).toHaveTextContent(/PDF · 108 bytes · Uploaded/);
    expect(list).toHaveTextContent('For SRE roles');
    expect(within(panel).getByLabelText('Name')).toHaveValue('');
    expect(await db.resumes.count()).toBe(1);
  });

  it('keeps a typed name instead of the suggestion', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.type(within(panel).getByLabelText('Name'), 'My CV');
    await user.upload(within(panel).getByLabelText('Resume file'), pickedFile('cv-2026.pdf'));
    expect(within(panel).getByLabelText('Name')).toHaveValue('My CV');
  });

  it('asks for a file, with the error linked and focused', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(within(panel).getByRole('button', { name: 'Upload' }));
    const fileInput = within(panel).getByLabelText('Resume file');
    expect(fileInput).toHaveAccessibleDescription(/Choose a file to upload\./);
    expect(fileInput).toHaveFocus();
  });

  it('rejects a file whose contents are not its format', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const panel = await openResumesTab(user);
    await user.upload(within(panel).getByLabelText('Resume file'), pickedFile('cv.pdf', DOCX_HEAD));
    await user.click(within(panel).getByRole('button', { name: 'Upload' }));
    await waitFor(() =>
      expect(within(panel).getByLabelText('Resume file')).toHaveAccessibleDescription(
        /doesn't look like a PDF/,
      ),
    );
    expect(await db.resumes.count()).toBe(0);
  });

  it('rejects an unsupported type', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const panel = await openResumesTab(user);
    await user.upload(within(panel).getByLabelText('Resume file'), pickedFile('photo.png'));
    await user.click(within(panel).getByRole('button', { name: 'Upload' }));
    await waitFor(() =>
      expect(within(panel).getByLabelText('Resume file')).toHaveAccessibleDescription(
        /Choose a PDF, DOCX, DOC, TXT or RTF file\./,
      ),
    );
  });

  it('renames and edits the note', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3', note: 'old' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: 'Rename Backend v3' }));
    const form = within(panel).getByRole('form', { name: 'Rename Backend v3' });
    await user.clear(within(form).getByLabelText('Name'));
    await user.type(within(form).getByLabelText('Name'), 'Backend v4');
    await user.clear(within(form).getByLabelText(/Note/));
    await user.click(within(form).getByRole('button', { name: 'Save' }));
    expect(
      await within(panel).findByRole('button', { name: 'Rename Backend v4' }),
    ).toBeInTheDocument();
    expect((await db.resumes.toArray())[0]).not.toHaveProperty('note');
  });

  it('archives into a collapsed Archived section, and unarchives', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: 'Archive Backend v3' }));
    const toggle = await within(panel).findByRole('button', { name: /Archived \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    const archived = within(panel).getByRole('list', { name: 'Archived resumes' });
    await user.click(within(archived).getByRole('button', { name: 'Unarchive Backend v3' }));
    await waitFor(() =>
      expect(within(panel).queryByRole('button', { name: /Archived/ })).toBeNull(),
    );
  });

  it('deletes an unused resume with Undo, removing its file when the toast ends', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: 'Delete Backend v3' }));
    expect(await screen.findByText('Deleted Backend v3.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await within(panel).findByRole('button', { name: 'Delete Backend v3' }),
    ).toBeInTheDocument();
    expect(await db.resumeFiles.get(resume.id)).toBeDefined();

    await user.click(within(panel).getByRole('button', { name: 'Delete Backend v3' }));
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(async () => expect(await db.resumeFiles.get(resume.id)).toBeUndefined());
  });

  it('archives instead of deleting a resume an application uses, saying why', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { resumeId: resume.id });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: 'Delete Backend v3' }));
    expect(
      await screen.findByText('Backend v3 is used by applications, so it was archived instead.'),
    ).toBeInTheDocument();
    expect(await db.resumeFiles.get(resume.id)).toBeDefined();
    expect((await db.resumes.get(resume.id))?.archived).toBe(true);
  });

  it('opens a PDF in a new viewer tab', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const create = vi.fn().mockResolvedValue({});
    Object.assign(fakeBrowser.tabs, { create });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: 'Open Backend v3' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        url: expect.stringMatching(new RegExp(`/resume-viewer\\.html\\?id=${resume.id}$`)),
      }),
    );
  });

  it('downloads other formats under their original, made-safe name', async () => {
    await addResume(asPicked(pickedFile('Backend: v3.docx', DOCX_HEAD)), { name: 'Backend v3' });
    const clicks: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ download: this.download, href: this.href });
    });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: 'Download Backend v3' }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(clicks[0]!.download).toBe('Backend_ v3.docx');
    expect(clicks[0]!.href).toMatch(/^blob:/);
  });

  it('removes files left by a session that closed before its toast ended', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), {}, db, new Date('2026-01-01'));
    await db.resumes.update(resume.id, { deletedAt: '2026-01-01T00:00:00.000Z' });
    render(<App />);
    await waitFor(async () => expect(await db.resumeFiles.get(resume.id)).toBeUndefined());
    act(() => {
      fireEvent.click(document.body);
    });
  });
});
