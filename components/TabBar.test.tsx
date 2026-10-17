import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { createDraft, draftKey } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 3 } as never);
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

const tab = (name: string) => screen.getByRole('tab', { name });
/** A section by its tab id, whether or not it's showing. */
const panel = (id: string) => document.getElementById(`section-panel-${id}`)!;

describe('Tab bar', () => {
  it('shows Applications, Stats, Resumes and Settings, Applications selected, wired to its panel', async () => {
    render(<App />);
    await screen.findByText(/No applications yet/);
    const tablist = screen.getByRole('tablist', { name: 'Job Log sections' });
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Applications', 'Stats', 'Resumes', 'Settings']);
    expect(tab('Applications')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Resumes')).toHaveAttribute('aria-selected', 'false');
    const panel = screen.getByRole('tabpanel', { name: 'Applications' });
    expect(tab('Applications')).toHaveAttribute('aria-controls', panel.id);
    // Roving focus: only the selected tab is in the tab order.
    expect(tab('Applications')).toHaveAttribute('tabindex', '0');
    expect(tab('Resumes')).toHaveAttribute('tabindex', '-1');
  });

  it('switches with a click, showing the Resumes empty state', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    const applications = screen.getByRole('tabpanel', { name: 'Applications' });
    await user.click(tab('Resumes'));
    expect(tab('Resumes')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Resumes' })).toHaveTextContent('No resumes yet.');
    // Sliding out: still painted, but out of reach and hidden from assistive tech.
    expect(applications).toHaveAttribute('inert');
    expect(applications).toHaveAttribute('aria-hidden', 'true');
    expect(applications).toHaveAttribute('data-slide', 'out-forward');
    expect(screen.getByRole('tabpanel', { name: 'Resumes' })).toHaveAttribute(
      'data-slide',
      'in-forward',
    );
    // Then out of sight.
    await waitFor(() => expect(screen.queryByText(/No applications yet/)).not.toBeVisible());
    expect(applications).not.toHaveAttribute('data-slide');
  });

  it('slides back when moving left, and not at all under reduced motion', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByText(/No applications yet/);
    await user.click(tab('Resumes'));
    const resumes = panel('resumes');
    await waitFor(() => expect(resumes).not.toHaveAttribute('data-slide'));
    await user.click(tab('Stats'));
    expect(panel('stats')).toHaveAttribute('data-slide', 'in-back');
    expect(resumes).toHaveAttribute('data-slide', 'out-back');
    unmount();

    const real = window.matchMedia.bind(window);
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
      query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
    );
    render(<App />);
    await screen.findByText(/No applications yet/);
    await user.click(tab('Resumes'));
    expect(panel('resumes')).not.toHaveAttribute('data-slide');
    expect(screen.queryByText(/No applications yet/)).not.toBeVisible();
  });

  it('switches at once, without sliding, when chosen again mid-slide', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await user.click(tab('Stats'));
    expect(panel('stats')).toHaveAttribute('data-slide', 'in-forward');
    await user.click(tab('Resumes'));
    expect(panel('resumes')).not.toHaveAttribute('data-slide');
    expect(panel('stats')).not.toBeVisible();
    expect(screen.queryByText(/No applications yet/)).not.toBeVisible();
  });

  it('shows no other section while a form is open', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    for (const id of ['stats', 'resumes']) {
      expect(panel(id)).not.toBeVisible();
      expect(panel(id)).toHaveAttribute('inert');
    }
  });

  it('moves with arrow keys (wrapping), Home and End, keeping focus on the tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    act(() => tab('Applications').focus());
    await user.keyboard('{ArrowRight}');
    expect(tab('Stats')).toHaveFocus();
    expect(tab('Stats')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Resumes')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Settings')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Applications')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Settings')).toHaveFocus();
    await user.keyboard('{Home}{ArrowLeft}');
    expect(tab('Settings')).toHaveFocus();
  });

  it('is hidden while a form is open, and back after', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await user.click(screen.getByRole('button', { name: 'Add application' }));
    expect(screen.queryByRole('tablist')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('keeps the Applications view (e.g. a detail) while Resumes is shown', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await screen.findByRole('heading', { level: 2, name: 'Acme' });
    await user.click(tab('Resumes'));
    await user.click(tab('Applications'));
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' })).toBeVisible();
  });

  it('switches to Applications when a capture arrives on the Resumes tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await waitFor(() => expect(fakeBrowser.windows.getCurrent).toHaveBeenCalled());
    await user.click(tab('Resumes'));
    await act(() =>
      fakeBrowser.storage.session.set({
        [draftKey(3)]: createDraft('page', {
          url: 'https://jobs.example.test/1',
          title: 'Engineer',
        }),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Add application' })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText(/Job title/)).toHaveValue('Engineer'));
  });

  it('leaves modified arrow keys alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    act(() => tab('Applications').focus());
    await user.keyboard('{Meta>}{ArrowRight}{/Meta}{Alt>}{ArrowRight}{/Alt}');
    expect(tab('Applications')).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps the Resumes panel mounted and focusable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    const panel = document.getElementById(tab('Resumes').getAttribute('aria-controls')!)!;
    expect(panel).not.toBeVisible();
    expect(panel).toHaveAttribute('inert');
    await user.click(tab('Resumes'));
    expect(panel).toBeVisible();
    expect(panel).not.toHaveAttribute('inert');
    // Focusable itself; that Tab really reaches it is checked in real Chrome (e2e/tab-bar.spec.ts),
    // since happy-dom ignores inert and lets Tab into the hidden Applications panel.
    expect(panel).toHaveAttribute('tabindex', '0');
  });

  it('Undo of a status change from another tab switches back and focuses the row', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    const row = await screen.findByRole('button', { name: /^Acme/ });
    await user.click(within(row.parentElement!).getByRole('button', { name: /^Status: / }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Change status' })).getByRole('button', {
        name: 'Offer',
      }),
    );
    await user.click(tab('Resumes'));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(tab('Applications')).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());
  });

  it('Undo of a delete from another tab switches back and focuses the restored row', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(tab('Resumes'));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Acme/ })).toHaveFocus());
    expect(tab('Applications')).toHaveAttribute('aria-selected', 'true');
  });

  it('Dismissing a toast on another tab focuses that tab, not the hidden list', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(tab('Resumes'));
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(tab('Resumes')).toHaveFocus();
    expect(tab('Resumes')).toHaveAttribute('aria-selected', 'true');
  });
});
