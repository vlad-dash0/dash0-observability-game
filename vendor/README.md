# vendor/

Third-party files served as-is, so the game never depends on a CDN at runtime.

| file | source | licence |
| --- | --- | --- |
| `alpine-3.14.1.min.js` | [Alpine.js](https://github.com/alpinejs/alpine) 3.14.1, `dist/cdn.min.js` from <https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js> | MIT, (c) Caleb Porzio and contributors |

`SHA256SUMS` pins each file; `test/static.test.mjs` fails if a file changes. To upgrade:
download the new build, rename it with its version, update `SHA256SUMS`
(`shasum -a 256 <file> > SHA256SUMS`) and the `<script>` in `index.html`.
