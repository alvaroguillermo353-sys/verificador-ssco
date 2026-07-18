// build_ssco.mjs — descarga el padrón SSCO de SUNAT y genera ssco.json
// Se ejecuta en GitHub Actions (que sí tiene acceso a internet a SUNAT).
import * as XLSX from 'xlsx';
import fs from 'node:fs';

const URL = 'https://www.sunat.gob.pe/padronesnotificaciones/ssco/sujesincapacidadOperativa.xlsx';
const UA  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/* --- misma lógica de parseo que el frontend --- */
const RUC_RE = /\b(?:10|15|16|17|20)\d{9}\b/g;
const RUC_TEST = /(?:10|15|16|17|20)\d{9}/;
const norm = s => (s==null?'':String(s)).normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().trim();

function findHeaderRow(rows){
  for(let i=0;i<Math.min(rows.length,15);i++){
    const joined = norm(rows[i].join(' '));
    if(/RUC|RAZON|DOCUMENTO|PROVEEDOR|COMPROBANTE|NOMBRE|CONTRIBUYENTE/.test(joined) &&
       !RUC_TEST.test(rows[i].join(''))){ return i; }
  }
  return -1;
}
function colIndex(header,patterns){
  for(let c=0;c<header.length;c++){ const h=norm(header[c]); if(patterns.some(p=>p.test(h))) return c; }
  return -1;
}
function fmtDate(v){
  if(v instanceof Date && !isNaN(v)){ const d=String(v.getUTCDate()).padStart(2,'0'), m=String(v.getUTCMonth()+1).padStart(2,'0'); return d+'/'+m+'/'+v.getUTCFullYear(); }
  const s=String(v==null?'':v).trim(); const mm=s.match(/(\d{4})-(\d{2})-(\d{2})/); if(mm) return mm[3]+'/'+mm[2]+'/'+mm[1]; return s.slice(0,10);
}
function parseSSCO(rows){
  const map=new Map(); const hr=findHeaderRow(rows);
  let rucC=-1,nomC=-1,resC=-1,fecC=-1,start=0;
  if(hr>=0){ const H=rows[hr];
    rucC=colIndex(H,[/^RUC$/,/^RUC\b/,/^RUC/,/N.*DOC/,/IDENTIDAD/]);   // 1ra col RUC = el SSCO
    nomC=colIndex(H,[/RAZON/,/NOMBRE/,/DENOMINAC/]);
    resC=colIndex(H,[/RESOLUC/,/CALIFIC/]);
    fecC=colIndex(H,[/PUBLICAC/]); if(fecC<0) fecC=colIndex(H,[/FECHA/,/VIGENC/]);   // prioriza fecha de publicación
    start=hr+1; }
  for(let i=start;i<rows.length;i++){ const r=rows[i]; if(!r) continue;
    let ruc=null,razon='';
    if(rucC>=0 && /^\d{11}$/.test(String(r[rucC]||'').trim())){ ruc=String(r[rucC]).trim(); razon=nomC>=0?String(r[nomC]||'').trim():''; }
    else { const m=r.join(' ').match(RUC_RE); if(m){ ruc=m[0];
      razon=r.map(x=>String(x||'').trim()).filter(x=>x!==ruc && !/^\d+$/.test(x)).sort((a,b)=>b.length-a.length)[0]||''; } }
    if(ruc && /^(10|15|16|17|20)\d{9}$/.test(ruc)){
      const det=[]; if(resC>=0&&r[resC])det.push('Resolución: '+String(r[resC]).trim());
      if(fecC>=0&&r[fecC])det.push('Publicación: '+fmtDate(r[fecC]));
      if(!map.has(ruc)) map.set(ruc,{razon,detalle:det.join(' · ')});
      else if(!map.get(ruc).razon&&razon) map.get(ruc).razon=razon;
    }
  }
  return map;
}

/* --- descarga + build --- */
async function main(){
  console.log('Descargando padrón SSCO de SUNAT…');
  const res = await fetch(URL, {headers:{'User-Agent':UA,'Accept':'*/*'}, redirect:'follow'});
  if(!res.ok) throw new Error('Descarga falló: HTTP '+res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log('Descargado:', buf.length, 'bytes');
  const wb = XLSX.read(buf,{type:'buffer',cellDates:true});
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const map = parseSSCO(rows);
  if(map.size===0) throw new Error('El padrón se descargó pero no se hallaron RUC válidos (¿cambió el formato?).');
  const out = {
    actualizado: new Date().toISOString(),
    fuente: URL,
    total: map.size,
    rucs: Object.fromEntries(map)
  };
  fs.writeFileSync('ssco.json', JSON.stringify(out));
  console.log('✓ ssco.json generado con', map.size, 'RUC calificados como SSCO.');
}

main().catch(e=>{
  console.error('ERROR:', e.message);
  console.error('No se sobrescribió ssco.json (se conserva la última versión válida).');
  process.exit(1);
});
