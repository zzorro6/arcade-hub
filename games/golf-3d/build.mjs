import { build } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';

const result = await build({
  base: './',
  build: {
    write: false,
    cssCodeSplit: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
const outputs = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output);
const entry = outputs.find((file) => file.fileName === 'index.html');
if (!entry || entry.type !== 'asset') throw new Error('Missing built golf HTML');
let html = String(entry.source);
let scripts = 0;
let styles = 0;
for (const file of outputs) {
  if (file.type === 'chunk' && file.isEntry) {
    const tag = /<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/;
    if (!tag.test(html)) throw new Error('Missing golf script tag');
    html = html.replace(tag, '');
    html = html.replace('</body>', () => `<script>${file.code.replace(/<\/script/gi, '<\\/script')}</script></body>`);
    scripts++;
  } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
    const tag = /<link\b[^>]*\brel="stylesheet"[^>]*>/;
    if (!tag.test(html)) throw new Error('Missing golf stylesheet tag');
    html = html.replace(tag, () => `<style>${String(file.source).replace(/<\/style/gi, '<\\/style')}</style>`);
    styles++;
  }
}
if (scripts !== 1 || styles !== 1 || /<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/.test(html)) {
  throw new Error('Golf build must contain exactly one inline script and stylesheet');
}
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
console.log(`Built self-contained golf page (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
