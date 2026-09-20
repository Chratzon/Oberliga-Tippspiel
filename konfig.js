/* Feste Verbindungsdaten für diese Installation.
 *
 * Trägst du hier deine Firebase-Konfiguration ein, verbindet sich die App
 * beim Start von selbst. Deine Mitspieler müssen dann gar nichts einrichten:
 * Einladungslink antippen, Namen eingeben, tippen.
 *
 * Die Werte sind keine Geheimnisse – sie stehen in jeder Firebase-Web-App
 * im Quelltext. Der Schutz kommt aus den Firestore-Regeln (siehe README).
 *
 * Bleibt der Wert null, fragt die App wie bisher im Profil danach.
 */

export const FIREBASE_KONFIG ={
  apiKey: "AIzaSyDa-dNmekolZJIbuBGzoutASa50Gli8vy0",
  authDomain: "tippspiel-oberliga.firebaseapp.com",
  projectId: "tippspiel-oberliga",
  storageBucket: "tippspiel-oberliga.firebasestorage.app",
  messagingSenderId: "533994067",
  appId: "1:533994067:web:b663efb28c8a97f38244a6"
};

/* So sieht es ausgefüllt aus – Block ersetzen und die Zeile oben löschen:

export const FIREBASE_KONFIG = {
  apiKey: "AIzaSy…",
  authDomain: "bully-tippspiel.firebaseapp.com",
  projectId: "bully-tippspiel",
  storageBucket: "bully-tippspiel.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456"
};

Hier darf es JavaScript-Schreibweise sein, also ohne Anführungszeichen um
die Namen – genau so, wie Firebase den Block anzeigt.
*/
