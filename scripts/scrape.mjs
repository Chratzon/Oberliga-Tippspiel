/* Holt Spielplan und Ergebnisse der Oberliga Süd und schreibt sie nach data/.
 *
 * Aufruf:
 *   node scripts/scrape.mjs            → schreibt die Dateien
 *   node scripts/scrape.mjs --pruefen  → zeigt nur, was erkannt wurde
 *
 * Braucht Node 18 oder neuer (fetch ist eingebaut), keine Abhängigkeiten.
 */

import { writeFile, readFile } from 'node:fs/promises';

const BASIS = 'https://www.hockeyweb.de/oberliga';
const STAFFEL = encodeURIComponent('süd');
const SEITEN = 30;                 // großzügig, leere Seiten werden übersprungen
const TEAMS_PRO_SPIELTAG = 7;      // 14 Vereine, jeder spielt jeden Spieltag
const PAUSE_MS = 900;              // höflicher Abstand zwischen den Abrufen

/* Slug aus der Spiel-URL → Team-ID in spielplan.json */
const SLUG_ZU_TEAM = {
  deggendorf: 'deggendorf',
  peiting: 'peiting',
  passau: 'passau',
  kaufbeuren: 'kaufbeuren',
  füssen: 'fuessen',
  fuessen: 'fuessen',
  lindau: 'lindau',
  erding: 'erding',
  tigers: 'tigers',
  heilbronn: 'heilbronn',
  höchstadt: 'hoechstadt',
  hoechstadt: 'hoechstadt',
  riessersee: 'riessersee',
  selb: 'selb',
  stuttgart: 'stuttgart',
  badtölz: 'badtoelz',
  badtoelz: 'badtoelz',
};

const pruefen = process.argv.includes('--pruefen');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function seiteHolen(pfad, seite) {
  const url = `${BASIS}/${pfad}/${STAFFEL}${seite > 1 ? `?page=${seite}` : ''}`;
  const antwort = await fetch(url, {
    headers: {
      'User-Agent': 'bully-tippspiel/1.0 (privates Tippspiel, 1 Abruf pro Tag)',
      'Accept-Language': 'de-DE,de;q=0.9',
    },
  });
  if (!antwort.ok) throw new Error(`${url} → HTTP ${antwort.status}`);
  return antwort.text();
}

/* Findet alle Spiel-Links einer Seite und schneidet den Textblock
   bis zum nächsten Link heraus. */
