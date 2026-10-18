import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication, softDeleteApplication } from './applications';
import {
  backupBlob,
  backupFileName,
  BACKUP_FORMAT,
  collectBackup,
  exportBackup,
  fromBase64,
  LAST_BACKUP_KEY,
  lastBackupText,
  onLastBackupChanged,
  readLastBackup,
  toBase64,
  withoutDerivedFields,
} from './backup';
import { JobLogDB } from './db';
import { addResume, deleteResume, type PickedFile } from './resumes';
import { updateSettings } from './settings';

let db: JobLogDB;
beforeEach(() => {
  fakeBrowser.reset();
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await db.delete();
});

const PDF_BYTES = [0x25, 0x50, 0x44, 0x46, 0x2d, 0, 255, 128];
const pdf = (name = 'Backend v3.pdf'): PickedFile => ({
  name,
  size: PDF_BYTES.length,
  arrayBuffer: async () => new Uint8Array(PDF_BYTES).buffer,
});

describe('base64', () => {
  it('round-trips every byte value', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(new Uint8Array(fromBase64(toBase64(bytes.buffer)))).toEqual(bytes);
  });

  it('handles a file larger than one chunk', () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(new Uint8Array(fromBase64(toBase64(bytes.buffer)))).toEqual(bytes);
  });

  it('throws on text that isn’t base64', () => {
    expect(() => fromBase64('not base64!')).toThrow();
  });
});

describe('collectBackup', () => {
  it('holds live applications and resumes with their files, and the settings', async () => {
    const resume = await addResume(pdf(), { note: 'For backend roles' }, db);
    const app = await addApplication(
      { url: 'https://acme.com/1', company: 'Acme', title: 'Engineer', resumeId: resume.id },
      db,
    );
    await updateSettings({ theme: 'dark', weeklyGoal: 10 });
    const now = new Date('2026-10-18T12:00:00Z');
    const backup = await collectBackup(db, now);
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.version).toBe(1);
    expect(backup.exportedAt).toBe(now.toISOString());
    expect(backup.settings).toEqual({ theme: 'dark', weeklyGoal: 10 });
    expect(backup.applications).toEqual([withoutDerivedFields(app)]);
    expect(backup.applications[0]).not.toHaveProperty('urlNormalized');
    expect(backup.applications[0]).not.toHaveProperty('companyTitleKey');
    expect(backup.resumes).toEqual([{ resume, file: new Uint8Array(PDF_BYTES).buffer }]);
  });

  it('leaves soft-deleted rows out, and keeps archived resumes', async () => {
    const used = await addResume(pdf('Used.pdf'), {}, db);
    const unused = await addResume(pdf('Unused.pdf'), {}, db);
    await addApplication({ url: 'https://acme.com/1', company: 'Acme', resumeId: used.id }, db);
    const gone = await addApplication({ url: 'https://globex.com/1', company: 'Globex' }, db);
    await softDeleteApplication(gone.id, db);
    await deleteResume(unused.id, db);
    // In use: archived instead of deleted.
    await deleteResume(used.id, db);
    const backup = await collectBackup(db);
    expect(backup.applications.map((app) => app.company)).toEqual(['Acme']);
    expect(backup.resumes.map(({ resume }) => [resume.name, resume.archived])).toEqual([
      ['Used', true],
    ]);
  });

  it('keeps a deleted resume that a live application still links to, with its file', async () => {
    const resume = await addResume(pdf(), {}, db);
    // Linked after the delete: the link a just-undone application delete can bring back.
    await db.resumes.update(resume.id, { deletedAt: new Date().toISOString() });
    await db.applications.add({
      ...(await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db)),
      id: crypto.randomUUID(),
      resumeId: resume.id,
    });
    const backup = await collectBackup(db);
    const linked = backup.applications.find((app) => app.resumeId === resume.id);
    expect(linked).toBeDefined();
    expect(backup.resumes).toHaveLength(1);
    expect(backup.resumes[0]!.resume.deletedAt).toBeDefined();
    expect(backup.resumes[0]!.file).not.toBeNull();
  });

  it('marks a resume whose file is gone with a null file', async () => {
    const resume = await addResume(pdf(), {}, db);
    await db.resumeFiles.delete(resume.id);
    expect((await collectBackup(db)).resumes[0]!.file).toBeNull();
  });

  it('keeps only the settings that are set', async () => {
    expect((await collectBackup(db)).settings).toEqual({});
    await updateSettings({ weekStartsOn: 0 });
    expect((await collectBackup(db)).settings).toEqual({ weekStartsOn: 0 });
    // Chosen explicitly, System is kept too.
    await updateSettings({ theme: 'system' });
    expect((await collectBackup(db)).settings).toEqual({ weekStartsOn: 0, theme: 'system' });
  });

  it('rejects when the settings can’t be read', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('broken'));
    await expect(collectBackup(db)).rejects.toThrow('broken');
  });
});

