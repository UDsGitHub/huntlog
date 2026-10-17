import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication, softDeleteApplication } from './applications';
import { draftKey } from './captureDraft';
import { JobLogDB } from './db';
import { deleteAllData, LeftoversError } from './deleteAll';
import { FORM_DEFAULTS_KEY } from './formDefaults';
import { addResume, type PickedFile } from './resumes';
import { readSettings, updateSettings } from './settings';

let db: JobLogDB;
beforeEach(() => {
  fakeBrowser.reset();
  db = new JobLogDB(`test-${crypto.randomUUID()}`);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

const pdf: PickedFile = {
  name: 'Backend v3.pdf',
  size: 8,
  arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]).buffer,
};

async function seed() {
  const resume = await addResume(pdf, {}, db);
  const kept = await addApplication(
    { url: 'https://acme.com/1', company: 'Acme', resumeId: resume.id },
    db,
  );
  const deleted = await addApplication({ url: 'https://globex.com/1', company: 'Globex' }, db);
  await softDeleteApplication(deleted.id, db);
  await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
  await fakeBrowser.storage.session.set({
    [draftKey(1)]: { v: 1 },
    [draftKey(2)]: { v: 1 },
    unrelated: 'stays',
  });
  await updateSettings({ theme: 'dark', weeklyGoal: 10 });
  return { resume, kept };
}

describe('deleteAllData', () => {
  it('permanently removes every application, resume and file, soft-deleted ones included', async () => {
    await seed();
    await deleteAllData(db);
    expect(await db.applications.count()).toBe(0);
    expect(await db.resumes.count()).toBe(0);
    expect(await db.resumeFiles.count()).toBe(0);
  });

  it('removes the remembered form defaults and pending captures, and nothing else', async () => {
    await seed();
    await deleteAllData(db);
    expect(await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY)).toEqual({});
    expect(await fakeBrowser.storage.session.get(null)).toEqual({ unrelated: 'stays' });
  });

  it('keeps the settings', async () => {
    await seed();
    await deleteAllData(db);
    expect(await readSettings()).toMatchObject({ theme: 'dark', weeklyGoal: 10 });
  });

  it('works on empty data, and can run twice', async () => {
    await deleteAllData(db);
    await seed();
    await deleteAllData(db);
    await deleteAllData(db);
    expect(await db.applications.count()).toBe(0);
  });

  it('clears no table if one fails', async () => {
    await seed();
    vi.spyOn(db.resumeFiles, 'clear').mockRejectedValue(new Error('disk'));
    await expect(deleteAllData(db)).rejects.toThrow('disk');
    await expect(deleteAllData(db)).rejects.not.toBeInstanceOf(LeftoversError);
    expect(await db.applications.count()).toBe(2);
    expect(await db.resumes.count()).toBe(1);
    expect(await db.resumeFiles.count()).toBe(1);
    // Nothing beside them was touched either.
    expect(await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY)).not.toEqual({});
  });

  it('rejects if storage fails after the data went, and a second run finishes', async () => {
    await seed();
    vi.spyOn(fakeBrowser.storage.local, 'remove').mockRejectedValueOnce(new Error('storage'));
    // Says the data is gone, so the UI can act on it.
    await expect(deleteAllData(db)).rejects.toBeInstanceOf(LeftoversError);
    expect(await db.applications.count()).toBe(0);
    await deleteAllData(db);
    expect(await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY)).toEqual({});
  });
});
