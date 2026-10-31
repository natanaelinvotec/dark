"use strict";

const form = document.getElementById("form-login");
const campo = document.getElementById("senha");
const erro = document.getElementById("erro-login");
const botao = document.getElementById("entrar");

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  erro.textContent = "";
  campo.removeAttribute("aria-invalid");
  if (!campo.value) {
    erro.textContent = "Digite a senha.";
    campo.setAttribute("aria-invalid", "true");
    campo.focus();
    return;
  }
  botao.setAttribute("aria-busy", "true");
  botao.textContent = "Entrando…";
  try {
    const resposta = await fetch("/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Estudio": "1" },
      body: JSON.stringify({ senha: campo.value }),
    });
    if (resposta.ok) {
      location.href = "/";
      return;
    }
    erro.textContent = resposta.status === 429
      ? "Muitas tentativas. Espere 15 minutos e tente de novo."
      : "Senha incorreta.";
  } catch {
    erro.textContent = "Sem conexão com o painel. Confira a Tailscale e tente de novo.";
  }
  campo.setAttribute("aria-invalid", "true");
  campo.select();
  botao.removeAttribute("aria-busy");
  botao.textContent = "Entrar";
});
