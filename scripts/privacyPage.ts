/**
 * The public privacy policy (docs/privacy/index.html, published with GitHub Pages for the store
 * listing, spec §8), made from the bundled page (entrypoints/privacy/index.html): the same
 * <main>, in a standalone page with the theme's colors inline, since the extension's tokens and
 * theme script aren't there. Pure, so tests can check the published file is up to date.
 */
export function publicPrivacyPage(bundled: string): string {
  const start = bundled.indexOf('<main>');
  const end = bundled.indexOf('</main>');
  if (start === -1 || end === -1) throw new Error('The bundled privacy page has no <main>.');
  const main = bundled.slice(start, end + '</main>'.length);
  return `<!doctype html>
<!-- Generated from entrypoints/privacy/index.html by scripts/build-privacy-page.ts. Don't edit. -->
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Huntlog: privacy policy</title>
    <meta
      name="description"
      content="Huntlog keeps your job applications on your device. Nothing is collected or sent."
    />
    <link rel="icon" href="icon.png" />
    <style>
      /* assets/theme.css's background, foreground and muted-foreground, light and dark. */
      :root {
        color-scheme: light dark;
        --background: #ffffff;
        --foreground: #09090b;
        --muted-foreground: #63636b;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --background: #09090b;
          --foreground: #fafafa;
          --muted-foreground: #a1a1aa;
        }
      }
      body {
        margin: 0 auto;
        padding: 2rem 1rem;
        max-width: 44rem;
        line-height: 1.6;
        font-family: system-ui, sans-serif;
        background: var(--background);
        color: var(--foreground);
      }
      h2 {
        margin-top: 2rem;
        font-size: 1.125rem;
      }
      .meta {
        color: var(--muted-foreground);
      }
      a {
        color: inherit;
        text-underline-offset: 4px;
      }
    </style>
  </head>
  <body>
    ${main}
  </body>
</html>
`;
}
