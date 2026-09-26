/* Verbindung, Konto und Räume.
 *
 * Die Verbindung kommt aus konfig.js und wird beim Start von selbst
 * aufgebaut. Der Nutzer richtet nichts ein – er wählt nur, ob er anonym
 * bleibt oder sich mit Google anmeldet.
 *
 * Räume: Der Name ist die Adresse, das Passwort der Schlüssel. Geprüft wird
 * serverseitig – die App schickt beim Beitritt einen Hash mit, und die
 * Firestore-Regel vergleicht ihn mit dem hinterlegten. Das Passwort selbst
 * verlässt das Gerät nie, und der hinterlegte Hash ist für niemanden lesbar.
 */

const CDN = 'https://www.gstatic.com/firebasejs/10.12.2';

let ctx = null;
let db = null;
let fs = null;
let authM = null;
let authObj = null;
let abmelden = [];
let status = 'aus';          // aus | verbinde | verbunden | fehler
let fehlerText = '';
let sendeTimer = null;
let eigeneAenderung = false;   // am Gerät getippt, noch nicht übertragen

class RaumFehler extends Error {}

function istAbbruch(e) {
  return ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(e?.code);
}

/* Manche Browser und installierte PWAs lassen kein Anmeldefenster zu.
   Dann weicht die App auf die Weiterleitung aus. */
function istPopupProblem(e) {
  return ['auth/popup-blocked', 'auth/popup-closed-by-user',
          'auth/operation-not-supported-in-this-environment'].includes(e?.code);
}

/* Als installierte App läuft die Anmeldung grundsätzlich über eine
   Weiterleitung – Popups werden dort zuverlässig blockiert. */
function ohneFenster() {
  return window.matchMedia('(display-mode: standalone)').matches
    || navigator.standalone === true;
}

