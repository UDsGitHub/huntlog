import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import * as applications from '@/lib/applications';
import { addApplication, setStatus, softDeleteApplication } from '@/lib/applications';
import { db } from '@/lib/db';
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
  await within(panel).findByLabelText('Range');
  return panel;
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
    expect(within(panel).getByLabelText('Range')).toHaveValue('this-week');
    expect(panel).toHaveTextContent('Oct 11, 2026 – Oct 17, 2026');
    expect(card(panel, 'Applied')).toHaveTextContent('4');
    expect(card(panel, 'Interviews')).toHaveTextContent('1');
    expect(card(panel, 'Offers')).toHaveTextContent('0');
    expect(card(panel, /Response rate/)).toHaveTextContent('2 of 4 heard back');
    expect(card(panel, /Response rate/)).toHaveTextContent('50%');
    expect(card(panel, /Interview rate/)).toHaveTextContent('25%');

    await user.selectOptions(within(panel).getByLabelText('Range'), 'This month');
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
  });

  it('a custom range starts at the last 30 days and follows the dates typed', async () => {
    await applied('2026-09-01');
    await applied('2026-09-20');
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    await user.selectOptions(within(panel).getByLabelText('Range'), 'Custom');
    const from = within(panel).getByLabelText('From');
    const to = within(panel).getByLabelText('To');
    expect(from).toHaveValue('2026-09-17');
    expect(to).toHaveValue('2026-10-16');
    expect(to).toHaveAttribute('max', '2026-10-16');
    expect(card(panel, 'Applied')).toHaveTextContent('2');

    await user.clear(from);
    // Only the field that's wrong is flagged, with its own message.
    expect(from).toHaveAccessibleDescription('Enter a date.');
    expect(from).toHaveAttribute('aria-invalid', 'true');
    expect(to).not.toHaveAttribute('aria-invalid');
    expect(within(panel).queryByText('Applied', { selector: 'dt' })).toBeNull();

    await user.type(from, '2026-09-01');
    expect(card(panel, 'Applied')).toHaveTextContent('3');
    expect(from).not.toHaveAttribute('aria-invalid');
  });

  it('says what is wrong with a typed date', async () => {
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    await user.selectOptions(within(panel).getByLabelText('Range'), 'Custom');
    const to = within(panel).getByLabelText('To');
    expect(to).toHaveAttribute('min', '1970-01-01');
    await user.clear(to);
    await user.type(to, '2026-10-20');
    expect(to).toHaveAccessibleDescription("This date can't be in the future.");
    await user.clear(to);
    await user.type(to, '1969-12-31');
    expect(to).toHaveAccessibleDescription('Enter a valid date.');
  });

  it('refills a half-cleared custom range when Custom is picked again', async () => {
    await applied('2026-10-10');
    const user = userEvent.setup();
    const panel = await openStats(user);
    const range = within(panel).getByLabelText('Range');
    await user.selectOptions(range, 'Custom');
    await user.clear(within(panel).getByLabelText('From'));
    await user.selectOptions(range, 'This week');
    await user.selectOptions(range, 'Custom');
    expect(within(panel).getByLabelText('From')).toHaveValue('2026-09-17');
    expect(within(panel).getByLabelText('From')).not.toHaveAttribute('aria-invalid');
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
    await user.selectOptions(within(panel).getByLabelText('Range'), 'All time');
    await user.click(screen.getByRole('tab', { name: 'Applications' }));
    await user.click(screen.getByRole('tab', { name: 'Stats' }));
    expect(within(panel).getByLabelText('Range')).toHaveValue('all-time');
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

  it('updates live when an application is added', async () => {
    const user = userEvent.setup();
    const panel = await openStats(user);
    await applied('2026-10-13');
    expect(await within(panel).findByText('Applied', { selector: 'dt' })).toBeInTheDocument();
    expect(card(panel, 'Applied')).toHaveTextContent('1');
  });
});
