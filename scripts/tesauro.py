"""Prepara los diccionarios de sinónimos (tesauros libres de LibreOffice).

Descarga th_es_v2.dat (OpenThesaurus, LGPL 2.1) y th_en_US_v2.dat (WordNet,
licencia WordNet), los pasa a un formato compacto y los deja comprimidos en
public/thes/<idioma>.txt.gz. Cada línea:

    palabra<TAB>sentido1<TAB>sentido2...     (sinónimos separados por "|")
    y, si hay antónimos, una columna final "!ant1|ant2"

Uso: python scripts/tesauro.py
"""
import gzip
import os
import re
import sys
import urllib.request

SOURCES = {
    "es": ("https://raw.githubusercontent.com/LibreOffice/dictionaries/master/es/th_es_v2.dat", "es"),
    "en": ("https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/th_en_US_v2.dat", "en"),
}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "thes")
ANT = re.compile(r"\s*\((antonym|antónimo|antónimos)\)\s*$", re.I)
NOTE = re.compile(r"\s*\([^)]*\)\s*$")


def convert(raw: bytes) -> str:
    first, _, rest = raw.partition(b"\n")
    enc = first.strip().decode("ascii", "replace") or "utf-8"
    text = rest.decode("latin-1" if enc.upper().startswith("ISO8859") else "utf-8", "replace")
    lines = text.split("\n")
    out = []
    i = 0
    while i < len(lines):
        head = lines[i].strip()
        i += 1
        if "|" not in head:
            continue
        word, _, count = head.rpartition("|")
        try:
            n = int(count)
        except ValueError:
            continue
        senses, ants = [], []
        for _ in range(n):
            if i >= len(lines):
                break
            parts = lines[i].strip().split("|")[1:]
            i += 1
            syns = []
            for p in parts:
                if ANT.search(p):
                    a = ANT.sub("", p).strip()
                    if a and a not in ants:
                        ants.append(a)
                    continue
                s = NOTE.sub("", p).strip()
                if s and s.lower() != word.lower() and s not in syns:
                    syns.append(s)
            if syns:
                senses.append("|".join(syns))
        if senses or ants:
            row = [word.lower()] + senses
            if ants:
                row.append("!" + "|".join(ants))
            out.append("\t".join(row))
    return "\n".join(out) + "\n"


def main():
    os.makedirs(OUT, exist_ok=True)
    for lang, (url, _) in SOURCES.items():
        print("Descargando", url)
        raw = urllib.request.urlopen(url).read()
        data = convert(raw).encode("utf-8")
        with gzip.open(os.path.join(OUT, f"{lang}.txt.gz"), "wb", compresslevel=9) as f:
            f.write(data)
        print(f"  {lang}: {len(data) // 1024} KB -> {os.path.getsize(os.path.join(OUT, lang + '.txt.gz')) // 1024} KB comprimido")
    with open(os.path.join(OUT, "LEEME.txt"), "w", encoding="utf-8") as f:
        f.write(
            "Diccionarios de sinónimos de LibreOffice, convertidos con scripts/tesauro.py.\n"
            "es: OpenThesaurus en español (Marcelo Garrone), LGPL 2.1.\n"
            "en: WordNet 3.0 (Princeton University), licencia WordNet: https://wordnet.princeton.edu/license-and-commercial-use\n"
        )


if __name__ == "__main__":
    sys.exit(main())
