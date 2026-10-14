// Writes the built app (dist/client) into worker/client-files.generated.json, a module both Vite
// and esbuild (wrangler preview) bundle into the Worker, which serves the app itself (worker/assets.ts).
//   node scripts/client-files.mjs          from dist/client (vite.config.ts runs this between builds)
//   node scripts/client-files.mjs --stub   an empty map, only if the file is missing (npm prepare)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(root, 'worker', 'client-files.generated.json');

export function writeClientFiles(dir = path.join(root, 'dist', 'client')) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.')) continue;
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else files['/' + path.relative(dir, full).split(path.sep).join('/')] = readFileSync(full, 'utf-8');
    }
  };
  walk(dir);
  if (!files['/index.html']) throw new Error(`No index.html in ${dir}; build the client first.`);
  writeFileSync(OUT, JSON.stringify(files));
  return Object.keys(files);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--stub')) {
    if (!existsSync(OUT)) writeFileSync(OUT, '{}');
  } else {
    console.log('client files:', writeClientFiles().join(', '));
  }
}
