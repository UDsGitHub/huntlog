import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDraft, draftKey, type CaptureGesture } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import { FORM_DEFAULTS_KEY } from '@/lib/formDefaults';
import { sourceValue } from '@/tests/formHelpers';
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
    expect(sourceValue()).toBe('');
  });
});

describe('the source of a capture', () => {
  const capture = (url: string) =>
    fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', { url, title: 'Engineer' }),
    });

  it('is told by the job board in its address, marked as auto-filled, with More details shut', async () => {
    await capture('https://www.linkedin.com/jobs/view/123');
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(sourceValue()).toBe('LinkedIn');
    const toggle = screen.getByRole('button', { name: /More details/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // The row says it, so the guess is never hidden.
    expect(toggle).toHaveAccessibleDescription('LinkedIn');
    expect(
      screen.getByRole('group', { name: /^Source/, hidden: true }),
    ).toHaveAccessibleDescription('Auto-filled, please check');
  });

  it('fills Other for a known board without a chip, and nothing for other sites', async () => {
    await capture('https://www.glassdoor.co.uk/job-listing/1');
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(sourceValue()).toBe('Glassdoor');
    unmount();
    await capture('https://boards.greenhouse.io/acme/jobs/1');
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(sourceValue()).toBe('');
  });

  it('never comes from the remembered source', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'Referral' } });
    await capture('https://acme.com/careers/1');
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(sourceValue()).toBe('');
  });

  it('is remembered for the next manual Add once saved', async () => {
    await capture('https://uk.indeed.com/viewjob?jk=1');
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    await user.type(screen.getByLabelText('Company'), 'Acme{Enter}');
    await waitFor(async () =>
      expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({
        source: 'Indeed',
      }),
    );
  });
});
