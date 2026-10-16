import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { createDraft, draftKey, DRAFT_MAX_AGE_MS, type CaptureDraft } from '@/lib/captureDraft';
import * as applications from '@/lib/applications';
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

    expect(screen.queryByRole('form')).toBeNull();
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
    expect(screen.queryByRole('form')).toBeNull();
  });

  it.each([
    ['garbage'],
    [{ v: 2, gesture: 'page' }],
    [{ v: 1, source: 'page', capturedAt: new Date().toISOString() }],
    [{ v: 9 }],
  ])('survives a malformed draft %j', async (raw) => {
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: raw });
    render(<App />);

    await waitFor(async () => expect(await stored()).toBeUndefined());
    expect(screen.queryByRole('form')).toBeNull();
    // The list loads on its own schedule, not necessarily before the draft is cleared.
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

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
    await user.type(fields().company, 'Acme{Enter}');

    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('Senior Engineer at Acme');
    expect(
      within(list).getByRole('link', {
        name: 'Open job posting for Acme: Senior Engineer at Acme',
      }),
    ).toHaveAttribute('href', 'https://jobs.example.test/posting/1');
    expect(screen.queryByText(HINT)).toBeNull();

    // The consumed capture doesn't come back on the next manual Add.
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    expect(fields().title).toHaveValue('');
    expect(fields().url).toHaveValue('');
    const [saved] = await db.applications.toArray();
    expect(saved).toMatchObject({ company: 'Acme', title: 'Senior Engineer at Acme' });
  });

  it('replaces half-typed input when a new capture arrives', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
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

  it('opens the Add view from the list when a capture arrives', async () => {
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());

    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));

    expect(await screen.findByRole('heading', { name: 'Add application' })).toBeInTheDocument();
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
  });

  it('a save that finishes after a new capture does not close the new form', async () => {
    let finish!: () => void;
    const real = applications.saveApplication;
    vi.spyOn(applications, 'saveApplication').mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => (finish = resolve));
      return real(...args);
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    await user.type(fields().url, 'https://first.example/1');
    await user.type(fields().company, 'First{Enter}');

    await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    await act(async () => finish());

    await waitFor(async () => expect(await db.applications.count()).toBe(1));
    expect(screen.getByRole('heading', { name: 'Add application' })).toBeInTheDocument();
    expect(fields().title).toHaveValue('Senior Engineer at Acme');
    expect(screen.getByRole('status')).toHaveTextContent('Saved First.');
  });

  describe('captures during other views', () => {
    async function seedAndOpenDetail(user: ReturnType<typeof userEvent.setup>) {
      await applications.addApplication({ url: 'https://acme.com/1', company: 'Acme' });
      render(<App />);
      await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());
      await user.click(await screen.findByRole('button', { name: /^Acme/ }));
      await screen.findByRole('heading', { level: 2, name: 'Acme' });
    }

    it('waits for an open edit instead of discarding it, then opens the capture', async () => {
      const user = userEvent.setup();
      await seedAndOpenDetail(user);
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.type(screen.getByLabelText(/Notes/), 'half-written');

      await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));

      expect(
        await screen.findByText('Job captured. It opens when you finish editing.'),
      ).toBeVisible();
      expect(screen.getByRole('form', { name: 'Edit application' })).toBeInTheDocument();
      expect(screen.getByLabelText(/Notes/)).toHaveValue('half-written');

      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByRole('heading', { name: 'Add application' })).toBeInTheDocument();
      await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
      expect((await db.applications.toArray())[0]?.notes).toBe('half-written');
    });

    it('keeps a deferred capture when Edit is left through View existing', async () => {
      await applications.addApplication({
        url: 'https://other.com/1',
        company: 'Other',
        title: 'Role',
      });
      const user = userEvent.setup();
      await seedAndOpenDetail(user);
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));
      await screen.findByText('Job captured. It opens when you finish editing.');

      await user.clear(screen.getByLabelText('Company'));
      await user.type(screen.getByLabelText('Company'), 'Other');
      await user.type(screen.getByLabelText(/Job title/), 'Role');
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await user.click(
        await screen.findByRole('button', { name: 'Discard changes and view existing' }),
      );

      expect(await screen.findByRole('heading', { level: 2, name: 'Other' })).toBeInTheDocument();
      await user.click(await screen.findByRole('button', { name: 'Open' }));
      await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));

      // The flag is spent: a later edit's Save goes back to its detail view.
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await user.click(await screen.findByRole('button', { name: /^Acme/ }));
      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    });

    it('an edit save that finishes after a capture does not close the Add form', async () => {
      let finish!: () => void;
      const real = applications.saveApplication;
      vi.spyOn(applications, 'saveApplication').mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => (finish = resolve));
        return real(...args);
      });
      const user = userEvent.setup();
      await seedAndOpenDetail(user);
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));
      // The capture arrives mid-save; the edit is already being written, so nothing is lost.
      await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));
      await act(async () => finish());
      expect(await screen.findByRole('heading', { name: 'Add application' })).toBeInTheDocument();
      await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
    });

    it('a delete that finishes after a capture does not close the Add form', async () => {
      let finish!: () => void;
      const real = applications.softDeleteApplication;
      vi.spyOn(applications, 'softDeleteApplication').mockImplementationOnce(async (...args) => {
        await new Promise<void>((resolve) => (finish = resolve));
        return real(...args);
      });
      const user = userEvent.setup();
      await seedAndOpenDetail(user);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      await act(() => fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() }));
      await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));
      await act(async () => finish());

      expect(await screen.findByText('Deleted Acme.')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Add application' })).toBeInTheDocument();
      expect(fields().title).toHaveValue('Senior Engineer at Acme');
    });
  });

  it('Cancel after a capture returns to the list and drops the capture', async () => {
    const user = userEvent.setup();
    await fakeBrowser.storage.session.set({ [draftKey(WINDOW_ID)]: pageDraft() });
    render(<App />);
    await waitFor(() => expect(fields().title).toHaveValue('Senior Engineer at Acme'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: '+ Add application' }));

    expect(fields().title).toHaveValue('');
    expect(screen.queryByText(HINT)).toBeNull();
    expect(await db.applications.count()).toBe(0);
  });

  it('opens a blank form when the window lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fakeBrowser.windows.getCurrent).mockRejectedValue(new Error('no window'));
    render(<App />);

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Reading the capture draft failed', expect.any(Error)),
    );
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add application' })).toBeEnabled();
  });
});
