import { extractPage } from './extract';

afterEach(() => {
  vi.restoreAllMocks();
  document.title = '';
});

describe('extractPage (M1 stub)', () => {
  it('returns the tab URL and trimmed document title', () => {
    document.title = '  Senior Engineer at Acme | LinkedIn  ';
    expect(extractPage()).toEqual({
      url: location.href,
      title: 'Senior Engineer at Acme | LinkedIn',
    });
  });

  it.each([[''], ['   \n\t ']])('leaves the title blank for %j', (title) => {
    document.title = title;
    expect(extractPage()).toEqual({ url: location.href, title: undefined });
  });

  it('never throws when reading the title throws', () => {
    vi.spyOn(document, 'title', 'get').mockImplementation(() => {
      throw new Error('hostile page');
    });
    expect(() => extractPage()).not.toThrow();
    expect(extractPage()).toEqual({ url: location.href, title: undefined });
  });

  it('returns null instead of throwing when location is unreadable', () => {
    vi.spyOn(location, 'href', 'get').mockImplementation(() => {
      throw new Error('detached');
    });
    expect(extractPage()).toBeNull();
  });

  // executeScript serializes the function, so it must not reference imports or outer scope.
  // Rebuilding it from source with no closure turns any such reference into a ReferenceError.
  it('is self-contained when serialized', () => {
    document.title = 'Serialized';
    const rebuilt = new Function(`return (${extractPage.toString()})`)() as typeof extractPage;
    expect(rebuilt()).toEqual({ url: location.href, title: 'Serialized' });
  });
});
