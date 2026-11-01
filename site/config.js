/*
 * Configuração do painel online (GitHub Pages).
 * Cole aqui o firebaseConfig do projeto novo do Firebase
 * (Console do Firebase > Configurações do projeto > Seus apps > Web).
 * Esses valores não são segredo: quem protege os dados são o login do Google e as regras
 * do Firestore. Enquanto a apiKey começar com "COLE", o painel abre em modo demonstração.
 */
window.ESTUDIO_CONFIG = {
  firebase: {
    apiKey: "COLE_A_API_KEY_AQUI",
    authDomain: "",
    projectId: "",
    appId: "",
  },
  // e-mail que pode entrar (as regras do Firestore conferem de novo no servidor)
  dono: "",
};
