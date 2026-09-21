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
const SPIELTAG_FERTIG_MS = 160 * 60 * 1000;  // so lange nach dem letzten Anpfiff wird abgefragt
const NACHLAUF_MS = 30 * 60 * 60 * 1000;     // offene Spiele so lange nachfragen

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

/* Welche Spieltage sind fertig, haben aber noch Lücken bei den Ergebnissen?
   Ein Tag gilt als fertig, wenn sein letztes Spiel seit 2 Std. 40 Min. läuft.
   Nur dann lohnt ein Abruf – vorher kämen die Ergebnisse unvollständig. */
export function faelligeTage(spiele, ergebnisse, jetzt = Date.now()) {
  const tage = new Map();
  for (const s of spiele) {
    const t = anpfiffMs(s.datum, s.zeit);
    const tag = tage.get(s.datum) || { letzter: 0, offen: 0, erster: Infinity };
    tag.letzter = Math.max(tag.letzter, t);
    tag.erster = Math.min(tag.erster, t);
    if (!ergebnisse[s.id]) tag.offen++;
    tage.set(s.datum, tag);
  }
  return [...tage.entries()]
    .filter(([, t]) => t.offen > 0
      && jetzt >= t.letzter + SPIELTAG_FERTIG_MS
      && jetzt <= t.erster + NACHLAUF_MS)
    .map(([datum, t]) => ({ datum, offen: t.offen }));
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

function ergebnisseAuswerten(ergBloecke, alle, jetzt) {
  const gefunden = {};
  let abgelehnt = 0;
  for (const b of ergBloecke) {
    const spiel = alle.get(b.id);
    if (!spiel) continue;
    if (jetzt < anpfiffMs(spiel.datum, spiel.zeit) + FRUEHESTES_ENDE_MS) continue;
    const e = ergebnisAus(b.text);
    if (e) gefunden[b.id] = e;
    else abgelehnt++;
  }
  return { gefunden, abgelehnt };
}

async function ergebnisseSchreiben(ergebnisse) {
  await writeFile(new URL('../data/ergebnisse.json', import.meta.url), JSON.stringify({
    format: DATENFORMAT,
    aktualisiert: new Date().toISOString(),
    quelle: 'hockeyweb.de',
    ergebnisse,
  }, null, 2) + '\n');
}

async function alteErgebnisseLesen() {
  const datei = await jsonLesen('../data/ergebnisse.json', {});
  if (datei.format === DATENFORMAT) return datei.ergebnisse || {};
  if (Object.keys(datei.ergebnisse || {}).length) {
    console.log('Alte Ergebnisdatei ohne Gegenprobe erkannt – wird neu aufgebaut.');
  }
  return {};
}

/* Tagsüber: nur die Ergebnisseite, und nur wenn ein Spieltag fertig ist. */
async function spieltagModus() {
  const plan = await jsonLesen('../data/spielplan.json', { spiele: [] });
  const alte = await alteErgebnisseLesen();
  const jetzt = Date.now();

  const faellig = faelligeTage(plan.spiele || [], alte, jetzt);
  if (!faellig.length) {
    console.log('Kein abgeschlossener Spieltag mit offenen Ergebnissen – kein Abruf.');
    return;
  }
  console.log('Fällig: ' + faellig.map((t) => `${t.datum} (${t.offen} offen)`).join(', '));

  const ergBloecke = await alleBloecke('ergebnisse');
  const alle = new Map((plan.spiele || []).map((sp) => [sp.id, sp]));
  const { gefunden, abgelehnt } = ergebnisseAuswerten(ergBloecke, alle, jetzt);

  const ergebnisse = { ...alte, ...gefunden };
  const neu = Object.keys(gefunden).filter((id) => !alte[id]).length;
  console.log(`${neu} neue Endstände, ${abgelehnt} ohne gültigen Endstand.`);

  const nochOffen = faelligeTage(plan.spiele || [], ergebnisse, jetzt);
  if (nochOffen.length) {
    console.log('Noch offen, nächster Lauf versucht es erneut: '
      + nochOffen.map((t) => `${t.datum} (${t.offen})`).join(', '));
  }

  if (neu > 0 || Object.keys(alte).length === 0) await ergebnisseSchreiben(ergebnisse);
}

/* Nachts oder von Hand: kompletter Spielplan plus Ergebnisse. */
async function vollModus(pruefen) {
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

  // Bekannte Spiele behalten; doppelte Paarungen mit alter Kennung verwerfen.
  const plan = await jsonLesen('../data/spielplan.json', { teams: [], spiele: [] });
  const paarung = (sp) => `${sp.datum}|${sp.heim}|${sp.gast}`;
  const bekanntePaarungen = new Set([...gefunden.values()].map(paarung));

  const alle = new Map();
  for (const sp of plan.spiele || []) {
    if (!gefunden.has(sp.id) && bekanntePaarungen.has(paarung(sp))) continue;
    alle.set(sp.id, sp);
  }
  for (const sp of gefunden.values()) {
    const alt = alle.get(sp.id);
    alle.set(sp.id, { ...alt, ...sp, zeit: sp.zeit || alt?.zeit || null });
  }

  const sortiert = [...alle.values()].sort((a, b) =>
    (a.datum + (a.zeit || '00:00')).localeCompare(b.datum + (b.zeit || '00:00')));
  sortiert.forEach((sp, i) => { sp.spieltag = Math.floor(i / TEAMS_PRO_SPIELTAG) + 1; });

  const { gefunden: neueErgebnisse, abgelehnt } = ergebnisseAuswerten(ergBloecke, alle, Date.now());
  const ergebnisse = { ...(await alteErgebnisseLesen()), ...neueErgebnisse };

  console.log(`\n${gefunden.size} Partien gelesen, ${sortiert.length} im Spielplan.`);
  console.log(`${Object.keys(neueErgebnisse).length} Endstände erkannt, ${abgelehnt} ohne gültigen Endstand.`);
  if (warnungen.size) console.warn('Unbekannte Team-Slugs: ' + [...warnungen].join(', '));

  if (pruefen) {
    for (const [id, e] of Object.entries(neueErgebnisse)) {
      const sp = alle.get(id);
      console.log(`  ${sp.datum} ${sp.heim} – ${sp.gast}: ${e.h}:${e.a} ${e.art === 'REG' ? '' : e.art}`);
    }
    return;
  }

  plan.spiele = sortiert;
  plan.standGeneriert = new Date().toISOString().slice(0, 10);
  plan.quelle = 'hockeyweb.de';
  await writeFile(new URL('../data/spielplan.json', import.meta.url), JSON.stringify(plan, null, 2) + '\n');
  await ergebnisseSchreiben(ergebnisse);
  console.log('data/spielplan.json und data/ergebnisse.json geschrieben.');
}

async function main() {
  const pruefen = process.argv.includes('--pruefen');
  if (process.argv.includes('--modus=spieltag')) await spieltagModus();
  else await vollModus(pruefen);
}

// Nur ausführen, wenn direkt aufgerufen – nicht beim Import durch die Tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exitCode = 1; });
}
