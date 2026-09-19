/* Bully – Tippspiel Oberliga Süd 26/27 */

import { Sync, GruppenFehler } from './sync.js';

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
  gruppen: [],             // [{code, name, ersteller, offen}]
  profil: { name: '', gruppe: null, id: null },
  firebase: null,
  spieltag: 1,
  ansicht: 'tippen',
  standDaten: null,
};

function laden() {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    if (!roh) return;
    const d = JSON.parse(roh);
    Object.assign(zustand.profil, d.profil || {});
    zustand.tipps = d.tipps || {};
    zustand.gruppen = d.gruppen || [];
    zustand.eigeneKorrekturen = d.eigeneKorrekturen || {};
    zustand.firebase = d.firebase || null;
  } catch (e) {
    console.warn('Gespeicherte Daten unlesbar, starte leer.', e);
  }
  if (!zustand.profil.id) zustand.profil.id = 'sp_' + Math.random().toString(36).slice(2, 11);

  // Aus der Zeit vor den Gruppen: alter Rundencode wird zur Gruppe.
  if (zustand.profil.runde && zustand.gruppen.length === 0) {
    const code = String(zustand.profil.runde).toUpperCase();
    zustand.gruppen.push({ code, name: zustand.profil.runde, ersteller: zustand.profil.id, offen: true });
    zustand.profil.gruppe = code;
  }
  delete zustand.profil.runde;
}

