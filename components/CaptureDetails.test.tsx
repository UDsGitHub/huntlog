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

describe('what the page said about the job (M8)', () => {
  const capture = () =>
    fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', {
        url: 'https://acme.example/jobs/1',
        title: 'Platform Engineer',
        company: 'Acme Robotics',
        location: 'Berlin, Germany',
        workMode: 'hybrid',
        salary: { min: 85000, max: 95000, currency: 'EUR', period: 'month' },
      }),
    });
  const HINT = 'Auto-filled, please check';

  it('fills company, location, work mode and salary, each marked, with More details open', async () => {
    await capture();
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(screen.getByLabelText(/^Company/)).toHaveValue('Acme Robotics');
    expect(screen.getByLabelText(/^Company/)).toHaveAccessibleDescription(HINT);
    expect(screen.getByRole('button', { name: /More details/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('Location')).toHaveValue('Berlin, Germany');
    expect(screen.getByLabelText('Location')).toHaveAccessibleDescription(HINT);
    const workMode = screen.getByRole('combobox', { name: 'Work mode' });
    expect(workMode).toHaveAttribute('data-value', 'hybrid');
    expect(workMode).toHaveAccessibleDescription(HINT);
    expect(screen.getByLabelText('Minimum')).toHaveValue('85,000');
    expect(screen.getByLabelText('Maximum')).toHaveValue('95,000');
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveAccessibleDescription(HINT);
    expect(screen.getByRole('combobox', { name: 'Per' })).toHaveAttribute('data-value', 'month');
  });

  it('drops a hint once its field is changed, and saves what the form shows', async () => {
    const user = userEvent.setup();
    await capture();
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    const location = screen.getByLabelText('Location');
    await user.clear(location);
    await user.type(location, 'Munich');
    expect(location).not.toHaveAccessibleDescription(HINT);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect(await db.applications.toArray()).toEqual([
        expect.objectContaining({
          company: 'Acme Robotics',
          title: 'Platform Engineer',
          location: 'Munich',
          workMode: 'hybrid',
          salaryMin: 85000,
          salaryMax: 95000,
          salaryCurrency: 'EUR',
          salaryPeriod: 'month',
        }),
      ]),
    );
  });

  it('leaves Currency and Per at their defaults, unmarked, when the page didn’t say', async () => {
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', {
        url: 'https://acme.example/jobs/1',
        salary: { min: 50000, max: 50000 },
      }),
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(screen.getByLabelText('Minimum')).toHaveAccessibleDescription(HINT);
    expect(screen.getByRole('combobox', { name: 'Per' })).toHaveAttribute('data-value', 'year');
    expect(screen.getByRole('combobox', { name: 'Per' })).not.toHaveAccessibleDescription(HINT);
    expect(screen.getByRole('combobox', { name: 'Currency' })).not.toHaveAccessibleDescription(
      HINT,
    );
  });

  it('uses the page’s work mode over the remembered one, and none when the page says none', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { workMode: 'remote' } });
    await capture();
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(screen.getByRole('combobox', { name: 'Work mode', hidden: true })).toHaveAttribute(
      'data-value',
      'hybrid',
    );
    unmount();
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', { url: 'https://acme.example/jobs/2' }),
    });
    render(<App />);
    await screen.findByRole('heading', { name: 'Add application' });
    expect(screen.getByRole('combobox', { name: 'Work mode', hidden: true })).toHaveAttribute(
      'data-value',
      '',
    );
  });
});
