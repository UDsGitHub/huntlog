import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as applications from '@/lib/applications';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fields() {
  return {
    url: screen.getByLabelText('Job posting URL'),
    company: screen.getByLabelText('Company'),
    save: screen.getByRole('button', { name: 'Save' }),
  };
}

describe('Add application form', () => {
  it('shows the empty state before anything is saved', async () => {
    render(<App />);
    expect(await screen.findByText(/No applications yet/)).toBeInTheDocument();
  });

  it('saves with Enter, lists the job, clears the form and refocuses the URL field', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { url, company } = fields();

    await user.type(url, 'example.com/jobs/42');
    await user.type(company, 'Acme{Enter}');

    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('Acme');
    expect(list).toHaveTextContent('https://example.com/jobs/42');
    expect(url).toHaveValue('');
    expect(company).toHaveValue('');
    await waitFor(() => expect(url).toHaveFocus());
  });

  it('shows linked errors for missing fields, focuses the first, and saves nothing', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { url, company, save } = fields();

    await user.type(company, '   ');
    await user.click(save);

    expect(url).toHaveAttribute('aria-invalid', 'true');
    expect(url).toHaveAccessibleDescription('Enter the job posting URL.');
    expect(company).toHaveAccessibleDescription('Enter the company name.');
    expect(url).toHaveFocus();
    expect(await db.applications.count()).toBe(0);
  });

  it('rejects a non-web URL', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { url, company, save } = fields();

    await user.type(url, 'javascript:alert(1)');
    await user.type(company, 'Acme');
    await user.click(save);

    expect(url).toHaveAccessibleDescription('Enter a valid web address (http or https).');
    expect(await db.applications.count()).toBe(0);
  });

  it('creates one row when Save is clicked twice before the first save finishes', async () => {
    const user = userEvent.setup();
    render(<App />);
    const { url, company, save } = fields();

    await user.type(url, 'https://example.com');
    await user.type(company, 'Acme');
    // Synchronous clicks: the second lands while the first save is still awaiting IndexedDB.
    fireEvent.click(save);
    fireEvent.click(save);

    await screen.findByRole('list', { name: 'Applications' });
    expect(await db.applications.count()).toBe(1);
  });

  it('keeps what the user typed while a slow save was in flight', async () => {
    let finish!: () => void;
    const real = applications.addApplication;
    vi.spyOn(applications, 'addApplication').mockImplementation(async (input) => {
      await new Promise<void>((resolve) => (finish = resolve));
      return real(input);
    });
    const user = userEvent.setup();
    render(<App />);
    const { url, company, save } = fields();

    await user.type(url, 'https://example.com/1');
    await user.type(company, 'Acme');
    await user.click(save);
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    await user.clear(url);
    await user.type(url, 'https://example.com/next');
    await act(async () => finish());

    await screen.findByRole('list', { name: 'Applications' });
    expect(url).toHaveValue('https://example.com/next');
    expect(company).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled');
  });

  it('shows a message instead of a blank panel when the list query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(applications, 'listApplications').mockRejectedValue(new Error('DB blocked'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your applications");
    expect(screen.getByLabelText('Job posting URL')).toBeInTheDocument();
  });

  it('renders a stored non-web URL as text, not a link', async () => {
    await db.applications.add({
      id: 'x',
      url: 'javascript:alert(1)',
      urlNormalized: 'javascript:alert(1)',
      company: 'Imported',
      status: 'applied',
      statusHistory: [],
      createdAt: '2026-10-15T00:00:00.000Z',
      updatedAt: '2026-10-15T00:00:00.000Z',
    });
    render(<App />);
    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('javascript:alert(1)');
    expect(screen.queryByRole('link')).toBeNull();
  });
});
