import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as applications from '@/lib/applications';
import { addApplication, setStatus, softDeleteApplication } from '@/lib/applications';
import { createDraft, draftKey } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import { updateSettings } from '@/lib/settings';
import App from '@/entrypoints/sidepanel/App';

// Friday, Oct 16 2026, in en-US: the week runs Sunday Oct 11 to Saturday Oct 17.
const NOW = new Date(2026, 9, 16, 15);
const on = (day: number) => new Date(2026, 9, day, 12);

beforeEach(async () => {
  // Only Date: Dexie and React need real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fakeBrowser.reset();
  await db.delete();
  await db.open();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

let n = 0;
async function applied(
  appliedAt: string,
  then?: { status: 'screening' | 'interviewing'; day: number },
) {
  const app = await addApplication(
    { url: `https://acme.com/jobs/${++n}`, company: `Acme ${n}`, status: 'applied', appliedAt },
    db,
    new Date(`${appliedAt}T12:00:00`),
  );
  if (then) await setStatus(app.id, then.status, {}, db, on(then.day));
  return app;
}

async function openStats(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(await screen.findByRole('tab', { name: 'Stats' }));
  const panel = screen.getByRole('tabpanel', { name: 'Stats' });
  // The panel renders once its live query has loaded.
  await within(panel).findByRole('radiogroup', { name: 'Range' });
  return panel;
}

const chip = (panel: HTMLElement, name: string) =>
  within(within(panel).getByRole('radiogroup', { name: 'Range' })).getByRole('radio', { name });
const pressedChip = (panel: HTMLElement) =>
  within(within(panel).getByRole('radiogroup', { name: 'Range' })).getByRole('radio', {
    checked: true,
  });
const customSheet = () => screen.getByRole('dialog', { name: 'Custom range' });

async function openCustom(user: ReturnType<typeof userEvent.setup>, panel: HTMLElement) {
  await user.click(chip(panel, 'Custom…'));
  return customSheet();
}

/** A headline card by its label (rate labels share their <dt> with the counts line). */
const card = (panel: HTMLElement, label: string | RegExp) =>
  within(panel).getByText(label, { selector: 'dt' }).closest('div')!;

describe('Stats tab', () => {
  it('shows an encouraging empty state with no applications', async () => {
    const user = userEvent.setup();
    const panel = await openStats(user);
    expect(panel).toHaveTextContent('Your stats show up here once you log applications.');
    expect(within(panel).queryByText('Applied', { selector: 'dt' })).toBeNull();
  });

  it("shows this week's numbers by default, then This month", async () => {
    await applied('2026-10-12', { status: 'interviewing', day: 14 });
    await applied('2026-10-13', { status: 'screening', day: 15 });
    await applied('2026-10-14');
    await applied('2026-10-15');
    await applied('2026-10-02'); // earlier this month
    const deleted = await applied('2026-10-12');
    await softDeleteApplication(deleted.id);

    const user = userEvent.setup();
    const panel = await openStats(user);
    expect(pressedChip(panel)).toHaveAccessibleName('This week');
    expect(panel).toHaveTextContent('Oct 11, 2026 – Oct 17, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('4');
    expect(card(panel, 'Interviews')).toHaveTextContent('1');
    expect(card(panel, 'Offers')).toHaveTextContent('0');
    expect(card(panel, /Response rate/)).toHaveTextContent('2 of 4 heard back');
    expect(card(panel, /Response rate/)).toHaveTextContent('50%');
    expect(card(panel, /Interview rate/)).toHaveTextContent('25%');

    await user.click(chip(panel, 'This month'));
    expect(pressedChip(panel)).toHaveAccessibleName('This month');
    expect(chip(panel, 'This week')).toHaveAttribute('aria-checked', 'false');
    expect(panel).toHaveTextContent('Oct 1, 2026 – Oct 31, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('5');
    expect(card(panel, /Response rate/)).toHaveTextContent('2 of 5 heard back');
  });

  it('shows a dash, not 0%, when nothing was applied in the range', async () => {
    await applied('2026-09-01');
    const user = userEvent.setup();
    const panel = await openStats(user);
    expect(card(panel, 'Applied')).toHaveTextContent('0');
    const response = card(panel, /Response rate/);
    expect(response).toHaveTextContent('—');
    expect(response).not.toHaveTextContent('0%');
    expect(within(response).getByText('No rate yet')).toHaveClass('sr-only');
    expect(panel).toHaveTextContent('Nothing applied in this range yet.');
    // One empty-state message, not a second one from an empty chart.
    expect(within(panel).queryByRole('region', { name: /^Applications per/ })).toBeNull();
    expect(within(panel).queryByRole('region', { name: 'Where they stand now' })).toBeNull();
  });

  it('picks a range from the chips with one Tab stop; arrows move without picking', async () => {
    await applied('2026-10-12');
    const user = userEvent.setup();
    const panel = await openStats(user);
    const chips = within(within(panel).getByRole('radiogroup', { name: 'Range' })).getAllByRole(
      'radio',
    );
    expect(chips.map((c) => c.textContent)).toEqual([
      'This week',
      'Last 7 days',
      'This month',
      'Last 30 days',
      'This year',
      'All time',
      'Custom…',
    ]);
    // Only the chosen chip is a Tab stop.
    expect(chips.map((c) => c.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    chips[0]!.focus();
    await user.keyboard('{ArrowRight}');
    expect(chips[1]).toHaveFocus();
    expect(pressedChip(panel)).toBe(chips[0]);
    await user.keyboard('{End}');
    // Landing on Custom doesn't open its sheet.
    expect(chips[6]).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(chips[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}{Enter}');
    expect(pressedChip(panel)).toBe(chips[5]);
    expect(chips[5]).toHaveAttribute('tabindex', '0');
    expect(panel).toHaveTextContent('Oct 12, 2026 – Oct 16, 2026');
  });

  it('Custom opens a sheet on the last 30 days, and Apply shows that range', async () => {
    await applied('2026-09-01');
    await applied('2026-09-20');
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    const sheet = await openCustom(user, panel);
    const from = within(sheet).getByLabelText('From');
    const to = within(sheet).getByLabelText('To');
    expect(from).toHaveFocus();
    expect(from).toHaveValue('2026-09-17');
    expect(to).toHaveValue('2026-10-16');
    expect(to).toHaveAttribute('max', '2026-10-16');
    expect(to).toHaveAttribute('min', '1970-01-01');
    // Nothing changes until Apply.
    expect(pressedChip(panel)).toHaveAccessibleName('This week');

    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pressedChip(panel)).toHaveAccessibleName('Custom…');
    expect(chip(panel, 'Custom…')).toHaveFocus();
    expect(panel).toHaveTextContent('Sep 17, 2026 – Oct 16, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('2');

    // Reopened, it shows the applied dates; Enter in a field applies.
    const again = await openCustom(user, panel);
    expect(within(again).getByLabelText('From')).toHaveValue('2026-09-17');
    await user.clear(within(again).getByLabelText('From'));
    await user.type(within(again).getByLabelText('From'), '2026-09-01{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(card(panel, 'Applied')).toHaveTextContent('3');
  });

  it('swaps dates entered the wrong way round', async () => {
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    const sheet = await openCustom(user, panel);
    const from = within(sheet).getByLabelText('From');
    const to = within(sheet).getByLabelText('To');
    await user.clear(from);
    await user.type(from, '2026-10-12');
    await user.clear(to);
    await user.type(to, '2026-10-01');
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(panel).toHaveTextContent('Oct 1, 2026 – Oct 12, 2026');
    const again = await openCustom(user, panel);
    expect(within(again).getByLabelText('From')).toHaveValue('2026-10-01');
    expect(within(again).getByLabelText('To')).toHaveValue('2026-10-12');
  });

  it('says what is wrong with a date on Apply, and keeps the range showing', async () => {
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    const sheet = await openCustom(user, panel);
    const from = within(sheet).getByLabelText('From');
    const to = within(sheet).getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2026-10-20');
    await user.clear(from);
    expect(from).not.toHaveAttribute('aria-invalid');
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    // Each field says what's wrong with it, and the first takes focus.
    expect(from).toHaveAccessibleDescription('Enter a date.');
    expect(to).toHaveAccessibleDescription("This date can't be in the future.");
    expect(from).toHaveFocus();
    expect(customSheet()).toBeInTheDocument();
    expect(pressedChip(panel)).toHaveAccessibleName('This week');

    // Fixing one date leaves the other's error showing.
    await user.type(from, '2026-10-01');
    expect(from).not.toHaveAttribute('aria-invalid');
    expect(to).toHaveAccessibleDescription("This date can't be in the future.");
    await user.clear(from);
    await user.type(from, '1969-12-31');
    expect(from).not.toHaveAttribute('aria-invalid');
    await user.click(within(sheet).getByRole('button', { name: 'Apply' }));
    expect(from).toHaveAccessibleDescription('Enter a valid date.');
  });

  it('closing without Apply keeps the range that was showing', async () => {
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    await user.click(chip(panel, 'This month'));
    const sheet = await openCustom(user, panel);
    await user.clear(within(sheet).getByLabelText('From'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pressedChip(panel)).toHaveAccessibleName('This month');
    expect(chip(panel, 'Custom…')).toHaveFocus();
    // What was typed is forgotten: it opens on the last 30 days again.
    const again = await openCustom(user, panel);
    expect(within(again).getByLabelText('From')).toHaveValue('2026-09-17');
    expect(within(again).getByLabelText('From')).not.toHaveAttribute('aria-invalid');
  });

  it('a capture closes the Custom sheet, and coming back does not reopen it', async () => {
    vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({
      id: 3,
    } satisfies Partial<Browser.windows.Window> as never);
    const user = userEvent.setup();
    const panel = await openStats(user);
    await user.click(chip(panel, 'This month'));
    await openCustom(user, panel);
    await act(async () => {
      await fakeBrowser.storage.session.set({
        [draftKey(3)]: createDraft('page', { url: 'https://acme.com/1' }),
      });
    });
    expect(await screen.findByRole('dialog', { name: 'Add application' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Custom range' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(pressedChip(panel)).toHaveAccessibleName('This month');
  });

  it('moves on to the new day when the panel is shown again after midnight', async () => {
    await applied('2026-10-17'); // Saturday: this week until the week turns
    const user = userEvent.setup();
    const panel = await openStats(user);
    expect(panel).toHaveTextContent('Oct 11, 2026 – Oct 17, 2026');
    vi.setSystemTime(new Date(2026, 9, 18, 9)); // Sunday: a new week
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(panel).toHaveTextContent('Oct 18, 2026 – Oct 24, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('0');
  });

  it('keeps the range while another tab shows', async () => {
    await applied('2026-10-12');
    const user = userEvent.setup();
    const panel = await openStats(user);
    await user.click(chip(panel, 'All time'));
    await user.click(screen.getByRole('tab', { name: 'Applications' }));
    await user.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(pressedChip(panel)).toHaveAccessibleName('All time');
  });

  it("shows a message instead of a blank tab when the stats can't load", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(applications, 'listApplications').mockRejectedValue(new Error('DB blocked'));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('tab', { name: 'Stats' }));
    const panel = screen.getByRole('tabpanel', { name: 'Stats' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent("Couldn't load your stats");
    // The rest of the panel still works.
    expect(screen.getByRole('tab', { name: 'Resumes' })).toBeInTheDocument();
  });

  it('starts the week on the day picked in Settings', async () => {
    await updateSettings({ weekStartsOn: 1 });
    await applied('2026-10-11'); // Sunday: last week when weeks start on Monday
    await applied('2026-10-12'); // Monday
    const user = userEvent.setup();
    const panel = await openStats(user);
    expect(panel).toHaveTextContent('Oct 12, 2026 – Oct 18, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('1');
  });

  it('re-counts this week when the first day changes in another window', async () => {
    await applied('2026-10-11'); // Sunday
    await applied('2026-10-12'); // Monday
    const user = userEvent.setup();
    const panel = await openStats(user);
    // en-US starts on Sunday.
    expect(panel).toHaveTextContent('Oct 11, 2026 – Oct 17, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('2');

    await act(() => updateSettings({ weekStartsOn: 6 }));
    expect(panel).toHaveTextContent('Oct 10, 2026 – Oct 16, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('2');

    await act(() => updateSettings({ weekStartsOn: 1 }));
    expect(panel).toHaveTextContent('Oct 12, 2026 – Oct 18, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('1');

    // Back to following the locale.
    await act(() => updateSettings({ weekStartsOn: undefined }));
    expect(panel).toHaveTextContent('Oct 11, 2026 – Oct 17, 2026');
  });

  it('updates live when an application is added', async () => {
    const user = userEvent.setup();
    const panel = await openStats(user);
    await applied('2026-10-13');
    expect(await within(panel).findByText('Applied', { selector: 'dt' })).toBeInTheDocument();
    expect(card(panel, 'Applied')).toHaveTextContent('1');
  });

  it('leads with the Applied number alone, then Interviews and Offers as two cards', async () => {
    await applied('2026-10-13');
    const user = userEvent.setup();
    const panel = await openStats(user);
    const headline = within(panel).getByLabelText('Headline numbers');
    expect(
      within(headline)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual(['Interviews', 'Offers']);
    expect(headline).not.toContainElement(card(panel, 'Applied'));
    expect(within(panel).queryByRole('region', { name: 'Weekly goal' })).toBeNull();
  });

  describe('weekly goal ring', () => {
    const ring = (panel: HTMLElement) =>
      within(panel).queryByRole('region', { name: 'Weekly goal' });

    it('shows only when a goal is set', async () => {
      await applied('2026-10-13');
      const user = userEvent.setup();
      const panel = await openStats(user);
      expect(ring(panel)).toBeNull();
      await act(() => updateSettings({ weeklyGoal: 10 }));
      expect(
        await within(panel).findByRole('img', { name: '1 of 10 applications this week' }),
      ).toBeInTheDocument();
      await act(() => updateSettings({ weeklyGoal: undefined }));
      await waitFor(() => expect(ring(panel)).toBeNull());
    });

    it('counts this week, whatever range is picked', async () => {
      await updateSettings({ weeklyGoal: 10 });
      await applied('2026-10-12');
      await applied('2026-10-14');
      await applied('2026-10-16');
      await applied('2026-10-02'); // earlier this month: not this week
      const user = userEvent.setup();
      const panel = await openStats(user);
      expect(ring(panel)).toHaveTextContent('3 of 10 this week');
      expect(ring(panel)).toHaveAccessibleDescription('7 more to reach your goal.');
      await user.click(chip(panel, 'This month'));
      expect(card(panel, 'Applied')).toHaveTextContent('4');
      expect(ring(panel)).toHaveTextContent('3 of 10 this week');
    });

    it('says when the goal is reached, and how far past it', async () => {
      await updateSettings({ weeklyGoal: 2 });
      await applied('2026-10-12');
      await applied('2026-10-13');
      const user = userEvent.setup();
      const panel = await openStats(user);
      expect(ring(panel)).toHaveAccessibleDescription('Goal reached. Nice work.');
      await applied('2026-10-14');
      await waitFor(() => expect(ring(panel)).toHaveTextContent('3 of 2 this week'));
      expect(ring(panel)).toHaveAccessibleDescription('Goal reached, and 1 beyond it.');
    });

    it('says "application" for a goal of one', async () => {
      await updateSettings({ weeklyGoal: 1 });
      await applied('2026-10-13');
      const user = userEvent.setup();
      const panel = await openStats(user);
      expect(
        within(panel).getByRole('img', { name: '1 of 1 application this week' }),
      ).toBeInTheDocument();
    });

    it('follows the first day of the week', async () => {
      await updateSettings({ weeklyGoal: 5, weekStartsOn: 1 });
      await applied('2026-10-11'); // Sunday: last week when weeks start on Monday
      await applied('2026-10-12');
      const user = userEvent.setup();
      const panel = await openStats(user);
      expect(ring(panel)).toHaveTextContent('1 of 5 this week');
    });
  });
});
