import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as applications from '@/lib/applications';
import { addApplication, saveApplication } from '@/lib/applications';
import { todayLocal } from '@/lib/dates';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';
import { StatusChip } from './StatusChip';

beforeEach(async () => {
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
  const app = { company: 'Acme', status: 'applied' as const, appliedAt: '2026-10-01' };

  it('is a menu button labelled with the current status', () => {
    render(<StatusChip application={app} onPick={() => {}} />);
    const chip = screen.getByRole('button', { name: 'Status: Applied. Change status' });
    expect(chip).toHaveAttribute('aria-haspopup', 'menu');
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens a menu of all 9 statuses in Active and Closed groups, current one checked and focused', async () => {
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={() => {}} />);
    await user.click(screen.getByRole('button', { name: /Status: Applied/ }));
    const menu = screen.getByRole('menu', { name: 'Change status for Acme' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent?.replace('✓', ''))).toEqual([
      'Saved',
      'Applied',
      'Screening',
      'Interviewing',
      'Offer',
      'Accepted',
      'Rejected',
      'Withdrawn',
      'Ghosted',
    ]);
    expect(within(menu).getByRole('group', { name: 'Active' })).toBeInTheDocument();
    expect(within(menu).getByRole('group', { name: 'Closed' })).toBeInTheDocument();
    const current = within(menu).getByRole('menuitemradio', { name: /Applied/ });
    expect(current).toHaveAttribute('aria-checked', 'true');
    expect(current).toHaveFocus();
    expect(screen.getByRole('button', { name: /Status: Applied/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('moves with arrows (wrapping), Home and End, and picks with Enter', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Status: Applied/ }));
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Screening' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitemradio', { name: 'Ghosted' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Saved' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{Home}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Interviewing' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith({ status: 'interviewing' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Status: Applied/ })).toHaveFocus();
  });

  it('opens from the keyboard with ArrowDown and picks with Space', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    act(() => screen.getByRole('button', { name: /Status: Applied/ }).focus());
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{ArrowUp} ');
    expect(onPick).toHaveBeenCalledWith({ status: 'saved' });
  });

  it('Escape closes without a change and returns focus to the chip', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Status: Applied/ }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('button', { name: /Status: Applied/ })).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('a click outside closes without a change', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <StatusChip application={app} onPick={onPick} />
        <p>elsewhere</p>
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Status: Applied/ }));
    await user.click(screen.getByText('elsewhere'));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('picking the current status changes nothing', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(<StatusChip application={app} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Status: Applied/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Applied/ }));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('never colors Rejected red', () => {
    render(<StatusChip application={{ ...app, status: 'rejected' }} onPick={() => {}} />);
    expect(screen.getByRole('button', { name: /Status: Rejected/ }).className).not.toMatch(/red/);
  });
});

describe('Date applied prompt', () => {
  const saved = { company: 'Acme', status: 'saved' as const };

  async function pick(user: User, status: string, onPick = vi.fn()) {
    render(<StatusChip application={saved} onPick={onPick} />);
    await user.click(screen.getByRole('button', { name: /Status: Saved/ }));
    await user.click(screen.getByRole('menuitemradio', { name: status }));
    return onPick;
  }

  it('asks when moving to a status that implies an application, defaulting to today', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Interviewing');
    const dialog = screen.getByRole('dialog', { name: 'When did you apply?' });
    const date = within(dialog).getByLabelText('Date applied');
    expect(date).toHaveValue(todayLocal());
    expect(date).toHaveFocus();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Set date passes the chosen date', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Offer');
    const date = screen.getByLabelText('Date applied');
    fireEvent.change(date, { target: { value: '2026-09-20' } });
    await user.click(screen.getByRole('button', { name: 'Set date' }));
    expect(onPick).toHaveBeenCalledWith({ status: 'offer', appliedAt: '2026-09-20' });
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
    const onPick = await pick(user, 'Screening');
    const date = screen.getByLabelText('Date applied');
    fireEvent.change(date, { target: { value: '2999-01-01' } });
    await user.click(screen.getByRole('button', { name: 'Set date' }));
    expect(date).toHaveAccessibleDescription("The date applied can't be in the future.");
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Escape cancels the whole change', async () => {
    const user = userEvent.setup();
    const onPick = await pick(user, 'Ghosted');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Status: Saved/ })).toHaveFocus();
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
    await user.click(screen.getByRole('menuitemradio', { name: 'Interviewing' }));
    expect(onPick).toHaveBeenCalledWith({ status: 'interviewing' });
  });
});

describe('Status changes in the panel', () => {
  it('changes a row with one tap, announces it, and Undo reverts it', async () => {
    const app = await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    await renderList();
    await user.click(chipFor('Acme'));
    await user.click(screen.getByRole('menuitemradio', { name: 'Interviewing' }));

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
    await user.click(screen.getByRole('menuitemradio', { name: 'Interviewing' }));
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
    await user.click(screen.getByRole('menuitemradio', { name: 'Offer' }));
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

  it('works from the detail view too', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    await renderList();
    await user.click(screen.getByRole('button', { name: /^Acme/ }));
    const detail = await screen.findByRole('region', { name: 'Acme' });
    await user.click(within(detail).getByRole('button', { name: /^Status: Applied/ }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Screening' }));
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
    await user.click(screen.getByRole('menuitemradio', { name: 'Offer' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("Couldn't change the status of Acme."),
    );
    expect(chipFor('Acme')).toHaveTextContent('Applied');
  });
});
