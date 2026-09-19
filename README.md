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

## 2. Gruppen

Getippt wird in Gruppen. Jede Gruppe hat einen sechsstelligen Beitrittscode,
eine eigene Rangliste und einen Gründer.

- **Gründen:** Profil → *Gruppe gründen*, Namen vergeben. Der Code wird erzeugt.
- **Einladen:** *Einladen* legt Code und Link in die Zwischenablage bzw. öffnet
  das Teilen-Menü des Geräts. Der Link öffnet die App und tritt direkt bei.
- **Beitreten:** Profil → *Mit Code beitreten*.
- **Schließen:** Nur der Gründer. Danach kommt niemand Neues mehr rein,
  bestehende Mitspieler tippen weiter. Jederzeit umkehrbar.
- **Mehrere Gruppen:** Man kann in beliebig vielen sein – Büro, Verein, Familie.
  Oben in der Kopfzeile steht die aktive, umgeschaltet wird im Profil.

Die Tipps gehören dir, nicht der Gruppe: Du tippst einmal, das Ergebnis zählt
in jeder Gruppe, in der du Mitglied bist. Wer eine Gruppe verlässt, behält
seine Tipps und verschwindet nur aus deren Rangliste.

Der Code ist die Einladung. Wer ihn hat, kann beitreten und die Tipps der
Gruppe sehen – so wie bei jedem Tippspiel im Bekanntenkreis. Soll die Runde
dicht sein, nach dem Beitritt aller einmal *Schließen* drücken.

## 3. Verbindung einrichten (Firebase)

Gruppen über mehrere Geräte brauchen eine Datenbank. Einmal für die ganze
Gruppe einrichten:

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

    match /runden/{gruppe} {
      // get, nicht list: ohne Code findet niemand eine Gruppe
      allow get:    if request.auth != null;
      allow create: if request.auth != null
                    && request.resource.data.ersteller == request.auth.uid;
      allow update, delete: if request.auth != null
                    && resource.data.ersteller == request.auth.uid;

      match /teilnehmer/{spieler} {
        allow read:   if request.auth != null;
        allow create: if request.auth != null
                      && request.auth.uid == spieler
                      && get(/databases/$(database)/documents/runden/$(gruppe)).data.offen == true;
        allow update, delete: if request.auth != null && request.auth.uid == spieler;
      }
    }
  }
}
```

Das erzwingt drei Dinge: Gruppen lassen sich nicht durchsuchen, nur über den
Code öffnen. Jeder ändert nur den eigenen Eintrag. Und schließen darf nur der
Gründer – die App blendet den Knopf bei den anderen aus, die Regel setzt es
tatsächlich durch.

6. In der App unter **Profil → Verbindung einrichten** die Konfiguration als
   JSON einfügen und auf *Verbinden* tippen. Jeder Mitspieler macht das einmal
   auf seinem Gerät.

Die Schlüssel aus `firebaseConfig` sind keine Geheimnisse – sie stehen in jeder
Firebase-Web-App im Quelltext. Der Schutz kommt aus den Regeln oben.

Wer die Konfiguration nicht jedem einzeln schicken will, legt sie fest in
`app.js` ab: im `zustand` das Feld `firebase` mit dem Objekt vorbelegen. Dann
reicht der Einladungslink, und der Beitritt läuft in einem Schritt.

Ohne Verbindung funktioniert die App weiter, Gruppen bleiben dann aber leer:
Du tippst allein auf deinem Gerät.

## 4. Daten aktuell halten

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

## 5. Vereinslogos

Ausgeliefert wird die App mit Farbmarken: ein Kreis in den Vereinsfarben mit
dem Kürzel. Die funktionieren offline, sind sofort unterscheidbar und berühren
keine fremden Rechte.

Echte Wappen einsetzen:

1. Logo als quadratisches SVG oder PNG (mindestens 128 px, transparent) nach
   `icons/teams/` legen.
2. In `data/spielplan.json` beim Verein das Feld `logo` füllen:
   `"logo": "icons/teams/deggendorf.svg"`.

Der Scraper überschreibt nur `spiele`, die Team-Einträge mit Logos und Farben
bleiben also erhalten.

Woher die Dateien: die meisten Vereine haben einen Presse- oder
Downloadbereich auf ihrer Seite, sonst kurz anfragen. Vereinswappen sind
geschützte Marken – in einer privaten Tipprunde stört das niemanden, eine
öffentlich erreichbare Seite mit allen vierzehn Logos ist rechtlich etwas
anderes. Wenn die App öffentlich auf Pages liegt, ist das Kürzel die
sorgenfreiere Variante.

Die Farben in `spielplan.json` sind ein Startwert und teils von mir geschätzt.
Pro Verein zwei Werte: `farbe` (Fläche) und `farbe2` (der Ring darum).
Bei hellen Flächen schaltet die Schrift automatisch auf dunkel.

## 6. Wertung

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

## 7. Tipps sind gesperrt

Ein Spiel lässt sich bis zum Anpfiff tippen, danach ist das Feld zu. Gibt der
Spielplan keine Uhrzeit her, sperrt die App ab Mitternacht des Spieltags.

Über *Profil → Daten sichern* lassen sich die eigenen Tipps als Datei
exportieren und auf einem anderen Gerät wieder einlesen – auch ohne Firebase.
