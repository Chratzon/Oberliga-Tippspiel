/* Sync- und Gruppenschicht.
   Ohne Firebase-Konfiguration bleibt alles lokal: Gruppen lassen sich anlegen,
   es sitzt aber niemand sonst darin. */

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

let ctx = null;          // { zustand, beiAenderung, beiStatus }
let db = null;
let fs = null;
let abmelden = [];       // aktive Listener
let status = 'aus';      // aus | verbinde | verbunden | fehler
let fehlerText = '';
let sendeTimer = null;

const ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ohne I, O, 0, 1

function codeErzeugen() {
  const werte = crypto.getRandomValues(new Uint8Array(6));
  return [...werte].map((b) => ZEICHEN[b % ZEICHEN.length]).join('');
}

class GruppenFehler extends Error {}

export const Sync = {

  init(kontext) { ctx = kontext; },

  verbunden() { return status === 'verbunden'; },

  statusText() {
    switch (status) {
      case 'verbunden': return 'Verbunden. Gruppen laufen über alle Geräte zusammen.';
      case 'verbinde':  return 'Verbindung wird aufgebaut …';
      case 'fehler':    return 'Verbindung fehlgeschlagen: ' + fehlerText;
      default:          return 'Nicht verbunden. Gruppen und Tipps bleiben auf diesem Gerät.';
    }
  },

  /* ---------- Verbindung ---------- */

  async neuVerbinden() {
    this.trennen();
    const cfg = ctx?.zustand.firebase;
    if (!cfg || !cfg.projectId) {
      status = 'aus';
      ctx?.beiStatus('');
      ctx?.beiAenderung();
      return;
    }

    status = 'verbinde';
    ctx.beiStatus('Gruppen werden synchronisiert …');

    try {
      const [{ initializeApp, getApps, deleteApp }, auth, firestore] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
      ]);
      fs = firestore;

      getApps().forEach((a) => deleteApp(a).catch(() => {}));
      const app = initializeApp(cfg);

      const a = auth.getAuth(app);
      await auth.signInAnonymously(a);
      ctx.zustand.profil.id = a.currentUser.uid;

      db = fs.getFirestore(app);
      status = 'verbunden';

      await this.mitgliedschaftenSchreiben();
      this.zuhoeren();
      ctx.beiStatus('');
    } catch (e) {
      status = 'fehler';
      fehlerText = e?.message || String(e);
      console.error(e);
      ctx.beiStatus('Gruppen offline – ' + fehlerText, true);
    }
  },

  trennen() {
    abmelden.forEach((f) => { try { f(); } catch {} });
    abmelden = [];
    db = null;
    status = 'aus';
  },

  /* ---------- Gruppen ---------- */

  async gruppeAnlegen(name) {
    const code = codeErzeugen();
    const eintrag = {
      code,
      name: name.trim() || 'Tipprunde',
      ersteller: ctx.zustand.profil.id,
      offen: true,
    };

    if (db && status === 'verbunden') {
      await fs.setDoc(fs.doc(db, 'runden', code), {
        name: eintrag.name,
        ersteller: eintrag.ersteller,
        offen: true,
        erstellt: new Date().toISOString(),
      });
    }

    ctx.zustand.gruppen.push(eintrag);
    ctx.zustand.profil.gruppe = code;
    await this.mitgliedschaftenSchreiben();
    this.zuhoeren();
    return eintrag;
  },

  async gruppeBeitreten(codeRoh) {
    const code = (codeRoh || '').trim().toUpperCase();
    if (!code) throw new GruppenFehler('Bitte einen Code eingeben.');

    if (ctx.zustand.gruppen.some((g) => g.code === code)) {
      ctx.zustand.profil.gruppe = code;
      this.zuhoeren();
      throw new GruppenFehler('In dieser Gruppe bist du schon – sie ist jetzt aktiv.');
    }

    if (!db || status !== 'verbunden') {
      throw new GruppenFehler('Ohne Verbindung geht das nicht. Erst unter „Verbindung einrichten“ verbinden.');
    }

    const schnappschuss = await fs.getDoc(fs.doc(db, 'runden', code));
    if (!schnappschuss.exists()) throw new GruppenFehler('Diesen Code gibt es nicht. Tippfehler?');

    const daten = schnappschuss.data();
    if (daten.offen === false) {
      throw new GruppenFehler(`„${daten.name}“ nimmt keine neuen Mitspieler mehr auf.`);
    }

    ctx.zustand.gruppen.push({ code, name: daten.name, ersteller: daten.ersteller, offen: daten.offen });
    ctx.zustand.profil.gruppe = code;
    await this.mitgliedschaftenSchreiben();
    this.zuhoeren();
    return daten;
  },

  async gruppeVerlassen(code) {
    if (db && status === 'verbunden') {
      await fs.deleteDoc(fs.doc(db, 'runden', code, 'teilnehmer', ctx.zustand.profil.id)).catch(() => {});
    }
    ctx.zustand.gruppen = ctx.zustand.gruppen.filter((g) => g.code !== code);
    if (ctx.zustand.profil.gruppe === code) {
      ctx.zustand.profil.gruppe = ctx.zustand.gruppen[0]?.code || null;
    }
    this.zuhoeren();
  },

  gruppeWechseln(code) {
    ctx.zustand.profil.gruppe = code;
    this.zuhoeren();
  },

  /* Nur der Gründer darf auf- und zusperren, die Firestore-Regeln erzwingen das. */
  async gruppeSperren(code, offen) {
    if (!db || status !== 'verbunden') throw new GruppenFehler('Dafür braucht es eine Verbindung.');
    await fs.updateDoc(fs.doc(db, 'runden', code), { offen });
    const g = ctx.zustand.gruppen.find((x) => x.code === code);
    if (g) g.offen = offen;
  },

  einladungsLink(code) {
    const u = new URL(location.href);
    u.hash = '';
    u.search = '?gruppe=' + code;
    return u.toString();
  },

  /* ---------- Schreiben und Zuhören ---------- */

  /* Die eigenen Tipps landen in jeder Gruppe, in der man Mitglied ist. */
  async mitgliedschaftenSchreiben() {
    if (!db || status !== 'verbunden') return;
    const { profil, tipps, gruppen } = ctx.zustand;
    await Promise.all(gruppen.map((g) =>
      fs.setDoc(fs.doc(db, 'runden', g.code, 'teilnehmer', profil.id), {
        name: profil.name || 'Unbenannt',
        tipps,
        aktualisiert: new Date().toISOString(),
      }).catch((e) => console.warn(`Gruppe ${g.code}: ${e.message}`))
    ));
  },

  zuhoeren() {
    abmelden.forEach((f) => { try { f(); } catch {} });
    abmelden = [];
    ctx.zustand.fremdeTipps = {};

    if (!db || status !== 'verbunden') { ctx.beiAenderung(); return; }

    const code = ctx.zustand.profil.gruppe;
    if (!code) { ctx.beiAenderung(); return; }

    // Mitspieler der aktiven Gruppe
    abmelden.push(fs.onSnapshot(
      fs.collection(db, 'runden', code, 'teilnehmer'),
      (schnappschuss) => {
        const alle = {};
        schnappschuss.forEach((doc) => { alle[doc.id] = doc.data(); });
        ctx.zustand.fremdeTipps = alle;
        ctx.beiAenderung();
      },
      (e) => {
        fehlerText = e.message;
        ctx.beiStatus('Gruppe offline – ' + e.message, true);
      }
    ));

    // Stammdaten der Gruppe: Name, offen oder geschlossen
    abmelden.push(fs.onSnapshot(fs.doc(db, 'runden', code), (doc) => {
      if (!doc.exists()) return;
      const g = ctx.zustand.gruppen.find((x) => x.code === code);
      if (g) Object.assign(g, {
        name: doc.data().name,
        offen: doc.data().offen,
        ersteller: doc.data().ersteller,
      });
      ctx.beiAenderung();
    }, () => {}));
  },

  tippSenden() {
    if (!db || status !== 'verbunden') return;
    clearTimeout(sendeTimer);
    sendeTimer = setTimeout(() => {
      this.mitgliedschaftenSchreiben().catch((e) => {
        ctx.beiStatus('Tipp nicht übertragen – ' + e.message, true);
      });
    }, 1200);
  },
};

export { GruppenFehler };
