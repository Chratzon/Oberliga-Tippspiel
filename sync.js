/* Sync-Schicht für die gemeinsame Rangliste.
   Ohne Firebase-Konfiguration läuft die App vollständig lokal weiter –
   diese Datei meldet dann nur "nicht verbunden" und tut sonst nichts. */

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

let ctx = null;          // { zustand, beiAenderung, beiStatus }
let db = null;
let fs = null;           // Firestore-Modul
let abmelden = null;     // Listener-Abbruch
let status = 'aus';      // aus | verbinde | verbunden | fehler
let fehlerText = '';
let sendeTimer = null;

export const Sync = {

  init(kontext) {
    ctx = kontext;
  },

  verbunden() {
    return status === 'verbunden';
  },

  statusText() {
    switch (status) {
      case 'verbunden': return `Verbunden – Runde „${ctx.zustand.profil.runde}“. Tipps laufen auf allen Geräten zusammen.`;
      case 'verbinde':  return 'Verbindung wird aufgebaut …';
      case 'fehler':    return 'Verbindung fehlgeschlagen: ' + fehlerText;
      default:          return 'Nicht verbunden. Tipps und Rangliste bleiben auf diesem Gerät.';
    }
  },

  async neuVerbinden() {
    this.trennen();
    const cfg = ctx?.zustand.firebase;
    if (!cfg || !cfg.projectId) {
      status = 'aus';
      ctx?.beiStatus('');
      return;
    }

    status = 'verbinde';
    ctx.beiStatus('Rangliste wird synchronisiert …');

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
      // Stabile ID über Geräte hinweg ist die Firebase-UID.
      ctx.zustand.profil.id = a.currentUser.uid;

      db = fs.getFirestore(app);
      await this.eigenesDokumentSchreiben();
      this.zuhoeren();

      status = 'verbunden';
      ctx.beiStatus('');
    } catch (e) {
      status = 'fehler';
      fehlerText = e?.message || String(e);
      console.error(e);
      ctx.beiStatus('Rangliste offline – ' + fehlerText, true);
    }
  },

  zuhoeren() {
    const runde = ctx.zustand.profil.runde || 'standard';
    const sammlung = fs.collection(db, 'runden', runde, 'teilnehmer');
    abmelden = fs.onSnapshot(sammlung, (schnappschuss) => {
      const alle = {};
      schnappschuss.forEach((doc) => { alle[doc.id] = doc.data(); });
      ctx.zustand.fremdeTipps = alle;
      ctx.beiAenderung();
    }, (e) => {
      status = 'fehler';
      fehlerText = e.message;
      ctx.beiStatus('Rangliste offline – ' + e.message, true);
    });
  },

  async eigenesDokumentSchreiben() {
    if (!db) return;
    const { profil, tipps } = ctx.zustand;
    const runde = profil.runde || 'standard';
    const ziel = fs.doc(db, 'runden', runde, 'teilnehmer', profil.id);
    await fs.setDoc(ziel, {
      name: profil.name || 'Unbenannt',
      tipps,
      aktualisiert: new Date().toISOString(),
    });
  },

  /* Wird bei jedem Tipp aufgerufen; gebündelt, damit das Steppen
     am Zähler nicht jedes Mal einen Schreibvorgang auslöst. */
  tippSenden() {
    if (!db || status !== 'verbunden') return;
    clearTimeout(sendeTimer);
    sendeTimer = setTimeout(() => {
      this.eigenesDokumentSchreiben().catch((e) => {
        ctx.beiStatus('Tipp nicht übertragen – ' + e.message, true);
      });
    }, 1200);
  },

  trennen() {
    if (abmelden) { abmelden(); abmelden = null; }
    db = null;
    status = 'aus';
  },
};