function sichern() {
  localStorage.setItem(SCHLUESSEL, JSON.stringify({
    profil: zustand.profil,
    tipps: zustand.tipps,
    gruppen: zustand.gruppen,
    eigeneKorrekturen: zustand.eigeneKorrekturen,
    firebase: zustand.firebase,
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

function aktiveGruppe() {
  return zustand.gruppen.find((g) => g.code === zustand.profil.gruppe) || null;
}

function zeichneRangliste() {
  const gruppe = aktiveGruppe();

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
  if (gruppe) teile.push(`${gruppe.name} · ${reihen.length} ${reihen.length === 1 ? 'Mitspieler' : 'Mitspieler'}`);
  else teile.push('Keine Gruppe aktiv');
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

function zeichneGruppen() {
  const liste = $('#gruppen-liste');
  liste.innerHTML = '';
  $('#gruppen-leer').hidden = zustand.gruppen.length > 0;

  for (const g of zustand.gruppen) {
    const aktiv = g.code === zustand.profil.gruppe;
    const meine = g.ersteller === zustand.profil.id;
    const anzahl = aktiv ? Object.keys(zustand.fremdeTipps).length : null;

    const li = document.createElement('li');
    li.className = 'gruppe' + (aktiv ? ' ist-aktiv' : '');
    li.innerHTML = `
      <div class="gruppe-kopf">
        <span class="gruppe-name">${g.name}</span>
        ${aktiv ? '<span class="gruppe-marke">aktiv</span>' : ''}
      </div>
      <div class="gruppe-meta">
        <span class="gruppe-code">${g.code}</span>
        ${anzahl !== null ? `<span>${anzahl || 1} ${anzahl === 1 ? 'Mitspieler' : 'Mitspieler'}</span>` : ''}
        ${meine ? '<span>von dir gegründet</span>' : ''}
        ${g.offen === false ? '<span>geschlossen</span>' : ''}
      </div>
      <div class="gruppe-aktionen">
        ${aktiv ? '' : '<button type="button" data-tat="wechseln">Aktivieren</button>'}
        <button type="button" data-tat="einladen">Einladen</button>
        ${meine ? `<button type="button" data-tat="sperren">${g.offen === false ? 'Wieder öffnen' : 'Schließen'}</button>` : ''}
        <button type="button" data-tat="verlassen" class="tat-warnung">Verlassen</button>
      </div>`;

    li.addEventListener('click', async (e) => {
      const tat = e.target.closest('[data-tat]')?.dataset.tat;
      if (!tat) return;

      if (tat === 'wechseln') {
        Sync.gruppeWechseln(g.code);
        sichern();
        kopfAktualisieren();
        zeichneGruppen();
        toast(`„${g.name}“ ist aktiv`);
      }

      if (tat === 'einladen') await einladen(g);

      if (tat === 'sperren') {
        try {
          await Sync.gruppeSperren(g.code, g.offen === false);
          zeichneGruppen();
          toast(g.offen === false ? 'Gruppe ist wieder offen' : 'Gruppe nimmt niemanden mehr auf');
        } catch (err) { toast(err.message); }
      }

      if (tat === 'verlassen') {
        if (!confirm(`„${g.name}“ wirklich verlassen? Deine Tipps bleiben erhalten, du tauchst dort aber nicht mehr auf.`)) return;
        await Sync.gruppeVerlassen(g.code);
        sichern();
        kopfAktualisieren();
        zeichneGruppen();
        toast('Gruppe verlassen');
      }
    });

    liste.appendChild(li);
  }
}

async function einladen(g) {
  const link = Sync.einladungsLink(g.code);
  const text = `Tipp mit bei „${g.name}“ – Code ${g.code}\n${link}`;
  if (navigator.share) {
    try { await navigator.share({ title: g.name, text }); return; } catch { /* abgebrochen */ }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Einladung kopiert');
  } catch {
    prompt('Einladung kopieren:', text);
  }
}

function zeichneProfil() {
  $('#in-name').value = zustand.profil.name;
  $('#in-firebase').value = zustand.firebase ? JSON.stringify(zustand.firebase, null, 2) : '';
  $('#fb-status').textContent = Sync.statusText();
  zeichneGruppen();
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
  const g = aktiveGruppe();
  $('#chip-gruppe').textContent = g ? g.name : 'Keine Gruppe';
}

function syncBand(text, fehler = false) {
  const el = $('#sync-band');
  el.hidden = !text;
  el.textContent = text || '';
  el.classList.toggle('ist-fehler', fehler);
}

/* Wird die App über einen Einladungslink geöffnet, direkt beitreten. */
async function einladungPruefen() {
  const code = new URLSearchParams(location.search).get('gruppe');
  if (!code) return;
  history.replaceState(null, '', location.pathname);

  try {
    const daten = await Sync.gruppeBeitreten(code);
    sichern();
    kopfAktualisieren();
    toast(`Du bist jetzt bei „${daten.name}“ dabei`);
  } catch (err) {
    toast(err.message);
    // Ohne Verbindung den Code merken, damit er nach dem Einrichten noch da ist.
    if (!Sync.verbunden()) {
      sessionStorage.setItem('bully.einladung', code.toUpperCase());
      return code.toUpperCase();
    }
  }
  return null;
}

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

  // Reiter
  document.querySelectorAll('.reiter-knopf').forEach((b) =>
    b.addEventListener('click', () => zeige(b.dataset.view)));
  $('#btn-profil').addEventListener('click', () => zeige('profil'));

  // Spieltag blättern
  $('#st-zurueck').addEventListener('click', () => { zustand.spieltag--; zeichneTippen(); });
  $('#st-vor').addEventListener('click', () => { zustand.spieltag++; zeichneTippen(); });

  // Name speichern
  $('#profil-form').addEventListener('submit', (e) => {
    e.preventDefault();
    zustand.profil.name = $('#in-name').value.trim();
    sichern();
    toast('Name gespeichert');
    Sync.mitgliedschaftenSchreiben().catch(() => {});
  });

  // Gruppen
  const umschalten = (welches) => {
    $('#form-gruppe-neu').hidden = welches !== 'neu';
    $('#form-gruppe-beitreten').hidden = welches !== 'beitreten';
    if (welches === 'neu') $('#in-gruppe-name').focus();
    if (welches === 'beitreten') $('#in-gruppe-code').focus();
  };

  $('#btn-gruppe-neu').addEventListener('click', () =>
    umschalten($('#form-gruppe-neu').hidden ? 'neu' : null));
  $('#btn-gruppe-beitreten').addEventListener('click', () =>
    umschalten($('#form-gruppe-beitreten').hidden ? 'beitreten' : null));

  $('#form-gruppe-neu').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#in-gruppe-name').value;
    try {
      const g = await Sync.gruppeAnlegen(name);
      sichern();
      kopfAktualisieren();
      zeichneGruppen();
      umschalten(null);
      $('#in-gruppe-name').value = '';
      toast(`„${g.name}“ angelegt, Code ${g.code}`);
      if (!Sync.verbunden()) {
        toast('Ohne Verbindung bleibt die Gruppe auf diesem Gerät');
      }
    } catch (err) { toast(err.message); }
  });

  $('#form-gruppe-beitreten').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const daten = await Sync.gruppeBeitreten($('#in-gruppe-code').value);
      sichern();
      kopfAktualisieren();
      zeichneGruppen();
      umschalten(null);
      $('#in-gruppe-code').value = '';
      toast(`Willkommen bei „${daten.name}“`);
    } catch (err) {
      toast(err.message);
      if (err instanceof GruppenFehler) { sichern(); kopfAktualisieren(); zeichneGruppen(); }
    }
  });

  // Firebase
  $('#btn-fb-speichern').addEventListener('click', async () => {
    try {
      zustand.firebase = JSON.parse($('#in-firebase').value);
    } catch {
      toast('Die Konfiguration ist kein gültiges JSON');
      return;
    }
    sichern();
    await Sync.neuVerbinden();
    sichern();
    $('#fb-status').textContent = Sync.statusText();

    const gemerkt = sessionStorage.getItem('bully.einladung');
    if (Sync.verbunden() && gemerkt) {
      sessionStorage.removeItem('bully.einladung');
      try {
        const daten = await Sync.gruppeBeitreten(gemerkt);
        sichern();
        toast(`Verbunden und bei „${daten.name}“ dabei`);
      } catch (err) { toast(err.message); }
    } else {
      toast(Sync.verbunden() ? 'Verbunden' : 'Verbindung fehlgeschlagen');
    }

    kopfAktualisieren();
    zeichneGruppen();
  });

  $('#btn-fb-loeschen').addEventListener('click', () => {
    zustand.firebase = null;
    sichern();
    Sync.trennen();
    $('#in-firebase').value = '';
    $('#fb-status').textContent = Sync.statusText();
    syncBand('');
    toast('Verbindung getrennt');
  });

  // Export / Import
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

  // Sync starten
  Sync.init({
    zustand,
    beiAenderung: () => {
      kopfAktualisieren();
      if (zustand.ansicht === 'tabelle') zeichneRangliste();
      if (zustand.ansicht === 'profil') zeichneGruppen();
    },
    beiStatus: syncBand,
  });
  await Sync.neuVerbinden();
  sichern();   // die von Firebase vergebene Teilnehmer-ID festhalten

  const offeneEinladung = await einladungPruefen();

  if (offeneEinladung) {
    zeige('profil');
    $('#in-gruppe-code').value = offeneEinladung;
    $('#form-gruppe-beitreten').hidden = false;
  } else {
    zeige('tippen');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

start();
