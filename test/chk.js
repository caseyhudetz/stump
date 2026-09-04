/* The cheapest check there is: does the page's inline JS parse, and does
   wrangler.jsonc still read as JSON once its comments are stripped. Run it
   before anything slower — a typo found here costs a second, and found by a
   browser suite costs a minute. Paths resolve from this file, so it can be
   run from anywhere. */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
for (const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
  if (m[0].includes('src=')) continue;
  try { new Function(m[1]); }
  catch (e) { console.log('HTML JS SYNTAX ERROR:', e.message); process.exit(1); }
}
console.log('index.html JS OK');

const jsonc = fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '');
JSON.parse(jsonc);
console.log('wrangler.jsonc parses OK');
