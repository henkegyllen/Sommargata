# Sommargatan AR – Växjö Kommun

Webbbaserad AR-upplevelse. Invånare scannar en QR-kod, öppnar appen i webbläsaren och ser 3D-innehåll förankrat till fysiska markörer på plats.

**Live-URL:** https://henkegyllen.github.io/Sommargata/

---

## Hur det fungerar

1. Varje station har en **QR-kod** (länk till appen) och en **markörsbild** (fysisk bild som kameran spårar)
2. Användaren scannar QR-koden → webbläsaren öppnar appen
3. Kameran pekar mot markörbilden → 3D-innehåll visas ovanpå markören

Inga appar att ladda ned. Fungerar i Safari (iPhone/iPad) och Chrome (Android).

---

## Lägga till eller ändra innehåll (utan kodkunskap)

### 1. Ladda upp filer

Via GitHub-webbgränssnittet: navigera till rätt mapp och dra och släpp filer.

| Filtyp | Mapp | Format |
|---|---|---|
| 3D-modeller | `assets/models/` | `.glb` – max 5 MB per fil |
| Historiska foton | `assets/images/` | `.jpg` – max 300 KB per fil |
| Markörmönster | `assets/markers/` | `.patt` – genereras enligt nedan |

### 2. Redigera config.json

Öppna `config.json` i GitHub → klicka pennan → gör ändringen → "Commit changes".

Appen är live igen inom ~2 minuter.

#### Lägga till en ny station

Kopiera ett befintligt stationsblock och anpassa:

```json
{
  "id": "station6",
  "name": "Ditt stationsnamn",
  "marker": { "type": "barcode", "value": 5 },
  "content": [
    {
      "type": "infoPanel",
      "title": "Rubrik",
      "body": "Brödtext som visas i AR.",
      "position": "0 0.1 0"
    }
  ]
}
```

#### Innehållstyper

**infoPanel** – halvtransparent textruta:
```json
{
  "type": "infoPanel",
  "title": "Rubrik",
  "body": "Brödtext",
  "position": "0 0.15 0"
}
```

**photo** – bild som flöter ovanför markören:
```json
{
  "type": "photo",
  "src": "assets/images/minbild.jpg",
  "position": "0 0.1 0",
  "scale": "0.2 0.15 1",
  "label": "Valfri bildtext"
}
```
*`scale`: första värdet = bredd i meter, andra = höjd. Justera för rätt bildförhållande.*

**model** – roterande 3D-modell (.glb):
```json
{
  "type": "model",
  "src": "assets/models/minmodell.glb",
  "position": "0 0.05 0",
  "scale": "0.3 0.3 0.3"
}
```
*Om filen saknas visas en blå kub som platshållare.*

#### Positionering (`position`)

Format: `"X Y Z"` relativt markörens centrum.
- X: vänster/höger
- Y: upp/ned (0 = markörens yta, positiv = uppåt)
- Z: mot/från kameran

---

## Markörer – generering och utskrift

### Steg 1: Generera markörsfil (.patt)

Öppna i webbläsaren:
https://ar-js-org.github.io/AR.js/three.js/examples/marker-training/examples/multi-markers/examples/marker-training.html

1. Ladda upp en kvadratisk PNG med tydligt svartvitt mönster (tjock svart kant, unikt mönster inuti)
2. Ladda ned `.patt`-filen → lägg den i `assets/markers/`
3. Uppdatera `config.json`: byt `"type": "barcode"` mot `"type": "pattern"` och lägg till `"url": "assets/markers/dinmarkör.patt"`

### Steg 2: ArUco-markörer för snabbtest (nuvarande setup)

De fem stationerna använder förnärvarande **ArUco/barcode-markörer** (värde 0–4). Inga .patt-filer behövs.

Ladda ned och skriv ut dessa markörer:
- Marker 0: https://raw.githack.com/AR-js-org/AR.js/master/data/images/HIRO.jpg *(byt ut mot ArUco-bilder)*

Enklare: sök "ArUco marker generator" och generera markörer med ID 0, 1, 2, 3, 4 och `matrixCodeType: 3x3`.

Rekommenderad utskriftsstorlek: **12–15 cm × 12–15 cm** för god detektering på 50–80 cm avstånd.
**Laminera** – stationerna är utomhus.

---

## GitHub Pages – aktivering (engångsinställning)

1. Gå till: https://github.com/henkegyllen/Sommargata/settings/pages
2. Under "Source": välj `main`-grenen, mapp `/` (root)
3. Spara → appen är live på https://henkegyllen.github.io/Sommargata/

---

## Testa utan utskrift

1. Öppna https://henkegyllen.github.io/Sommargata/ar.html på mobilen
2. Visa en markörsbild på en datorskärm
3. Peka mobilkameran mot datorskärmen – fungerar för testning utan utskrift

---

## Teknikstack

- [A-Frame 1.5.0](https://aframe.io) – 3D/WebXR-ramverk
- [AR.js 3.4.5](https://ar-js-org.github.io/AR.js-Docs/) – Markörsbaserad AR i webbläsaren
- Statisk hosting på GitHub Pages (gratis, HTTPS ingår)
