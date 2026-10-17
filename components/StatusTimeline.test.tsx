import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as applications from '@/lib/applications';
import { addApplication, setStatus } from '@/lib/applications';
import { db } from '@/lib/db';
import { localDateOf } from '@/lib/status';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

type User = ReturnType<typeof userEvent.setup>;

/** Opens an entry's date with its pencil and types a new one, without saving. */
async function startEdit(user: User, timeline: HTMLElement, status: string, value: string) {
  await user.click(within(timeline).getByRole('button', { name: `Change the date for ${status}` }));
  const input = within(timeline).getByLabelText(`${status} date`);
  fireEvent.change(input, { target: { value } });
  return input;
}

/** Changes an entry's date and presses its Save. */
async function editDate(user: User, timeline: HTMLElement, status: string, value: string) {
  const input = await startEdit(user, timeline, status, value);
  await user.click(within(timeline).getByRole('button', { name: `Save the date for ${status}` }));
  return input;
}

/** Entry statuses, top to bottom. */
const entries = (timeline: HTMLElement) =>
  within(timeline)
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.font-medium')?.textContent);

async function openDetail() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /^Acme/ }));
  await screen.findByRole('heading', { level: 2, name: 'Acme' });
  return screen.getByRole('region', { name: 'Status history' });
}

describe('Status timeline', () => {
  it('lists every entry by date, read-only, each with a pencil', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await setStatus(app.id, 'screening');
    await setStatus(app.id, 'interviewing');
    const timeline = await openDetail();
    expect(entries(timeline)).toEqual(['Applied', 'Screening', 'Interviewing']);
    expect(within(timeline).queryByRole('textbox')).toBeNull();
    expect(timeline.querySelector('input')).toBeNull();
    expect(
      within(timeline).getByRole('button', { name: 'Change the date for Screening' }),
    ).toBeInTheDocument();
  });

  it('backfills a date with Save, re-sorts, and returns focus to the pencil', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await setStatus(app.id, 'interviewing');
    const user = userEvent.setup();
    const timeline = await openDetail();
    await editDate(user, timeline, 'Interviewing', '2020-01-02');

    await waitFor(async () =>
      expect(localDateOf((await db.applications.get(app.id))!.statusHistory[1]!.at)).toBe(
        '2020-01-02',
      ),
    );
    await waitFor(() => expect(entries(timeline)).toEqual(['Interviewing', 'Applied']));
    expect(
      within(timeline).getByRole('button', { name: 'Change the date for Interviewing' }),
    ).toHaveFocus();
    // Stored order is untouched.
    expect((await db.applications.get(app.id))!.statusHistory.map((e) => e.status)).toEqual([
      'applied',
      'interviewing',
    ]);
  });

  // Regression: the date used to save only when the field lost focus, so picking one from the
  // calendar (which keeps focus in the field) changed nothing until you clicked elsewhere, and
  // Date applied looked stuck. Now Save is explicit, and Date applied follows at once.
  it('moves Date applied with the first Applied entry as soon as Save is pressed', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    const timeline = await openDetail();
    await editDate(user, timeline, 'Applied', '2026-01-05');
    await waitFor(async () =>
      expect((await db.applications.get(app.id))?.appliedAt).toBe('2026-01-05'),
    );
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Acme' })).toHaveTextContent('Jan 5, 2026'),
    );
  });

  it('saves nothing just by picking a date, even when the field is left', async () => {
    const spy = vi.spyOn(applications, 'updateHistoryDate');
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    const timeline = await openDetail();
    const input = await startEdit(user, timeline, 'Applied', '2025-01-05');
    // Typing a year arrives as a series of changes; none of them saves, nor does leaving.
    for (const partial of ['0002-01-05', '0020-01-05', '2025-01-05']) {
      fireEvent.change(input, { target: { value: partial } });
    }
    fireEvent.blur(input);
    expect(spy).not.toHaveBeenCalled();
  });

  it('Enter saves; Escape cancels and puts focus back on the pencil', async () => {
    const spy = vi.spyOn(applications, 'updateHistoryDate');
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    const timeline = await openDetail();
    await startEdit(user, timeline, 'Applied', '2025-01-05');
    await user.keyboard('{Escape}');
    expect(spy).not.toHaveBeenCalled();
    expect(within(timeline).queryByLabelText('Applied date')).toBeNull();
    const pencil = within(timeline).getByRole('button', { name: 'Change the date for Applied' });
    expect(pencil).toHaveFocus();
    // Escape closed only the editor, not the detail view.
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' })).toBeInTheDocument();

    await startEdit(user, timeline, 'Applied', '2025-01-05');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![2]).toBe('2025-01-05');
  });

  it('shows a linked error for a future date and saves nothing', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const before = await db.applications.get(app.id);
    const user = userEvent.setup();
    const timeline = await openDetail();
    const input = await editDate(user, timeline, 'Applied', '2999-01-01');
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription("This date can't be in the future."),
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await db.applications.get(app.id)).toEqual(before);
  });

  it('explains when the entry changed meanwhile', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    vi.spyOn(applications, 'updateHistoryDate').mockResolvedValueOnce({
      error: 'This entry changed meanwhile. Check the date and try again.',
    });
    const user = userEvent.setup();
    const timeline = await openDetail();
    const input = await editDate(user, timeline, 'Applied', '2026-01-05');
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription(
        'This entry changed meanwhile. Check the date and try again.',
      ),
    );
  });

  it('says so when there is no history yet', async () => {
    await db.applications.add({
      id: 'legacy',
      url: 'https://acme.com/1',
      urlNormalized: '',
      company: 'Acme',
      status: 'applied',
      statusHistory: [],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    const timeline = await openDetail();
    expect(within(timeline).getByText('No history yet.')).toBeInTheDocument();
  });

  it('updates when the status changes from the chip', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const timeline = await openDetail();
    await act(async () => {
      await setStatus(app.id, 'offer');
    });
    await waitFor(() => expect(entries(timeline)).toContain('Offer'));
  });

  it('rejects a half-typed year that would otherwise look valid', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    const timeline = await openDetail();
    const input = await editDate(user, timeline, 'Applied', '0202-01-05');
    await waitFor(() => expect(input).toHaveAccessibleDescription('Enter a valid date.'));
  });

  it('drops an open editor whose entry changed elsewhere, rather than saving onto another', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await setStatus(app.id, 'interviewing');
    const user = userEvent.setup();
    const timeline = await openDetail();
    await startEdit(user, timeline, 'Interviewing', '2020-01-02');
    // Another window replaces that entry in one write: Interviewing (undone) became Offer, at
    // the same position with a new time.
    await act(async () => {
      const current = (await db.applications.get(app.id))!;
      await db.applications.put({
        ...current,
        status: 'offer',
        statusHistory: [
          current.statusHistory[0]!,
          { status: 'offer', at: new Date().toISOString() },
        ],
      });
    });
    await waitFor(() => expect(entries(timeline)).toEqual(['Applied', 'Offer']));
    // Its editor is gone, not carried over with the typed date to the new entry.
    expect(within(timeline).queryByLabelText('Offer date')).toBeNull();
    expect(within(timeline).queryByLabelText('Interviewing date')).toBeNull();
  });

  it('saves once however fast Save is pressed twice', async () => {
    const spy = vi.spyOn(applications, 'updateHistoryDate');
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    const timeline = await openDetail();
    await startEdit(user, timeline, 'Applied', '2025-01-05');
    const save = within(timeline).getByRole('button', { name: 'Save the date for Applied' });
    await act(async () => {
      save.click();
      save.click();
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });
});
