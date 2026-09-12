/* Copies the framework-free domain (game engine + data model) into functions/src/domain so the
 * deployed bundle is self-contained. The app remains the single source of truth (src/domain). */
const fs = require('fs');
const path = require('path');

const from = path.resolve(__dirname, '..', '..', 'src', 'domain');
const to = path.resolve(__dirname, '..', 'src', 'domain');

function copy(src, dst) {
  if (path.basename(src) === '__tests__') return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copy(path.join(src, entry), path.join(dst, entry));
  } else if (src.endsWith('.ts')) {
    fs.copyFileSync(src, dst);
  }
}

fs.rmSync(to, { recursive: true, force: true });
copy(from, to);
console.log(`domain synced: ${from} -> ${to}`);