/* Aus „Eishalle Rosenheim“ wird „eishalle-rosenheim“. */
export function raumSchluessel(name) {
  return (name || '').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/* Der Nachweis ist ein Hash aus Raumname und Passwort. Der Raumname geht mit
   ein, damit dasselbe Passwort in zwei Räumen nicht denselben Wert ergibt. */
async function nachweisBilden(raumId, passwort) {
  const roh = new TextEncoder().encode(`bully:${raumId}:${passwort}`);
  const puffer = await crypto.subtle.digest('SHA-256', roh);
  return [...new Uint8Array(puffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const Sync = {

  init(kontext) { ctx = kontext; },

  verbunden() { return status === 'verbunden'; },

  statusText() {
    switch (status) {
      case 'verbunden': return 'Verbunden.';
      case 'verbinde':  return 'Verbindung wird aufgebaut …';
      case 'fehler':    return 'Verbindung fehlgeschlagen: ' + fehlerText;
      default:          return 'Nicht verbunden.';
    }
  },

  /* ---------- Verbindung ---------- */

  async verbinden() {
    this.abbauen();
    const cfg = ctx?.konfiguration;
    if (!cfg || !cfg.projectId) {
      status = 'aus';
      ctx?.beiStatus('Nicht eingerichtet – Tipps bleiben auf diesem Gerät.', true);
      return;
    }

    status = 'verbinde';
    ctx.beiStatus('Verbindung wird aufgebaut …');

    try {
      const [{ initializeApp, getApps, deleteApp }, auth, firestore] = await Promise.all([
        import(`${CDN}/firebase-app.js`),
        import(`${CDN}/firebase-auth.js`),
        import(`${CDN}/firebase-firestore.js`),
      ]);
      fs = firestore;
      authM = auth;

      getApps().forEach((a) => deleteApp(a).catch(() => {}));
      const app = initializeApp(cfg);
      authObj = auth.getAuth(app);
      db = fs.getFirestore(app);

      // Rückkehr von einer Google-Weiterleitung: dann keine neue anonyme Kennung.
      let rueckkehr = null;
      try {
        rueckkehr = await auth.getRedirectResult(authObj);
      } catch (e) {
        // Das Konto gehört schon zu einem Profil: damit anmelden statt verknüpfen.
        if (['auth/credential-already-in-use', 'auth/email-already-in-use'].includes(e.code)) {
          const zugang = auth.GoogleAuthProvider.credentialFromError(e);
          if (zugang) rueckkehr = await auth.signInWithCredential(authObj, zugang);
        } else {
          console.warn('Weiterleitung: ' + e.message);
        }
      }
      if (!authObj.currentUser) await auth.signInAnonymously(authObj);

      ctx.zustand.profil.id = authObj.currentUser.uid;
      ctx.zustand.konto = this.kontoInfo();
      status = 'verbunden';

      if (rueckkehr && rueckkehr.user) await this.wiederherstellen();

      // Nichts hochschreiben: Beim Verbinden gilt der Stand aus der Datenbank.
      // Geschrieben wird nur, was auf diesem Gerät geändert wurde.
      this.zuhoeren();
      ctx.beiStatus('');
    } catch (e) {
      status = 'fehler';
      fehlerText = e?.message || String(e);
      console.error(e);
      ctx.beiStatus('Offline – ' + fehlerText, true);
    }
  },

  abbauen() {
    abmelden.forEach((f) => { try { f(); } catch {} });
    abmelden = [];
    db = null;
    status = 'aus';
  },

  /* ---------- Konto ---------- */

  kontoInfo() {
    const u = authObj?.currentUser;
    if (!u) return { angemeldet: false, anonym: true, name: '', email: '' };
    return { angemeldet: true, anonym: u.isAnonymous, name: u.displayName || '', email: u.email || '' };
  },

  /* Ein Knopf für beide Fälle: Erst versuchen, das Google-Konto an die
     bestehende Kennung zu hängen. Gehört es schon zu einem Profil, wird
     stattdessen angemeldet und der frühere Stand zurückgeholt. */
  async googleWaehlen() {
    if (!authObj || status !== 'verbunden') throw new RaumFehler('Keine Verbindung.');
    const anbieter = new authM.GoogleAuthProvider();

    if (ohneFenster()) {
      await authM.linkWithRedirect(authObj.currentUser, anbieter);
      return null;                      // die Seite lädt neu
    }

    try {
      await authM.linkWithPopup(authObj.currentUser, anbieter);
      ctx.zustand.konto = this.kontoInfo();
      await this.nutzerAkteSchreiben();
      return { konto: ctx.zustand.konto, zurueckgeholt: null };
    } catch (e) {
      if (istAbbruch(e)) throw new RaumFehler('Abgebrochen.');

      if (istPopupProblem(e)) {
        await authM.linkWithRedirect(authObj.currentUser, anbieter);
        return null;
      }

      const schonVergeben = ['auth/credential-already-in-use', 'auth/email-already-in-use']
        .includes(e.code);
      if (!schonVergeben) throw new RaumFehler(e.message);
    }

    // Das Konto gibt es schon: anmelden statt verknüpfen.
    try {
      await authM.signInWithPopup(authObj, anbieter);
    } catch (e) {
      if (istAbbruch(e)) throw new RaumFehler('Abgebrochen.');
      if (istPopupProblem(e)) {
        await authM.signInWithRedirect(authObj, anbieter);
        return null;
      }
      throw new RaumFehler(e.message);
    }

    ctx.zustand.profil.id = authObj.currentUser.uid;
    ctx.zustand.konto = this.kontoInfo();
    const zurueckgeholt = await this.wiederherstellen();
    await this.mitgliedschaftenSchreiben();
    this.zuhoeren();
    return { konto: ctx.zustand.konto, zurueckgeholt };
  },

  async googleAbmelden() {
    if (!authObj) return;
    await authM.signOut(authObj);
    ctx.zustand.raeume = [];
    ctx.zustand.profil.raum = null;
    ctx.zustand.konto = { angemeldet: false, anonym: true, name: '', email: '' };
    this.abbauen();
    await this.verbinden();
  },

  /* ---------- Räume ---------- */

  async raumErstellen(nameRoh, passwort) {
    const name = (nameRoh || '').trim();
    const id = raumSchluessel(name);
    if (id.length < 3) throw new RaumFehler('Der Raumname braucht mindestens drei Zeichen.');
    if ((passwort || '').length < 4) throw new RaumFehler('Das Passwort braucht mindestens vier Zeichen.');
    if (!db || status !== 'verbunden') throw new RaumFehler('Keine Verbindung.');
    if (ctx.zustand.raeume.some((r) => r.id === id)) throw new RaumFehler('In diesem Raum bist du schon.');

    const nachweis = await nachweisBilden(id, passwort);

    try {
      await fs.setDoc(fs.doc(db, 'raeume', id), {
        name,
        passwortHash: nachweis,
        ersteller: ctx.zustand.profil.id,
        erstellt: new Date().toISOString(),
      });
    } catch (e) {
      if (e.code === 'permission-denied') {
        throw new RaumFehler(`Den Raum „${name}“ gibt es schon. Tritt ihm bei oder nimm einen anderen Namen.`);
      }
      throw new RaumFehler(e.message);
    }

    const eintrag = { id, name, nachweis, ersteller: ctx.zustand.profil.id };
    ctx.zustand.raeume.push(eintrag);
    ctx.zustand.profil.raum = id;
    await this.mitgliedschaftenSchreiben();
    this.zuhoeren();
    return eintrag;
  },

  async raumBeitreten(nameRoh, passwort) {
    const id = raumSchluessel(nameRoh);
    if (!id) throw new RaumFehler('Bitte einen Raumnamen eingeben.');
    if (!db || status !== 'verbunden') throw new RaumFehler('Keine Verbindung.');

    if (ctx.zustand.raeume.some((r) => r.id === id)) {
      ctx.zustand.profil.raum = id;
      this.zuhoeren();
      throw new RaumFehler('In diesem Raum bist du schon – er ist jetzt aktiv.');
    }

    const nachweis = await nachweisBilden(id, passwort || '');

    try {
      await fs.setDoc(fs.doc(db, 'raeume', id, 'teilnehmer', ctx.zustand.profil.id), {
        name: ctx.zustand.profil.name || 'Unbenannt',
        tipps: ctx.zustand.tipps,
        nachweis,
        aktualisiert: new Date().toISOString(),
      });
    } catch (e) {
      if (e.code === 'permission-denied') {
        throw new RaumFehler('Raumname oder Passwort stimmt nicht.');
      }
      throw new RaumFehler(e.message);
    }

    // Ab jetzt sind wir Mitglied und dürfen die Stammdaten lesen.
    const stamm = await fs.getDoc(fs.doc(db, 'raeume', id)).catch(() => null);
    const eintrag = {
      id,
      name: stamm?.data()?.name || nameRoh.trim(),
      nachweis,
      ersteller: stamm?.data()?.ersteller || null,
    };

    ctx.zustand.raeume.push(eintrag);
    ctx.zustand.profil.raum = id;
    await this.nutzerAkteSchreiben();
    this.zuhoeren();
    return eintrag;
  },

  async raumVerlassen(id) {
    if (db && status === 'verbunden') {
      await fs.deleteDoc(fs.doc(db, 'raeume', id, 'teilnehmer', ctx.zustand.profil.id)).catch(() => {});
    }
    ctx.zustand.raeume = ctx.zustand.raeume.filter((r) => r.id !== id);
    if (ctx.zustand.profil.raum === id) {
      ctx.zustand.profil.raum = ctx.zustand.raeume[0]?.id || null;
    }
    await this.nutzerAkteSchreiben();
    this.zuhoeren();
  },

  raumWechseln(id) {
    ctx.zustand.profil.raum = id;
    this.zuhoeren();
  },

  einladungsLink(id) {
    const u = new URL(location.href);
    u.hash = '';
    u.search = '?raum=' + encodeURIComponent(id);
    return u.toString();
  },

  /* ---------- Abgleich ---------- */

  /* Wurde der eigene Eintrag anderswo geändert – auf einem zweiten Gerät
     oder von Hand in der Firebase-Konsole –, gilt dieser Stand. */
  entferntenStandUebernehmen(eigen) {
    const entfernt = eigen.tipps || {};
    const hierher = JSON.stringify(entfernt) !== JSON.stringify(ctx.zustand.tipps);
    const nameAnders = eigen.name && eigen.name !== ctx.zustand.profil.name;
    if (!hierher && !nameAnders) return;

    ctx.zustand.tipps = entfernt;
    if (nameAnders) ctx.zustand.profil.name = eigen.name;
    ctx.beiUebernahme?.(hierher);
  },

  async raumEintragSchreiben(raumId) {
    if (!db || status !== 'verbunden') return;
    const { profil, tipps, raeume } = ctx.zustand;
    const raum = raeume.find((r) => r.id === raumId);
    if (!raum) return;
    await fs.setDoc(fs.doc(db, 'raeume', raumId, 'teilnehmer', profil.id), {
      name: profil.name || 'Unbenannt',
      tipps,
      nachweis: raum.nachweis,
      aktualisiert: new Date().toISOString(),
    });
  },

  /* ---------- Schreiben und Zuhören ---------- */

  async mitgliedschaftenSchreiben() {
    if (!db || status !== 'verbunden') return;
    const { profil, tipps, raeume } = ctx.zustand;
    await Promise.all(raeume.map((r) =>
      fs.setDoc(fs.doc(db, 'raeume', r.id, 'teilnehmer', profil.id), {
        name: profil.name || 'Unbenannt',
        tipps,
        nachweis: r.nachweis,
        aktualisiert: new Date().toISOString(),
      }).catch((e) => console.warn(`Raum ${r.id}: ${e.message}`))
    ));
    await this.nutzerAkteSchreiben();
  },

  /* Private Akte – nur zum Zurückholen auf einem anderen Gerät. */
  async nutzerAkteSchreiben() {
    if (!db || status !== 'verbunden') return;
    const { profil, tipps, raeume } = ctx.zustand;
    await fs.setDoc(fs.doc(db, 'nutzer', profil.id), {
      name: profil.name || '',
      raeume,
      tipps,
      aktualisiert: new Date().toISOString(),
    }).catch((e) => console.warn('Nutzerakte: ' + e.message));
  },

  /* Was auf diesem Gerät schon getippt wurde, hat Vorrang. */
  async wiederherstellen() {
    if (!db) return null;
    const schnappschuss = await fs.getDoc(fs.doc(db, 'nutzer', ctx.zustand.profil.id)).catch(() => null);
    if (!schnappschuss || !schnappschuss.exists()) return null;

    const d = schnappschuss.data();
    ctx.zustand.tipps = { ...(d.tipps || {}), ...ctx.zustand.tipps };

    const vorhanden = new Set(ctx.zustand.raeume.map((r) => r.id));
    for (const r of (d.raeume || [])) {
      if (!vorhanden.has(r.id)) ctx.zustand.raeume.push(r);
    }
    if (!ctx.zustand.profil.name && d.name) ctx.zustand.profil.name = d.name;
    if (!ctx.zustand.profil.raum) ctx.zustand.profil.raum = ctx.zustand.raeume[0]?.id || null;

    return { raeume: (d.raeume || []).length, tipps: Object.keys(d.tipps || {}).length };
  },

  zuhoeren() {
    abmelden.forEach((f) => { try { f(); } catch {} });
    abmelden = [];
    ctx.zustand.fremdeTipps = {};

    if (!db || status !== 'verbunden') { ctx.beiAenderung(); return; }

    const id = ctx.zustand.profil.raum;
    if (!id) { ctx.beiAenderung(); return; }

    abmelden.push(fs.onSnapshot(
      fs.collection(db, 'raeume', id, 'teilnehmer'),
      (schnappschuss) => {
        const alle = {};
        schnappschuss.forEach((doc) => { alle[doc.id] = doc.data(); });
        ctx.zustand.fremdeTipps = alle;

        const eigen = alle[ctx.zustand.profil.id];
        if (!eigen) {
          // Erster Besuch dieses Raums auf diesem Gerät: Eintrag anlegen.
          this.raumEintragSchreiben(code).catch((e) => console.warn(e.message));
        } else if (!eigeneAenderung) {
          this.entferntenStandUebernehmen(eigen);
        }

        ctx.beiAenderung();
      },
      (e) => {
        fehlerText = e.message;
        ctx.beiStatus('Raum offline – ' + e.message, true);
      }
    ));

    abmelden.push(fs.onSnapshot(fs.doc(db, 'raeume', id), (doc) => {
      if (!doc.exists()) return;
      const r = ctx.zustand.raeume.find((x) => x.id === id);
      if (r) { r.name = doc.data().name; r.ersteller = doc.data().ersteller; }
      ctx.beiAenderung();
    }, () => {}));
  },

  /* Änderung am Gerät sofort übertragen (Name, Raumbeitritt). */
  async aenderungSenden() {
    eigeneAenderung = true;
    try { await this.mitgliedschaftenSchreiben(); }
    finally { eigeneAenderung = false; }
  },

  /* Wird bei jeder Änderung am Gerät aufgerufen. Bis sie übertragen ist,
     überschreibt kein Stand aus der Datenbank die lokale Fassung. */
  tippSenden() {
    eigeneAenderung = true;
    if (!db || status !== 'verbunden') return;
    clearTimeout(sendeTimer);
    sendeTimer = setTimeout(() => {
      this.mitgliedschaftenSchreiben()
        .then(() => { eigeneAenderung = false; })
        .catch((e) => {
          eigeneAenderung = false;
          ctx.beiStatus('Tipp nicht übertragen – ' + e.message, true);
        });
    }, 1200);
  },
};

export { RaumFehler };
