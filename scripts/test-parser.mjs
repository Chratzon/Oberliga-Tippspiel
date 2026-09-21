/* Prüft die Erkennung gegen den echten Aufbau der Ergebnisseite.
 * Die Werte stammen von hockeyweb.de, erstes Wochenende 2026/27.
 *
 *   node scripts/test-parser.mjs
 */

import { bloeckeZerlegen, ergebnisAus, zeitAus, anpfiffMs, faelligeTage } from './scrape.mjs';

// [slug, zeit, endstand, drittel1, drittel2, drittel3, zusatz, erwartet]
const SPIELE = [
  ['kaufbeuren-badt%C3%B6lz-20260917-17414', '19:30', '2 : 0', '2 : 0', '0 : 0', '0 : 0', '',    { h: 2,  a: 0, art: 'REG' }],
  ['riessersee-passau-20260918-17429',       '19:30', '4 : 2', '3 : 0', '0 : 1', '1 : 1', '',    { h: 4,  a: 2, art: 'REG' }],
  ['tigers-selb-20260918-17426',             '19:30', '4 : 3', '1 : 0', '1 : 1', '2 : 2', '',    { h: 4,  a: 3, art: 'REG' }],
  ['peiting-stuttgart-20260918-17420',       '19:30', '6 : 2', '1 : 2', '1 : 0', '4 : 0', '',    { h: 6,  a: 2, art: 'REG' }],
  ['erding-f%C3%BCssen-20260918-17432',      '20:00', '2 : 4', '0 : 1', '1 : 0', '1 : 3', '',    { h: 2,  a: 4, art: 'REG' }],
  ['h%C3%B6chstadt-lindau-20260918-17431',   '20:00', '7 : 4', '3 : 2', '0 : 0', '4 : 2', '',    { h: 7,  a: 4, art: 'REG' }],
  ['deggendorf-heilbronn-20260918-17423',    '20:00', '2 : 1', '0 : 1', '0 : 0', '1 : 0', 'PSO', { h: 2,  a: 1, art: 'PS'  }],
  ['heilbronn-kaufbeuren-20260920-17419',    '15:00', '4 : 1', '2 : 1', '0 : 0', '2 : 0', '',    { h: 4,  a: 1, art: 'REG' }],
  ['lindau-deggendorf-20260920-17430',       '16:00', '0 : 6', '0 : 2', '0 : 3', '0 : 1', '',    { h: 0,  a: 6, art: 'REG' }],
  ['selb-peiting-20260920-17417',            '17:30', '5 : 6', '1 : 3', '3 : 0', '1 : 2', 'OT',  { h: 5,  a: 6, art: 'OT'  }],
  ['stuttgart-tigers-20260920-17413',        '17:30', '3 : 4', '2 : 0', '1 : 2', '0 : 2', '',    { h: 3,  a: 4, art: 'REG' }],
  ['badt%C3%B6lz-erding-20260920-17425',     '18:00', '10 : 6','5 : 2', '2 : 2', '3 : 2', '',    { h: 10, a: 6, art: 'REG' }],
  ['f%C3%BCssen-riessersee-20260920-17424',  '18:00', '0 : 2', '0 : 0', '0 : 1', '0 : 1', '',    { h: 0,  a: 2, art: 'REG' }],
  ['passau-h%C3%B6chstadt-20260920-17418',   '18:00', '8 : 5', '2 : 0', '3 : 2', '3 : 3', '',    { h: 8,  a: 5, art: 'REG' }],
];

function spielHtml([slug, zeit, end, d1, d2, d3, zusatz], zeitInSpans = false) {
  const z = zeitInSpans
    ? zeit.split(':').map((t) => `<span>${t}</span>`).join('<span>:</span>')
    : zeit;
  return `
  <a href="https://www.hockeyweb.de/oberliga/spiele/${slug}"></a>
  <div class="zeit">${z}</div>
  <div>Heim <img alt="Heim Logo" src="x.webp"></div>
  <div class="stand">${end}</div>
  <div><img alt="Gast Logo" src="y.webp"> Gast</div>
  <div>${d1}</div><div>${d2}</div><div>${d3}</div>
  ${zusatz ? `<div>${zusatz}</div>` : ''}`;
}

let fehler = 0;
const pruefe = (bedingung, text) => {
  console.log(`${bedingung ? '  ok  ' : ' FEHLER'}  ${text}`);
  if (!bedingung) fehler++;
};

