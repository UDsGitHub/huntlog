import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDraft, draftKey, DRAFT_MAX_AGE_MS, type CaptureDraft } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

const WINDOW_ID = 3;
const HINT = 'Auto-filled, please check';

const pageDraft = (overrides: Partial<CaptureDraft> = {}): CaptureDraft => ({
  ...createDraft('page', {
    url: 'https://jobs.example.test/posting/1',
    title: 'Senior Engineer at Acme',
  }),
  ...overrides,
});

const stored = async (windowId = WINDOW_ID) =>
  (await fakeBrowser.storage.session.get(draftKey(windowId)))[draftKey(windowId)];

function fields() {
  return {
    url: screen.getByLabelText('Job posting URL'),
    company: screen.getByLabelText('Company'),
    title: screen.getByLabelText(/Job title/),
  };
}

beforeEach(async () => {
  fakeBrowser.reset();
  // `as never`: getCurrent's callback overload types the spy as returning void.
  vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({
    id: WINDOW_ID,
  } satisfies Partial<Browser.windows.Window> as never);
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('capture prefill', () => {
  it('prefills from a draft stored before the panel opened, then consumes it', async () => {
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() });
    render(<App />);

    await waitFor(() => expect(fields().url).toHaveValue('https://jobs.example.test/posting/1'));
    const { url, company, title } = fields();
    expect(title).toHaveValue('Senior Engineer at Acme');
    expect(url).toHaveAccessibleDescription(HINT);
    expect(title).toHaveAccessibleDescription(HINT);
    expect(company).toHaveValue('');
    expect(company).toHaveFocus();
    await waitFor(async () => expect(await stored()).toBeUndefined());
  });

  it('prefills from a draft that arrives while the panel is open', async () => {
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());

    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));

    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    await waitFor(async () => expect(await stored()).toBeUndefined());
  });

  it("ignores another window's draft and leaves it for that window", async () => {
    await fakeBrowser.storage.session.set({ [draftKey(99)]: pageDraft() });
    render(<App />);
    await screen.findByText(/No applications yet/);
    await act(() => fakeBrowser.storage.session.set({ [draftKey(98)]: pageDraft() }));

    expect(fields().url).toHaveValue('');
    expect(await stored(99)).toBeDefined();
    expect(await stored(98)).toBeDefined();
  });

  it('discards a stale draft without prefilling', async () => {
    const old = new Date(Date.now() - DRAFT_MAX_AGE_MS - 1000).toISOString();
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: pageDraft({ capturedAt: old }),
    });
    render(<App />);

    await waitFor(async () => expect(await stored()).toBeUndefined());
    expect(fields().url).toHaveValue('');
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it.each([['garbage'], [{ v: 1, source: 'page' }], [{ v: 9 }]])(
    'survives a malformed draft %j',
    async (raw) => {
      await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: raw });
      render(<App />);

      await waitFor(async () => expect(await stored()).toBeUndefined());
      expect(fields().url).toHaveValue('');
    },
  );

  it('does not prefill an unsafe URL even if one reaches storage', async () => {
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: { ...pageDraft(), url: 'javascript:alert(1)' },
    });
    render(<App />);

    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    expect(fields().url).toHaveValue('');
  });

  it('prefills only the URL from a link capture', async () => {
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('link', { url: 'https://jobs.example.test/posting/9' }),
    });
    render(<App />);

    await waitFor(() => expect(fields().url).toHaveValue('https://jobs.example.test/posting/9'));
    const { url, title } = fields();
    expect(url).toHaveAccessibleDescription(HINT);
    expect(title).toHaveValue('');
    expect(screen.getAllByText(HINT)).toHaveLength(1);
  });

  it('explains a failed page read and opens a blank form', async () => {
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('command', { url: 'chrome://settings', readFailed: true }),
    });
    render(<App />);

    // The live region is mounted (empty) before the capture lands, so wait for its text.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't read this page"),
    );
    expect(fields().url).toHaveValue('');
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it('focuses the URL field when no URL could be captured', async () => {
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('command', { url: 'chrome://settings', readFailed: true }),
    });
    render(<App />);
    await screen.findByRole('status', { name: '' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Couldn't read/));
    await waitFor(() => expect(fields().url).toHaveFocus());
  });

  it('says only the address was kept when the read failed on a web page', async () => {
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', {
        url: 'https://chromewebstore.google.com/detail/x',
        readFailed: true,
      }),
    });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        "Couldn't read this page, so only its address was filled in.",
      ),
    );
    expect(screen.queryByText(/fill in the details below/)).toBeNull();
    expect(fields().url).toHaveValue('https://chromewebstore.google.com/detail/x');
    expect(fields().url).toHaveAccessibleDescription(HINT);
    await waitFor(() => expect(fields().company).toHaveFocus());
  });

  it('announces a capture through a live region that exists before it arrives', async () => {
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));

    await waitFor(() => expect(status).toHaveTextContent('Job captured.'));
    expect(screen.getByRole('status')).toBe(status);
  });

  it('shows the hint again if the user restores the captured value', async () => {
    const user = userEvent.setup();
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() });
    render(<App />);
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    const { title } = fields();

    await user.type(title, 'X');
    expect(title).not.toHaveAccessibleDescription(HINT);
    await user.type(title, '{Backspace}');
    expect(title).toHaveAccessibleDescription(HINT);
  });

  it('removes a hint once the user edits that field', async () => {
    const user = userEvent.setup();
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() });
    render(<App />);
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    const { url, title } = fields();

    await user.type(title, ' II');

    expect(title).not.toHaveAccessibleDescription(HINT);
    expect(url).toHaveAccessibleDescription(HINT);
  });

  it('saves the prefilled job with its title and clears the hints', async () => {
    const user = userEvent.setup();
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() });
    render(<App />);
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    const { company, title } = fields();

    await user.type(company, 'Acme{Enter}');

    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('Senior Engineer at Acme');
    expect(list).toHaveTextContent('https://jobs.example.test/posting/1');
    expect(screen.queryByText(HINT)).toBeNull();
    expect(title).toHaveValue('');
    const [saved] = await db.applications.toArray();
    expect(saved).toMatchObject({ company: 'Acme', title: 'Senior Engineer at Acme' });
  });

  it('replaces half-typed input when a new capture arrives', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());
    await user.type(fields().company, 'Typed Co');

    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));

    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    expect(fields().company).toHaveValue('');
  });

  it('applies a second capture of the same page', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());

    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    await user.clear(fields().title);
    await waitFor(async () => expect(await stored()).toBeUndefined());

    const again = createDraft(
      'page',
      { url: 'https://jobs.example.test/posting/1', title: 'Senior Engineer at Acme' },
      new Date(Date.now() + 1),
    );
    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: again }));

    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    expect(fields().title).toHaveAccessibleDescription(HINT);
  });

  it('opens a blank form when the window lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fakeBrowser.windows.getCurrent).mockRejectedValue(new Error('no window'));
    render(<App />);

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Reading the capture draft failed', expect.any(Error)),
    );
    expect(fields().url).toHaveValue('');
  });
});
