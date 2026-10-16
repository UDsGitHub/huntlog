import { render, screen } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDraft, draftKey, type CaptureGesture } from '@/lib/captureDraft';
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

// Regression (v0.3.0): every capture opened More details, though it fills nothing in there. The
// draft's gesture field was called `source` and mistaken for the application's Source field.
describe.each<[string, CaptureGesture, Parameters<typeof createDraft>[1]]>([
  ['page capture', 'page', { url: 'https://jobs.example.test/1', title: 'Engineer' }],
  ['link capture', 'link', { url: 'https://jobs.example.test/2' }],
  ['shortcut capture', 'command', { url: 'https://jobs.example.test/3', title: 'Engineer' }],
  ['failed page read', 'command', { url: 'chrome://settings', readFailed: true }],
])('a %s', (_label, gesture, fields) => {
  it('leaves More details collapsed when it filled nothing in there', async () => {
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: createDraft(gesture, fields) });
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(screen.getByRole('button', { name: /More details/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByLabelText(/Source/)).toHaveValue('');
  });
});