for (const spans of [false, true]) {
  console.log(`\nSeite mit ${spans ? 'zerlegter' : 'normaler'} Uhrzeit:`);
  const bloecke = bloeckeZerlegen(SPIELE.map((s) => spielHtml(s, spans)).join('\n'));
  pruefe(bloecke.length === SPIELE.length, `${bloecke.length} von ${SPIELE.length} Spielen gefunden`);

  bloecke.forEach((b, i) => {
    const soll = SPIELE[i][7];
    const ist = ergebnisAus(b.text);
    const passt = ist && ist.h === soll.h && ist.a === soll.a && ist.art === soll.art;
    pruefe(passt, `${b.heimSlug}–${b.gastSlug}: ${ist ? `${ist.h}:${ist.a} ${ist.art}` : 'nichts'} (soll ${soll.h}:${soll.a} ${soll.art})`);
    pruefe(zeitAus(b.text) === SPIELE[i][1], `  Anpfiff ${zeitAus(b.text)}`);
  });
}

console.log('\nSpiele ohne Ergebnis dürfen keins bekommen:');
for (const zeit of ['20:00', '18:00', '19:30', '15:00']) {
  const html = `<a href="/oberliga/spiele/erding-lindau-20261004-17500"></a><div>${zeit}</div><div>Erding</div><div>Lindau</div>`;
  const e = ergebnisAus(bloeckeZerlegen(html)[0].text);
  pruefe(e === null, `Anpfiff ${zeit}, noch nicht gespielt → ${e ? `${e.h}:${e.a}` : 'kein Ergebnis'}`);
}

console.log('\nLaufendes Spiel, drittes Drittel fehlt noch:');
{
  const html = `<a href="/oberliga/spiele/selb-peiting-20261004-17501"></a><div>19:30</div><div>3 : 1</div><div>2 : 0</div><div>1 : 1</div>`;
  const e = ergebnisAus(bloeckeZerlegen(html)[0].text);
  pruefe(e === null, `3:1 nach zwei Dritteln → ${e ? `${e.h}:${e.a}` : 'kein Ergebnis'}`);
}

console.log('\nZeitzone:');
pruefe(new Date(anpfiffMs('2026-09-18', '19:30')).toISOString() === '2026-09-18T17:30:00.000Z',
  'Sommerzeit: 18.09. 19:30 → 17:30 UTC');
pruefe(new Date(anpfiffMs('2026-11-20', '19:30')).toISOString() === '2026-11-20T18:30:00.000Z',
  'Winterzeit: 20.11. 19:30 → 18:30 UTC');

console.log('\nWann wird abgefragt? (Sonntag 20.09.: Spiele 15:00 bis 18:00)');
{
  const sonntag = [
    { id: 'a', datum: '2026-09-20', zeit: '15:00' },
    { id: 'b', datum: '2026-09-20', zeit: '17:30' },
    { id: 'c', datum: '2026-09-20', zeit: '18:00' },
  ];
  const um = (hhmm, tag = '2026-09-20') => anpfiffMs(tag, hhmm);
  const faellig = (zeit, erg = {}, tag) => faelligeTage(sonntag, erg, um(zeit, tag)).length > 0;

  pruefe(!faellig('17:45'), '17:45 – erstes Spiel vorbei, andere laufen: kein Abruf');
  pruefe(!faellig('20:30'), '20:30 – letztes Spiel erst 2½ Std. alt: kein Abruf');
  pruefe(faellig('20:45'), '20:45 – letztes Spiel 2 Std. 45 Min. alt: Abruf');
  pruefe(faellig('21:15', { a: {}, b: {} }), '21:15 – ein Ergebnis fehlt noch: erneuter Abruf');
  pruefe(!faellig('21:15', { a: {}, b: {}, c: {} }), '21:15 – alle Ergebnisse da: kein Abruf');
  pruefe(faellig('01:30', {}, '2026-09-21'), 'Montag 01:30 – Nachzügler noch offen: Abruf');
  pruefe(!faellig('23:00', {}, '2026-09-21'), 'Montag 23:00 – über 30 Std. her: aufgeben, Nachtlauf übernimmt');
  pruefe(!faelligeTage([], {}, Date.now()).length, 'Tag ohne Spiele: kein Abruf');
}

console.log(fehler ? `\n${fehler} Fehler.` : '\nAlles bestanden.');
process.exitCode = fehler ? 1 : 0;
