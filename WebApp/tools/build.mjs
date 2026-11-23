import { cp, mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { icons } from './icons.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
await mkdir(dist, { recursive: true });
const expected=new Set(['icon-192.png','icon-512.png','licenses/notices.md']);
for(const [directory,files] of [['public',['index.html','style.css','manifest.webmanifest']],
  ['src',['app.js','domain.js','storage.js','ocr.js','preprocess.js','template.js']]]) {
  const entries=await readdir(join(root,directory),{withFileTypes:true});
  if(entries.some(entry=>!entry.isFile()||!files.includes(entry.name)))throw new Error(`Unexpected source file in ${directory}`);
  await mkdir(directory==='src'?join(dist,'src'):dist,{recursive:true});
  for(const file of files) {
    const output=directory==='src'?`src/${file}`:file;expected.add(output);
    await cp(join(root,directory,file),join(dist,...output.split('/')));
  }
}
await icons(dist);
await mkdir(join(dist, 'vendor', 'core'), { recursive: true });
await mkdir(join(dist, 'vendor', 'lang'), { recursive: true });
const deps = join(root, 'node_modules');
for (const file of ['tesseract.min.js', 'worker.min.js']) {
  expected.add(`vendor/${file}`);
  await cp(join(deps, 'tesseract.js', 'dist', file), join(dist, 'vendor', file));
}
for (const file of await readdir(join(deps, 'tesseract.js-core'))) {
  if (/^tesseract-core.*\.wasm(?:\.js)?$/.test(file)) {
    expected.add(`vendor/core/${file}`);
    await cp(join(deps, 'tesseract.js-core', file), join(dist, 'vendor', 'core', file));
  }
}
for (const lang of ['chi_sim', 'eng']) {
  expected.add(`vendor/lang/${lang}.traineddata.gz`);
  await cp(join(deps, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`),
    join(dist, 'vendor', 'lang', `${lang}.traineddata.gz`));
}
await mkdir(join(dist, 'licenses'), { recursive: true });
for (const name of ['tesseract.js', 'tesseract.js-core']) {
  const files = await readdir(join(deps, name));
  const license = files.find(file => /^license/i.test(file));
  if (!license) throw new Error(`Missing dependency license: ${name}`);
  expected.add(`licenses/${name}.txt`);
  await cp(join(deps, name, license), join(dist, 'licenses', `${name}.txt`));
}
await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(dist, 'licenses', 'notices.md'));
const assets = [];
async function walk(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await walk(path);
    else if (!['sw.js', 'asset-manifest.json'].includes(item.name)) {
      if(!expected.has(relative(dist,path).replaceAll('\\','/')))throw new Error('Unexpected file in deployment output');
      const data = await readFile(path);
      assets.push({ path: relative(dist, path).replaceAll('\\', '/'), bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex') });
    }
  }
}
await walk(dist);
assets.sort((a, b) => a.path.localeCompare(b.path));
const template=await readFile(join(root,'tools','sw-template.js'),'utf8');
const version = createHash('sha256').update(JSON.stringify(assets)+template).digest('hex').slice(0, 16);
await writeFile(join(dist, 'asset-manifest.json'), JSON.stringify({ version, assets }, null, 2));
await writeFile(join(dist, 'sw.js'),template.replace('__VERSION__', version));
console.log(`Built ${assets.length} self-hosted assets (${(assets.reduce((n, a) => n + a.bytes, 0) / 1048576).toFixed(1)} MB).`);
