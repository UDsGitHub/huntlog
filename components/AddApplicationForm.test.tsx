import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
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
});
