/* Holt Spielplan und Ergebnisse der Oberliga Süd von hockeyweb.de
 * und schreibt sie nach data/.
 *
 *   node scripts/scrape.mjs            → schreibt die Dateien
 *   node scripts/scrape.mjs --pruefen  → zeigt nur, was erkannt wurde
 *
 * Node 18 oder neuer, keine Abhängigkeiten.
 *
 * Aufbau eines Spiels auf der Ergebnisseite (Stand September 2026):
 *   Link /oberliga/spiele/<heim>-<gast>-<JJJJMMTT>-<id>
 *   19:30          Anpfiff
 *   2 : 0          Endstand
 *   2 : 0          1. Drittel
 *   0 : 0          2. Drittel
 *   0 : 0          3. Drittel
 *   OT | PSO       nur nach Verlängerung bzw. Penaltyschießen
 */

import { writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const BASIS = 'https://www.hockeyweb.de/oberliga';
const STAFFEL = encodeURIComponent('süd');
const SEITEN = 30;
const TEAMS_PRO_SPIELTAG = 7;
const PAUSE_MS = 900;
const DATENFORMAT = 2;                       // ältere Ergebnisdateien werden verworfen
const FRUEHESTES_ENDE_MS = 135 * 60 * 1000;  // vorher gilt kein Spiel als beendet

const SLUG_ZU_TEAM = {
  deggendorf: 'deggendorf', peiting: 'peiting', passau: 'passau',
  kaufbeuren: 'kaufbeuren', füssen: 'fuessen', fuessen: 'fuessen',
  lindau: 'lindau', erding: 'erding', tigers: 'tigers', heilbronn: 'heilbronn',
  höchstadt: 'hoechstadt', hoechstadt: 'hoechstadt', riessersee: 'riessersee',
  selb: 'selb', stuttgart: 'stuttgart', badtölz: 'badtoelz', badtoelz: 'badtoelz',
};

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Zerlegen (exportiert für die Tests) ---------- */

export function bloeckeZerlegen(html) {
  const muster = /\/oberliga\/spiele\/([^"'\s>?]+?)-(\d{8})-(\d+)/g;
  const treffer = [...html.matchAll(muster)];
  const bloecke = [];

  for (let i = 0; i < treffer.length; i++) {
    const t = treffer[i];
    const id = t[3];
    if (bloecke.some((b) => b.id === id)) continue;

    // Block reicht bis zum nächsten *anderen* Spiel
    let j = i + 1;
    while (j < treffer.length && treffer[j][3] === id) j++;
    const ende = j < treffer.length ? treffer[j].index : Math.min(html.length, t.index + 4000);

    const text = html.slice(t.index, ende)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const slug = decodeURIComponent(t[1]).toLowerCase();
    const teile = slug.split('-');
    bloecke.push({ id, datumRoh: t[2], heimSlug: teile[0], gastSlug: teile.slice(1).join('-'), text });
  }
  return bloecke;
}

export function zeitAus(text) {
  const m = text.match(/\b([01]\d|2[0-3])\s*:\s*([0-5]\d)\b/);
  return m ? `${m[1]}:${m[2]}` : null;
}

/* Sucht Endstand plus drei Drittel und prüft, ob sie zusammenpassen.
   Eine Uhrzeit besteht diese Gegenprobe nie – deshalb ist die
   Reihenfolge auf der Seite egal. */
export function ergebnisAus(text) {
  const paare = [...text.matchAll(/(\d{1,2})\s*:\s*(\d{1,2})/g)]
    .map((m) => [Number(m[1]), Number(m[2])]);

  for (let start = 0; start + 4 <= paare.length; start++) {
    const [h, a] = paare[start];
    if (h === a || h > 19 || a > 19) continue;

    const drittel = paare.slice(start + 1, start + 4);
    const sh = drittel.reduce((s, p) => s + p[0], 0);
    const sa = drittel.reduce((s, p) => s + p[1], 0);

    if (sh === h && sa === a) return { h, a, art: 'REG' };

    // Nach 60 Minuten unentschieden, Sieger bekommt ein Tor mehr
    const nachVerlaengerung = sh === sa && (
      (h === sh + 1 && a === sa) || (a === sa + 1 && h === sh)
    );
    if (nachVerlaengerung) {
      const penalty = /\b(PSO|SO|PS)\b|n\.\s?P\./.test(text);
      return { h, a, art: penalty ? 'PS' : 'OT' };
    }
  }
  return null;
}

/* Anpfiff in deutscher Ortszeit – Sommer- und Winterzeit richtig. */
export function anpfiffMs(datum, zeit) {
  const naiv = Date.parse(`${datum}T${zeit || '00:00'}:00Z`);
  const teile = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(naiv)).map((p) => [p.type, p.value]));
  const alsBerlin = Date.parse(`${teile.year}-${teile.month}-${teile.day}T${teile.hour}:${teile.minute}:00Z`);
  return naiv - (alsBerlin - naiv);
}

function datumIso(roh) {
  return `${roh.slice(0, 4)}-${roh.slice(4, 6)}-${roh.slice(6, 8)}`;
}

/* ---------- Abruf ---------- */

async function seiteHolen(pfad, seite) {
  const url = `${BASIS}/${pfad}/${STAFFEL}${seite > 1 ? `?page=${seite}` : ''}`;
  const antwort = await fetch(url, {
    headers: {
      'User-Agent': 'bully-tippspiel/1.1 (privates Tippspiel)',
      'Accept-Language': 'de-DE,de;q=0.9',
    },
  });
  if (!antwort.ok) throw new Error(`${url} → HTTP ${antwort.status}`);
  return antwort.text();
}

async function alleBloecke(pfad) {
  const gesammelt = [];
  const gesehen = new Set();
  for (let seite = 1; seite <= SEITEN; seite++) {
    let html;
    try { html = await seiteHolen(pfad, seite); }
    catch (e) { console.warn(`  Seite ${seite} übersprungen: ${e.message}`); break; }

    const neu = bloeckeZerlegen(html).filter((b) => !gesehen.has(b.id));
    if (neu.length === 0) break;
    neu.forEach((b) => gesehen.add(b.id));
    gesammelt.push(...neu);
    console.log(`  ${pfad} Seite ${seite}: ${neu.length} Partien`);
    await warte(PAUSE_MS);
  }
  return gesammelt;
}

async function jsonLesen(pfad, ersatz) {
  try { return JSON.parse(await readFile(new URL(pfad, import.meta.url), 'utf8')); }
  catch { return ersatz; }
}

/* ---------- Hauptablauf ---------- */

async function main() {
  const pruefen = process.argv.includes('--pruefen');
  const warnungen = new Set();
  const team = (slug) => {
    if (!SLUG_ZU_TEAM[slug]) warnungen.add(slug);
    return SLUG_ZU_TEAM[slug] || slug;
  };

  console.log('Spielplan wird gelesen …');
  const planBloecke = await alleBloecke('spielplan');
  console.log('Ergebnisse werden gelesen …');
  const ergBloecke = await alleBloecke('ergebnisse');

  const gefunden = new Map();
  for (const b of [...ergBloecke, ...planBloecke]) {
    if (gefunden.has(b.id)) continue;
    gefunden.set(b.id, {
      id: b.id,
      datum: datumIso(b.datumRoh),
      zeit: zeitAus(b.text),
      heim: team(b.heimSlug),
      gast: team(b.gastSlug),
    });
  }

  if (gefunden.size < 7) {
    console.error(`Nur ${gefunden.size} Partien erkannt – Dateien bleiben unverändert.`);
    console.error('Wahrscheinlich hat sich der Aufbau der Quellseite geändert.');
    process.exitCode = 1;
    return;
  }

  /* Spielplan zusammenführen: Die Quelle zeigt vergangene Wochen nicht
     dauerhaft an. Was einmal bekannt war, bleibt erhalten – außer es gibt
     für dieselbe Paarung am selben Tag inzwischen eine andere Kennung. */
  const plan = await jsonLesen('../data/spielplan.json', { teams: [], spiele: [] });
  const paarung = (s) => `${s.datum}|${s.heim}|${s.gast}`;
  const bekanntePaarungen = new Set([...gefunden.values()].map(paarung));

  const alle = new Map();
  for (const s of plan.spiele || []) {
    if (!gefunden.has(s.id) && bekanntePaarungen.has(paarung(s))) continue;
    alle.set(s.id, s);
  }
  for (const s of gefunden.values()) {
    const alt = alle.get(s.id);
    alle.set(s.id, { ...alt, ...s, zeit: s.zeit || alt?.zeit || null });
  }

  const sortiert = [...alle.values()].sort((a, b) =>
    (a.datum + (a.zeit || '00:00')).localeCompare(b.datum + (b.zeit || '00:00')));
  sortiert.forEach((s, i) => { s.spieltag = Math.floor(i / TEAMS_PRO_SPIELTAG) + 1; });

  /* Ergebnisse: nur mit bestandener Gegenprobe und nur für Spiele,
     die frühestens vor 2 Stunden 15 Minuten angepfiffen wurden. */
  const jetzt = Date.now();
  const neueErgebnisse = {};
  let abgelehnt = 0;

  for (const b of ergBloecke) {
    const spiel = alle.get(b.id);
    if (!spiel) continue;
    const anpfiff = anpfiffMs(spiel.datum, spiel.zeit);
    if (jetzt < anpfiff + FRUEHESTES_ENDE_MS) continue;

    const e = ergebnisAus(b.text);
    if (e) neueErgebnisse[b.id] = e;
    else abgelehnt++;
  }

  // Frühere Endstände behalten – aber nur aus Dateien im geprüften Format.
  const alteDatei = await jsonLesen('../data/ergebnisse.json', {});
  const alteErgebnisse = alteDatei.format === DATENFORMAT ? (alteDatei.ergebnisse || {}) : {};
  if (alteDatei.format !== DATENFORMAT && Object.keys(alteDatei.ergebnisse || {}).length) {
    console.log('Alte Ergebnisdatei ohne Gegenprobe erkannt – wird komplett neu aufgebaut.');
  }
  const ergebnisse = { ...alteErgebnisse, ...neueErgebnisse };

  console.log(`\n${gefunden.size} Partien gelesen, ${sortiert.length} im Spielplan.`);
  console.log(`${Object.keys(neueErgebnisse).length} Endstände erkannt, ${abgelehnt} ohne gültigen Endstand übersprungen.`);
  if (warnungen.size) console.warn('Unbekannte Team-Slugs: ' + [...warnungen].join(', '));

  if (pruefen) {
    for (const [id, e] of Object.entries(neueErgebnisse)) {
      const s = alle.get(id);
      console.log(`  ${s.datum} ${s.heim} – ${s.gast}: ${e.h}:${e.a} ${e.art === 'REG' ? '' : e.art}`);
    }
    return;
  }

  plan.spiele = sortiert;
  plan.standGeneriert = new Date().toISOString().slice(0, 10);
  plan.quelle = 'hockeyweb.de';
  await writeFile(new URL('../data/spielplan.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n');

  await writeFile(new URL('../data/ergebnisse.json', import.meta.url), JSON.stringify({
    format: DATENFORMAT,
    aktualisiert: new Date().toISOString(),
    quelle: 'hockeyweb.de',
    ergebnisse,
  }, null, 2) + '\n');

  console.log('data/spielplan.json und data/ergebnisse.json geschrieben.');
}

// Nur ausführen, wenn direkt aufgerufen – nicht beim Import durch die Tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
