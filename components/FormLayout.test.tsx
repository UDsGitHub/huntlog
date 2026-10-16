import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addApplication } from '@/lib/applications';
import { createDraft, draftKey } from '@/lib/captureDraft';
import { db } from '@/lib/db';
import { FORM_DEFAULTS_KEY } from '@/lib/formDefaults';
import App from '@/entrypoints/sidepanel/App';

const WINDOW_ID = 3;

beforeEach(async () => {
  fakeBrowser.reset();
  vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: WINDOW_ID } as never);
  await db.delete();
  await db.open();
});
afterEach(() => vi.restoreAllMocks());

type User = ReturnType<typeof userEvent.setup>;
const detailsToggle = () => screen.getByRole('button', { name: /More details/ });
const isHidden = (label: RegExp | string) =>
  screen.getByLabelText(label).closest('[hidden]') !== null;

async function openAdd(user: User) {
  render(<App />);
  await screen.findByText(/No applications yet/);
  await user.click(screen.getByRole('button', { name: '+ Add application' }));
}

describe('More details', () => {
  it('starts collapsed in Add, with only the top fields showing', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'false');
    for (const label of ['Job posting URL', 'Company', /Job title/, 'Date applied']) {
      expect(isHidden(label)).toBe(false);
    }
    for (const label of [/Location/, /Work mode/, 'Minimum', 'Currency', /Source/, /Notes/]) {
      expect(isHidden(label)).toBe(true);
    }
  });

  it('opens and closes, keeping what was typed', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(detailsToggle());
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(detailsToggle()).toHaveAttribute(
      'aria-controls',
      screen.getByLabelText(/Location/).closest('[id$="-details"]')!.id,
    );
    await user.type(screen.getByLabelText(/Location/), 'Berlin');
    await user.click(detailsToggle());
    expect(isHidden(/Location/)).toBe(true);
    expect(screen.getByText('Berlin')).toBeInTheDocument(); // the collapsed summary
    await user.click(detailsToggle());
    expect(screen.getByLabelText(/Location/)).toHaveValue('Berlin');
  });

  it('opens on its own and focuses a field inside that fails validation', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(detailsToggle());
    await user.type(screen.getByLabelText('Minimum'), 'lots');
    await user.click(detailsToggle());
    await user.type(screen.getByLabelText('Job posting URL'), 'https://acme.com/1');
    await user.type(screen.getByLabelText('Company'), 'Acme{Enter}');

    await waitFor(() => expect(screen.getByLabelText('Minimum')).toHaveFocus());
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(isHidden('Minimum')).toBe(false);
  });

  it('opens for an error inside even when an earlier field fails too', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(detailsToggle());
    await user.type(screen.getByLabelText('Minimum'), 'lots');
    await user.click(detailsToggle());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('Job posting URL')).toHaveFocus());
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'true');
    await waitFor(() =>
      expect(screen.getByLabelText('Minimum')).toHaveAccessibleDescription(/Enter a number/),
    );
  });

  it('publishes the sticky bar height so the toast and focus scrolling keep clear', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--sticky-bar-height')).toMatch(/^\d+px$/);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(root.style.getPropertyValue('--sticky-bar-height')).toBe('');
  });

  it('stays collapsed when only a top field fails', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('Job posting URL')).toHaveFocus());
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens in Edit when a field inside has a value', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme', notes: 'Call back' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('stays collapsed in Edit when nothing inside has a value', async () => {
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps Save and Cancel in a sticky bar after every field', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    const bar = screen.getByRole('button', { name: 'Save' }).parentElement!;
    expect(bar).toHaveClass('sticky', 'bottom-0');
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Cancel' }));
  });
});

describe('Currency picker', () => {
  it('keeps a stored currency the runtime does not know, and flags it on save', async () => {
    await db.applications.add({
      id: 'legacy',
      url: 'https://acme.com/1',
      urlNormalized: '',
      company: 'Legacy',
      status: 'applied',
      statusHistory: [],
      appliedAt: '2026-10-01',
      salaryMin: 100,
      salaryCurrency: 'XYZ',
      salaryPeriod: 'year',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Legacy/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Currency')).toHaveValue('XYZ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Currency')).toHaveAccessibleDescription(/Choose a currency/),
    );
  });

  it('lists the locale default and USD, EUR, GBP first', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    const groups = screen.getByLabelText('Currency').querySelectorAll('optgroup');
    expect(groups[0]).toHaveAttribute('label', 'Common');
    expect([...groups[0]!.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'USD',
      'EUR',
      'GBP',
    ]);
    expect(groups[1]!.querySelectorAll('option[value="USD"]')).toHaveLength(0);
    expect(groups[1]!.querySelectorAll('option[value="JPY"]')).toHaveLength(1);
  });
});

