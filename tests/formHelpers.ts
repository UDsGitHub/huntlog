import { screen, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

/** The open form's Source (spec §4.2 chips; found even inside a collapsed More details): the pressed chip, or what Other holds, or ''. */
export function sourceValue(): string {
  const group = screen.getByRole('group', { name: /^Source/, hidden: true });
  const pressed = within(group)
    .queryAllByRole('button', { pressed: true, hidden: true })
    .map((chip) => chip.textContent?.trim() ?? '');
  if (pressed[0] === 'Other…')
    return (within(group).getByLabelText('Other source') as HTMLInputElement).value;
  return pressed[0] ?? '';
}

/** Sets the open form's Source: its chip, Other… with text, or '' to clear it. */
export async function chooseSource(user: ReturnType<typeof userEvent.setup>, value: string) {
  const group = screen.getByRole('group', { name: /^Source/, hidden: true });
  const current = sourceValue();
  if (current === value) return;
  const chip = within(group).queryByRole('button', { name: value, pressed: false, hidden: true });
  if (value === '') {
    const on = within(group).queryAllByRole('button', { pressed: true, hidden: true })[0];
    if (on) await user.click(on);
  } else if (chip) {
    await user.click(chip);
  } else {
    const other = within(group).getByRole('button', { name: 'Other…', hidden: true });
    if (other.getAttribute('aria-pressed') !== 'true') await user.click(other);
    const field = within(group).getByLabelText('Other source');
    await user.clear(field);
    await user.type(field, value);
  }
}
