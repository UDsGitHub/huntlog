import { render, screen, within } from '@testing-library/react';
import type { Activity } from '@/lib/stats';
import { ActivityChart, OutcomesBar, outcomeLabel } from './StatsCharts';

describe('OutcomesBar', () => {
  it('labels rejections neutrally, never as "Rejected"', () => {
    expect(outcomeLabel('rejected')).toBe('Closed – not selected');
    render(
      <OutcomesBar
        outcomes={[
          { status: 'applied', count: 3 },
          { status: 'rejected', count: 2 },
        ]}
      />,
    );
    const section = screen.getByRole('region', { name: 'Where they stand now' });
    expect(section).not.toHaveTextContent(/reject/i);
    const items = within(section).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Applied3', 'Closed – not selected2']);
  });

  it('sizes each segment by its share and never colors rejections red', () => {
    const { container } = render(
      <OutcomesBar
        outcomes={[
          { status: 'interviewing', count: 1 },
          { status: 'rejected', count: 3 },
        ]}
      />,
    );
    const segments = container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div');
    expect([...segments].map((s) => s.style.width)).toEqual(['25%', '75%']);
    expect(container.innerHTML).not.toMatch(/red|rose/);
  });

  it('shows nothing with no applications', () => {
    const { container } = render(<OutcomesBar outcomes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

const days: Activity = {
  unit: 'day',
  buckets: [
    { from: '2026-10-11', to: '2026-10-11', count: 0 },
    { from: '2026-10-12', to: '2026-10-12', count: 3 },
    { from: '2026-10-13', to: '2026-10-13', count: 1 },
  ],
};

describe('ActivityChart', () => {
  it('sums up the chart in text and gives screen readers the data as a table', () => {
    render(<ActivityChart activity={days} />);
    const section = screen.getByRole('region', { name: 'Applications per day' });
    expect(section).toHaveTextContent(
      '4 applications in this range. The busiest day was Oct 12, 2026, with 3.',
    );
    const table = within(section).getByRole('table', { name: 'Applications per day' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'Oct 11, 20260',
      'Oct 12, 20263',
      'Oct 13, 20261',
    ]);
    expect(table).toHaveClass('sr-only');
  });

  it('draws a bar per bucket, the busiest one full height', () => {
    const { container } = render(<ActivityChart activity={days} />);
    const bars = [...container.querySelectorAll('rect')];
    expect(bars).toHaveLength(3);
    const heights = bars.map((bar) => Number(bar.getAttribute('height')));
    expect(heights[0]).toBe(0);
    expect(heights[1]).toBeGreaterThan(heights[2]!);
    expect(heights[2]).toBeCloseTo(heights[1]! / 3);
    // The drawing is decorative: the text and the table carry the numbers.
    expect(container.querySelector('svg')!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Oct 11')).toBeInTheDocument();
    expect(screen.getByText('Oct 13')).toBeInTheDocument();
  });

  it('names weeks by their first day', () => {
    render(
      <ActivityChart
        activity={{
          unit: 'week',
          buckets: [
            { from: '2026-10-01', to: '2026-10-04', count: 2 },
            { from: '2026-10-05', to: '2026-10-11', count: 5 },
          ],
        }}
      />,
    );
    const section = screen.getByRole('region', { name: 'Applications per week' });
    expect(section).toHaveTextContent('The busiest week was the week of Oct 5, 2026, with 5.');
    expect(within(section).getByRole('rowheader', { name: 'Week of Oct 1, 2026' })).toBeTruthy();
  });

  it('says so when the range is empty, with no bars drawn', () => {
    const { container } = render(
      <ActivityChart
        activity={{ unit: 'day', buckets: days.buckets.map((b) => ({ ...b, count: 0 })) }}
      />,
    );
    expect(screen.getByText('No applications in this range yet.')).toBeInTheDocument();
    expect(
      [...container.querySelectorAll('rect')].every((r) => r.getAttribute('height') === '0'),
    ).toBe(true);
  });
});
