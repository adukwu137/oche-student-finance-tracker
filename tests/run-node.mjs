// Run the tests in the terminal: node tests/run-node.mjs (ass a word to run only matching tests, e.g. "amount")
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
const load = (file) => vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
['finance', 'validators', 'search', 'state', 'storage', 'seed-data'].forEach((n) => load(`scripts/${n}.js`));
globalThis.SEED_JSON_TEXT = fs.readFileSync(path.join(root, 'seed.json'), 'utf8');
load('tests/suite.js');

const filter = process.argv[2];
const results = await globalThis.SFT.suite.runAll(filter);
if(filter && results.length === 0) { console.log(`No tests match "${filter}".`); process.exit(2); }
let failed = 0;
for (const r of results) {
    const mark = r.status === 'pass' ? 'PASS' : r.status === 'skip' ? 'SKIP' : 'FAIL';
    console.log(`${mark}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
    if (r.status === 'fail') failed += 1;
}
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`\n${count('pass')} passed, ${failed} failed, ${count('skip')} skipped (of ${results.length})`);
process.exit(failed ? 1 : 0);
