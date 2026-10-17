/**
 * Decodes one punycode label (RFC 3492), the part after "xn--". Browsers keep internationalized
 * host names in this ASCII form (`new URL()`), so showing a site's name needs the way back.
 * Returns undefined for input that isn't valid punycode.
 */
function decodeLabel(input: string): string | undefined {
  const base = 36;
  const [tMin, tMax, skew, damp] = [1, 26, 38, 700];
  const adapt = (delta: number, points: number, first: boolean) => {
    delta = first ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / points);
    let k = 0;
    while (delta > ((base - tMin) * tMax) >> 1) {
      delta = Math.floor(delta / (base - tMin));
      k += base;
    }
    return k + Math.floor(((base - tMin + 1) * delta) / (delta + skew));
  };
  const digit = (code: number) =>
    code >= 48 && code <= 57
      ? code - 22
      : code >= 65 && code <= 90
        ? code - 65
        : code >= 97 && code <= 122
          ? code - 97
          : base;

  const lastDash = input.lastIndexOf('-');
  const output = [...(lastDash > 0 ? input.slice(0, lastDash) : '')].map((c) => c.codePointAt(0)!);
  let [n, i, bias] = [128, 0, 72];
  for (let index = lastDash > 0 ? lastDash + 1 : 0; index < input.length;) {
    const oldI = i;
    for (let w = 1, k = base; ; k += base) {
      if (index >= input.length) return undefined;
      const d = digit(input.charCodeAt(index++));
      if (d >= base) return undefined;
      i += d * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldI, output.length + 1, oldI === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    if (n > 0x10ffff) return undefined;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

/** A host name with its punycode labels ("xn--…") shown as Unicode; others left as they are. */
export function toUnicodeHost(host: string): string {
  return host
    .split('.')
    .map((label) =>
      label.toLowerCase().startsWith('xn--')
        ? (decodeLabel(label.slice(4).toLowerCase()) ?? label)
        : label,
    )
    .join('.');
}
