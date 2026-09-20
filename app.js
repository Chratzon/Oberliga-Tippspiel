/* Bully – Tippspiel Oberliga Süd 26/27 */

import { Sync, RaumFehler } from './sync.js';
import { FIREBASE_KONFIG } from './konfig.js';

/* ========== Wertung ========== */

export const WERTUNG = [
  { punkte: 6, text: 'Ergebnis und Ausgang exakt getroffen' },
  { punkte: 4, text: 'Ergebnis exakt, Ausgang daneben' },
  { punkte: 3, text: 'Sieger und Tordifferenz richtig' },
  { punkte: 2, text: 'Sieger richtig, dazu der richtige Ausgang' },
  { punkte: 1, text: 'Nur der Sieger stimmt' },
];

export const AUSGANG = { REG: '60 Min.', OT: 'Verl.', PS: 'Penalty' };

export function punkteFuer(tipp, erg) {
  if (!tipp || !erg) return null;
  const exakt = tipp.h === erg.h && tipp.a === erg.a;
  const artGleich = tipp.art === erg.art;
  if (exakt && artGleich) return 6;
  if (exakt) return 4;

  const siegerTipp = tipp.h > tipp.a ? 'h' : tipp.h < tipp.a ? 'a' : null;
  const siegerErg = erg.h > erg.a ? 'h' : erg.h < erg.a ? 'a' : null;
  if (!siegerTipp || siegerTipp !== siegerErg) return 0;

  if (tipp.h - tipp.a === erg.h - erg.a) return 3;
  if (artGleich) return 2;
  return 1;
}

/* ========== Zustand ========== */

const SCHLUESSEL = 'bully.v1';

const zustand = {
  spielplan: null,
  teams: new Map(),
  ergebnisse: {},          // spielId -> {h,a,art}
  tipps: {},               // spielId -> {h,a,art}
  fremdeTipps: {},         // teilnehmerId -> {name, tipps:{...}}
  eigeneKorrekturen: {},   // spielId -> {h,a,art}  (manuell nachgetragen)
  raeume: [],              // [{id, name, nachweis, ersteller}]
  profil: { name: '', raum: null, id: null },
  konto: { angemeldet: false, anonym: true, name: '', email: '' },
  spieltag: 1,
  ansicht: 'tippen',
  standDaten: null,
};

function laden() {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (roh) {
      const d = JSON.parse(roh);
      Object.assign(zustand.profil, d.profil || {});
      zustand.tipps = d.tipps || {};
      zustand.raeume = d.raeume || [];
      zustand.eigeneKorrekturen = d.eigeneKorrekturen || {};
    }
  } catch (e) {
    console.warn('Gespeicherte Daten unlesbar, starte leer.', e);
  }
  if (!zustand.profil.id) zustand.profil.id = 'sp_' + Math.random().toString(36).slice(2, 11);

  delete zustand.profil.runde;
  delete zustand.profil.gruppe;
}

function sichern() {
  localStorage.setItem(SCHLUESSEL, JSON.stringify({
    profil: zustand.profil,
    tipps: zustand.tipps,
    raeume: zustand.raeume,
    eigeneKorrekturen: zustand.eigeneKorrekturen,
  }));
}

/* ========== Hilfsfunktionen ========== */

const $ = (sel) => document.querySelector(sel);

