/* Copia o domínio puro (motor do jogo + modelo) de ../src/domain para backend/src/domain.
 * O app continua sendo a fonte única (src/domain); o backend roda exatamente o mesmo código. */
const fs = require('fs');
const path = require('path');

const from = path.resolve(__dirname, '..', '..', 'src', 'domain');
const to = path.resolve(__dirname, '..', 'src', 'domain');

// Os testes do domínio vêm junto: o motor que roda no servidor é testado aqui também.
function copy(src, dst) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) copy(path.join(src, entry), path.join(dst, entry));
  } else if (src.endsWith('.ts')) {
    fs.copyFileSync(src, dst);
  }
}

if (!fs.existsSync(from)) {
  // Build da imagem Docker: o contexto já traz o domínio copiado.
  console.log('domain source not found, keeping existing copy');
  process.exit(0);
}
fs.rmSync(to, { recursive: true, force: true });
copy(from, to);
console.log(`domain synced: ${from} -> ${to}`);
