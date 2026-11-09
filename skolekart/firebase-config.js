// Erstatt verdiene under med dine egne prosjektdetaljer fra Firebase Console:
// Prosjektinnstillinger -> Generelt -> «Dine apper» -> Webapp (</>)
const firebaseConfig = {
  apiKey: "AIzaSyCXtcC4fUfI3QRV8CzgCC6LaFYlh5zBLRY",
  authDomain: "makerlvgs.firebaseapp.com",
  projectId: "makerlvgs",
  storageBucket: "makerlvgs.firebasestorage.app",
  messagingSenderId: "477687171059",
  appId: "1:477687171059:web:7117b8b9ebd226c580f486",
  measurementId: "G-DFMWQ9TV2G"
};

// Initialiser Firebase dersom konfigurasjonen er fylt ut
if (typeof firebase !== 'undefined' && firebaseConfig.apiKey !== 'AIzaSyCXtcC4fUfI3QRV8CzgCC6LaFYlh5zBLRY') {
  firebase.initializeApp(firebaseConfig);
  window.db = firebase.firestore();
} else {
  console.info('Firebase er ikke konfigurert ennå. Kartet kjører midlertidig med lokal lagring.');
  window.db = null;
}