const WOCHENTAG = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function datumKurz(iso) {
  const d = new Date(iso + 'T12:00:00');
  return `${WOCHENTAG[d.getDay()]}, ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
}

function anpfiff(spiel) {
  return new Date(`${spiel.datum}T${spiel.zeit || '00:00'}:00`);
}

function istGesperrt(spiel) {
  return Boolean(ergebnisVon(spiel.id)) || Date.now() >= anpfiff(spiel).getTime();
}

function ergebnisVon(spielId) {
  return zustand.ergebnisse[spielId] || zustand.eigeneKorrekturen[spielId] || null;
}

function team(id) {
  return zustand.teams.get(id) || { name: id, kurz: id.slice(0, 3).toUpperCase(), ort: '' };
}

/* Wappen: liegt für den Verein eine Logodatei vor, wird sie gezeigt.
   Sonst eine Farbmarke mit dem Kürzel – funktioniert offline und
   braucht keine fremden Bildrechte. */
function wappen(t) {
  if (t.logo) {
    return `<img class="wappen" src="${t.logo}" alt="" loading="lazy"
             onerror="this.replaceWith(Object.assign(document.createElement('span'),
             {className:'wappen wappen-ersatz',textContent:'${t.kurz || ''}',
              style:'background:${t.farbe || '#16232E'};color:${t.farbe2 || '#fff'}'}))">`;
  }
  const hell = istHell(t.farbe || '#16232E');
  return `<span class="wappen wappen-ersatz" aria-hidden="true"
           style="background:${t.farbe || '#16232E'};color:${hell ? '#16232E' : '#FFFFFF'};
                  box-shadow:inset 0 0 0 2px ${t.farbe2 || 'transparent'}">${t.kurz || ''}</span>`;
}

function istHell(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('ist-sichtbar');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('ist-sichtbar'), 2200);
}

function spieleVonSpieltag(nr) {
  return zustand.spielplan.spiele
    .filter((s) => s.spieltag === nr)
    .sort((a, b) => (a.datum + (a.zeit || '')).localeCompare(b.datum + (b.zeit || '')));
}

function alleSpieltage() {
  return [...new Set(zustand.spielplan.spiele.map((s) => s.spieltag))].sort((a, b) => a - b);
}

function aktuellerSpieltag() {
  const heute = new Date().toISOString().slice(0, 10);
  const naechstes = zustand.spielplan.spiele
    .filter((s) => s.datum >= heute)
    .sort((a, b) => a.datum.localeCompare(b.datum))[0];
  return naechstes ? naechstes.spieltag : Math.max(...alleSpieltage(), 1);
}

/* ========== Daten laden ========== */

async function datenLaden() {
  const [plan, erg] = await Promise.all([
    fetch('data/spielplan.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('data/ergebnisse.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({ ergebnisse: {} })),
  ]);
  zustand.spielplan = plan;
  zustand.teams = new Map(plan.teams.map((t) => [t.id, t]));
  zustand.ergebnisse = erg.ergebnisse || {};
  zustand.standDaten = erg.aktualisiert || null;
}

/* ========== Ansicht: Tippen ========== */

function zeichneTippen() {
  const tage = alleSpieltage();
  const nr = zustand.spieltag;
  const spiele = spieleVonSpieltag(nr);

  $('#st-nummer').textContent = nr;
  $('#st-datum').textContent = spiele.length ? datumKurz(spiele[0].datum) : '';
  $('#st-zurueck').disabled = nr <= Math.min(...tage);
  $('#st-vor').disabled = nr >= Math.max(...tage);

  const liste = $('#spiele-liste');
  liste.innerHTML = '';
  $('#tippen-leer').hidden = spiele.length > 0;

  for (const spiel of spiele) liste.appendChild(spielKarte(spiel));
}

function spielKarte(spiel) {
  const erg = ergebnisVon(spiel.id);
  const tipp = zustand.tipps[spiel.id];
  const gesperrt = istGesperrt(spiel);
  const punkte = punkteFuer(tipp, erg);

  const karte = document.createElement('article');
  karte.className = 'spiel' + (punkte > 0 ? ' ist-gewertet' : '');

  const h = team(spiel.heim), g = team(spiel.gast);
  const zeitText = spiel.zeit ? `${spiel.zeit} Uhr` : 'Anpfiff offen';

  karte.innerHTML = `
    <div class="spiel-kopf">
      <span>${datumKurz(spiel.datum)}</span>
      ${erg ? '<span class="marke">Endstand</span>' : ''}
      <span class="anpfiff">${erg ? '' : zeitText}</span>
    </div>
    <div class="paarung">
      <div class="mannschaft heim">${wappen(h)}<span class="ms-name">${h.name}</span></div>
      <div class="endstand ${erg ? '' : 'ist-offen'}">
        ${erg ? `${erg.h}:${erg.a}` : '–:–'}
        ${erg && erg.art !== 'REG' ? `<span class="zusatz">${AUSGANG[erg.art]}</span>` : ''}
      </div>
      <div class="mannschaft gast"><span class="ms-name">${g.name}</span>${wappen(g)}</div>
    </div>`;

  karte.appendChild(gesperrt ? gesperrtLeiste(tipp, punkte) : tippFeld(spiel, tipp));
  return karte;
}

