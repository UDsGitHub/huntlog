import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as applicationInput from '@/lib/applicationInput';
import * as applications from '@/lib/applications';
import { todayLocal } from '@/lib/dates';
import { db } from '@/lib/db';
import App from '@/entrypoints/sidepanel/App';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openAddForm(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await screen.findByText(/No applications yet/);
  await user.click(screen.getByRole('button', { name: '+ Add application' }));
  return screen.getByRole('form', { name: 'Add application' });
}

const field = (label: string | RegExp) => screen.getByLabelText(label);

describe('Add view', () => {
  it('starts on the list with an empty state that explains capture', async () => {
    render(<App />);
    expect(await screen.findByText(/No applications yet/)).toHaveTextContent(
      'right-click any job posting',
    );
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('opens a blank form with defaults and focuses the URL field', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    expect(field('Job posting URL')).toHaveFocus();
    expect(field('Job posting URL')).toHaveValue('');
    expect(field('Date applied')).toHaveValue(todayLocal());
    expect(field(/Work mode/)).toHaveValue('');
    expect(field('Per')).toHaveValue('year');
    expect(field('Currency')).toHaveValue('USD');
  });

  it('saves every field, returns to the list and focuses + Add application', async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    await user.type(field('Job posting URL'), 'acme.com/jobs/42');
    await user.type(field('Company'), 'Acme');
    await user.type(field(/Job title/), 'Senior Engineer');
    await user.type(field(/Location/), 'Berlin');
    await user.selectOptions(field(/Work mode/), 'hybrid');
    await user.clear(field('Date applied'));
    await user.type(field('Date applied'), '2026-10-01');
    await user.type(field('Minimum'), '85,000');
    await user.type(field('Maximum'), '95000');
    await user.selectOptions(field('Currency'), 'EUR');
    await user.selectOptions(field('Per'), 'month');
    await user.type(field(/Source/), 'Referral');
    await user.type(field(/Notes/), 'Met the team{Enter}Second line');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const list = await screen.findByRole('list', { name: 'Applications' });
    expect(list).toHaveTextContent('Acme');
    expect(list).toHaveTextContent('Senior Engineer');
    expect(list).toHaveTextContent('Berlin · Hybrid');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add application' })).toHaveFocus(),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved Acme.');

    const [saved] = await db.applications.toArray();
    expect(saved).toMatchObject({
      url: 'https://acme.com/jobs/42',
      company: 'Acme',
      title: 'Senior Engineer',
      location: 'Berlin',
      workMode: 'hybrid',
      appliedAt: '2026-10-01',
      salaryMin: 85000,
      salaryMax: 95000,
      salaryCurrency: 'EUR',
      salaryPeriod: 'month',
      source: 'Referral',
      notes: 'Met the team\nSecond line',
    });
  });

  it('stores no salary fields when no salary is entered', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://acme.com/1');
    await user.type(field('Company'), 'Acme{Enter}');
    await screen.findByRole('list', { name: 'Applications' });
    const [saved] = await db.applications.toArray();
    expect(saved).not.toHaveProperty('salaryCurrency');
    expect(saved).not.toHaveProperty('salaryPeriod');
  });

  it('offers the source suggestions', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    const listId = field(/Source/).getAttribute('list')!;
    const options = [...document.getElementById(listId)!.querySelectorAll('option')].map(
      (o) => o.value,
    );
    expect(options).toEqual([
      'LinkedIn',
      'Indeed',
      'Company site',
      'Referral',
      'Recruiter',
      'Other',
    ]);
  });

  it('shows linked errors for every invalid field, focuses the first, and saves nothing', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Minimum'), '90000');
    await user.type(field('Maximum'), '80000');
    await user.clear(field('Date applied'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(field('Job posting URL')).toHaveAccessibleDescription('Enter the job posting URL.');
    expect(field('Company')).toHaveAccessibleDescription('Enter the company name.');
    expect(field('Date applied')).toHaveAccessibleDescription('Enter the date you applied.');
    expect(field('Maximum')).toHaveAccessibleDescription('Maximum must be at least the minimum.');
    expect(field('Maximum')).toHaveAttribute('aria-invalid', 'true');
    expect(field('Job posting URL')).toHaveFocus();
    expect(await db.applications.count()).toBe(0);
  });

  it('focuses the first invalid field even when it is lower down', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://acme.com/1');
    await user.type(field('Company'), 'Acme');
    await user.type(field('Minimum'), 'lots');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(field('Minimum')).toHaveFocus();
    expect(field('Minimum')).toHaveAccessibleDescription('Enter a number, like 85,000.');
  });

  it('rejects a non-web URL', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'javascript:alert(1)');
    await user.type(field('Company'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(field('Job posting URL')).toHaveAccessibleDescription(
      'Enter a valid web address (http or https).',
    );
    expect(await db.applications.count()).toBe(0);
  });

  it('creates one row when Save is clicked twice before the first save finishes', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://example.com');
    await user.type(field('Company'), 'Acme');
    const save = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByRole('list', { name: 'Applications' });
    expect(await db.applications.count()).toBe(1);
  });

  it('locks the fields while saving, so nothing typed during the save is lost', async () => {
    let finish!: () => void;
    const real = applications.addApplication;
    vi.spyOn(applications, 'addApplication').mockImplementation(async (input) => {
      await new Promise<void>((resolve) => (finish = resolve));
      return real(input);
    });
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://example.com');
    await user.type(field('Company'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
    expect(field(/Notes/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Saving…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await act(async () => finish());
    await screen.findByRole('list', { name: 'Applications' });
  });

  it('validates once per save, through addApplication', async () => {
    const spy = vi.spyOn(applicationInput, 'validateApplication');
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://example.com');
    await user.type(field('Company'), 'Acme{Enter}');
    await screen.findByRole('list', { name: 'Applications' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('announces a second save even when the message repeats', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://example.com/1');
    await user.type(field('Company'), 'Acme{Enter}');
    await screen.findByRole('list', { name: 'Applications' });
    const first = screen.getByRole('status').textContent;

    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    await user.type(field('Job posting URL'), 'https://example.com/2');
    await user.type(field('Company'), 'Acme{Enter}');
    await waitFor(() => expect(screen.getByRole('status').textContent).not.toBe(first));
    expect(screen.getByRole('status')).toHaveTextContent('Saved Acme.');
  });

  it('keeps the form and shows an error when saving fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(applications, 'addApplication').mockRejectedValue(new Error('quota'));
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Job posting URL'), 'https://example.com');
    await user.type(field('Company'), 'Acme{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't save.");
    expect(field('Company')).toHaveValue('Acme');
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-disabled');
  });

  it('Cancel returns to the list without saving and focuses + Add application', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Company'), 'Half typed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '+ Add application' })).toHaveFocus(),
    );
    expect(await db.applications.count()).toBe(0);
  });

  it('opens a fresh form each time', async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    await user.type(field('Company'), 'Half typed');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    expect(field('Company')).toHaveValue('');
  });
});

describe('Application list', () => {
  it('shows a message instead of a blank panel when the list query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(applications, 'listApplications').mockRejectedValue(new Error('DB blocked'));
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your applications");
    expect(screen.getByRole('button', { name: '+ Add application' })).toBeInTheDocument();
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
    expect(within(list).queryByRole('link')).toBeNull();
  });
});
