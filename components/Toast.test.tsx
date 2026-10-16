import { act, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { Toast, TOAST_DURATION_MS, useToast, type ToastData } from './Toast';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Harness: shows whatever toast it's given and exposes show() to the test. */
let showToast: (data: Omit<ToastData, 'id'>) => void;
let dismissReasons: string[] = [];
beforeEach(() => {
  dismissReasons = [];
});
function Harness() {
  const { toast, show, dismiss } = useToast();
  useEffect(() => {
    showToast = show;
  }, [show]);
  return <Toast toast={toast} onDismiss={(reason) => (dismissReasons.push(reason), dismiss())} />;
}

function show(data: Omit<ToastData, 'id'>) {
  act(() => showToast(data));
}

describe('Toast', () => {
  it('shows the message and disappears after 5 seconds', () => {
    render(<Harness />);
    show({ message: 'Deleted Acme.' });
    expect(screen.getByText('Deleted Acme.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(screen.getByText('Deleted Acme.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Deleted Acme.')).toBeNull();
  });

  it('lives in a polite live region that exists before any toast', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('[aria-live="polite"]')).toBeEmptyDOMElement();
  });

  it('runs the action once and dismisses', () => {
    const onAction = vi.fn();
    render(<Harness />);
    show({ message: 'Deleted Acme.', action: { label: 'Undo', onAction } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Deleted Acme.')).toBeNull();
  });

  it('can be dismissed, and reports why each toast closed', () => {
    render(<Harness />);
    show({ message: 'Saved.' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Saved.')).toBeNull();
    show({ message: 'Deleted.', action: { label: 'Undo', onAction: () => {} } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    show({ message: 'Later.' });
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(dismissReasons).toEqual(['dismiss', 'action', 'timeout']);
  });

  it('pauses while hovered and restarts the full time when the pointer leaves', () => {
    render(<Harness />);
    show({ message: 'Deleted Acme.' });
    const card = screen.getByText('Deleted Acme.').parentElement!;
    act(() => vi.advanceTimersByTime(4000));
    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Deleted Acme.')).toBeInTheDocument();
    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS - 1));
    expect(screen.getByText('Deleted Acme.')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Deleted Acme.')).toBeNull();
  });

  it('pauses while a button inside has keyboard focus', () => {
    render(<Harness />);
    show({ message: 'Deleted Acme.', action: { label: 'Undo', onAction: () => {} } });
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText('Deleted Acme.')).toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Undo' }).blur());
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByText('Deleted Acme.')).toBeNull();
  });

  it('replaces the previous toast and its action, with a fresh timer', () => {
    const first = vi.fn();
    render(<Harness />);
    show({ message: 'Deleted Acme.', action: { label: 'Undo', onAction: first } });
    act(() => vi.advanceTimersByTime(4000));
    show({ message: 'Deleted Beta.' });
    expect(screen.queryByText('Deleted Acme.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByText('Deleted Beta.')).toBeInTheDocument();
  });

  it("doesn't carry a pause over to the next toast", () => {
    render(<Harness />);
    show({ message: 'First', action: { label: 'Undo', onAction: () => {} } });
    act(() => screen.getByRole('button', { name: 'Undo' }).focus());
    show({ message: 'Second' });
    act(() => vi.advanceTimersByTime(TOAST_DURATION_MS));
    expect(screen.queryByText('Second')).toBeNull();
  });
});
