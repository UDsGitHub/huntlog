import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { db } from '@/lib/db';
import * as deleteAll from '@/lib/deleteAll';
import { FORM_DEFAULTS_KEY } from '@/lib/formDefaults';
import { readSettings, SETTINGS_KEYS, updateSettings } from '@/lib/settings';
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
  await user.click(await screen.findByRole('tab', { name: 'Settings' }));
  return screen.findByRole('tabpanel', { name: 'Settings' });
}

const card = (panel: HTMLElement, name: string) => within(panel).getByRole('region', { name });

describe('Settings tab', () => {
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
    expect(within(panel).getByLabelText('First day of the week')).toHaveDisplayValue(
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

    it.each([['0'], ['201'], ['2.5'], ['abc'], ['-3'], [''], ['1e1']])(
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
      await user.selectOptions(select, 'Monday');
      await waitFor(async () => expect((await readSettings()).weekStartsOn).toBe(1));
      await user.selectOptions(select, 'Locale default (Sunday)');
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
      // Back on Applications? No: Settings stays selected; the list behind it is empty.
      await user.click(screen.getByRole('tab', { name: 'Applications' }));
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
});