function punkteChip(punkte) {
  if (punkte === null) return '';
  return `<span class="punkte ${punkte === 0 ? 'ist-null' : ''}">${punkte} ${punkte === 1 ? 'Punkt' : 'Punkte'}</span>`;
}

function gesperrtLeiste(tipp, punkte) {
  const el = document.createElement('div');
  el.className = 'tipp-gesperrt';
  el.innerHTML = tipp
    ? `<span>Dein Tipp: ${tipp.h}:${tipp.a}${tipp.art !== 'REG' ? ' (' + AUSGANG[tipp.art] + ')' : ''}</span>${punkteChip(punkte)}`
    : '<span>Kein Tipp abgegeben</span>';
  return el;
}

function tippFeld(spiel, tipp) {
  const wert = tipp || { h: 0, a: 0, art: 'REG' };
  const el = document.createElement('div');
  el.className = 'tipp-feld';
  el.innerHTML = `
    <div class="zaehler-reihe">
      <div class="zaehler">
        <button type="button" data-tor="heim" data-schritt="-1" aria-label="Tore Heim verringern">−</button>
        <output data-feld="heim">${wert.h}</output>
        <button type="button" data-tor="heim" data-schritt="1" aria-label="Tore Heim erhöhen">+</button>
      </div>
      <span class="doppelpunkt">:</span>
      <div class="zaehler">
        <button type="button" data-tor="gast" data-schritt="-1" aria-label="Tore Gast verringern">−</button>
        <output data-feld="gast">${wert.a}</output>
        <button type="button" data-tor="gast" data-schritt="1" aria-label="Tore Gast erhöhen">+</button>
      </div>
    </div>
    <div class="ausgang" role="group" aria-label="Wie endet das Spiel?">
      ${Object.entries(AUSGANG).map(([k, v]) =>
        `<button type="button" data-art="${k}" class="${wert.art === k ? 'ist-gewaehlt' : ''}">${v}</button>`).join('')}
    </div>
    <div class="tipp-fuss"><span>${tipp ? 'Tipp gespeichert' : 'Noch nicht getippt'}</span></div>`;

  const ausgabeH = el.querySelector('[data-feld="heim"]');
  const ausgabeG = el.querySelector('[data-feld="gast"]');
  const hinweis = el.querySelector('.tipp-fuss span');

  const lies = () => ({
    h: Number(ausgabeH.textContent),
    a: Number(ausgabeG.textContent),
    art: el.querySelector('.ausgang .ist-gewaehlt').dataset.art,
  });

  const uebernehmen = () => {
    const neu = lies();
    // Unentschieden gibt es im Eishockey nicht – bei Gleichstand nachschärfen.
    if (neu.h === neu.a) {
      hinweis.textContent = 'Unentschieden gibt es nicht – ein Tor muss mehr sein';
      return;
    }
    if (neu.h !== neu.a && neu.art !== 'REG' && Math.abs(neu.h - neu.a) !== 1) {
      hinweis.textContent = 'Nach Verlängerung oder Penalty ist der Abstand immer 1 Tor';
      return;
    }
    zustand.tipps[spiel.id] = neu;
    sichern();
    hinweis.textContent = 'Tipp gespeichert';
    Sync.tippSenden(spiel.id, neu);
  };

  el.querySelectorAll('[data-tor]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ziel = btn.dataset.tor === 'heim' ? ausgabeH : ausgabeG;
      const neu = Math.max(0, Math.min(20, Number(ziel.textContent) + Number(btn.dataset.schritt)));
      ziel.textContent = neu;
      uebernehmen();
    });
  });

  el.querySelectorAll('[data-art]').forEach((btn) => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('[data-art]').forEach((b) => b.classList.remove('ist-gewaehlt'));
      btn.classList.add('ist-gewaehlt');
      uebernehmen();
    });
  });

  return el;
}
/* ========== Ansicht: Rangliste ========== */

