import { toUnicodeHost } from './punycode';

describe('toUnicodeHost', () => {
  it.each([
    ['jobs.xn--mnchen-3ya.de', 'jobs.münchen.de'],
    ['xn--bcher-kva.example', 'bücher.example'],
    ['xn--fsqu00a.xn--55qx5d', '例子.公司'],
    ['xn--80ak6aa92e.com', 'аррӏе.com'],
    ['XN--MNCHEN-3YA.DE', 'münchen.DE'],
  ])('%s → %s', (host, expected) => {
    expect(toUnicodeHost(host)).toBe(expected);
  });

  it('leaves ordinary and invalid labels alone', () => {
    expect(toUnicodeHost('boards.greenhouse.io')).toBe('boards.greenhouse.io');
    expect(toUnicodeHost('xn--!!.example')).toBe('xn--!!.example');
  });
});
