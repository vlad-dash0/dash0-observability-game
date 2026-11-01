# vendor/

Third-party files served as-is, so the game never depends on a CDN at runtime.

| file | source | licence |
| --- | --- | --- |
| `alpine-3.14.1.min.js` | [Alpine.js](https://github.com/alpinejs/alpine) 3.14.1, `dist/cdn.min.js` from <https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js> | MIT, (c) Caleb Porzio and contributors |
| `js-yaml-5.5.0.mjs` | [js-yaml](https://github.com/nodeca/js-yaml) 5.5.0, `dist/js-yaml.mjs` (an ES module, byte for byte as published) from <https://cdn.jsdelivr.net/npm/js-yaml@5.5.0/dist/js-yaml.mjs>; it matches the file inside the npm tarball <https://registry.npmjs.org/js-yaml/-/js-yaml-5.5.0.tgz> | MIT, (c) 2011-2015 Vitaly Puzrin |

The game imports js-yaml (a relative path, so `node --test` and the browser load the same file) only through `lib/configure/`, and loads it with the CORE schema and no custom types. 5.5.0 is the current line (npm `latest`); 4.3.2 is the legacy line. js-yaml 5 differs where the game cares in two ways, both handled in `lib/configure/parse.mjs`: a text with nothing in it throws instead of loading as nothing, and some error texts and positions changed. The file ends with a `sourceMappingURL` comment and the `.map` is not vendored, so DevTools may log one 404; the bytes stay identical to upstream so the pin can be checked against the registry.

`SHA256SUMS` pins each file; `test/static.test.mjs` fails if a file changes. To upgrade:
download the new build, rename it with its version, update `SHA256SUMS`
(`shasum -a 256 <file> > SHA256SUMS`) and the `<script>` in `index.html`.
