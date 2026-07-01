# Sommargatan AR – "Kalasvärlden" – Växjö Kommun

Webbaserad AR-upplevelse för sommargågatan "Sommargatan 2026". Besökaren scannar en QR-kod på en skylt, öppnar sidan i mobilens webbläsare och ser festligt 3D-innehåll (prickar, ballonger, paket, polkagrisar, tårta) utlagt längs gatan – ingen app att ladda ned.

**Live-URL:** https:// henkegyllen.github.io/Sommargata/
*(URL:er i denna fil är avsiktligt "brutna" med ett mellanslag efter `https://` så att de inte tolkas som klickbara länkar.)*

---

## Så upplever besökaren den

1. Scannar QR-koden → sidan (`index.html`) öppnas i webbläsaren.
2. **Passar in hela clownen** (fastmonterad på pyramiden vid startpunkten) i kamerarutan – med hjälp av den mindre rutan + vertikala mittlinjen. Det ger position och riktning utan GPS, kompass eller markörskanning.
3. Trycker **"Starta AR"** → kalibreringen låses:
   - **Android** (Chrome + ARCore/WebXR): stabil spårning – besökaren kan **vandra runt** i kalaset.
   - **iPhone/iPad** (Safari, ingen WebXR): gyro-läge – besökaren **står kvar och vrider sig**; innehållet följer blicken men inte stegen. (Fysisk begränsning i iOS Safari, inte en bugg.)

---

## Arkitektur

Statisk sajt på GitHub Pages, **inget byggsteg**. Hela appen är **en fil**: `index.html`.

| Fil / mapp | Roll |
|---|---|
| `index.html` | Hela AR-appen (clown-kalibrering, scen, animeringar, cache-handskakning) |
| `assets/placements.csv` | **Utplacering av alla objekt** – huvudspaken för innehållet |
| `config.json` | `modelDefaults` (standardskala per modell) |
| `assets/models/*.glb` | 3D-modellerna |
| `css/ui.css` | Delade UI-stilar |
| `version.json` | Versionsstämpel för cache-handskakningen (se nedan) |

Enda externa beroendet är **A-Frame 1.5.0** (`https:// aframe.io/releases/1.5.0/aframe.min.js`). Allt annat hämtas lokalt från samma ursprung.

---

## Redigera innehållet – `assets/placements.csv`

Kan redigeras direkt i GitHub-webbgränssnittet (penna → "Commit changes", live inom ~1–2 min).

Format:
```
namn,lat,lon,elev,synlig_inom,scale,rotation
```
| Kolumn | Betydelse |
|---|---|
| `namn` | GLB-filnamn ur `assets/models/` (t.ex. `Ballong_1.glb`) |
| `lat,lon` | Inmätt WGS84-position |
| `elev` | Höjd (m). Objektets höjd i scenen = `elev − 105` (marken = 105) |
| `synlig_inom` | Max synlighetsavstånd i meter (tom = alltid synlig) |
| `scale` | `0.5` = uniform, `1 2 1` = icke-uniform (tom = 1) |
| `rotation` | `90` = grader runt Y, `90 0 0` = "x y z" (tom = ingen) |

Specialrader:
- **`ANKAR`** – origo för scenen (inmätt referenspunkt). Obligatorisk.
- **`KALAS`** – startpunkten + riktning mot clownen (`bearing 0.0` = besökaren tittar rakt norrut). Clownen sitter 1 m norr om startpunkten.
- Rader som slutar på `.png` (t.ex. `Pyramid.png`, `Bild_*.png`) samt `SPARR_*` (siktbarriärer) **ignoreras av `index.html`** – de är kvar från äldre metoder.

**Lägga till en modell:** ladda upp `.glb` i `assets/models/`, lägg en rad i CSV:n. **Lägga till en animerad modell:** samma sak – har GLB:n inbäddade animationsklipp spelas de automatiskt (se Animeringar).

---

## Kalibrering av vinkeln (`HEADING_OFFSET`)

I `index.html` finns konstanten `HEADING_OFFSET` (grader, + = medurs sett uppifrån). Den läggs ovanpå clown-kalibreringen och rättar systematisk snedvridning mot de målade prickarna på marken.

- Nuvarande värde: **7°** (fältmätt 2026-06-29).
- Justeras genom att ändra siffran i `index.html` och deploya.

---

## Animeringar

- **Ballongerna** gungar och svävar via procedurell animering (A-Frame `animation`-komponenten) – desynkade per ballong.
- **`clip-player`** (egen liten komponent, använder THREE som följer med A-Frame – inget externt beroende): spelar automatiskt upp **inbäddade glTF-animationsklipp** om en modell har några. Släpp bara in en färdiganimerad GLB + referera i CSV:n. (Nuvarande modeller saknar klipp.)

---

## Deploy och cache

GitHub Pages cachar HTML hårt (iOS Safari särskilt). Därför har `index.html` en **versionshandskakning**: `APP_VERSION` i `index.html` jämförs mot `version.json`; skiljer de sig laddas sidan om med en färsk URL.

> **Rutin vid varje skarp ändring i `index.html`: höj BÅDE `APP_VERSION` (i index.html) OCH `version.json`.**
> Nuvarande: `2026-06-29g`. Be testaren hårdladda en gång om gammal version sitter kvar (versionsstämpeln nere på startskärmen visar laddad version).

Kollegan redigerar ibland `placements.csv` via GitHub-webben – gör `git pull --rebase` före push.

---

## Teknikstack

- **A-Frame 1.5.0** – 3D/WebXR-ramverk (enda externa beroendet)
- Statisk hosting på GitHub Pages (gratis, HTTPS ingår, inget byggsteg)

---

## Underhåll

Från 2026-07-01 underhålls **enbart `index.html`**. Tidigare experimentspår (gps-a/b/c/d, geo/AR.js, Variant Launch, Metod F multi-markör, kalibreringssidan kal.html m.fl.) är borttagna ur repot; lokal kopia finns hos utvecklaren utanför repot.
