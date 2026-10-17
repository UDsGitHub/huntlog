import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as applications from '@/lib/applications';
import { addApplication, saveApplication } from '@/lib/applications';
import { todayLocal } from '@/lib/dates';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';
import { StatusChip } from './StatusChip';

beforeEach(async () => {
  // Sheets close at once, so focus is back on the chip without waiting for the slide.
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

type User = ReturnType<typeof userEvent.setup>;
/** The chip in the list row whose open-button starts with `company`. */
const chipFor = (company: string) =>
  within(screen.getByRole('button', { name: new RegExp(`^${company}`) }).parentElement!).getByRole(
    'button',
    { name: /^Status: / },
  );

/** A status in the open sheet. */
const option = (name: string) =>
  within(screen.getByRole('dialog', { name: 'Change status' })).getByRole('button', { name });

async function seedSaved(company = 'Acme') {
  const result = await saveApplication({
    url: `https://${company.toLowerCase()}.com/1`,
    company,
    status: 'saved',
  });
  if (!('saved' in result)) throw new Error('expected a save');
  return result.saved;
}

async function renderList() {
  render(<App />);
  await screen.findByRole('list', { name: 'Applications' });
}

describe('StatusChip (unit)', () => {
  const app = {
    company: 'Acme',
    title: 'Engineer',
    status: 'applied' as const,
    appliedAt: '2026-10-01',
  };
  const chip = () => screen.getByRole('button', { name: /^Status: / });

  it('is a button that opens a dialog, labelled with the current status', () => {
    render(<StatusChip application={app} onPick={() => {}} />);
    expect(chip()).toHaveAccessibleName('Status: Applied. Change status');
    expect(chip()).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('opens a sheet of all 9 statuses in Active and Closed groups, the current one marked and focused', async () => {
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={() => {}} />);
    await user.click(chip());
    const sheet = screen.getByRole('dialog', { name: 'Change status' });
    expect(sheet).toHaveAccessibleDescription('Acme · Engineer');
    expect(
      within(within(sheet).getByRole('group', { name: 'Active' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Saved', 'Applied(current)', 'Screening', 'Interviewing', 'Offer']);
    expect(
      within(within(sheet).getByRole('group', { name: 'Closed' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Accepted', 'Rejected', 'Withdrawn', 'Ghosted']);
    const current = within(sheet).getByRole('button', { name: 'Applied (current)' });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current).toHaveFocus();
  });

  it('arrow keys move without changing anything (wrapping); Enter picks', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(chip());
    await user.keyboard('{ArrowDown}');
    expect(option('Screening')).toHaveFocus();
    await user.keyboard('{End}');
    expect(option('Ghosted')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(option('Saved')).toHaveFocus();
    await user.keyboard('{ArrowUp}{Home}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(option('Interviewing')).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ status: 'interviewing' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
  });

  it('Escape closes without a change and returns focus to the chip', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(chip());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip()).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a click outside closes without a change', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(chip());
    const dialog = document.querySelector('dialog')!;
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picking the current status changes nothing', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(chip());
    await user.click(option('Applied (current)'));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never colors Rejected red', () => {
    render(<StatusChip application={{ ...app, status: 'rejected' }} onPick={() => {}} />);
    expect(chip().className).not.toMatch(/red|destructive/);
  });
});

describe('Date applied step', () => {
  const saved = { company: 'Acme', status: 'saved' as const };

  async function pick(user: User, status: string, onPick = vi.fn()) {
    render(<StatusChip application={saved} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Status: Saved/ }));
    await user.click(option(status));
    return onPick;
  }

  it('asks in the same sheet when moving to a status that implies an application', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Interviewing');
    const sheet = screen.getByRole('dialog', { name: 'When did you apply?' });
    expect(sheet).toHaveAccessibleDescription('Moving Acme to Interviewing.');
    const date = within(sheet).getByLabelText('Date applied');
    expect(date).toHaveValue(todayLocal());
    expect(date).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Set date passes the chosen date', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Offer');
    fireEvent.change(screen.getByLabelText('Date applied'), { target: { value: '2026-09-30' } });
    await user.click(screen.getByRole('button', { name: 'Set date' }));
    expect(onPick).toHaveBeenCalledWith({ status: 'offer', appliedAt: '2026-09-30' });
    expect(screen.getByRole('button', { name: /Status: Saved/ })).toHaveFocus();
  });

  it('Skip changes the status without a date', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Rejected');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onPick).toHaveBeenCalledWith({ status: 'rejected' });
  });

  it('rejects a future date with a linked error', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Offer');
    fireEvent.change(screen.getByLabelText('Date applied'), { target: { value: '2999-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Set date' }));
    const date = screen.getByLabelText('Date applied');
    expect(date).toHaveAttribute('aria-invalid', 'true');
    expect(date).toHaveAccessibleDescription(/future/);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Escape cancels the whole change, and the next opening starts at the list', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Offer');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Status: Saved/ })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: /Status: Saved/ }));
    expect(screen.getByRole('dialog', { name: 'Change status' })).toBeInTheDocument();
  });

  it.each([['Applied'], ['Withdrawn']])("doesn't ask for %s", async (status) => {
    const user = userEvent.setup();
    const onPick = await pick(user, status);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onPick).toHaveBeenCalledWith({ status: status.toLowerCase() });
  });

  it("doesn't ask when a date is already stored", async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={{ ...saved, appliedAt: '2026-10-01' }} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Status: Saved/ }));
    await user.click(option('Interviewing'));
    expect(onPick).toHaveBeenCalledWith({ status: 'interviewing' });
  });
});

