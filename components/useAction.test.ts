import { act, renderHook } from '@testing-library/react';
import { useAction } from './useAction';

afterEach(() => vi.restoreAllMocks());

describe('useAction', () => {
  it('runs one action at a time, even after a reset (the sheet closed) mid-run', async () => {
    const orphaned = vi.fn();
    const { result } = renderHook(() => useAction(orphaned));
    let finish!: (value: boolean) => void;
    const first = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const second = vi.fn(async () => true);
    let running!: Promise<boolean>;
    act(() => {
      running = result.current.run(first, () => 'failed');
    });
    expect(result.current.busy).toBe(true);
    act(() => result.current.reset());
    // Still running: a sheet reopened meanwhile shows it busy and can't start another.
    expect(result.current.busy).toBe(true);
    let started!: boolean;
    await act(async () => {
      started = await result.current.run(second, () => 'failed');
    });
    expect(started).toBe(false);
    expect(second).not.toHaveBeenCalled();
    await act(async () => {
      finish(true);
      await running;
    });
    expect(result.current.busy).toBe(false);
    await act(async () => {
      started = await result.current.run(second, () => 'failed');
    });
    expect(started).toBe(true);
  });

  it('reports a failure in the sheet, or as orphaned once the sheet has been reset', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const orphaned = vi.fn();
    const { result } = renderHook(() => useAction(orphaned));
    await act(async () => {
      await result.current.run(
        () => Promise.reject(new Error('x')),
        () => 'shown here',
      );
    });
    expect(result.current.error).toBe('shown here');
    let fail!: (error: Error) => void;
    let running!: Promise<boolean>;
    act(() => {
      running = result.current.run(
        () => new Promise<boolean>((_, reject) => (fail = reject)),
        () => 'as a toast',
      );
    });
    act(() => result.current.reset());
    await act(async () => {
      fail(new Error('y'));
      await running;
    });
    expect(result.current.error).toBeNull();
    expect(orphaned).toHaveBeenCalledWith('as a toast');
  });
});
