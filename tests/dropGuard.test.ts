import { guardFileDrops } from '@/components/dropGuard';

/** A drag event as the browser fires it, carrying these types. */
function drag(type: 'dragover' | 'drop', target: Element, types: string[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, dropEffect: 'copy' } });
  target.dispatchEvent(event);
  return event as Event & { dataTransfer: { dropEffect: string } };
}

describe('guardFileDrops', () => {
  let stop: () => void;
  beforeEach(() => {
    document.body.innerHTML =
      '<p id="page">Page</p><label data-dropzone=""><span id="inside">Zone</span></label>' +
      '<input id="text" type="text"><input id="file" type="file">';
    stop = guardFileDrops();
  });
  afterEach(() => stop());
  const el = (id: string) => document.getElementById(id)!;

  it('refuses a file dragged or dropped outside a drop zone', () => {
    const over = drag('dragover', el('page'), ['Files']);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
    expect(drag('drop', el('page'), ['Files']).defaultPrevented).toBe(true);
  });

  it('leaves a drop zone (and anything inside it) to handle its own files', () => {
    expect(drag('dragover', el('inside'), ['Files']).defaultPrevented).toBe(false);
    expect(drag('drop', el('inside'), ['Files']).defaultPrevented).toBe(false);
  });

  it('leaves drags of text alone, so they can still drop into a field', () => {
    expect(drag('dragover', el('page'), ['text/plain']).defaultPrevented).toBe(false);
    expect(drag('drop', el('page'), ['text/plain']).defaultPrevented).toBe(false);
  });

  it('refuses a link anywhere but a text field, where it drops in as text', () => {
    const link = ['text/uri-list', 'text/plain'];
    expect(drag('dragover', el('page'), link).defaultPrevented).toBe(true);
    expect(drag('drop', el('page'), link).defaultPrevented).toBe(true);
    expect(drag('drop', el('file'), link).defaultPrevented).toBe(true);
    expect(drag('dragover', el('text'), link).defaultPrevented).toBe(false);
    expect(drag('drop', el('text'), link).defaultPrevented).toBe(false);
  });

  it('refuses a file even on a text field', () => {
    expect(drag('drop', el('text'), ['Files']).defaultPrevented).toBe(true);
  });

  it('stops guarding once removed', () => {
    stop();
    expect(drag('drop', el('page'), ['Files']).defaultPrevented).toBe(false);
    stop = () => {};
  });
});
