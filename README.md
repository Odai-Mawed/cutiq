# CutIQ

Video rein, Pausen raus: CutIQ schneidet automatisch alle stillen Stellen
(Leerstellen) aus Videos und Audiodateien.

- **Eine Codebasis** – React Native (Expo) für **iOS, Android und Browser**
- **Web-Version auf Netlify** – rein statisch, kein Server nötig
- **Datenschutz** – die Verarbeitung läuft lokal auf dem Gerät mit
  [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm); nichts wird hochgeladen

## So funktioniert es

1. `silencedetect` von ffmpeg findet alle Stellen, die leiser als die
   **Stille-Schwelle** (z. B. −30 dB) und länger als die **Mindestlänge** sind.
2. Daraus werden die Abschnitte berechnet, die bleiben (mit etwas **Puffer**
   um die Sprache, damit keine Wörter abgeschnitten werden).
3. Ein einziger ffmpeg-Durchlauf (`select`/`aselect`) behält nur diese
   Abschnitte und setzt die Zeitstempel neu – Bild und Ton bleiben synchron.
   Ergebnis: MP4 (H.264/AAC) bzw. M4A bei reinen Audiodateien.

```
public/engine/        Schnitt-Engine (läuft in iframe / WebView)
  engine.js           ffmpeg.wasm + Nachrichten-Protokoll
  silence.js          reine Logik: Log parsen, Abschnitte, Filtergraph
src/
  CutScreen.tsx       Oberfläche
  engine/Engine.web.tsx     Web: verstecktes iframe
  engine/Engine.native.tsx  iOS/Android: versteckte WebView, Datei in Chunks
tests/                Unit-Tests für silence.js
```

## Lokal starten

```bash
npm install          # kopiert ffmpeg.wasm nach public/engine/vendor
npm run web          # Browser
npm test             # Unit-Tests
npm run typecheck
```

## Auf Netlify deployen

Repo in Netlify verbinden – `netlify.toml` ist schon da
(Build: `npm run build:web`, Ordner: `dist`). Oder per CLI:

```bash
npm run build:web
npx netlify-cli deploy --prod --dir dist
```

## iOS / Android

Die App lädt die Schnitt-Engine von deiner Netlify-Seite in eine unsichtbare
WebView (dort läuft ffmpeg.wasm). Deshalb **zuerst die Web-Version deployen**,
dann die URL eintragen:

```bash
cp .env.example .env
# EXPO_PUBLIC_ENGINE_URL=https://<deine-seite>.netlify.app/engine/index.html
npx expo run:ios       # bzw. run:android  (oder: npx eas-cli build)
```

`react-native-webview` ist eine native Bibliothek – die App braucht einen
Development Build (`expo run:*` oder EAS), Expo Go reicht nicht. Ergebnis wird
über das Teilen-Menü gespeichert („Video sichern“ / Dateien / Galerie).

## Grenzen

- ffmpeg.wasm läuft single-threaded: ca. 1–1,5× Echtzeit bei 720p am Desktop,
  auf Handys langsamer. Für lange Videos (> ~15 min) oder > ~1 GB reicht der
  Speicher im Browser oft nicht.
- Beim ersten Start wird die Engine (~32 MB) geladen, danach aus dem Cache.
- Das Video wird neu kodiert (H.264, CRF 23).
