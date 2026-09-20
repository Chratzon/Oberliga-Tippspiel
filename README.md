# Bully – Tippspiel Oberliga Süd 26/27

Installierbare PWA, mit der eine Gruppe die Spiele der DEB-Oberliga Süd tippt.
Läuft ohne Server: GitHub Pages liefert die App aus, eine GitHub Action hält
Spielplan und Ergebnisse aktuell, Firebase Firestore hält die Tipps der
Mitspieler zusammen.

```
index.html · app.css · app.js · sync.js   → die App
konfig.js                                  → Firebase-Zugang (einmal eintragen)
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

## 2. Was der Nutzer sieht

Beim ersten Start eine Begrüßung mit genau zwei Möglichkeiten: Namen eingeben
und loslegen, oder mit Google anmelden. Das war die gesamte Einrichtung.
Von Firebase bekommt niemand etwas zu sehen – die Verbindung steht in
`konfig.js` und wird beim Start von selbst aufgebaut.

Danach geht es in einen Raum: **Profil → Raum eröffnen** oder
**Raum beitreten**. Ein Raum hat einen Namen und ein Passwort, beides gibst
du deinen Mitspielern weiter. Mehr brauchen sie nicht.

Aus „Eishalle Rosenheim" wird intern `eishalle-rosenheim`. Groß- und
Kleinschreibung, Leerzeichen und Umlaute sind also egal – „EISHALLE ROSENHEIM"
führt in denselben Raum.

Der Einladungsknopf kopiert Raumnamen und Link. Das Passwort bewusst nicht:
Es soll nicht in derselben Nachricht stehen wie der Zugang.

### Wie das Passwort geprüft wird

Nicht in der Oberfläche, sondern serverseitig. Die App bildet aus Raumname und
Passwort einen SHA-256-Hash und schickt ihn beim Beitritt mit. Die
Firestore-Regel vergleicht ihn mit dem hinterlegten Wert und lässt den Eintrag
nur durch, wenn er stimmt.

Das Passwort selbst verlässt das Gerät nie. Der hinterlegte Hash ist für
niemanden lesbar – der Raum lässt sich erst nach dem Beitritt öffnen. Damit
ist ein Durchprobieren nur über den Server möglich, nicht heimlich auf dem
eigenen Rechner. Für eine Tipprunde ist das reichlich; ein Passwort wie
`eishockey` wäre trotzdem keine gute Wahl.

Wer nicht im Raum ist, sieht dessen Tipps nicht. Auch das steht in den Regeln,
nicht nur in der Oberfläche.

## 3. Konten und Gerätewechsel

Ohne Anmeldung läuft alles über eine anonyme Kennung – bequem, aber an das
Gerät gebunden. Browserspeicher geleert oder neues Handy heißt sonst: neu
anfangen.

Der Knopf **Mit Google anmelden** löst beides. Beim ersten Mal hängt er das
Google-Konto an die bestehende Kennung; Tipps, Räume und Ranglistenplatz
bleiben unberührt. Auf einem neuen Gerät erkennt die App, dass das Konto schon
vergeben ist, meldet stattdessen an und holt Räume, Namen und Tipps zurück.
Ein Knopf, beide Fälle.

Beim Zurückholen hat Vorrang, was auf dem aktuellen Gerät schon getippt wurde.
Ein frisch abgegebener Tipp wird also nicht von einem älteren aus der Cloud
überschrieben.

Dafür liegt unter `nutzer/{uid}` eine private Akte mit Raumliste und Tipps.
Sie gehört ausschließlich dem jeweiligen Konto.

In installierten PWAs, vor allem auf iOS, lassen manche Browser kein
Anmeldefenster zu. Die App weicht dann auf eine Weiterleitung aus: Die Seite
lädt einmal neu, danach ist man angemeldet.

## 4. Firebase einrichten (nur du, einmalig)

1. Auf console.firebase.google.com ein Projekt anlegen (Analytics kann aus bleiben).
2. **Build → Authentication → Sign-in method**: **Anonymous** und **Google**
   aktivieren. Beide werden gebraucht.
3. **Authentication → Settings → Authorized domains**: deine Pages-Adresse
   eintragen, also `deinname.github.io`. Fehlt sie, schlägt jede Anmeldung fehl.
4. **Build → Firestore Database → Create database**, Region eur3, Produktionsmodus.
5. Unter *Firestore → Rules* diesen Regelsatz einsetzen und veröffentlichen:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function istMitglied(raum) {
      return request.auth != null &&
        exists(/databases/$(database)/documents/raeume/$(raum)/teilnehmer/$(request.auth.uid));
    }

    match /raeume/{raum} {
      // Stammdaten sieht nur, wer drin ist – der Passwort-Hash bleibt verborgen
      allow get:    if istMitglied(raum);
      allow create: if request.auth != null
                    && request.resource.data.ersteller == request.auth.uid
                    && request.resource.data.passwortHash is string;
      allow update, delete: if request.auth != null
                    && resource.data.ersteller == request.auth.uid;

      match /teilnehmer/{spieler} {
        allow read:   if istMitglied(raum);
        // Beitritt nur mit dem richtigen Nachweis
        allow create: if request.auth != null
                      && request.auth.uid == spieler
                      && request.resource.data.nachweis ==
                         get(/databases/$(database)/documents/raeume/$(raum)).data.passwortHash;
        allow update: if request.auth != null
                      && request.auth.uid == spieler
                      && request.resource.data.nachweis == resource.data.nachweis;
        allow delete: if request.auth != null && request.auth.uid == spieler;
      }
    }

    // Private Akte zum Zurückholen auf einem neuen Gerät
    match /nutzer/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

6. **Project settings → Your apps → Web app** anlegen, den `firebaseConfig`-Block
   kopieren und in `konfig.js` eintragen. Dort darf die JavaScript-Schreibweise
   stehen, genau wie Firebase sie anzeigt.
7. Pushen. Fertig – ab jetzt richtet niemand mehr etwas ein.

Die Schlüssel liegen damit im öffentlichen Repository. Das ist in Ordnung: Sie
identifizieren nur das Projekt und berechtigen zu nichts. Was jemand darf,
entscheiden ausschließlich die Regeln oben.

## 5. Daten aktuell halten

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

## 6. Vereinslogos

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

## 7. Wertung

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

## 8. Tipps sind gesperrt

Ein Spiel lässt sich bis zum Anpfiff tippen, danach ist das Feld zu. Gibt der
Spielplan keine Uhrzeit her, sperrt die App ab Mitternacht des Spieltags.

Über *Profil → Daten sichern* lassen sich die eigenen Tipps als Datei
exportieren und auf einem anderen Gerät wieder einlesen – auch ohne Firebase.
