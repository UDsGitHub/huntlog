import fs from 'node:fs';
import path from 'node:path';

/*
 * Spec §10: contrast meets WCAG AA in both themes. Reads the token values from
 * assets/theme.css, so changing a color there is checked here. Text needs 4.5:1 (all our text is
 * under 18px); component edges, focus rings and chart marks need 3:1 (WCAG 1.4.11).
 */
const css = fs.readFileSync(path.resolve(import.meta.dirname, '../assets/theme.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!]),
  );
}

const light = block(':root');
// Dark overrides every color it lists; anything it doesn't list falls back to light.
const dark = { ...light, ...block(":root[data-theme='dark']") };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [foreground token, background token]: text that appears on that background. */
const TEXT: [string, string][] = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['destructive', 'popover'],
  ['destructive-foreground', 'destructive'],
  ['warning-foreground', 'warning'],
  ['status-neutral-foreground', 'status-neutral'],
  ['status-progress-foreground', 'status-progress'],
  ['status-progress-strong-foreground', 'status-progress-strong'],
  ['status-success-foreground', 'status-success'],
  ['status-success-strong-foreground', 'status-success-strong'],
];

/** Non-text: a control's edge, the focus ring, chart bars. */
const GRAPHICS: [string, string][] = [
  ['input', 'background'],
  ['input', 'card'],
  ['ring', 'background'],
  ['ring', 'card'],
  ['chart-1', 'background'],
  ['chart-1', 'card'],
  // Status swatches: timeline dots on the page, outcome segments and legend swatches on a card.
  ...(
    [
      'saved',
      'applied',
      'screening',
      'interviewing',
      'offer',
      'accepted',
      'rejected',
      'withdrawn',
      'ghosted',
    ] as const
  ).flatMap((status): [string, string][] => [
    [`status-${status}`, 'background'],
    [`status-${status}`, 'card'],
  ]),
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme', (_name, tokens) => {
  it.each(TEXT)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined();
    expect(tokens[bg], bg).toBeDefined();
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAPHICS)('%s on %s is at least 3:1', (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined();
    expect(tokens[bg], bg).toBeDefined();
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

it('checks the math against known pairs', () => {
  expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
  expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
});
