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

describe('Tab bar', () => {
  it('shows Applications and Resumes, Applications selected, wired to its panel', async () => {
    render(<App />);
    await screen.findByText(/No applications yet/);
    const tablist = screen.getByRole('tablist', { name: 'Job Log sections' });
    expect(
      within(tablist)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Applications', 'Resumes']);
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
    await user.click(tab('Resumes'));
    expect(tab('Resumes')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'Resumes' })).toHaveTextContent('No resumes yet.');
    expect(screen.queryByText(/No applications yet/)).not.toBeVisible();
  });

  it('moves with arrow keys (wrapping), Home and End, keeping focus on the tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    act(() => tab('Applications').focus());
    await user.keyboard('{ArrowRight}');
    expect(tab('Resumes')).toHaveFocus();
    expect(tab('Resumes')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Applications')).toHaveFocus();
    await user.keyboard('{End}');
    expect(tab('Resumes')).toHaveFocus();
    await user.keyboard('{Home}{ArrowLeft}');
    expect(tab('Resumes')).toHaveFocus();
  });

  it('is hidden while a form is open, and back after', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
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
});