describe('Remembered defaults', () => {
  it('reach a form opened before they finished loading', async () => {
    let release!: () => void;
    const stored = { [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } };
    vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementationOnce((async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return stored;
    }) as never);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: '+ Add application' }));
    expect(screen.queryByRole('form')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByLabelText(/Source/)).toHaveValue('LinkedIn'));
  });

  async function addOne(
    user: User,
    fields: { company: string; source?: string; workMode?: string },
  ) {
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    await user.type(screen.getByLabelText('Job posting URL'), `https://${fields.company}.com/1`);
    await user.type(screen.getByLabelText('Company'), fields.company);
    await user.click(detailsToggle());
    const source = screen.getByLabelText(/Source/);
    await user.clear(source);
    if (fields.source) await user.type(source, fields.source);
    await user.selectOptions(screen.getByLabelText(/Work mode/), fields.workMode ?? '');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: new RegExp(`^${fields.company}`) });
  }

  it('start the next manual Add with the last source and work mode, shown while collapsed', async () => {
    const user = userEvent.setup();
    await openAdd(user);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await addOne(user, { company: 'acme', source: 'Referral', workMode: 'remote' });

    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    expect(screen.getByLabelText(/Source/)).toHaveValue('Referral');
    expect(screen.getByLabelText(/Work mode/)).toHaveValue('remote');
    expect(detailsToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Remote · Referral')).toBeInTheDocument();
    expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({
      source: 'Referral',
      workMode: 'remote',
    });
  });

  it('load from storage when the panel opens', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
    const user = userEvent.setup();
    await openAdd(user);
    await waitFor(() => expect(screen.getByLabelText(/Source/)).toHaveValue('LinkedIn'));
  });

  it('remember a blank too: the defaults follow the last application', async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText(/No applications yet/);
    await addOne(user, { company: 'beta' });
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    expect(screen.getByLabelText(/Source/)).toHaveValue('');
  });

  it("don't hold up a capture's form while they load", async () => {
    vi.spyOn(fakeBrowser.storage.local, 'get').mockImplementation(
      (() => new Promise(() => {})) as never,
    );
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', {
        url: 'https://jobs.example.test/1',
        title: 'Engineer',
      }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/Job title/)).toHaveValue('Engineer'));
  });

  it("aren't wiped by saving a capture that had no source or work mode", async () => {
    await fakeBrowser.storage.local.set({
      [FORM_DEFAULTS_KEY]: { source: 'LinkedIn', workMode: 'remote' },
    });
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', {
        url: 'https://jobs.example.test/1',
        title: 'Engineer',
      }),
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/Job title/)).toHaveValue('Engineer'));
    await user.type(screen.getByLabelText('Company'), 'Captured Co{Enter}');
    await screen.findByRole('button', { name: /^Captured Co/ });
    await user.click(screen.getByRole('button', { name: '+ Add application' }));
    expect(screen.getByLabelText(/Source/)).toHaveValue('LinkedIn');
    expect(screen.getByLabelText(/Work mode/)).toHaveValue('remote');
  });

  it("don't apply to a capture", async () => {
    await fakeBrowser.storage.local.set({
      [FORM_DEFAULTS_KEY]: { source: 'LinkedIn', workMode: 'remote' },
    });
    await fakeBrowser.storage.session.set({
      [draftKey(WINDOW_ID)]: createDraft('page', {
        url: 'https://jobs.example.test/1',
        title: 'Engineer',
      }),
    });
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText(/Job title/)).toHaveValue('Engineer'));
    expect(screen.getByLabelText(/Source/)).toHaveValue('');
    expect(screen.getByLabelText(/Work mode/)).toHaveValue('');
  });

  it("don't apply to Edit, and editing doesn't change them", async () => {
    await fakeBrowser.storage.local.set({ [FORM_DEFAULTS_KEY]: { source: 'LinkedIn' } });
    await addApplication({ url: 'https://acme.com/1', company: 'Acme' });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: /^Acme/ }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/Source/)).toHaveValue('');
    await user.click(detailsToggle());
    await user.type(screen.getByLabelText(/Source/), 'Recruiter');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus());
    expect((await fakeBrowser.storage.local.get(FORM_DEFAULTS_KEY))[FORM_DEFAULTS_KEY]).toEqual({
      source: 'LinkedIn',
    });
  });
});
