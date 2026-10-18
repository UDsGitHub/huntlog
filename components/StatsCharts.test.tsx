import { cleanup, render, screen, within } from '@testing-library/react';
import type { Activity } from '@/lib/stats';
import {
  ActivityChart,
  OutcomesBar,
  outcomeLabel,
  segmentFill,
  WeeklyGoalCard,
} from './StatsCharts';

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

  it('sizes each segment by its count and never colors rejections red', () => {
    const { container } = render(
      <OutcomesBar
        outcomes={[
          { status: 'interviewing', count: 1 },
          { status: 'rejected', count: 3 },
        ]}
      />,
    );
    const segments = container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div');
    expect([...segments].map((s) => s.style.flexGrow)).toEqual(['1', '3']);
    expect(container.innerHTML).not.toMatch(/red|rose/);
  });

  it('gives every status its own color, so segments match the legend', () => {
    const statuses = [
      'saved',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'accepted',
      'rejected',
      'withdrawn',
      'ghosted',
    ] as const;
    const { container } = render(
      <OutcomesBar outcomes={statuses.map((status) => ({ status, count: 1 }))} />,
    );
    const colors = [...container.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div')].map(
      (segment) => [...segment.classList].find((c) => c.startsWith('bg-')),
    );
    expect(new Set(colors).size).toBe(statuses.length);
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
    render(<ActivityChart activity={days} total={4} />);
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

  it('draws a bar per busy bucket, the busiest one full height', () => {
    const { container } = render(<ActivityChart activity={days} total={4} />);
    const bars = [...container.querySelectorAll<HTMLElement>('[data-bar]')];
    expect(bars).toHaveLength(2); // no bar for an empty day
    expect(bars.map((bar) => parseFloat(bar.style.height))).toEqual([100, expect.closeTo(33.33)]);
    // The drawing is decorative: the text and the table carry the numbers.
    expect(bars[0]!.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Oct 11')).toBeInTheDocument();
    expect(screen.getByText('Oct 13')).toBeInTheDocument();
  });

  it('shows the year on the axis when the range crosses one', () => {
    render(
      <ActivityChart
        total={1}
        activity={{
          unit: 'day',
          buckets: [
            { from: '2026-12-31', to: '2026-12-31', count: 1 },
            { from: '2027-01-01', to: '2027-01-01', count: 0 },
          ],
        }}
      />,
    );
    expect(screen.getByText('Dec 31, 2026', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Jan 1, 2027', { selector: 'span' })).toBeInTheDocument();
  });

  it('names months and years', () => {
    const { unmount } = render(
      <ActivityChart
        total={3}
        activity={{
          unit: 'month',
          buckets: [
            { from: '2025-09-15', to: '2025-09-30', count: 1 },
            { from: '2025-10-01', to: '2025-10-31', count: 2 },
          ],
        }}
      />,
    );
    const section = screen.getByRole('region', { name: 'Applications per month' });
    expect(section).toHaveTextContent('The busiest month was Oct 2025, with 2.');
    expect(within(section).getByRole('rowheader', { name: 'Sep 2025' })).toBeTruthy();
    unmount();
    render(
      <ActivityChart
        total={1}
        activity={{ unit: 'year', buckets: [{ from: '2020-03-01', to: '2020-12-31', count: 1 }] }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Applications per year' })).toHaveTextContent(
      'The busiest year was 2020, with 1.',
    );
  });

  it('names weeks by their first day', () => {
    render(
      <ActivityChart
        total={7}
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
    const empty = { unit: 'day' as const, buckets: days.buckets.map((b) => ({ ...b, count: 0 })) };
    const { container } = render(<ActivityChart activity={empty} total={0} />);
    expect(screen.getByText('No applications in this range yet.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-bar]')).toHaveLength(0);
  });
});

describe('WeeklyGoalCard', () => {
  const week = { from: '2026-10-11', to: '2026-10-17' };
  const progress = (count: number, goal = 5) => ({
    count,
    goal,
    fraction: Math.min(1, count / goal),
    remaining: Math.max(0, goal - count),
    week,
  });
  const fills = () =>
    [...document.querySelectorAll<HTMLElement>('[data-segment] > div')].map(
      (fill) => fill.style.width,
    );
  const bar = () => screen.getByRole('progressbar', { name: 'Weekly application goal' });

  it.each([
    [
      0,
      '0 applications submitted',
      ['0%', '0%', '0%', '0%', '0%'],
      'Goal: 5 applications · 5 more applications to reach your goal',
    ],
    [
      1,
      '1 application submitted',
      ['100%', '0%', '0%', '0%', '0%'],
      'Goal: 5 applications · 4 more applications to reach your goal',
    ],
    [
      3,
      '3 applications submitted',
      ['100%', '100%', '100%', '0%', '0%'],
      'Goal: 5 applications · 2 more applications to reach your goal',
    ],
    [
      5,
      '5 applications submitted',
      ['100%', '100%', '100%', '100%', '100%'],
      'Goal: 5 applications · Weekly goal complete',
    ],
    [
      12,
      '12 applications submitted',
      ['100%', '100%', '100%', '100%', '100%'],
      'Goal: 5 applications · 7 above your goal',
    ],
  ])('with %i of 5: "%s"', (count, submitted, widths, summary) => {
    render(<WeeklyGoalCard progress={progress(count)} />);
    const card = screen.getByRole('region', { name: 'Weekly application goal' });
    expect(card).toHaveTextContent(submitted);
    expect(card).toHaveAccessibleDescription(summary);
    expect(fills()).toEqual(widths);
    expect(bar()).toHaveAttribute('aria-valuenow', String(Math.min(count, 5)));
    expect(bar()).toHaveAttribute('aria-valuetext', `${count} of 5 applications this week`);
    const reached = count >= 5;
    expect(screen.queryByText("You've reached your goal!") !== null).toBe(reached);
    // Blue toward the goal, green once it's reached.
    for (const fill of document.querySelectorAll('[data-segment] > div')) {
      expect(fill).toHaveClass(reached ? 'bg-success' : 'bg-chart-1');
    }
  });

  it('fills a segment partly between steps, and says "application" for one', () => {
    render(<WeeklyGoalCard progress={progress(3, 10)} />);
    expect(fills()).toEqual(['100%', '50%', '0%', '0%', '0%']);
    cleanup();
    render(<WeeklyGoalCard progress={progress(0, 1)} />);
    expect(screen.getByRole('region')).toHaveAccessibleDescription(
      'Goal: 1 application · 1 more application to reach your goal',
    );
  });

  it('shows nothing for a goal of zero', () => {
    const { container } = render(<WeeklyGoalCard progress={progress(2, 0)} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('segmentFill', () => {
  it('clamps to the bar, never overflowing', () => {
    expect(segmentFill(2.4, 4)).toBe(1);
    expect(segmentFill(-1, 0)).toBe(0);
    expect(segmentFill(Number.NaN, 0)).toBe(0);
    expect(segmentFill(0.5, 2)).toBe(0.5);
  });
});
