import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState } from 'react';
import { Sheet, SHEET_ANIMATION_MS } from './Sheet';
import { Toast, useToast } from './Toast';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function reduceMotion() {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) =>
    query.includes('reduce') ? ({ matches: true } as MediaQueryList) : real(query),
  );
}

/** An opener button and a sheet, as a screen would use it. */
function Harness({
  dirty = false,
  dismissible = false,
  closeButton,
  withInitialFocus = false,
  onClosed,
}: {
  dirty?: boolean;
  dismissible?: boolean;
  closeButton?: 'back' | 'close';
  withInitialFocus?: boolean;
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const second = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        onClosed={onClosed}
        title="Filters"
        description="Narrow the list"
        dirty={dirty}
        dismissible={dismissible}
        closeButton={closeButton}
        initialFocus={withInitialFocus ? second : undefined}
        footer={<button type="button">Done</button>}
      >
        <label>
          First <input />
        </label>
        <label>
          Second <input ref={second} />
        </label>
      </Sheet>
    </>
  );
}

const dialog = () => document.querySelector('dialog')!;

/** A press and release on the dimmed area outside the panel. */
function clickOutside() {
  fireEvent.pointerDown(dialog());
  fireEvent.click(dialog());
}

async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return dialog();
}

describe('Sheet', () => {
  it('opens as a modal dialog named by its title, focusing its first control', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(dialog().open).toBe(false);
    const sheet = await openSheet(user);
    expect(sheet.open).toBe(true);
    expect(sheet).toHaveAttribute('data-state', 'open');
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveAccessibleDescription(
      'Narrow the list',
    );
    // The header's close button comes first in the DOM, but focus goes to the content.
    expect(screen.getByLabelText('First')).toHaveFocus();
  });

  it('focuses the given element instead, when there is one', async () => {
    const user = userEvent.setup();
    render(<Harness withInitialFocus />);
    await openSheet(user);
    expect(screen.getByLabelText('Second')).toHaveFocus();
  });

  it('slides out, then closes and returns focus to the opener', async () => {
    const onClosed = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClosed={onClosed} />);
    await openSheet(user);
    vi.useFakeTimers();
    fireEvent.keyDown(screen.getByLabelText('First'), { key: 'Escape' });
    // Still shown while it slides out.
    expect(dialog().open).toBe(true);
    expect(dialog()).toHaveAttribute('data-state', 'closing');
    expect(onClosed).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(SHEET_ANIMATION_MS));
    expect(dialog().open).toBe(false);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('closes at once when the user prefers reduced motion', async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness />);
    await openSheet(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog().open).toBe(false);
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus();
  });

  it('has a Back button instead of Close for page-like sheets', async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness closeButton="back" />);
    await openSheet(user);
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(dialog().open).toBe(false);
  });

  it('closes on a click outside only when dismissible', async () => {
    reduceMotion();
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await openSheet(user);
    clickOutside();
    expect(dialog().open).toBe(true);
    // A click inside the panel never closes it.
    fireEvent.click(screen.getByLabelText('First'));
    expect(dialog().open).toBe(true);
    unmount();

    render(<Harness dismissible />);
    await openSheet(user);
    fireEvent.click(screen.getByLabelText('First'));
    expect(dialog().open).toBe(true);
    clickOutside();
    expect(dialog().open).toBe(false);
  });

  it('asks before discarding unsaved changes', async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness dirty dismissible />);
    await openSheet(user);
    const second = screen.getByLabelText('Second');
    second.focus();

    // Escape asks; Keep editing goes back to where focus was.
    await user.keyboard('{Escape}');
    const question = screen.getByRole('alertdialog', { name: 'Discard your changes?' });
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    // The form behind the question is out of reach meanwhile.
    expect(screen.getByLabelText('First').closest('[inert]')).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(question).not.toBeInTheDocument();
    expect(second).toHaveFocus();
    expect(dialog().open).toBe(true);

    // Escape inside the question is Keep editing too.
    clickOutside();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(dialog().open).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(dialog().open).toBe(false);
  });

  it("doesn't ask again on the next opening", async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness dirty />);
    await openSheet(user);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await openSheet(user);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('closes the dialog if it unmounts while open', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    const sheet = await openSheet(user);
    unmount();
    expect(sheet.open).toBe(false);
  });

  it('shows toasts inside itself while open, and in the page otherwise', async () => {
    reduceMotion();
    let show!: ReturnType<typeof useToast>['show'];
    function WithToast() {
      const toast = useToast();
      useEffect(() => {
        show = toast.show;
      }, [toast.show]);
      return (
        <>
          <Harness />
          <Toast toast={toast.toast} onDismiss={toast.dismiss} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<WithToast />);
    act(() => show({ message: 'Outside' }));
    expect(dialog()).not.toContainElement(screen.getByText('Outside'));

    await openSheet(user);
    expect(dialog()).toContainElement(screen.getByText('Outside'));
    act(() => show({ message: 'Inside' }));
    expect(dialog()).toContainElement(screen.getByText('Inside'));
    // Usable inside the modal: its buttons are reachable.
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(dialog()).not.toContainElement(screen.getByText('Inside'));
  });

  it("doesn't close for a drag that started in the panel and ended outside", async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness dismissible />);
    await openSheet(user);
    fireEvent.pointerDown(screen.getByLabelText('First'));
    fireEvent.click(dialog());
    expect(dialog().open).toBe(true);
  });

  it('is inert while it slides out, so a second click does nothing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openSheet(user);
    vi.useFakeTimers();
    fireEvent.keyDown(screen.getByLabelText('First'), { key: 'Escape' });
    expect(screen.getByLabelText('First').closest('[inert]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Done', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Close', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
  });

  it('keeps the header out of reach while asking to discard', async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness dirty />);
    await openSheet(user);
    await user.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'Close', hidden: true }).closest('[inert]'),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Keep editing' }).closest('[inert]')).toBeNull();
  });

  it('unmounting while it slides out still returns focus and reports closed', async () => {
    const onClosed = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<Harness onClosed={onClosed} />);
    await openSheet(user);
    fireEvent.keyDown(screen.getByLabelText('First'), { key: 'Escape' });
    expect(dialog().open).toBe(true);
    rerender(<button type="button">Open</button>);
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument();
  });

  it('keeps toasts inside itself until it has finished sliding out', async () => {
    let show!: ReturnType<typeof useToast>['show'];
    function WithToast() {
      const toast = useToast();
      useEffect(() => {
        show = toast.show;
      }, [toast.show]);
      return (
        <>
          <Harness />
          <Toast toast={toast.toast} onDismiss={toast.dismiss} />
        </>
      );
    }
    const user = userEvent.setup();
    render(<WithToast />);
    await openSheet(user);
    vi.useFakeTimers();
    fireEvent.keyDown(screen.getByLabelText('First'), { key: 'Escape' });
    // Shown as it closes, e.g. "Deleted": still in the sheet, which is still on top.
    act(() => show({ message: 'Deleted Acme.' }));
    const card = () => screen.getByText('Deleted Acme.');
    expect(dialog()).toContainElement(card());
    expect(card().closest('[inert]')).toBeNull();
    act(() => vi.advanceTimersByTime(SHEET_ANIMATION_MS));
    expect(dialog().open).toBe(false);
    expect(dialog()).not.toContainElement(card());
    // Moved, not new: it isn't announced a second time.
    expect(card().closest('[aria-live]')).toHaveAttribute('aria-live', 'off');
  });

  it('holds its content only while open, so each opening starts fresh', async () => {
    reduceMotion();
    const user = userEvent.setup();
    render(<Harness />);
    // Closed: nothing of it is in the page.
    expect(screen.queryByLabelText('First')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    await openSheet(user);
    await user.type(screen.getByLabelText('First'), 'typed');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('First')).toBeNull();
    await openSheet(user);
    expect(screen.getByLabelText('First')).toHaveValue('');
  });
});
