import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CaptureTip } from './CaptureTip';

type Command = Browser.commands.Command;

function shortcutIs(shortcut: string | undefined) {
  const commands: Command[] = [{ name: 'add-job', shortcut, description: 'Add' }];
  return vi.spyOn(fakeBrowser.commands, 'getAll').mockResolvedValue(commands as never);
}

beforeEach(() => {
  fakeBrowser.reset();
  vi.restoreAllMocks();
});

describe('CaptureTip', () => {
  it('names the shortcut Chrome has set', async () => {
    shortcutIs('⌥⇧J');
    render(<CaptureTip />);
    expect(await screen.findByText('⌥⇧J')).toBeInTheDocument();
    expect(screen.getByText(/on any job posting, press/)).toHaveTextContent(
      'Tip: on any job posting, press ⌥⇧J or right-click and choose Add job to Huntlog to fill it in for you.',
    );
    expect(screen.queryByRole('button', { name: 'Set a keyboard shortcut' })).toBeNull();
  });

  it("offers Chrome's shortcuts page when none is set", async () => {
    shortcutIs('');
    const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);
    const user = userEvent.setup();
    render(<CaptureTip />);
    await user.click(await screen.findByRole('button', { name: 'Set a keyboard shortcut' }));
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
    expect(screen.getByText(/right-click any job posting/)).toBeInTheDocument();
  });

  it("falls back to the right-click tip alone when the shortcut can't be read", async () => {
    vi.spyOn(fakeBrowser.commands, 'getAll').mockRejectedValue(new Error('no'));
    render(<CaptureTip />);
    await act(async () => {});
    expect(
      screen.getByText(
        'Tip: right-click any job posting and choose Add job to Huntlog to fill it in for you.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('reads it again when the panel regains focus (it is changed on Chrome’s page)', async () => {
    const getAll = shortcutIs('');
    render(<CaptureTip />);
    await screen.findByRole('button', { name: 'Set a keyboard shortcut' });
    getAll.mockResolvedValue([{ name: 'add-job', shortcut: 'Ctrl+Shift+Y' }] as never);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText('Ctrl+Shift+Y')).toBeInTheDocument();
  });
});