describe('backupBlob', () => {
  it('is the backup as JSON, with each file in base64', async () => {
    const one = await addResume(pdf('One.pdf'), {}, db);
    const two = await addResume(pdf('Two.pdf'), {}, db);
    await db.resumeFiles.delete(two.id);
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    const contents = await collectBackup(db);
    const blob = backupBlob(contents);
    expect(blob.type).toBe('application/json');
    const base64 = toBase64(new Uint8Array(PDF_BYTES).buffer);
    const files = new Map([
      [one.id, base64],
      [two.id, null],
    ]);
    expect(JSON.parse(await blob.text())).toEqual({
      ...contents,
      resumes: contents.resumes.map(({ resume }) => ({ ...resume, file: files.get(resume.id) })),
    });
  });

  it('works with no resumes', async () => {
    const contents = await collectBackup(db);
    expect(JSON.parse(await backupBlob(contents).text())).toEqual(contents);
  });
});

describe('backupFileName', () => {
  it('uses the local date', () => {
    expect(backupFileName(new Date(2026, 0, 2, 23, 59))).toBe('huntlog-backup-2026-01-02.json');
  });
});

describe('exportBackup', () => {
  it('downloads the backup and records when', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:backup';
    });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    const now = new Date(2026, 9, 18, 9, 30);
    expect(await exportBackup(db, now)).toEqual({ applications: 1, resumes: 0 });
    expect(names).toEqual(['huntlog-backup-2026-10-18.json']);
    expect(blobs[0]!.type).toBe('application/json');
    const backup = JSON.parse(await blobs[0]!.text());
    expect(backup.applications[0].company).toBe('Acme');
    expect(await readLastBackup()).toBe(now.toISOString());
  });

  it('still succeeds when the time can’t be recorded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup');
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('full'));
    await expect(exportBackup(db)).resolves.toEqual({ applications: 0, resumes: 0 });
  });
});

describe('last backup', () => {
  it('reads nothing when never made or malformed', async () => {
    expect(await readLastBackup()).toBeUndefined();
    await fakeBrowser.storage.local.set({ [LAST_BACKUP_KEY]: 'soon' });
    expect(await readLastBackup()).toBeUndefined();
  });

  it('reports a backup made in another window', async () => {
    const seen: (string | undefined)[] = [];
    const stop = onLastBackupChanged((at) => seen.push(at));
    await fakeBrowser.storage.local.set({ [LAST_BACKUP_KEY]: '2026-10-18T10:00:00.000Z' });
    await fakeBrowser.storage.local.set({ unrelated: 1 });
    stop();
    await fakeBrowser.storage.local.set({ [LAST_BACKUP_KEY]: '2026-10-19T10:00:00.000Z' });
    expect(seen).toEqual(['2026-10-18T10:00:00.000Z']);
  });

  it.each([
    [undefined, 'Last backup: never'],
    [new Date(2026, 9, 18, 0, 5), 'Last backup: today'],
    [new Date(2026, 9, 17, 23, 55), 'Last backup: yesterday'],
    [new Date(2026, 9, 11, 12, 0), 'Last backup: 7 days ago'],
    [new Date(2025, 9, 18, 12, 0), 'Last backup: 365 days ago'],
    [new Date(2024, 9, 18, 12, 0), 'Last backup: 730 days ago'],
    // A clock moved back: never "-1 days ago".
    [new Date(2026, 9, 19, 12, 0), 'Last backup: today'],
  ])('describes %s', (at, text) => {
    expect(lastBackupText(at?.toISOString(), new Date(2026, 9, 18, 8, 0))).toBe(text);
  });

  it.each(['soon', '+010000-01-01T00:00:00.000Z', '2026-13-01T00:00:00Z'])(
    'treats an unreadable %j as never, without throwing',
    (at) => {
      expect(lastBackupText(at)).toBe('Last backup: never');
    },
  );

  it('shows the count in Latin digits whatever the locale', () => {
    const toLocale = vi.spyOn(Number.prototype, 'toLocaleString');
    expect(lastBackupText(new Date(2026, 9, 6).toISOString(), new Date(2026, 9, 18))).toBe(
      'Last backup: 12 days ago',
    );
    expect(toLocale).not.toHaveBeenCalled();
  });
});