function aktiverRaum() {
  return zustand.raeume.find((r) => r.id === zustand.profil.raum) || null;
}

function zeichneRangliste() {
  const raum = aktiverRaum();

  const teilnehmer = [
    { id: zustand.profil.id, name: zustand.profil.name || 'Du', tipps: zustand.tipps, ich: true },
    ...Object.entries(zustand.fremdeTipps)
      .filter(([id]) => id !== zustand.profil.id)
      .map(([id, w]) => ({ id, name: w.name || 'Unbenannt', tipps: w.tipps || {}, ich: false })),
  ];

  const gewertet = Object.keys(zustand.ergebnisse).length + Object.keys(zustand.eigeneKorrekturen).length;

  const reihen = teilnehmer.map((t) => {
    let punkte = 0, treffer = 0, getippt = 0;
    for (const [spielId, tipp] of Object.entries(t.tipps)) {
      const erg = ergebnisVon(spielId);
      if (!erg) continue;
      getippt++;
      const p = punkteFuer(tipp, erg);
      punkte += p;
      if (p >= 4) treffer++;
    }
    return { ...t, punkte, treffer, getippt };
  }).sort((a, b) => b.punkte - a.punkte || b.treffer - a.treffer || a.name.localeCompare(b.name));

  const teile = [];
  teile.push(raum ? `${raum.name} · ${reihen.length} Mitspieler` : 'Noch in keinem Raum');
  if (gewertet) teile.push(`${gewertet} gewertete ${gewertet === 1 ? 'Partie' : 'Partien'}`);
  $('#rang-info').textContent = teile.join(' · ');

  const liste = $('#rangliste');
  liste.innerHTML = '';
  const zeigen = gewertet > 0;
  $('#rang-leer').hidden = zeigen;

  if (zeigen) {
    reihen.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.ich) li.className = 'bin-ich';
      li.innerHTML = `
        <span class="rang-platz">${i + 1}</span>
        <span>
          <span class="rang-name">${r.name}</span>
          <span class="rang-detail">${r.getippt} getippt · ${r.treffer} Volltreffer</span>
        </span>
        <span class="rang-punkte">${r.punkte}</span>`;
      liste.appendChild(li);
    });
  }

  $('#legende-liste').innerHTML = WERTUNG
    .map((w) => `<li><b>${w.punkte}</b><span>${w.text}</span></li>`).join('');
}

/* ========== Ansicht: Ergebnisse ========== */

function zeichneErgebnisse() {
  const mitErgebnis = zustand.spielplan.spiele
    .filter((s) => ergebnisVon(s.id))
    .sort((a, b) => (b.datum + (b.zeit || '')).localeCompare(a.datum + (a.zeit || '')));

  $('#erg-info').textContent = zustand.standDaten
    ? `Zuletzt aktualisiert: ${new Date(zustand.standDaten).toLocaleString('de-DE')}`
    : 'Noch keine Aktualisierung durchgelaufen';

  const liste = $('#ergebnis-liste');
  liste.innerHTML = '';
  $('#erg-leer').hidden = mitErgebnis.length > 0;
  for (const spiel of mitErgebnis) liste.appendChild(spielKarte(spiel));
}

/* ========== Ansicht: Profil ========== */

