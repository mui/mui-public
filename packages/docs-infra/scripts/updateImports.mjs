import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const pkgJsonPath = path.join(process.cwd(), 'build', 'package.json');
const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, 'utf8'));

Object.keys(pkgJson.exports).forEach((key) => {
  const val = pkgJson.exports[key];
  if (!val || typeof val === 'string') {
    return;
  }
  pkgJson.exports[key].default = pkgJson.exports[key].import;
  delete pkgJson.exports[key].import;
});

await fs.writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2), 'utf-8');
