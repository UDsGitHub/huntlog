import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication, softDeleteApplication } from './applications';
import {
  backupFileName,
  backupParts,
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
    expect(backup.resumes).toEqual([
      { ...resume, file: toBase64(new Uint8Array(PDF_BYTES).buffer) },
    ]);
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
    expect(backup.resumes.map((resume) => [resume.name, resume.archived])).toEqual([
      ['Used', true],
    ]);
  });

  it('marks a resume whose file is gone with a null file', async () => {
    const resume = await addResume(pdf(), {}, db);
    await db.resumeFiles.delete(resume.id);
    expect((await collectBackup(db)).resumes[0]!.file).toBeNull();
  });

  it('keeps only the settings that are set', async () => {
    expect((await collectBackup(db)).settings).toEqual({ theme: 'system' });
    await updateSettings({ weekStartsOn: 0 });
    expect((await collectBackup(db)).settings).toEqual({ theme: 'system', weekStartsOn: 0 });
  });

  it('rejects when the settings can’t be read', async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(new Error('broken'));
    await expect(collectBackup(db)).rejects.toThrow('broken');
  });
});

describe('backupParts', () => {
  it('joins into the backup as JSON', async () => {
    await addResume(pdf('One.pdf'), {}, db);
    await addResume(pdf('Two.pdf'), {}, db);
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' }, db);
    const backup = await collectBackup(db);
    const parts = backupParts(backup);
    expect(parts.length).toBe(4);
    expect(JSON.parse(parts.join(''))).toEqual(backup);
  });

  it('works with no resumes', async () => {
    const backup = await collectBackup(db);
    expect(JSON.parse(backupParts(backup).join(''))).toEqual(backup);
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
    // A clock moved back: never "-1 days ago".
    [new Date(2026, 9, 19, 12, 0), 'Last backup: today'],
  ])('describes %s', (at, text) => {
    expect(lastBackupText(at?.toISOString(), new Date(2026, 9, 18, 8, 0))).toBe(text);
  });
});
