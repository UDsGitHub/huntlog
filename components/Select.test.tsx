import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Select, type SelectGroup, type SelectOption } from './Select';

const OPTIONS: (SelectOption | SelectGroup)[] = [
  {
    label: 'Active',
    options: [
      { value: 'saved', label: 'Saved' },
      { value: 'applied', label: 'Applied' },
      { value: 'screening', label: 'Screening' },
    ],
  },
  {
    label: 'Closed',
    options: [
      { value: 'accepted', label: 'Accepted' },
      { value: 'rejected', label: 'Rejected' },
    ],
  },
];

function Harness({ onChange = () => {} }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('applied');
  return (
    <div onKeyDown={(event) => event.key === 'Escape' && onChange('escape reached parent')}>
      <label htmlFor="status">Status</label>
      <Select
        id="status"
        listLabel="Statuses"
        value={value}
        options={OPTIONS}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">Next</button>
    </div>
  );
}

const select = () => screen.getByRole('combobox', { name: 'Status' });
const list = () => screen.queryByRole('listbox', { name: 'Statuses' });
const active = () => {
  const id = select().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id)?.textContent : undefined;
};

describe('Select', () => {
  it('is named by its label and shows the choice, closed', () => {
    render(<Harness />);
    expect(select()).toHaveTextContent('Applied');
    expect(select()).toHaveAttribute('aria-expanded', 'false');
    expect(select()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(list()).toBeNull();
  });

  it('opens on the choice, moves without choosing, and chooses with Enter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    select().focus();
    await user.keyboard('{ArrowDown}');
    expect(list()).toBeInTheDocument();
    expect(select()).toHaveAttribute('aria-expanded', 'true');
    expect(active()).toBe('Applied');
    expect(within(list()!).getByRole('option', { selected: true })).toHaveTextContent('Applied');
    // Across the group boundary, stopping at the end.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(active()).toBe('Rejected');
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{Home}');
    expect(active()).toBe('Saved');
    await user.keyboard('{End}{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenCalledWith('accepted');
    expect(list()).toBeNull();
    expect(select()).toHaveTextContent('Accepted');
    expect(select()).toHaveFocus();
  });

  it('⌘/Ctrl+Enter on an open list chooses too, so a sheet around it never gets it', async () => {
    const onChange = vi.fn();
    const outer = vi.fn();
    const user = userEvent.setup();
    render(
      // Stands in for the sheet: it takes a ⌘/Ctrl+Enter nothing else used.
      <div
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.defaultPrevented) return;
          event.preventDefault();
          outer();
        }}
      >
        <Harness onChange={onChange} />
      </div>,
    );
    select().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Control>}{Enter}{/Control}');
    expect(onChange).toHaveBeenCalledWith('screening');
    expect(list()).toBeNull();
    expect(outer).not.toHaveBeenCalled();
    // Closed, it's left to the sheet.
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(list()).toBeNull();
    expect(outer).toHaveBeenCalled();
  });

  it('chooses with Space, and Home/End open at either end', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    select().focus();
    await user.keyboard('{End}');
    expect(active()).toBe('Rejected');
    await user.keyboard(' ');
    expect(select()).toHaveTextContent('Rejected');
    await user.keyboard('{Home}');
    expect(active()).toBe('Saved');
  });

  it('jumps to an option by typing its first letters', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    select().focus();
    // Closed: opens on the first match, without choosing it.
    await user.keyboard('r');
    expect(active()).toBe('Rejected');
    expect(onChange).not.toHaveBeenCalled();
    // Open: "s" goes to the next S, then "sc" keeps narrowing.
    await user.keyboard('{Escape}{ArrowDown}');
    await user.keyboard('sc');
    expect(active()).toBe('Screening');
  });

  it('Escape closes the list without choosing, and only the list', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    select().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Escape}');
    expect(list()).toBeNull();
    expect(select()).toHaveTextContent('Applied');
    // Open, Escape stopped at the select (a sheet around it stays open)...
    expect(onChange).not.toHaveBeenCalled();
    // ...closed, it's left to the page.
    await user.keyboard('{Escape}');
    expect(onChange).toHaveBeenCalledWith('escape reached parent');
  });

  it('Tab closes without choosing and moves on', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    select().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.tab();
    expect(list()).toBeNull();
    expect(select()).toHaveTextContent('Applied');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
  });

  it('a click opens it and a click on an option chooses, keeping focus', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(select());
    await user.click(within(list()!).getByRole('option', { name: 'Saved' }));
    expect(select()).toHaveTextContent('Saved');
    expect(select()).toHaveFocus();
    expect(list()).toBeNull();
    // Clicking the button again closes an open list.
    await user.click(select());
    await user.click(select());
    expect(list()).toBeNull();
  });

  it('labels its groups', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(select());
    expect(within(list()!).getByRole('group', { name: 'Active' })).toBeInTheDocument();
    expect(within(list()!).getByRole('group', { name: 'Closed' })).toBeInTheDocument();
  });
});
