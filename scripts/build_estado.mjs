// build_estado.mjs — descarga el Padrón Reducido del RUC de SUNAT y genera
// estado.txt.gz (comprimido) + estado.meta.json con SOLO los RUC cuyo
// estado ≠ ACTIVO o cuya condición de domicilio es NO HABIDO / NO HALLADO.
//
// Se ejecuta en GitHub Actions (que sí tiene acceso a internet a SUNAT).
// No requiere dependencias npm: usa módulos nativos de Node + el comando `unzip`.
//
// Formato del padrón reducido (texto plano, delimitado por "|", sin cabecera):
//   RUC | Razón Social | Estado | Condición domicilio | Ubigeo | ...direccion...
//
// Salida:
//   estado.txt.gz  -> líneas "RUC|ESTADO|CONDICION" (gzip), solo RUC observados
//   estado.meta.json -> { actualizado, fuente, total }

import fs from 'node:fs';
import { createReadStream, createWriteStream } from 'node:fs';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { execSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';

const ZIP_URL = 'http://www2.sunat.gob.pe/padron_reducido_ruc.zip';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ZIP_FILE = 'padron_reducido_ruc.zip';
const OUT_GZ   = 'estado.txt.gz';
const OUT_META = 'estado.meta.json';

function pickTxt(){
  const files = fs.readdirSync('.').filter(f => /\.txt$/i.test(f));
  // el archivo del padrón suele llamarse padron_reducido_ruc.txt; si no, el .txt más grande
  const pref = files.find(f => /padr.*reduc.*ruc/i.test(f));
  if (pref) return pref;
  let best = null, size = -1;
  for (const f of files){ const s = fs.statSync(f).size; if (s > size){ size = s; best = f; } }
  return best;
}

async function main(){
  console.log('Descargando padrón reducido del RUC de SUNAT…');
  const res = await fetch(ZIP_URL, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, redirect: 'follow' });
  if (!res.ok) throw new Error('Descarga falló: HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(ZIP_FILE));
  console.log('Descargado:', fs.statSync(ZIP_FILE).size, 'bytes. Descomprimiendo…');

  execSync('unzip -o ' + ZIP_FILE, { stdio: 'inherit' });
  const txt = pickTxt();
  if (!txt) throw new Error('No se encontró el archivo .txt dentro del ZIP.');
  console.log('Leyendo:', txt, '(' + fs.statSync(txt).size + ' bytes)');

  const gz  = zlib.createGzip({ level: 9 });
  const out = createWriteStream(OUT_GZ);
  gz.pipe(out);

  const rl = readline.createInterface({ input: createReadStream(txt, { encoding: 'latin1' }), crlfDelay: Infinity });
  let total = 0, seen = 0;
  for await (const line of rl){
    if (!line) continue;
    const a = line.indexOf('|'); if (a < 0) continue;
    const ruc = line.slice(0, a);
    if (!/^\d{11}$/.test(ruc)) continue;           // salta cabeceras o basura
    seen++;
    // Layout SUNAT: RUC | Razón social | Estado | Condición domicilio | ...
    const b = line.indexOf('|', a + 1);            // fin de Razón social
    if (b < 0) continue;
    const c = line.indexOf('|', b + 1);            // fin de Estado
    const d = line.indexOf('|', c + 1);            // fin de Condición
    const estado = (c < 0 ? line.slice(b + 1) : line.slice(b + 1, c)).trim().toUpperCase();
    const cond   = (c < 0 ? '' : (d < 0 ? line.slice(c + 1) : line.slice(c + 1, d))).trim().toUpperCase();
    const noHab  = /NO\s*HAB|NO\s*HALL/.test(cond);
    if (estado === 'ACTIVO' && !noHab) continue;    // solo guardamos lo "observable"
    if (!gz.write(ruc + '|' + estado + '|' + cond + '\n')) await once(gz, 'drain');
    total++;
  }
  gz.end();
  await once(out, 'finish');

  if (total === 0) throw new Error('El padrón se leyó (' + seen + ' filas) pero no se hallaron RUC observables (¿cambió el formato?).');

  fs.writeFileSync(OUT_META, JSON.stringify({
    actualizado: new Date().toISOString(),
    fuente: ZIP_URL,
    total,
    leidos: seen
  }));
  console.log('✓ ' + OUT_GZ + ' generado con ' + total + ' RUC observados (de ' + seen + ' leídos).');
  console.log('  Tamaño comprimido:', fs.statSync(OUT_GZ).size, 'bytes.');

  // limpieza para no commitear el zip/txt gigantes
  try { fs.unlinkSync(ZIP_FILE); } catch(e){}
  try { fs.unlinkSync(txt); } catch(e){}
}

main().catch(e => {
  console.error('ERROR:', e.message);
  console.error('No se sobrescribieron los archivos de estado (se conserva la última versión válida).');
  process.exit(1);
});
