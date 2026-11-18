#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera los padrones adicionales para el Verificador SSCO:
  - buenos.txt.gz  + buenos.meta.json   (Padrón de Buenos Contribuyentes)
  - agentes.txt.gz + agentes.meta.json  (Padrón de Agentes de Retención del IGV)

Descarga los archivos oficiales de SUNAT (ZIP con TXT), extrae los RUC y los
deja comprimidos (un RUC por línea) junto a ssco.json / estado.txt.gz.

El cliente (index.html) los carga solo si existen; si una descarga falla,
el padrón simplemente no se muestra ese día (no rompe nada).

Uso:  python gen_padrones_extra.py [carpeta_salida]
"""
import io, os, re, sys, gzip, json, zipfile, datetime, urllib.request

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
HOY = datetime.date.today().isoformat()
RUC_RE = re.compile(r"(?:10|15|16|17|20)\d{9}")

# Fuentes oficiales SUNAT (ZIP -> TXT). Se intentan en orden; la primera que
# responda se usa. (www redirige a ww1).
FUENTES = {
    "buenos": {
        "nombre": "Buenos Contribuyentes",
        "urls": [
            "https://ww1.sunat.gob.pe/descarga/BueCont/BueCont_TXT.zip",
            "https://www.sunat.gob.pe/descarga/BueCont/BueCont_TXT.zip",
        ],
    },
    "agentes": {
        "nombre": "Agentes de Retención del IGV",
        "urls": [
            "https://ww1.sunat.gob.pe/descarga/AgentRet/AgenRet_TXT.zip",
            "https://www.sunat.gob.pe/descarga/AgentRet/AgenRet_TXT.zip",
        ],
    },
    # Si SUNAT publica el padrón de Agentes de Percepción en el mismo formato,
    # añade aquí su clave "percep" con sus URLs y el cliente lo activa solo.
}

def descargar(urls):
    ultimo = None
    for u in urls:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (verificador-ssco robot)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:
            ultimo = e
    raise ultimo if ultimo else RuntimeError("sin URLs")

def rucs_de_zip(data):
    rucs = set()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            if not name.lower().endswith((".txt", ".csv")):
                continue
            raw = z.read(name).decode("latin1", errors="ignore")
            for linea in raw.splitlines():
                m = RUC_RE.search(linea)   # primer RUC válido de la línea
                if m:
                    rucs.add(m.group(0))
    return rucs

def escribir(clave, rucs):
    gz = os.path.join(OUT, clave + ".txt.gz")
    with gzip.open(gz, "wb") as f:
        f.write(("#actualizado=%s\n" % HOY).encode("latin1"))
        for ruc in sorted(rucs):
            f.write((ruc + "\n").encode("latin1"))
    meta = {"actualizado": HOY, "total": len(rucs), "fuente": "SUNAT"}
    with open(os.path.join(OUT, clave + ".meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    print("  -> %s (%d RUC)" % (gz, len(rucs)))

def main():
    ok = 0
    for clave, cfg in FUENTES.items():
        print("[%s] %s" % (clave, cfg["nombre"]))
        try:
            data = descargar(cfg["urls"])
            rucs = rucs_de_zip(data)
            if not rucs:
                print("  !! no se extrajeron RUC; se omite (se conserva el archivo anterior)")
                continue
            escribir(clave, rucs)
            ok += 1
        except Exception as e:
            print("  !! fallo: %s (se conserva el archivo anterior)" % e)
    print("Listo. Padrones generados: %d/%d" % (ok, len(FUENTES)))

if __name__ == "__main__":
    main()
