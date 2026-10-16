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

/** Picks a date and leaves the field, which is when the timeline saves. */
function changeDate(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

async function openDetail() {
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('button', { name: /^Acme/ }));
  await screen.findByRole('heading', { level: 2, name: 'Acme' });
  return screen.getByRole('region', { name: 'Status history' });
}

describe('Status timeline', () => {
  it('lists every entry by date with an editable date each', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await setStatus(app.id, 'screening');
    await setStatus(app.id, 'interviewing');
    const timeline = await openDetail();
    const items = within(timeline).getAllByRole('listitem');
    expect(items.map((li) => li.querySelector('label')?.textContent)).toEqual([
      'Applied',
      'Screening',
      'Interviewing',
    ]);
    expect(within(timeline).getByLabelText('Screening')).toHaveValue(
      localDateOf(new Date().toISOString()),
    );
  });

  it('backfills a date, saves it, and re-sorts by date', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    await setStatus(app.id, 'interviewing');
    const timeline = await openDetail();
    changeDate(within(timeline).getByLabelText('Interviewing'), '2020-01-02');

    await waitFor(async () =>
      expect(localDateOf((await db.applications.get(app.id))!.statusHistory[1]!.at)).toBe(
        '2020-01-02',
      ),
    );
    await waitFor(() =>
      expect(
        within(timeline)
          .getAllByRole('listitem')
          .map((li) => li.querySelector('label')?.textContent),
      ).toEqual(['Interviewing', 'Applied']),
    );
    // Stored order is untouched.
    expect((await db.applications.get(app.id))!.statusHistory.map((e) => e.status)).toEqual([
      'applied',
      'interviewing',
    ]);
  });

  it('moves Date applied with the first Applied entry', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const timeline = await openDetail();
    changeDate(within(timeline).getByLabelText('Applied'), '2026-01-05');
    await waitFor(async () =>
      expect((await db.applications.get(app.id))?.appliedAt).toBe('2026-01-05'),
    );
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Acme' })).toHaveTextContent('2026-01-05'),
    );
  });

  it('shows a linked error for a future date and saves nothing', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const before = await db.applications.get(app.id);
    const timeline = await openDetail();
    const input = within(timeline).getByLabelText('Applied');
    changeDate(input, '2999-01-01');
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription("This date can't be in the future."),
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await db.applications.get(app.id)).toEqual(before);
  });

  it('explains when the entry changed meanwhile', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const timeline = await openDetail();
    const input = within(timeline).getByLabelText('Applied');
    vi.spyOn(applications, 'updateHistoryDate').mockResolvedValueOnce({
      error: 'This entry changed meanwhile. Check the date and try again.',
    });
    changeDate(input, '2026-01-05');
    await waitFor(() =>
      expect(input).toHaveAccessibleDescription(
        'This entry changed meanwhile. Check the date and try again.',
      ),
    );
    expect(app.id).toBeTruthy();
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
    await waitFor(() => expect(within(timeline).getByLabelText('Offer')).toBeInTheDocument());
  });

  it("doesn't save while the date is still being changed, only when the field is left", async () => {
    const spy = vi.spyOn(applications, 'updateHistoryDate');
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const timeline = await openDetail();
    const input = within(timeline).getByLabelText('Applied');
    // Typing a year arrives as a series of changes; none of them saves.
    for (const partial of ['0002-01-05', '0020-01-05', '0202-01-05', '2025-01-05']) {
      fireEvent.change(input, { target: { value: partial } });
    }
    expect(spy).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy.mock.calls[0]![2]).toBe('2025-01-05');
  });

  it('rejects a half-typed year that would otherwise look valid', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const timeline = await openDetail();
    const input = within(timeline).getByLabelText('Applied');
    changeDate(input, '0202-01-05');
    await waitFor(() => expect(input).toHaveAccessibleDescription('Enter a valid date.'));
  });
});
