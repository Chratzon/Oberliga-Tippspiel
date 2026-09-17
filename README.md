# Bully – Tippspiel Oberliga Süd 26/27

Installierbare PWA, mit der eine Gruppe die Spiele der DEB-Oberliga Süd tippt.
Läuft ohne Server: GitHub Pages liefert die App aus, eine GitHub Action hält
Spielplan und Ergebnisse aktuell, Firebase Firestore hält die Tipps der
Mitspieler zusammen.

```
index.html · app.css · app.js · sync.js   → die App
data/spielplan.json                        → Teams und alle Ansetzungen
data/ergebnisse.json                       → Endstände, von der Action gepflegt
scripts/scrape.mjs                         → holt beides von hockeyweb.de
.github/workflows/daten-update.yml         → führt den Scraper täglich aus
```

## 1. Auf GitHub Pages bringen

1. Neues Repository anlegen, den Inhalt dieses Ordners hineinlegen, pushen.
2. *Settings → Pages → Source: Deploy from a branch*, Branch `main`, Ordner `/ (root)`.
3. *Settings → Actions → General → Workflow permissions* auf **Read and write** stellen,
   sonst darf die Action die aktualisierten Daten nicht zurückschreiben.
4. Die Seite über den Pages-Link öffnen und im Browser „Zum Startbildschirm hinzufügen“.

Ohne HTTPS gibt es keinen Service Worker – lokal testen deshalb nicht per
Doppelklick auf `index.html`, sondern mit `npx serve .` oder
`python3 -m http.server`.

## 2. Gemeinsame Rangliste einrichten (Firebase)

Einmal für die ganze Gruppe:

1. Auf console.firebase.google.com ein Projekt anlegen (Analytics kann aus bleiben).
2. **Build → Authentication → Sign-in method → Anonymous** aktivieren.
3. **Build → Firestore Database → Create database**, Region Europa, Produktionsmodus.
4. **Project settings → Your apps → Web app** hinzufügen. Der angezeigte
   `firebaseConfig`-Block ist das, was in die App kommt.
5. Unter *Firestore → Rules* diese Regeln setzen:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /runden/{runde}/teilnehmer/{spieler} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == spieler;
    }
  }
}
```

Damit sieht jeder Angemeldete alle Tipps seiner Runde, kann aber nur den
eigenen Eintrag ändern.

6. In der App unter **Profil → Gemeinsame Rangliste einrichten** die Konfiguration
   als JSON einfügen und auf *Verbinden* tippen. Jeder Mitspieler macht das einmal
   auf seinem Gerät und trägt **denselben Rundencode** ein.

Die API-Keys aus `firebaseConfig` sind keine Geheimnisse – sie stehen in jeder
Firebase-Web-App im Quelltext. Der Schutz kommt aus den Regeln oben.

Wer die Konfiguration nicht jedem einzeln schicken will, legt sie fest in
`app.js` ab: im `zustand` das Feld `firebase` mit dem Objekt vorbelegen.

## 3. Daten aktuell halten

Die Action läuft täglich um 05:15 UTC und lässt sich unter *Actions →
Spielplan und Ergebnisse aktualisieren → Run workflow* auch von Hand starten.

Der Scraper liest `hockeyweb.de` und erkennt Partien an der Struktur der
Spiel-Links (`/oberliga/spiele/<heim>-<gast>-<datum>-<id>`). Er schreibt nichts,
wenn er weniger als 50 Partien findet – das ist die Bremse für den Fall, dass
die Quellseite umgebaut wird.

**Einmal prüfen, bevor du dich darauf verlässt:**

```bash
node scripts/scrape.mjs --pruefen
```

Das gibt die ersten erkannten Partien und Endstände aus, ohne Dateien zu
verändern. Achte auf zwei Dinge:

- Meldet er unbekannte Team-Slugs, ergänze sie oben in `SLUG_ZU_TEAM`.
- Stimmen die Endstände? Die Unterscheidung zwischen Uhrzeit (`19:30`) und
  Ergebnis (`4:2`) sowie die Erkennung von Verlängerung und Penaltyschießen
  beruht auf Textmustern. Ich konnte das nicht gegen die Live-Seite testen,
  die Regeln in `ergebnisAus()` sind also der wahrscheinlichste Stellhebel.

Zur Sicherheit gibt es in der App unter **Profil → Endstände von Hand nachtragen**
eine manuelle Eingabe. Sie gilt nur auf dem eigenen Gerät und wird überschrieben,
sobald `ergebnisse.json` das Spiel enthält.

### Spieltage

Die Quelle gruppiert nach Spielwochen, nicht nach Spieltagen. Der Scraper
sortiert deshalb alle Partien nach Datum und schneidet sie in Siebenerblöcke –
bei 14 Vereinen spielt jeder an jedem Spieltag. Bei einer Spielverlegung kann
diese Zuordnung um einen Block verrutschen; die Tipps hängen an der Spiel-ID,
nicht am Spieltag, es geht dabei also nichts verloren.

## 4. Wertung

| Punkte | Bedingung |
|---|---|
| 6 | Ergebnis und Ausgang exakt getroffen |
| 4 | Ergebnis exakt, Ausgang daneben |
| 3 | Sieger und Tordifferenz richtig |
| 2 | Sieger richtig, dazu der richtige Ausgang |
| 1 | Nur der Sieger stimmt |

Ausgang heißt: reguläre Zeit, Verlängerung oder Penaltyschießen.
Unentschieden gibt es nicht, die Eingabe verhindert es. Nach Verlängerung oder
Penalty ist der Abstand immer genau ein Tor – auch das prüft die App.

Andere Werte stehen in `app.js` ganz oben in `WERTUNG` und `punkteFuer()`.

## 5. Tipps sind gesperrt

Ein Spiel lässt sich bis zum Anpfiff tippen, danach ist das Feld zu. Gibt der
Spielplan keine Uhrzeit her, sperrt die App ab Mitternacht des Spieltags.

Über *Profil → Daten sichern* lassen sich die eigenen Tipps als Datei
exportieren und auf einem anderen Gerät wieder einlesen – auch ohne Firebase.