function zeichneKonto() {
  const k = zustand.konto;
  const status = $('#konto-status');
  const knoepfe = $('#konto-knoepfe');

  $('#konto-name').textContent = zustand.profil.name || 'Unbenannt';

  if (!Sync.verbunden()) {
    status.textContent = 'Keine Verbindung. Du tippst gerade nur für dich auf diesem Gerät.';
    knoepfe.innerHTML = '';
    return;
  }

  if (!k.anonym) {
    status.textContent = `Angemeldet mit Google${k.email ? ' · ' + k.email : ''}. `
      + 'Auf einem neuen Gerät meldest du dich damit an und hast Räume und Tipps sofort wieder.';
    knoepfe.innerHTML = '<button type="button" class="knopf knopf-still" data-tat="abmelden">Abmelden</button>';
  } else {
    status.textContent = 'Anonym unterwegs. Dein Profil hängt an diesem Gerät – '
      + 'Browserspeicher geleert oder neues Handy heißt: neu anfangen.';
    knoepfe.innerHTML = '<button type="button" class="knopf" data-tat="google">Mit Google anmelden</button>';
  }

  knoepfe.onclick = async (e) => {
    const tat = e.target.closest('[data-tat]')?.dataset.tat;
    if (!tat) return;
    try {
      if (tat === 'google') {
        const ergebnis = await Sync.googleWaehlen();
        if (ergebnis === null) return;               // Weiterleitung läuft
        sichern();
        kopfAktualisieren();
        toast(ergebnis.zurueckgeholt
          ? `Willkommen zurück: ${ergebnis.zurueckgeholt.raeume} Räume, ${ergebnis.zurueckgeholt.tipps} Tipps`
          : 'Konto verbunden');
      }
      if (tat === 'abmelden') {
        if (!confirm('Abmelden? Auf diesem Gerät bist du danach wieder anonym unterwegs.')) return;
        await Sync.googleAbmelden();
        sichern();
        kopfAktualisieren();
        toast('Abgemeldet');
      }
    } catch (err) { toast(err.message); }
    zeichneProfil();
  };
}

function zeichneRaeume() {
  const liste = $('#raum-liste');
  liste.innerHTML = '';
  $('#raum-leer').hidden = zustand.raeume.length > 0;

  for (const r of zustand.raeume) {
    const aktiv = r.id === zustand.profil.raum;
    const meiner = r.ersteller === zustand.profil.id;
    const anzahl = aktiv ? Object.keys(zustand.fremdeTipps).length : null;

    const li = document.createElement('li');
    li.className = 'gruppe' + (aktiv ? ' ist-aktiv' : '');
    li.innerHTML = `
      <div class="gruppe-kopf">
        <span class="gruppe-name">${r.name}</span>
        ${aktiv ? '<span class="gruppe-marke">aktiv</span>' : ''}
      </div>
      <div class="gruppe-meta">
        <span class="gruppe-code">${r.id}</span>
        ${anzahl ? `<span>${anzahl} Mitspieler</span>` : ''}
        ${meiner ? '<span>von dir eröffnet</span>' : ''}
      </div>
      <div class="gruppe-aktionen">
        ${aktiv ? '' : '<button type="button" data-tat="wechseln">Aktivieren</button>'}
        <button type="button" data-tat="einladen">Einladen</button>
        <button type="button" data-tat="verlassen" class="tat-warnung">Verlassen</button>
      </div>`;

    li.addEventListener('click', async (e) => {
      const tat = e.target.closest('[data-tat]')?.dataset.tat;
      if (!tat) return;

      if (tat === 'wechseln') {
        Sync.raumWechseln(r.id);
        sichern();
        kopfAktualisieren();
        zeichneRaeume();
        toast(`„${r.name}“ ist aktiv`);
      }

      if (tat === 'einladen') await einladen(r);

      if (tat === 'verlassen') {
        if (!confirm(`„${r.name}“ verlassen? Deine Tipps bleiben, du tauchst dort aber nicht mehr auf.`)) return;
        await Sync.raumVerlassen(r.id);
        sichern();
        kopfAktualisieren();
        zeichneRaeume();
        toast('Raum verlassen');
      }
    });

    liste.appendChild(li);
  }
}

