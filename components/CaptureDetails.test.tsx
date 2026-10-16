import { render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDraft, draftKey, type CaptureSource } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

const WINDOW_ID = 3;

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: WINDOW_ID } as never);
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

// Regression: every capture opened More details, though it fills nothing in there. The draft's
// `source` (which gesture made it: page, link or command) was mistaken for the application's
// Source field.
describe.each<[CaptureSource, Parameters<typeof createDraft>[1]]>([
  ['page', { url: 'https://jobs.example.test/1', title: 'Engineer' }],
  ['link', { url: 'https://jobs.example.test/2' }],
  ['command', { url: 'https://jobs.example.test/3', title: 'Engineer' }],
  ['command', { url: 'chrome://settings', readFailed: true }],
])('a %s capture', (source, fields) => {
  it('leaves More details collapsed when it filled nothing in there', async () => {
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: createDraft(source, fields) });
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(screen.getByRole('button', { name: /More details/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByLabelText(/Source/)).toHaveValue('');
  });
});
