import { act, renderHook } from '@testing-library/react';
import { SEARCH_DEBOUNCE_MS, useDebouncedSearch } from './useDebouncedSearch';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useDebouncedSearch', () => {
  it('passes the text on once typing pauses, restarting the wait per keystroke', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedSearch(value), {
      initialProps: { value: '' },
    });
    rerender({ value: 'a' });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
    rerender({ value: 'ac' });
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 50));
    expect(result.current).toBe('');
    act(() => vi.advanceTimersByTime(50));
    expect(result.current).toBe('ac');
  });

  it('passes a blank search at once, and a pending one never lands after it', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedSearch(value), {
      initialProps: { value: 'acme' },
    });
    expect(result.current).toBe('acme');
    rerender({ value: 'acme corp' });
    rerender({ value: '  ' });
    expect(result.current).toBe('  ');
    act(() => vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS * 2));
    expect(result.current).toBe('  ');
  });
});