async function einladen(r) {
  const link = Sync.einladungsLink(r.id);
  const text = `Tipp mit im Raum „${r.name}“\n${link}\n\nDas Passwort bekommst du von mir.`;
  if (navigator.share) {
    try { await navigator.share({ title: r.name, text }); return; } catch { /* abgebrochen */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Einladung kopiert – Passwort separat schicken');
  } catch {
    prompt('Einladung kopieren:', text);
  }
}

function zeichneProfil() {
  $('#in-name').value = zustand.profil.name;
  zeichneKonto();
  zeichneRaeume();

  $('#hinweis-einrichtung').hidden = Boolean(FIREBASE_KONFIG && FIREBASE_KONFIG.projectId);

  $('#daten-stand').textContent = zustand.standDaten
    ? `Spielplan und Ergebnisse vom ${new Date(zustand.standDaten).toLocaleDateString('de-DE')}`
    : 'Spielplan aus der mitgelieferten Datei';

  const liste = $('#admin-liste');
  liste.innerHTML = '';
  const kandidaten = zustand.spielplan.spiele
    .filter((s) => new Date(s.datum) <= new Date())
    .sort((a, b) => b.datum.localeCompare(a.datum))
    .slice(0, 40);

  for (const spiel of kandidaten) {
    const erg = ergebnisVon(spiel.id) || { h: '', a: '', art: 'REG' };
    const fixiert = Boolean(zustand.ergebnisse[spiel.id]);
    const zeile = document.createElement('div');
    zeile.className = 'admin-zeile';
    zeile.innerHTML = `
      <span>${team(spiel.heim).kurz} – ${team(spiel.gast).kurz}<br><small style="color:var(--grau)">${datumKurz(spiel.datum)}</small></span>
      <span class="admin-eingabe">
        <input type="text" inputmode="numeric" value="${erg.h}" data-rolle="h" ${fixiert ? 'disabled' : ''}>
        <input type="text" inputmode="numeric" value="${erg.a}" data-rolle="a" ${fixiert ? 'disabled' : ''}>
        <select data-rolle="art" ${fixiert ? 'disabled' : ''}>
          ${Object.entries(AUSGANG).map(([k, v]) => `<option value="${k}" ${erg.art === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
      </span>`;

    zeile.addEventListener('change', () => {
      const h = Number(zeile.querySelector('[data-rolle="h"]').value);
      const a = Number(zeile.querySelector('[data-rolle="a"]').value);
      const art = zeile.querySelector('[data-rolle="art"]').value;
      if (Number.isNaN(h) || Number.isNaN(a) || h === a) {
        delete zustand.eigeneKorrekturen[spiel.id];
      } else {
        zustand.eigeneKorrekturen[spiel.id] = { h, a, art };
      }
      sichern();
      toast('Endstand übernommen');
    });

    liste.appendChild(zeile);
  }
}

/* ========== Navigation ========== */

function zeige(name) {
  zustand.ansicht = name;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.id !== 'view-' + name;
  for (const btn of document.querySelectorAll('.reiter-knopf')) {
    const aktiv = btn.dataset.view === name;
    btn.classList.toggle('ist-aktiv', aktiv);
    btn.setAttribute('aria-selected', String(aktiv));
  }
  if (name === 'tippen') zeichneTippen();
  if (name === 'tabelle') zeichneRangliste();
  if (name === 'ergebnisse') zeichneErgebnisse();
  if (name === 'profil') zeichneProfil();
  window.scrollTo({ top: 0 });
}

function kopfAktualisieren() {
  const r = aktiverRaum();
  $('#chip-gruppe').textContent = r ? r.name : 'Kein Raum';
}

function syncBand(text, fehler = false) {
  const el = $('#sync-band');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('ist-fehler', fehler);
}

/* ========== Begrüßung ========== */

function begruessungZeigen(an) {
  if (an && !Sync.verbunden()) {
    const w = $('#willkommen-warnung');
    w.hidden = false;
    w.textContent = 'Keine Verbindung zum Server. Die Anmeldung mit Google '
      + 'funktioniert gerade nicht – mit einem Namen kommst du trotzdem rein und '
      + 'tippst erst einmal für dich.';
  }
  $('#willkommen').hidden = !an;
  $('#inhalt').hidden = an;
  document.querySelector('.reiter').hidden = an;
  document.querySelector('.tafel').hidden = an;
}

function begruessungAnbinden() {
  $('#form-start').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#in-startname').value.trim();
    if (!name) { toast('Bitte einen Namen eingeben'); return; }
    zustand.profil.name = name;
    sichern();
    Sync.mitgliedschaftenSchreiben().catch(() => {});
    begruessungZeigen(false);
    zeige(zustand.raeume.length ? 'tippen' : 'profil');
    if (!zustand.raeume.length) toast('Jetzt noch einem Raum beitreten');
  });

  $('#btn-start-google').addEventListener('click', async () => {
    if (!Sync.verbunden()) {
      toast('Ohne Verbindung geht das nicht – gib einfach einen Namen ein');
      $('#in-startname').focus();
      return;
    }
    try {
      const ergebnis = await Sync.googleWaehlen();
      if (ergebnis === null) return;
      if (!zustand.profil.name) zustand.profil.name = ergebnis.konto.name || '';
      sichern();
      if (!zustand.profil.name) { $('#in-startname').focus(); return; }
      kopfAktualisieren();
      begruessungZeigen(false);
      zeige(zustand.raeume.length ? 'tippen' : 'profil');
    } catch (err) { toast(err.message); }
  });
}

/* ========== Räume: Formulare ========== */

function raumFormulareAnbinden() {
  const umschalten = (welches) => {
    $('#form-raum-neu').hidden = welches !== 'neu';
    $('#form-raum-beitreten').hidden = welches !== 'beitreten';
  };

  $('#btn-raum-neu').addEventListener('click', () =>
    umschalten($('#form-raum-neu').hidden ? 'neu' : null));
  $('#btn-raum-beitreten').addEventListener('click', () =>
    umschalten($('#form-raum-beitreten').hidden ? 'beitreten' : null));

  $('#form-raum-neu').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await Sync.raumErstellen($('#in-raum-name').value, $('#in-raum-pw').value);
      sichern();
      kopfAktualisieren();
      zeichneRaeume();
      umschalten(null);
      $('#in-raum-name').value = '';
      $('#in-raum-pw').value = '';
      toast(`„${r.name}“ eröffnet`);
    } catch (err) { toast(err.message); }
  });

  $('#form-raum-beitreten').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await Sync.raumBeitreten($('#in-beitritt-name').value, $('#in-beitritt-pw').value);
      sichern();
      kopfAktualisieren();
      zeichneRaeume();
      umschalten(null);
      $('#in-beitritt-name').value = '';
      $('#in-beitritt-pw').value = '';
      toast(`Willkommen in „${r.name}“`);
    } catch (err) { toast(err.message); }
  });
}

/* Einladungslink: Raumname vorbelegen, Passwort muss der Nutzer eingeben. */
function einladungVorbelegen() {
  const raum = new URLSearchParams(location.search).get('raum');
  if (!raum) return false;
  history.replaceState(null, '', location.pathname);
  if (zustand.raeume.some((r) => r.id === raum)) return false;
  $('#in-beitritt-name').value = raum;
  $('#form-raum-beitreten').hidden = false;
  return true;
}

/* ========== Passwortfelder ========== */

/* Hängt an jedes Passwortfeld einen Knopf zum Sichtbarmachen.
   Wird einmal beim Start über alle vorhandenen Felder gelegt. */
function passwortFelderAufwerten() {
  for (const feld of document.querySelectorAll('input[type="password"]')) {
    if (feld.closest('.pw-feld')) continue;

    const huelle = document.createElement('div');
    huelle.className = 'pw-feld';
    feld.parentNode.insertBefore(huelle, feld);
    huelle.appendChild(feld);

    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.className = 'pw-knopf';
    knopf.setAttribute('aria-label', 'Passwort anzeigen');
    knopf.setAttribute('aria-pressed', 'false');
    knopf.innerHTML = AUGE_ZU;

    knopf.addEventListener('click', () => {
      const sichtbar = feld.type === 'text';
      feld.type = sichtbar ? 'password' : 'text';
      knopf.innerHTML = sichtbar ? AUGE_ZU : AUGE_AUF;
      knopf.setAttribute('aria-label', sichtbar ? 'Passwort anzeigen' : 'Passwort verbergen');
      knopf.setAttribute('aria-pressed', String(!sichtbar));
      // Der Tippfluss soll nicht abreißen.
      feld.focus();
      const ende = feld.value.length;
      try { feld.setSelectionRange(ende, ende); } catch { /* Typwechsel */ }
    });

    huelle.appendChild(knopf);
  }
}

const AUGE_ZU = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>
  <circle cx="12" cy="12" r="3"/></svg>`;

const AUGE_AUF = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>
  <circle cx="12" cy="12" r="3"/><path d="M4 20L20 4"/></svg>`;

/* ========== Start ========== */

async function start() {
  laden();
  kopfAktualisieren();

  try {
    await datenLaden();
  } catch (e) {
    document.body.innerHTML = '<p class="leer">Spielplan konnte nicht geladen werden. Bitte Seite neu laden.</p>';
    return;
  }

  zustand.spieltag = aktuellerSpieltag();

  document.querySelectorAll('.reiter-knopf').forEach((b) =>
    b.addEventListener('click', () => zeige(b.dataset.view)));
  $('#btn-profil').addEventListener('click', () => zeige('profil'));

  $('#st-zurueck').addEventListener('click', () => { zustand.spieltag--; zeichneTippen(); });
  $('#st-vor').addEventListener('click', () => { zustand.spieltag++; zeichneTippen(); });

  $('#profil-form').addEventListener('submit', (e) => {
    e.preventDefault();
    zustand.profil.name = $('#in-name').value.trim();
    sichern();
    zeichneKonto();
    toast('Name gespeichert');
    Sync.mitgliedschaftenSchreiben().catch(() => {});
  });

  begruessungAnbinden();
  raumFormulareAnbinden();
  passwortFelderAufwerten();

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ profil: zustand.profil, tipps: zustand.tipps }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `tipps-${zustand.profil.name || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('#btn-import').addEventListener('click', () => $('#datei-import').click());
  $('#datei-import').addEventListener('change', async (e) => {
    const datei = e.target.files[0];
    if (!datei) return;
    try {
      const d = JSON.parse(await datei.text());
      Object.assign(zustand.tipps, d.tipps || {});
      sichern();
      toast('Tipps eingelesen');
      zeige(zustand.ansicht);
    } catch {
      toast('Datei konnte nicht gelesen werden');
    }
  });

  // Verbindung kommt ausschließlich aus konfig.js – ohne Zutun des Nutzers.
  Sync.init({
    zustand,
    konfiguration: FIREBASE_KONFIG,
    beiAenderung: () => {
      kopfAktualisieren();
      if (zustand.ansicht === 'tabelle') zeichneRangliste();
      if (zustand.ansicht === 'profil') zeichneProfil();
    },
    beiStatus: syncBand,
  });
  await Sync.verbinden();
  sichern();

  const wartendeEinladung = einladungVorbelegen();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  if (!zustand.profil.name) {
    begruessungZeigen(true);
    $('#in-startname').focus();
    return;
  }

  begruessungZeigen(false);
  zeige(wartendeEinladung || !zustand.raeume.length ? 'profil' : 'tippen');
}

start();
