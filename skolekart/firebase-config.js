const firebaseConfig = {
  apiKey: "AIzaSyCXtcC4fUfI3QRV8CzgCC6LaFYlh5zBLRY",
  authDomain: "makerlvgs.firebaseapp.com",
  projectId: "makerlvgs",
  storageBucket: "makerlvgs.firebasestorage.app",
  messagingSenderId: "477687171059",
  appId: "1:477687171059:web:7117b8b9ebd226c580f486",
  measurementId: "G-DFMWQ9TV2G"
};

// Initialiser Firebase
if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
  window.db = firebase.firestore();
} else {
  console.info('Firebase SDK ble ikke lastet.');
  window.db = null;
}
