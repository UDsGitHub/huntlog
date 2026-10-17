import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { Combobox } from './Combobox';

const OPTIONS = [
  { value: '', label: 'No resume' },
  { value: 'a', label: 'Backend v3' },
  { value: 'b', label: 'Frontend' },
  { value: 'c', label: 'Ingénieur' },
];

function Harness({
  initial = '',
  onSubmit = () => {},
}: {
  initial?: string;
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="resume">Resume</label>
      <Combobox
        id="resume"
        value={value}
        options={OPTIONS}
        onChange={setValue}
        listLabel="Resumes"
      />
      <button type="submit">Save</button>
      <p role="status">{value || 'none'}</p>
    </form>
  );
}

const field = () => screen.getByRole('combobox', { name: 'Resume' });
const options = () =>
  within(screen.getByRole('listbox', { name: 'Resumes' }))
    .getAllByRole('option')
    .map((option) => option.textContent);
const chosen = () => screen.getByRole('status').textContent;

describe('Combobox', () => {
  it('shows the chosen option, and lists them all when opened', async () => {
    const user = userEvent.setup();
    render(<Harness initial="a" />);
    expect(field()).toHaveValue('Backend v3');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    await user.click(field());
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(options()).toEqual(['No resume', 'Backend v3', 'Frontend', 'Ingénieur']);
    expect(screen.getByRole('option', { name: 'Backend v3' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('filters as you type, ignoring case and accents, and Enter picks', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSubmit={onSubmit} />);
    await user.type(field(), 'ingen');
    expect(options()).toEqual(['Ingénieur']);
    await user.keyboard('{Enter}');
    expect(chosen()).toBe('c');
    expect(field()).toHaveValue('Ingénieur');
    // Enter picked; it didn't submit the form.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('moves with the arrow keys, wrapping, and points aria-activedescendant at the option', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    field().focus();
    await user.keyboard('{ArrowDown}');
    const active = () => document.getElementById(field().getAttribute('aria-activedescendant')!);
    expect(active()).toHaveTextContent('No resume');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toHaveTextContent('Frontend');
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(active()).toHaveTextContent('Ingénieur');
    await user.keyboard('{Enter}');
    expect(chosen()).toBe('c');
  });

  it('Escape closes and restores the chosen option; a closed Escape is left to the sheet', async () => {
    const outer = vi.fn();
    const user = userEvent.setup();
    render(
      <div onKeyDown={(event) => event.key === 'Escape' && outer()}>
        <Harness initial="a" />
      </div>,
    );
    await user.type(field(), 'fro');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveValue('Backend v3');
    expect(outer).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('leaving the field without picking keeps the chosen option', async () => {
    const user = userEvent.setup();
    render(<Harness initial="a" />);
    await user.type(field(), 'nothing like it');
    expect(within(screen.getByRole('listbox')).getByText('No matches')).toBeInTheDocument();
    await user.tab();
    expect(field()).toHaveValue('Backend v3');
    expect(chosen()).toBe('a');
  });

  it('picks with a click, keeping focus in the field', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());
    await user.click(screen.getByRole('option', { name: 'Frontend' }));
    expect(chosen()).toBe('b');
    expect(field()).toHaveFocus();
  });

  it('opens from its chevron', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Show resumes' }));
    expect(screen.getByRole('listbox', { name: 'Resumes' })).toBeInTheDocument();
  });

  it('keeps the highlight on the same option when the list changes under it', async () => {
    function Live() {
      const [options, setOptions] = useState(OPTIONS);
      const [value, setValue] = useState('');
      return (
        <>
          <label htmlFor="resume">Resume</label>
          <Combobox
            id="resume"
            value={value}
            options={options}
            onChange={setValue}
            listLabel="Resumes"
          />
          <button
            type="button"
            onClick={() =>
              setOptions([OPTIONS[0]!, { value: 'z', label: 'Zeta' }, ...OPTIONS.slice(1)])
            }
          >
            Upload elsewhere
          </button>
          <p role="status">{value}</p>
        </>
      );
    }
    const user = userEvent.setup();
    render(<Live />);
    field().focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    const active = () => document.getElementById(field().getAttribute('aria-activedescendant')!);
    expect(active()).toHaveTextContent('Frontend');
    // Another window adds a resume above it.
    fireEvent.click(screen.getByRole('button', { name: 'Upload elsewhere' }));
    expect(active()).toHaveTextContent('Frontend');
    await user.keyboard('{Enter}');
    expect(chosen()).toBe('b');
  });

  it("doesn't close when the list itself is pressed (e.g. its scrollbar)", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(field());
    const list = screen.getByRole('listbox');
    expect(fireEvent.mouseDown(list)).toBe(false);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
