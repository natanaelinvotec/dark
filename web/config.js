/*
 * Configuração do painel no Firebase.
 * Cole aqui o firebaseConfig do projeto (Console do Firebase > Configurações do projeto >
 * Seus apps > Web). Esses valores não são segredo: quem protege os dados é o login do Google
 * e as regras do Firestore (firestore.rules).
 * Enquanto a apiKey começar com "COLE", o painel abre em modo demonstração (dados de exemplo
 * só no navegador).
 */
window.ESTUDIO_CONFIG = {
  firebase: {
    apiKey: "AIzaSyByaphjlHmAWSpheH-JeamkJk-0vynJdEA",
    authDomain: "estudio-canais.firebaseapp.com",
    projectId: "estudio-canais",
    storageBucket: "estudio-canais.firebasestorage.app",
    messagingSenderId: "683350225761",
    appId: "1:683350225761:web:2a6b551784d196f6a54b20",
  },
  // e-mail que pode entrar (precisa ser o mesmo de firestore.rules)
  dono: "natanael.invotec@gmail.com",
  // true quando a pasta functions/ (produção automática) estiver publicada
  funcoes: false,
};
