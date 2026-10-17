import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication, NotFoundError } from '@/lib/applications';
import { createDraft, draftKey } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import * as resumes from '@/lib/resumes';
import * as motion from './motion';
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
  // Sheets and accordions close at once.
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

type User = ReturnType<typeof userEvent.setup>;

async function openResumesTab(user: User) {
  render(<App />);
  await user.click(await screen.findByRole('tab', { name: 'Resumes' }));
  return screen.getByRole('tabpanel', { name: 'Resumes' });
}

/** Opens the upload sheet from the floating + Upload. */
async function openUpload(user: User) {
  await user.click(screen.getByRole('button', { name: 'Upload resume' }));
  return within(screen.getByRole('dialog', { name: 'Upload a resume' }));
}
const uploadButton = () =>
  within(screen.getByRole('dialog', { name: 'Upload a resume' })).getByRole('button', {
    name: 'Upload',
  });

/** Picks an action from a resume's ⋯ menu. */
async function menuAction(user: User, name: string, action: string) {
  await user.click(await screen.findByRole('button', { name: `More actions for ${name}` }));
  await user.click(screen.getByRole('menuitem', { name: action }));
}

/** A drop of these files, as the browser fires it. */
function dropFiles(target: Element, files: File[]) {
  const dataTransfer = { files, types: ['Files'], dropEffect: 'none' };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

describe('Resumes tab', () => {
  it('uploads from the + Upload sheet, suggesting a name, and lists it with format, size and date', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    const sheet = await openUpload(user);
    expect(sheet.getByLabelText('Resume file')).toHaveFocus();
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('Backend v3.pdf'));
    expect(sheet.getByLabelText('Name')).toHaveValue('Backend v3');
    // The zone shows what was picked, and the file field is described by it.
    expect(sheet.getByText('Backend v3.pdf')).toBeInTheDocument();
    expect(sheet.getByLabelText('Resume file')).toHaveAccessibleDescription(
      /Backend v3\.pdf PDF · 108 bytes/,
    );
    await user.type(sheet.getByLabelText(/Note/), 'For SRE roles');
    await user.click(uploadButton());

    const list = await within(panel).findByRole('list', { name: 'Resumes' });
    expect(list).toHaveTextContent('Backend v3');
    // The upload date has its own line, so it never wraps mid-date.
    expect(list).toHaveTextContent(/PDF · 108 bytes/);
    const row = within(list).getByRole('button', { name: 'Open Backend v3' });
    expect(
      [...row.querySelectorAll(`[id$="-details"] > span`)].map((line) => line.textContent),
    ).toEqual(['PDF · 108 bytes · ', expect.stringMatching(/^Uploaded /)]);
    expect(list).toHaveTextContent('For SRE roles');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload resume' })).toHaveFocus();
    expect(await db.resumes.count()).toBe(1);
  });

  it('offers a full-size upload button when there are no resumes', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(within(panel).getByRole('button', { name: 'Upload your first resume' }));
    expect(screen.getByRole('dialog', { name: 'Upload a resume' })).toBeInTheDocument();
  });

  it('uploads with Enter in the name field', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('cv.pdf'));
    await user.type(sheet.getByLabelText('Name'), 'Mine{Enter}');
    expect(await within(panel).findByRole('list', { name: 'Resumes' })).toHaveTextContent('Mine');
  });

  it('keeps a typed name instead of the suggestion', async () => {
    const user = userEvent.setup();
    await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.type(sheet.getByLabelText('Name'), 'My CV');
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('cv-2026.pdf'));
    expect(sheet.getByLabelText('Name')).toHaveValue('My CV');
  });

  it('asks for a file, with the error linked and focused', async () => {
    const user = userEvent.setup();
    await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.click(uploadButton());
    const fileInput = sheet.getByLabelText('Resume file');
    expect(fileInput).toHaveAccessibleDescription(/Choose a file to upload\./);
    expect(fileInput).toHaveFocus();
  });

  it('rejects a file whose contents are not its format', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('cv.pdf', DOCX_HEAD));
    await user.click(uploadButton());
    await waitFor(() =>
      expect(sheet.getByLabelText('Resume file')).toHaveAccessibleDescription(
        /doesn't look like a PDF/,
      ),
    );
    expect(await db.resumes.count()).toBe(0);
  });

  it('rejects an unsupported type', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('photo.png'));
    await user.click(uploadButton());
    await waitFor(() =>
      expect(sheet.getByLabelText('Resume file')).toHaveAccessibleDescription(
        /Choose a PDF, DOCX, DOC, TXT or RTF file\./,
      ),
    );
  });

  it('takes a file dropped on the zone, and refuses more than one', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    const sheet = await openUpload(user);
    const zone = sheet.getByText('Choose a file or drag it here').closest('[data-dropzone]')!;
    dropFiles(zone, [pickedFile('a.pdf'), pickedFile('b.pdf')]);
    expect(sheet.getByLabelText('Resume file')).toHaveAccessibleDescription(
      /Drop one file at a time\./,
    );
    dropFiles(zone, [pickedFile('Dropped v1.pdf')]);
    expect(sheet.getByLabelText('Name')).toHaveValue('Dropped v1');
    expect(sheet.getByText('Change file')).toBeInTheDocument();
    expect(sheet.getByLabelText('Resume file')).not.toHaveAttribute('aria-invalid');
    await user.click(uploadButton());
    expect(await within(panel).findByRole('list', { name: 'Resumes' })).toHaveTextContent(
      'Dropped v1',
    );
  });

  it('asks before discarding a picked file', async () => {
    const user = userEvent.setup();
    await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('cv.pdf'));
    await user.click(sheet.getByRole('button', { name: 'Close' }));
    await user.click(sheet.getByRole('button', { name: 'Keep editing' }));
    expect(sheet.getByLabelText('Name')).toHaveValue('cv');
    await user.click(sheet.getByRole('button', { name: 'Close' }));
    await user.click(sheet.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // A new upload starts empty.
    const again = await openUpload(user);
    expect(again.getByLabelText('Name')).toHaveValue('');
  });

  it('searches by display name and file name, archived ones too', async () => {
    await addResume(asPicked(pickedFile('cv-2026.pdf')), { name: 'Backend v3' });
    await addResume(asPicked(pickedFile('lebenslauf.pdf')), { name: 'Ingénieur' });
    const old = await addResume(asPicked(pickedFile('old.pdf')), { name: 'Backend v1' });
    await db.resumes.update(old.id, { archived: true });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    const search = await within(panel).findByRole('searchbox', { name: 'Search resumes' });
    await user.type(search, 'ingenieur');
    expect(within(panel).getByRole('list', { name: 'Resumes' })).toHaveTextContent('Ingénieur');
    expect(within(panel).getByRole('list', { name: 'Resumes' })).not.toHaveTextContent('Backend');
    expect(within(panel).queryByRole('button', { name: /Archived/ })).toBeNull();
    await user.clear(search);
    await user.type(search, '2026');
    expect(within(panel).getByRole('list', { name: 'Resumes' })).toHaveTextContent('Backend v3');
    await user.clear(search);
    await user.type(search, 'old.pdf');
    expect(within(panel).queryByRole('list', { name: 'Resumes' })).toBeNull();
    expect(within(panel).getByRole('button', { name: /Archived/ })).toHaveTextContent('(1)');
    await user.clear(search);
    await user.type(search, 'nothing');
    expect(within(panel).getByText('No resumes match.')).toBeInTheDocument();
  });

  it('renames and edits the note in a sheet, opened with current values', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), {
      name: 'Backend v3',
      note: 'old',
    });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    // Renamed elsewhere after the row mounted: the sheet must open with the new name.
    await act(async () => {
      await db.resumes.update(resume.id, { name: 'Renamed elsewhere' });
    });
    await menuAction(user, 'Renamed elsewhere', 'Rename');
    const sheet = within(screen.getByRole('dialog', { name: 'Rename resume' }));
    expect(sheet.getByLabelText('Name')).toHaveValue('Renamed elsewhere');
    expect(sheet.getByLabelText('Name')).toHaveFocus();
    await user.clear(sheet.getByLabelText('Name'));
    // The sheet really slides out here (happy-dom otherwise reports reduced motion).
    vi.spyOn(motion, 'prefersReducedMotion').mockReturnValue(false);
    // For each change to the status region: was a modal sheet open then?
    const statusWhileModal: boolean[] = [];
    const watcher = new MutationObserver(() =>
      statusWhileModal.push(document.querySelector('dialog[open]') !== null),
    );
    watcher.observe(screen.getByRole('status'), {
      childList: true,
      characterData: true,
      subtree: true,
    });
    // Spaces around the name are trimmed, and the announcement says the saved name.
    await user.type(sheet.getByLabelText('Name'), '  Backend v4 ');
    await user.clear(sheet.getByLabelText(/Note/));
    await user.click(sheet.getByRole('button', { name: 'Save' }));
    // Announced only once the sheet has closed: while it's open (sliding out included) it's
    // modal, which keeps the status region inert, so the message would go unheard.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(statusWhileModal).toEqual([false]);
    expect(screen.getByRole('status')).toHaveTextContent('Renamed to Backend v4.');
    // The live list shows the new name once the write lands; focus stayed on that row's ⋯.
    await waitFor(() =>
      expect(
        within(panel).getByRole('button', { name: 'More actions for Backend v4' }),
      ).toHaveFocus(),
    );
    expect((await db.resumes.toArray())[0]).not.toHaveProperty('note');
  });

  it('shows a rename error in the sheet, focused', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    await openResumesTab(user);
    await menuAction(user, 'Backend v3', 'Rename');
    const sheet = within(screen.getByRole('dialog', { name: 'Rename resume' }));
    await user.clear(sheet.getByLabelText('Name'));
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(sheet.getByLabelText('Name')).toHaveAccessibleDescription(
        'Enter a name for this resume.',
      ),
    );
    expect(sheet.getByLabelText('Name')).toHaveFocus();
  });

  it('archives into a collapsed Archived accordion, and unarchives', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await menuAction(user, 'Backend v3', 'Archive');
    const toggle = await within(panel).findByRole('button', { name: /Archived \(1\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(panel).queryByRole('list', { name: 'Archived resumes' })).toBeNull();
    await user.click(toggle);
    const archived = within(panel).getByRole('list', { name: 'Archived resumes' });
    expect(archived).toBeVisible();
    await menuAction(user, 'Backend v3', 'Unarchive');
    await waitFor(() =>
      expect(within(panel).queryByRole('button', { name: /Archived/ })).toBeNull(),
    );
  });

  it('deletes an unused resume with Undo, removing its file when the toast ends', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await menuAction(user, 'Backend v3', 'Delete');
    expect(await screen.findByText('Deleted Backend v3.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await within(panel).findByRole('button', { name: 'Open Backend v3' }),
    ).toBeInTheDocument();
    expect(await db.resumeFiles.get(resume.id)).toBeDefined();

    await menuAction(user, 'Backend v3', 'Delete');
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    await waitFor(async () => expect(await db.resumeFiles.get(resume.id)).toBeUndefined());
  });

  it('archives instead of deleting a resume an application uses, saying why', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { resumeId: resume.id });
    const user = userEvent.setup();
    await openResumesTab(user);
    await menuAction(user, 'Backend v3', 'Delete');
    expect(
      await screen.findByText('Backend v3 is used by applications, so it was archived instead.'),
    ).toBeInTheDocument();
    expect(await db.resumeFiles.get(resume.id)).toBeDefined();
    expect((await db.resumes.get(resume.id))?.archived).toBe(true);
  });

  it('opens a PDF in a new viewer tab from its row', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), {
      name: 'Backend v3',
      note: 'SRE',
    });
    const create = vi.fn().mockResolvedValue({});
    Object.assign(fakeBrowser.tabs, { create });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    const row = await within(panel).findByRole('button', { name: 'Open Backend v3' });
    expect(row).toHaveAccessibleDescription(/^PDF · 108 bytes · Uploaded .+ SRE$/);
    await user.click(row);
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

  it('follows the picked file with its suggested name, but keeps a typed one', async () => {
    const user = userEvent.setup();
    await openResumesTab(user);
    const sheet = await openUpload(user);
    const fileInput = sheet.getByLabelText('Resume file');
    const name = sheet.getByLabelText('Name');
    await user.upload(fileInput, pickedFile('Backend v3.pdf'));
    await user.upload(fileInput, pickedFile('Frontend v2.pdf'));
    expect(name).toHaveValue('Frontend v2');
    await user.clear(name);
    await user.type(name, 'Mine');
    await user.upload(fileInput, pickedFile('Data v1.pdf'));
    expect(name).toHaveValue('Mine');
  });

  it('keeps an already archived resume archived when Delete archives it again', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await db.applications.update(app.id, { resumeId: resume.id });
    await db.resumes.update(resume.id, { archived: true });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(await within(panel).findByRole('button', { name: /Archived \(1\)/ }));
    await menuAction(user, 'Backend v3', 'Delete');
    expect(
      await screen.findByText('Backend v3 is used by applications, so it stays archived.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('keeps focus in the tab after archiving', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await menuAction(user, 'Backend v3', 'Archive');
    await waitFor(() =>
      expect(within(panel).getByRole('heading', { name: 'Resumes' })).toHaveFocus(),
    );
  });

  it('explains when archiving fails because the resume is gone', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    vi.spyOn(resumes, 'setResumeArchived').mockRejectedValue(new NotFoundError('x'));
    const user = userEvent.setup();
    await openResumesTab(user);
    await menuAction(user, 'Backend v3', 'Archive');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        "Couldn't change Backend v3. It may have been deleted.",
      ),
    );
  });

  it('leaves recently deleted files alone at startup (another window may still Undo)', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')));
    await db.resumes.update(resume.id, {
      deletedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    });
    render(<App />);
    await screen.findByRole('tab', { name: 'Resumes' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await db.resumeFiles.get(resume.id)).toBeDefined();
  });

  it('a capture closes its sheets, and coming back to the tab does not reopen them', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({
      id: 3,
    } satisfies Partial<Browser.windows.Window> as never);
    const capture = (url: string) =>
      act(async () => {
        await fakeBrowser.storage.session.set({ [draftKey(3)]: createDraft('page', { url }) });
      });
    const user = userEvent.setup();
    await openResumesTab(user);
    await openUpload(user);
    await capture('https://acme.com/1');
    expect(await screen.findByRole('dialog', { name: 'Add application' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Upload a resume' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('tab', { name: 'Resumes' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await menuAction(user, 'Backend v3', 'Rename');
    await capture('https://acme.com/2');
    expect(await screen.findByRole('dialog', { name: 'Add application' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Rename resume' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('tab', { name: 'Resumes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('after the first upload, focus stays in the tab (its opener is gone)', async () => {
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.click(within(panel).getByRole('button', { name: 'Upload your first resume' }));
    const sheet = within(screen.getByRole('dialog', { name: 'Upload a resume' }));
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('cv.pdf'));
    await user.click(uploadButton());
    await within(panel).findByRole('list', { name: 'Resumes' });
    await waitFor(() =>
      expect(within(panel).getByRole('heading', { name: 'Resumes' })).toHaveFocus(),
    );
  });

  it('keeps a picked file when the last resume goes elsewhere while the sheet is open', async () => {
    const resume = await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const user = userEvent.setup();
    await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('Frontend.pdf'));
    // Deleted in another window: the tab goes back to its empty state behind the sheet.
    await act(async () => {
      await db.resumes.update(resume.id, { deletedAt: new Date().toISOString() });
    });
    await screen.findByRole('button', { name: 'Upload your first resume', hidden: true });
    expect(sheet.getByLabelText('Name')).toHaveValue('Frontend');
  });

  it("can't be closed mid-upload, and ignores a file dropped meanwhile", async () => {
    let finish!: () => void;
    const real = resumes.addResume;
    vi.spyOn(resumes, 'addResume').mockImplementation(
      (...args) =>
        new Promise((resolve) => {
          finish = () => resolve(real(...args));
        }),
    );
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    const sheet = await openUpload(user);
    await user.upload(sheet.getByLabelText('Resume file'), pickedFile('First.pdf'));
    const submit = uploadButton();
    await user.click(submit);
    expect(submit).toHaveTextContent('Uploading…');
    dropFiles(sheet.getByText('First.pdf').closest('[data-dropzone]')!, [pickedFile('Second.pdf')]);
    expect(sheet.getByLabelText('Name')).toHaveValue('First');
    await user.click(sheet.getByRole('button', { name: 'Close' }));
    expect(sheet.queryByRole('button', { name: 'Discard' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Upload a resume' })).toBeInTheDocument();
    await act(async () => finish());
    expect(await within(panel).findByRole('list', { name: 'Resumes' })).toHaveTextContent('First');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a rename that takes the row out of the search leaves focus in the tab', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    await addResume(asPicked(pickedFile('cv2.pdf')), { name: 'Backend v2' });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.type(await within(panel).findByRole('searchbox'), 'backend v3');
    await menuAction(user, 'Backend v3', 'Rename');
    const sheet = within(screen.getByRole('dialog', { name: 'Rename resume' }));
    await user.clear(sheet.getByLabelText('Name'));
    await user.type(sheet.getByLabelText('Name'), 'Frontend v1{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(within(panel).getByRole('heading', { name: 'Resumes' })).toHaveFocus(),
    );
  });

  it('says so when only archived resumes match the search', async () => {
    await addResume(asPicked(pickedFile('cv.pdf')), { name: 'Backend v3' });
    const old = await addResume(asPicked(pickedFile('old.pdf')), { name: 'Old one' });
    await db.resumes.update(old.id, { archived: true });
    const user = userEvent.setup();
    const panel = await openResumesTab(user);
    await user.type(await within(panel).findByRole('searchbox'), 'old');
    expect(
      within(panel).getByText('Only archived resumes match. Open Archived to see them.'),
    ).toBeInTheDocument();
  });
});
