import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const base = 'https://raw.githubusercontent.com/sayhiben/reddit-comment-stream/main/dist/';
const variants = [
  ['reddit-comment-stream', 'Reddit Comment Stream', ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'sh.reddit.com', 'np.reddit.com', 'm.reddit.com']],
  ['reddit-comment-stream-old', 'Reddit Comment Stream — Old Reddit', ['old.reddit.com', 'np.reddit.com']],
  ['reddit-comment-stream-new', 'Reddit Comment Stream — New Reddit', ['reddit.com', 'www.reddit.com', 'new.reddit.com', 'sh.reddit.com', 'm.reddit.com']],
];
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const [file, name, hosts] of variants) {
  const metadata = [
    '// ==UserScript==',
    `// @name         ${name}`,
    '// @namespace    https://github.com/sayhiben/reddit-comment-stream',
    `// @version      ${version}`,
    '// @description  Load available Reddit replies, then read every level newest first with threaded context.',
    '// @author       sayhiben',
    '// @license      MIT',
    '// @homepageURL  https://github.com/sayhiben/reddit-comment-stream',
    '// @supportURL   https://github.com/sayhiben/reddit-comment-stream/issues',
    `// @updateURL    ${base}${file}.meta.js`,
    `// @downloadURL  ${base}${file}.user.js`,
    ...hosts.map(host => `// @match        https://${host}/*`),
    '// @grant        none',
    '// @inject-into  content',
    '// @run-at       document-end',
    '// @noframes',
    '// ==/UserScript==',
  ].join('\n');
  const output = await build({
    entryPoints: [fileURLToPath(new URL('../src/app.js', import.meta.url))],
    bundle: true, format: 'iife', target: ['chrome100', 'firefox102', 'safari15.4'],
    write: false, legalComments: 'none', charset: 'utf8',
    loader: { '.css': 'text' },
  });
  await writeFile(new URL(`../dist/${file}.user.js`, import.meta.url), `${metadata}\n\n${output.outputFiles[0].text}`);
  await writeFile(new URL(`../dist/${file}.meta.js`, import.meta.url), `${metadata}\n`);
}
console.log(`Built ${variants.length} standalone userscripts (${version}).`);
