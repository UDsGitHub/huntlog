import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import { createDraft, draftKey } from '@/lib/captureDraft';
import * as deleteAll from '@/lib/deleteAll';
import { FORM_DEFAULTS_KEY } from '@/lib/formDefaults';
import { readSettings, SETTINGS_KEYS, updateSettings } from '@/lib/settings';
import { sourceValue, chooseOption } from '@/tests/formHelpers';
import App from '@/entrypoints/sidepanel/App';

type User = ReturnType<typeof userEvent.setup>;

beforeEach(async () => {
  fakeBrowser.reset();
  // Sheets close at once, so tests don't wait for their slide.
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

async function openSettings(user: User) {
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
  return screen.findByRole('dialog', { name: 'Settings' });
}

const card = (panel: HTMLElement, name: string) => within(panel).getByRole('region', { name });

describe('Settings', () => {
  it("opens from the header's gear over the current tab, and gives focus back to it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('tab', { name: 'Stats' }));
    const gear = screen.getByRole('button', { name: 'Settings' });
    await user.click(gear);
    const sheet = screen.getByRole('dialog', { name: 'Settings' });
    expect(sheet).toHaveAttribute('open');
    // Its first control has focus.
    expect(within(sheet).getByRole('switch', { name: 'Set a weekly goal' })).toHaveFocus();
    // The tab behind it stays as it was.
    expect(screen.getByRole('tab', { name: 'Stats', hidden: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(gear).toHaveFocus();
  });

  it('a capture closes it, showing the capture’s form', async () => {
    const WINDOW_ID = 3;
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({
      id: WINDOW_ID,
    } satisfies Partial<Browser.windows.Window> as never);
    const user = userEvent.setup();
    await openSettings(user);
    await act(async () => {
      await fakeBrowser.storage.session.set({
        [draftKey(WINDOW_ID)]: createDraft('page', { url: 'https://acme.com/2' }),
      });
    });
    expect(await screen.findByLabelText('Job posting URL')).toHaveValue('https://acme.com/2');
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
  });

  it('shows its four cards at the defaults', async () => {
    const user = userEvent.setup();
    const panel = await openSettings(user);
    for (const name of ['Weekly goal', 'Display', 'Your data', 'About']) {
      expect(card(panel, name)).toBeInTheDocument();
    }
    expect(within(panel).getByRole('switch', { name: 'Set a weekly goal' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(within(panel).getByRole('radio', { name: 'System' })).toBeChecked();
    // en-US weeks start on Sunday.
    expect(within(panel).getByLabelText('First day of the week')).toHaveTextContent(
      'Locale default (Sunday)',
    );
  });

  describe('weekly goal', () => {
    it('turns on with a suggested goal, saves what is typed, and turns off', async () => {
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await user.click(within(panel).getByRole('switch', { name: 'Set a weekly goal' }));
      const field = within(panel).getByLabelText('Applications per week');
      expect(field).toHaveValue('5');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(5));

      await user.clear(field);
      await user.type(field, '12');
      expect(field).toHaveValue('12');
      // Saved when the field is left (or on Enter), not on each keystroke.
      expect((await readSettings()).weeklyGoal).toBe(5);
      await user.tab();
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(12));
      await user.clear(field);
      await user.type(field, '30{Enter}');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(30));

      await user.click(within(panel).getByRole('switch', { name: 'Set a weekly goal' }));
      expect(within(panel).queryByLabelText('Applications per week')).toBeNull();
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBeUndefined());
    });

    it.each([['0'], ['201'], ['abc'], ['']])(
      'rejects %j and keeps the last good goal',
      async (input) => {
        await updateSettings({ weeklyGoal: 8 });
        const user = userEvent.setup();
        const panel = await openSettings(user);
        const field = within(panel).getByLabelText('Applications per week');
        await user.clear(field);
        if (input) await user.type(field, input);
        expect(field).toHaveAttribute('aria-invalid', 'true');
        expect(field).toHaveAccessibleDescription('Enter a whole number from 1 to 200.');
        await user.tab();
        expect((await readSettings()).weeklyGoal).toBe(8);
      },
    );

    it('keeps only digits as they are typed', async () => {
      await updateSettings({ weeklyGoal: 8 });
      const user = userEvent.setup();
      const panel = await openSettings(user);
      const field = within(panel).getByLabelText('Applications per week');
      for (const [typed, kept] of [
        ['2.5', '25'],
        ['-3', '3'],
        ['1e1', '11'],
      ] as const) {
        await user.clear(field);
        await user.type(field, typed);
        expect(field).toHaveValue(kept);
      }
    });

    it('steps with − and + (and the arrow keys), saving at once, within 1 to 200', async () => {
      await updateSettings({ weeklyGoal: 2 });
      const user = userEvent.setup();
      const panel = await openSettings(user);
      const field = within(panel).getByLabelText('Applications per week');
      const less = within(panel).getByRole('button', { name: 'Decrease weekly goal' });
      const more = within(panel).getByRole('button', { name: 'Increase weekly goal' });
      await user.click(less);
      expect(field).toHaveValue('1');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(1));
      // − stops at 1: it never turns the goal off. Still focusable (aria-disabled), so a
      // keyboard user pressing it at the limit keeps their place.
      expect(less).toHaveAttribute('aria-disabled', 'true');
      expect(less).toHaveFocus();
      await user.click(less);
      expect(field).toHaveValue('1');
      await user.click(more);
      await user.click(more);
      expect(field).toHaveValue('3');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(3));
      field.focus();
      await user.keyboard('{ArrowUp}{ArrowUp}{ArrowDown}');
      expect(field).toHaveValue('4');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(4));

      await user.clear(field);
      await user.type(field, '200{Enter}');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(200));
      expect(more).toHaveAttribute('aria-disabled', 'true');
      await user.click(more);
      expect(field).toHaveValue('200');
      // While what's typed is invalid, the buttons step from the stored goal.
      await user.clear(field);
      await user.type(field, '0');
      await user.click(less);
      expect(field).toHaveValue('199');
      expect(field).not.toHaveAttribute('aria-invalid');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(199));
    });

    it('saves a step back to a value saved here before the goal changed elsewhere', async () => {
      await updateSettings({ weeklyGoal: 9 });
      const user = userEvent.setup();
      const panel = await openSettings(user);
      const field = within(panel).getByLabelText('Applications per week');
      await user.click(within(panel).getByRole('button', { name: 'Increase weekly goal' }));
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(10));
      await act(() => updateSettings({ weeklyGoal: 11 }));
      await waitFor(() => expect(field).toHaveValue('11'));
      await user.click(within(panel).getByRole('button', { name: 'Decrease weekly goal' }));
      expect(field).toHaveValue('10');
      await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(10));
    });

    it('follows a goal changed in another window', async () => {
      await updateSettings({ weeklyGoal: 8 });
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await act(() => updateSettings({ weeklyGoal: 20 }));
      await waitFor(() =>
        expect(within(panel).getByLabelText('Applications per week')).toHaveValue('20'),
      );
    });
  });

  describe('display', () => {
    it('saves the theme and applies it, by click and with arrow keys', async () => {
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await user.click(within(panel).getByRole('radio', { name: 'Dark' }));
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
      expect((await readSettings()).theme).toBe('dark');

      await user.keyboard('{ArrowLeft}');
      expect(within(panel).getByRole('radio', { name: 'Light' })).toBeChecked();
      await waitFor(async () => expect((await readSettings()).theme).toBe('light'));
    });

    it('saves the first day of the week, and can go back to the locale default', async () => {
      const user = userEvent.setup();
      const panel = await openSettings(user);
      const select = within(panel).getByLabelText('First day of the week');
      await chooseOption(user, select, 'Monday');
      await waitFor(async () => expect((await readSettings()).weekStartsOn).toBe(1));
      await chooseOption(user, select, 'Locale default (Sunday)');
      await waitFor(async () => expect((await readSettings()).weekStartsOn).toBeUndefined());
    });

    it('says so when a setting could not be saved', async () => {
      const user = userEvent.setup();
      const panel = await openSettings(user);
      vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('quota'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await user.click(within(panel).getByRole('radio', { name: 'Dark' }));
      expect(await within(panel).findByRole('alert')).toHaveTextContent("Couldn't save");
    });
  });

  describe('delete all data', () => {
    async function seeded() {
      await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
      await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
      await updateSettings({ theme: 'dark', weeklyGoal: 7 });
    }

    it('works only once DELETE is typed, then deletes the data and keeps the settings', async () => {
      await seeded();
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Delete all data' }),
      );
      const sheet = screen.getByRole('dialog', { name: 'Delete all data?' });
      const confirm = within(sheet).getByRole('button', { name: 'Delete all data' });
      const field = within(sheet).getByLabelText('Type DELETE to confirm');
      expect(field).toHaveFocus();

      for (const wrong of ['delete', 'DELET', 'DELETE x', 'DE LETE']) {
        await user.clear(field);
        await user.type(field, wrong);
        expect(confirm).toBeDisabled();
      }
      await user.clear(field);
      await user.type(field, ' DELETE ');
      expect(confirm).toBeEnabled();
      await user.click(confirm);

      await waitFor(() => expect(sheet).not.toHaveAttribute('open'));
      expect(await db.applications.count()).toBe(0);
      expect(await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY)).toEqual({});
      expect(await readSettings()).toMatchObject({ theme: 'dark', weeklyGoal: 7 });
      expect(await screen.findByText('All your data was deleted.')).toBeInTheDocument();
      // Settings stays open; the list behind it is empty.
      expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAttribute('open');
      await user.keyboard('{Escape}');
      expect(await screen.findByText('No applications yet.')).toBeInTheDocument();
    });

    it('cancels without deleting, and starts empty next time', async () => {
      await seeded();
      const user = userEvent.setup();
      const panel = await openSettings(user);
      const open = within(card(panel, 'Your data')).getByRole('button', {
        name: 'Delete all data',
      });
      await user.click(open);
      await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.keyboard('{Escape}');
      expect(await db.applications.count()).toBe(1);
      // Focus goes back to the button that opened it.
      expect(open).toHaveFocus();
      await user.click(open);
      expect(screen.getByLabelText('Type DELETE to confirm')).toHaveValue('');
    });

    it('keeps the sheet open and says so when deleting fails', async () => {
      await seeded();
      vi.spyOn(deleteAll, 'deleteAllData').mockRejectedValue(new Error('disk'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Delete all data' }),
      );
      const sheet = screen.getByRole('dialog', { name: 'Delete all data?' });
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.click(within(sheet).getByRole('button', { name: 'Delete all data' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't delete");
      expect(sheet).toHaveAttribute('open');
    });

    it('closes when a capture switches tabs mid-delete, and still says how it went', async () => {
      await seeded();
      let fail!: (error: Error) => void;
      vi.spyOn(deleteAll, 'deleteAllData').mockReturnValue(
        new Promise((_, reject) => {
          fail = reject;
        }),
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const WINDOW_ID = 3;
      vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({
        id: WINDOW_ID,
      } satisfies Partial<Browser.windows.Window> as never);
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Delete all data' }),
      );
      const sheet = screen.getByRole('dialog', { name: 'Delete all data?' });
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.click(within(sheet).getByRole('button', { name: 'Delete all data' }));
      // A capture switches to Applications (the page behind the sheet is inert, so no user click).
      await act(async () => {
        await fakeBrowser.storage.session.set({
          [draftKey(WINDOW_ID)]: createDraft('page', { url: 'https://acme.com/2' }),
        });
      });
      await waitFor(() => expect(sheet).not.toHaveAttribute('open'));
      expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
      await act(async () => fail(new Error('disk')));
      expect(
        await screen.findByText(/Couldn't delete your data\. Nothing was deleted\./),
      ).toBeInTheDocument();
    });
  });

  describe('reset settings', () => {
    async function seeded() {
      await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
      await updateSettings({ theme: 'dark', weeklyGoal: 7, weekStartsOn: 6 });
    }

    async function openReset(user: User) {
      const panel = await openSettings(user);
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Reset settings' }),
      );
      return screen.getByRole('dialog', { name: 'Reset settings?' });
    }

    it('resets the settings and keeps the data', async () => {
      await seeded();
      const user = userEvent.setup();
      const sheet = await openReset(user);
      expect(within(sheet).queryByLabelText('Type DELETE to confirm')).toBeNull();
      await user.click(within(sheet).getByRole('button', { name: 'Reset settings' }));
      await waitFor(async () =>
        expect(await fakeBrowser.storage.local.get(Object.values(SETTINGS_KEYS))).toEqual({}),
      );
      expect(await db.applications.count()).toBe(1);
      await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
      expect(await screen.findByText('Settings reset.')).toBeInTheDocument();
    });

    it('with the box ticked, needs DELETE and then clears both', async () => {
      await seeded();
      const user = userEvent.setup();
      const sheet = await openReset(user);
      await user.click(within(sheet).getByLabelText(/Also delete all my data/));
      const confirm = within(sheet).getByRole('button', { name: 'Reset and delete everything' });
      expect(confirm).toBeDisabled();
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.click(confirm);
      await waitFor(async () => expect(await db.applications.count()).toBe(0));
      expect(await readSettings()).toMatchObject({ theme: 'system' });
      expect((await readSettings()).weeklyGoal).toBeUndefined();
      expect(
        await screen.findByText('Settings reset, and all your data deleted.'),
      ).toBeInTheDocument();
    });

    it('unticking forgets what was typed, so ticking again starts unconfirmed', async () => {
      const user = userEvent.setup();
      const sheet = await openReset(user);
      const box = within(sheet).getByLabelText(/Also delete all my data/);
      await user.click(box);
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.click(box);
      expect(within(sheet).getByRole('button', { name: 'Reset settings' })).toBeEnabled();
      await user.click(box);
      expect(within(sheet).getByLabelText('Type DELETE to confirm')).toHaveValue('');
      expect(
        within(sheet).getByRole('button', { name: 'Reset and delete everything' }),
      ).toBeDisabled();
    });

    it('leaves the settings alone when deleting the data fails', async () => {
      await seeded();
      vi.spyOn(deleteAll, 'deleteAllData').mockRejectedValue(new Error('disk'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      const sheet = await openReset(user);
      await user.click(within(sheet).getByLabelText(/Also delete all my data/));
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.click(within(sheet).getByRole('button', { name: 'Reset and delete everything' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent("Couldn't delete");
      expect(await readSettings()).toMatchObject({ theme: 'dark', weeklyGoal: 7, weekStartsOn: 6 });
    });
  });

  it('links to the bundled privacy policy and notices', async () => {
    const user = userEvent.setup();
    const panel = await openSettings(user);
    const about = card(panel, 'About');
    expect(within(about).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/privacy\.html$/),
    );
    expect(within(about).getByRole('link', { name: 'Third-party notices' })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/notices\.html$/),
    );
  });

  describe('when things go partly wrong', () => {
    async function confirmDelete(user: User) {
      const panel = await openSettings(user);
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Delete all data' }),
      );
      const sheet = screen.getByRole('dialog', { name: 'Delete all data?' });
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      return sheet;
    }

    it('says the data is gone when only the cleanup after it failed, and empties the list', async () => {
      await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
      const user = userEvent.setup();
      // Opened first, so the list shows Acme before the delete.
      render(<App />);
      await screen.findByRole('button', { name: /^Acme/ });
      vi.spyOn(fakeBrowser.storage.local, 'remove').mockRejectedValueOnce(new Error('storage'));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await user.click(screen.getByRole('button', { name: 'Settings' }));
      const panel = screen.getByRole('dialog', { name: 'Settings' });
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Delete all data' }),
      );
      const sheet = screen.getByRole('dialog', { name: 'Delete all data?' });
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      await user.click(within(sheet).getByRole('button', { name: 'Delete all data' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(
        'Your data was deleted, but a few leftovers',
      );
      expect(await db.applications.count()).toBe(0);
      await user.keyboard('{Escape}');
      await user.keyboard('{Escape}');
      expect(await screen.findByText('No applications yet.')).toBeInTheDocument();
    });

    it('says the data is gone when only the settings reset failed', async () => {
      await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
      await updateSettings({ theme: 'dark' });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      const panel = await openSettings(user);
      await user.click(
        within(card(panel, 'Your data')).getByRole('button', { name: 'Reset settings' }),
      );
      const sheet = screen.getByRole('dialog', { name: 'Reset settings?' });
      await user.click(within(sheet).getByLabelText(/Also delete all my data/));
      await user.type(within(sheet).getByLabelText('Type DELETE to confirm'), 'DELETE');
      const remove = fakeBrowser.storage.local.remove.bind(fakeBrowser.storage.local);
      vi.spyOn(fakeBrowser.storage.local, 'remove').mockImplementation((async (keys: unknown) => {
        // The settings reset removes several keys; the delete's cleanup removes one.
        if (Array.isArray(keys)) throw new Error('storage');
        return remove(keys as string);
      }) as never);
      await user.click(within(sheet).getByRole('button', { name: 'Reset and delete everything' }));
      expect(await within(sheet).findByRole('alert')).toHaveTextContent(
        "Your data was deleted, but the settings couldn't be reset.",
      );
      expect(await db.applications.count()).toBe(0);
    });

    it('a sheet closed while deleting shows no old error when reopened', async () => {
      let fail!: (error: Error) => void;
      vi.spyOn(deleteAll, 'deleteAllData').mockImplementation(
        () => new Promise((_, reject) => (fail = reject)),
      );
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const user = userEvent.setup();
      const sheet = await confirmDelete(user);
      await user.click(within(sheet).getByRole('button', { name: 'Delete all data' }));
      await user.keyboard('{Escape}');
      await act(async () => fail(new Error('disk')));
      const panel = screen.getByRole('dialog', { name: 'Settings' });
      // The card's own button (the closed sheet's one has the same name).
      await user.click(
        within(card(panel, 'Your data')).getAllByRole('button', { name: 'Delete all data' })[0]!,
      );
      expect(within(sheet).queryByRole('alert')).toBeNull();
    });

    it('runs once however fast the button is pressed twice', async () => {
      const spy = vi.spyOn(deleteAll, 'deleteAllData');
      const user = userEvent.setup();
      const sheet = await confirmDelete(user);
      const button = within(sheet).getByRole('button', { name: 'Delete all data' });
      await act(async () => {
        button.click();
        button.click();
      });
      await waitFor(() => expect(sheet).not.toHaveAttribute('open'));
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  it('saves the goal once for Enter followed by leaving the field', async () => {
    await updateSettings({ weeklyGoal: 8 });
    const user = userEvent.setup();
    const panel = await openSettings(user);
    const set = vi.spyOn(fakeBrowser.storage.local, 'set');
    const field = within(panel).getByLabelText('Applications per week');
    await user.clear(field);
    await user.type(field, '12{Enter}');
    await user.tab();
    await waitFor(async () => expect((await readSettings()).weeklyGoal).toBe(12));
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('a delete in another window clears this window’s remembered form defaults', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('No applications yet.');
    // Another window deletes everything.
    await act(() => fakeBrowser.storage.local.remove(FORM_DEFAULTS_KEY));
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    await user.click(screen.getByRole('button', { name: 'More details' }));
    expect(sourceValue()).toBe('');
  });
});