function bloeckeZerlegen(html) {
  const muster = /\/oberliga\/spiele\/([^"'\s>?]+?)-(\d{8})-(\d+)/g;
  const treffer = [...html.matchAll(muster)];
  const bloecke = [];

  for (let i = 0; i < treffer.length; i++) {
    const t = treffer[i];
    const id = t[3];
    if (bloecke.some((b) => b.id === id)) continue;   // Links kommen doppelt vor

    const start = t.index;
    const ende = i + 1 < treffer.length ? treffer[i + 1].index : Math.min(html.length, start + 4000);
    const text = html.slice(start, ende)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const slug = decodeURIComponent(t[1]).toLowerCase();
    const teile = slug.split('-');
    bloecke.push({
      id,
      datumRoh: t[2],
      heimSlug: teile[0],
      gastSlug: teile.slice(1).join('-'),
      text,
    });
  }
  return bloecke;
}

function datumIso(roh) {
  return `${roh.slice(0, 4)}-${roh.slice(4, 6)}-${roh.slice(6, 8)}`;
}

function teamId(slug, warnungen) {
  const id = SLUG_ZU_TEAM[slug];
  if (!id) warnungen.add(slug);
  return id || slug;
}

function zeitAus(text) {
  const m = text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
  return m ? `${m[1]}:${m[2]}` : null;
}

function ergebnisAus(text) {
  // Endstände stehen als "4:2", Uhrzeiten als "19:30" – Minuten ≥ 2-stellig
  // mit führender Null unterscheiden sich davon nicht sicher, deshalb
  // greifen wir nur Paare mit höchstens einer Ziffer je Seite ab.
  const m = text.match(/(?:^|\s)(\d{1,2})\s*:\s*(\d{1,2})(?:\s|$)/);
  if (!m) return null;
  const h = Number(m[1]), a = Number(m[2]);
  if (h > 25 || a > 25 || h === a) return null;

  let art = 'REG';
  if (/n\.?\s?V\.?|OT|Verläng/i.test(text)) art = 'OT';
  if (/n\.?\s?P\.?|Penalty|Shootout|PS\b/i.test(text)) art = 'PS';
  return { h, a, art };
}

async function alleBloecke(pfad) {
  const gesammelt = [];
  const gesehen = new Set();

  for (let seite = 1; seite <= SEITEN; seite++) {
    let html;
    try {
      html = await seiteHolen(pfad, seite);
    } catch (e) {
      console.warn(`  Seite ${seite} übersprungen: ${e.message}`);
      break;
    }
    const bloecke = bloeckeZerlegen(html).filter((b) => !gesehen.has(b.id));
    if (bloecke.length === 0) break;
    bloecke.forEach((b) => gesehen.add(b.id));
    gesammelt.push(...bloecke);
    console.log(`  ${pfad} Seite ${seite}: ${bloecke.length} Partien`);
    await warte(PAUSE_MS);
  }
  return gesammelt;
}

async function main() {
  const warnungen = new Set();

  console.log('Spielplan wird gelesen …');
  const planBloecke = await alleBloecke('spielplan');

  console.log('Ergebnisse werden gelesen …');
  const ergBloecke = await alleBloecke('ergebnisse');

  /* --- Spiele zusammenführen --- */
  const spiele = new Map();

  for (const b of [...ergBloecke, ...planBloecke]) {
    if (spiele.has(b.id)) continue;
    spiele.set(b.id, {
      id: b.id,
      datum: datumIso(b.datumRoh),
      zeit: zeitAus(b.text),
      heim: teamId(b.heimSlug, warnungen),
      gast: teamId(b.gastSlug, warnungen),
    });
  }

  const sortiert = [...spiele.values()]
    .sort((a, b) => (a.datum + (a.zeit || '00:00')).localeCompare(b.datum + (b.zeit || '00:00')));

  // Spieltag = je sieben Partien in Datumsreihenfolge
  sortiert.forEach((s, i) => { s.spieltag = Math.floor(i / TEAMS_PRO_SPIELTAG) + 1; });

  /* --- Ergebnisse --- */
  const ergebnisse = {};
  for (const b of ergBloecke) {
    const e = ergebnisAus(b.text);
    if (e) ergebnisse[b.id] = e;
  }

  console.log(`\n${sortiert.length} Partien, ${Object.keys(ergebnisse).length} Endstände erkannt.`);
  if (warnungen.size) {
    console.warn('Unbekannte Team-Slugs (in SLUG_ZU_TEAM ergänzen): ' + [...warnungen].join(', '));
  }

  if (pruefen) {
    console.log(JSON.stringify(sortiert.slice(0, 10), null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(ergebnisse).slice(0, 10)), null, 2));
    return;
  }

  if (sortiert.length < 50) {
    console.error('Zu wenige Partien erkannt – die Dateien bleiben unverändert.');
    console.error('Wahrscheinlich hat sich der Aufbau der Quellseite geändert.');
    process.exitCode = 1;
    return;
  }

  const alt = JSON.parse(await readFile(new URL('../data/spielplan.json', import.meta.url), 'utf8'));
  alt.spiele = sortiert;
  alt.standGeneriert = new Date().toISOString().slice(0, 10);
  await writeFile(new URL('../data/spielplan.json', import.meta.url), JSON.stringify(alt, null, 2) + '\n');

  await writeFile(
    new URL('../data/ergebnisse.json', import.meta.url),
    JSON.stringify({
      aktualisiert: new Date().toISOString(),
      quelle: 'hockeyweb.de',
      ergebnisse,
    }, null, 2) + '\n'
  );

  console.log('data/spielplan.json und data/ergebnisse.json geschrieben.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
