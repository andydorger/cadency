# Cadency website

The live site is `index.html`, served by GitHub Pages.

The two executive portals (Cadency and MP Holdings) are encrypted inside `index.html`.
Each one opens only with its own username and password; the readable content is never published.

## Updating the site

1. Edit the page layout in `src/site.html`.
2. Edit portal content in `portals/cadency.html` and `portals/mp-holdings.html`, and logins in `secrets.json`.
   These files are deliberately kept out of git (see `.gitignore`) because this repository is public.
3. Run `node tools/build.mjs` to rebuild `index.html`, then commit and push `index.html`.