describe('Status changes in the panel', () => {
  it('changes a row with one tap, announces it, and Undo reverts it', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(option('Interviewing'));

    await waitFor(() => expect(chipFor('Acme')).toHaveTextContent('Interviewing'));
    // Announced once, by the toast's live region, not also by the status region.
    expect(screen.getAllByText(/Moved Acme to Interviewing\./)).toHaveLength(1);
    expect(screen.getByRole('status')).not.toHaveTextContent('Moved Acme');
    expect((await db.applications.get(app.id))?.statusHistory.map((e) => e.status)).toEqual([
      'applied',
      'interviewing',
    ]);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(chipFor('Acme')).toHaveTextContent('Applied'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Acme is back to Applied.'),
    );
    expect((await db.applications.get(app.id))?.statusHistory).toHaveLength(1);
  });

  it('records the date from the prompt, and Undo clears it', async () => {
    const app = await seedSaved();
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(option('Interviewing'));
    fireEvent.change(screen.getByLabelText('Date applied'), {
      target: { value: '2026-09-30' },
    });
    await user.click(screen.getByRole('button', { name: 'Set date' }));
    await waitFor(async () =>
      expect((await db.applications.get(app.id))?.appliedAt).toBe('2026-09-30'),
    );

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () =>
      expect(await db.applications.get(app.id)).not.toHaveProperty('appliedAt'),
    );
  });

  it("explains when Undo can't apply because the job changed since", async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(option('Offer'));
    await screen.findByText('Moved Acme to Offer.');
    await act(async () => {
      await applications.setStatus(app.id, 'accepted');
    });
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't undo: Acme changed since."),
    );
    expect((await db.applications.get(app.id))?.status).toBe('accepted');
  });

  it('returns focus to the row after Undo', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(option('Offer'));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    act(() => undo.focus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());
  });

  it('explains a date rejected when saving', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    vi.spyOn(applications, 'setStatus').mockRejectedValue(
      new applications.ValidationError({ appliedAt: "The date applied can't be in the future." }),
    );
    const error = vi.spyOn(console, 'error');
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(option('Offer'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        "Couldn't change the status of Acme: The date applied can't be in the future.",
      ),
    );
    expect(error).not.toHaveBeenCalled();
  });

  it('works from the detail view too', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    await renderList();
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    const detail = await screen.findByRole('region', { name: 'Acme' });
    await user.click(within(detail).getByRole('button', { name: /^Status: Applied/ }));
    await user.click(option('Screening'));
    await waitFor(() =>
      expect(
        within(detail).getByRole('button', { name: /^Status: Screening/ }),
      ).toBeInTheDocument(),
    );
  });

  it('reports a failed change without crashing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    vi.spyOn(applications, 'setStatus').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(option('Offer'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't change the status of Acme."),
    );
    expect(chipFor('Acme')).toHaveTextContent('Applied');
  });
});
