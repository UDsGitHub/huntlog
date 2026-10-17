import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MoreMenu } from './MoreMenu';

function setup() {
  const archive = vi.fn();
  const remove = vi.fn();
  render(
    <>
      <MoreMenu
        label="More actions for Acme"
        items={[
          { label: 'Archive', onSelect: archive },
          { label: 'Delete', onSelect: remove, destructive: true },
        ]}
      />
      <button type="button">Elsewhere</button>
    </>,
  );
  const button = screen.getByRole('button', { name: 'More actions for Acme' });
  return { archive, remove, button };
}

describe('MoreMenu', () => {
  it('is a menu button that opens with the first item focused', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'More actions for Acme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
  });

  it('moves with arrows (wrapping), Home and End, and runs the chosen item', async () => {
    const user = userEvent.setup();
    const { button, remove, archive } = setup();
    await user.click(button);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus();
    await user.keyboard('{End}{Enter}');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('Escape closes back to the button; Tab and a click elsewhere just close', async () => {
    const user = userEvent.setup();
    const { button, remove } = setup();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button).toHaveFocus();

    await user.click(button);
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('shows destructive items in the destructive color', async () => {
    const user = userEvent.setup();
    const { button } = setup();
    await user.click(button);
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('text-destructive');
    expect(screen.getByRole('menuitem', { name: 'Archive' })).not.toHaveClass('text-destructive');
  });
});
