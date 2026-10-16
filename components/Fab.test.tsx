import { fireEvent, render, screen } from '@testing-library/react';
import { Fab } from './Fab';
import { PlusIcon } from './icons';

describe('Fab', () => {
  it('has the full name, shows the short label, and acts', () => {
    const onClick = vi.fn();
    render(
      <Fab label="Add application" icon={<PlusIcon />} onClick={onClick}>
        Add
      </Fab>,
    );
    const button = screen.getByRole('button', { name: 'Add application' });
    expect(button).toHaveTextContent('Add');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('publishes the room it takes while mounted, so toasts sit above it', () => {
    const root = document.documentElement;
    const { unmount } = render(
      <Fab label="Add application" icon={<PlusIcon />} onClick={() => {}}>
        Add
      </Fab>,
    );
    expect(root.style.getPropertyValue('--fab-clearance')).toMatch(/px$/);
    unmount();
    expect(root.style.getPropertyValue('--fab-clearance')).toBe('');
  });
});
