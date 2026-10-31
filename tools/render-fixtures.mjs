// Regenerates test/fixtures/pr-findings/*.html from the .md beside each (#35): GitHub
// renders the markdown once (`gh api markdown`, GFM mode in this repo's context, as a
// comment's bodyHTML is rendered) and the tests read the committed HTML, offline.
// Usage: node tools/render-fixtures.mjs [name ...]   (no names: every .md fixture)
// Review the diff after running it: a change in GitHub's renderer shows up there.
import { execFile } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'pr-findings');
const CONTEXT = 'vlad-dash0/dash0-observability-game';

const render = (file) => new Promise((done, fail) => {
  execFile('gh', ['api', 'markdown', '-F', `text=@${file}`, '-f', 'mode=gfm', '-f', `context=${CONTEXT}`],
    { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      err ? fail(new Error(`${file}: ${stderr.trim() || err.message}`)) : done(stdout));
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  const all = readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  const unknown = names.filter((n) => !all.includes(n));
  if (unknown.length) {
    console.error(`no such fixture: ${unknown.join(', ')}`);
    process.exitCode = 1;
  } else {
    for (const name of names.length ? names : all) {
      writeFileSync(join(DIR, `${name}.html`), await render(join(DIR, `${name}.md`)));
      console.log(`rendered ${name}.html`);
    }
  }
}
