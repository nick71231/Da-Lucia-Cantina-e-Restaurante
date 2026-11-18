// Janela de confirmação desenhada pela própria página.
// Dentro dos aplicativos Android (balança, totem, garçom) o confirm()/alert() do navegador NÃO aparece:
// o confirm() responde "não" sozinho e o botão parece não fazer nada. Por isso as telas usam:
//   if (!(await confirmar("Apagar?"))) return;     avisar("Mensagem");
(function () {
  function abrir(msg, comCancelar, txtSim) {
    return new Promise((ok) => {
      const fundo = document.createElement("div");
      fundo.style.cssText = "position:fixed;inset:0;background:#2a1410aa;z-index:100000;display:grid;place-items:center;padding:16px";
      const caixa = document.createElement("div");
      caixa.style.cssText = "background:#fff;color:#2a1410;border-radius:16px;padding:22px;width:min(460px,100%);font:18px system-ui;box-shadow:0 10px 40px #0005";
      const p = document.createElement("div");
      p.style.cssText = "white-space:pre-line;line-height:1.4;margin-bottom:20px;font-weight:600";
      p.textContent = msg;
      const linha = document.createElement("div");
      linha.style.cssText = "display:flex;gap:10px";
      const botao = (txt, fundoCor, cor, valor) => {
        const b = document.createElement("button"); b.type = "button"; b.textContent = txt;
        b.style.cssText = `flex:1;border:0;border-radius:12px;padding:16px;font:700 18px system-ui;background:${fundoCor};color:${cor};cursor:pointer`;
        b.onclick = (e) => { e.stopPropagation(); fundo.remove(); document.removeEventListener("keydown", tecla, true); ok(valor); };
        return b;
      };
      if (comCancelar) linha.appendChild(botao("Não", "#f3e8d8", "#2a1410", false));
      const sim = botao(txtSim || (comCancelar ? "Sim" : "OK"), "#a30d12", "#fff", true);
      linha.appendChild(sim);
      const tecla = (e) => {
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); sim.click(); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); fundo.remove(); document.removeEventListener("keydown", tecla, true); ok(!comCancelar); }
      };
      document.addEventListener("keydown", tecla, true);
      fundo.addEventListener("click", (e) => e.stopPropagation()); // toque fora não aciona a tela de trás
      caixa.append(p, linha); fundo.appendChild(caixa); document.body.appendChild(fundo);
    });
  }
  window.confirmar = (msg, txtSim) => abrir(String(msg), true, txtSim);
  window.avisar = (msg) => abrir(String(msg), false);
})();
