# VRENT Offerten

Standalone offline **PWA** für **Offerten & Rechnungen** (VRENT.CH). Erstellt
Swiss-Classic-PDFs (DE/EN) mit dem echten VRENT-Logo — komplett lokal auf dem
Gerät, ohne Server, ohne Shopify-Anbindung (angenommene Aufträge werden manuell
in Shopify erfasst).

- Deutsche Oberfläche, PDF wahlweise Deutsch/Englisch
- Lokale Kundenliste, editierbare Preisliste (Seed = echter VRENT-Mietkatalog)
- Nummernkreise `OF-JJJJ-nnn` / `RE-JJJJ-nnn`, Offerte → Rechnung Umwandlung
- MwSt. (Standard 8.1 %), Rabatt, Schweizer Rappenrundung (0.05)
- Backup-Export/-Import als JSON
- Offline dank Service Worker (`vrent-offerten-v2`), installierbar (A2HS)

## Architektur (Build auf Vercel)

| Datei | Zweck |
|---|---|
| `package.json` | jspdf 2.5.2, `build` → `bash build.sh` |
| `build.sh` | installiert fonttools/brotli/pillow, ruft `gen_assets.py`, füllt `public/` |
| `gen_assets.py` | holt Archivo + IBM Plex Mono (google/fonts) und das Logo vom vrent.ch-CDN, subsettet Fonts (woff2 fürs UI, TTF+Logo als Base64 in `fonts.js` für jsPDF), rendert PWA-Icons |
| `index.html` | die gesamte App |
| `sw.js` | Offline-Cache |
| `manifest.webmanifest` | PWA-Manifest |
| `logo.png` / `mark.png` | optional: lokal eingecheckte Logos hätten Vorrang vor dem CDN-Fetch (siehe `.gitignore`) |

Logo-Quellen (CDN, mit Shopify-Fallback):
`Vrent.ch_Logo.png` → `logo.png` (PDF-Briefkopf), `Logo_VRENT.png` → `mark.png` (App-Icon/Topbar).

## Lokal bauen & testen

```bash
npm install
bash build.sh          # → public/
python3 -m http.server 8931 --directory public
```

Hinter restriktiven Proxies (Logo-CDN gesperrt): eigene `logo.png`/`mark.png`
neben `gen_assets.py` legen — lokale Dateien gewinnen immer.

## Deployment

Vercel-Projekt **vrent-offerten** (Team `vrentchs-projects`), statisches
Output-Verzeichnis `public`, Framework `null`:

```
https://vrent-offerten-vrentchs-projects.vercel.app
```

Deploy = die 6 Quelldateien hochladen (Logo/Fonts holt der Build selbst);
im Build-Log erscheinen `assets done` und `build done`.
