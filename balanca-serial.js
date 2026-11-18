// Leitura da BALANÇA pelo cabo (só funciona dentro do app Android "Balança Da Lúcia", que lê o USB-serial e manda os bytes pra cá).
// No navegador comum este arquivo não faz nada.
// Protocolo: a UPX Wind D3 em modo "sob demanda" responde quando recebe um pedido. Como o formato exato não é público,
// a leitura é tolerante: entende o padrão Toledo (STX + 5/6 dígitos + ETX, peso em kg com 3 casas) e também textos com
// números ("PESO 0,456 kg  R$ 12,34"). A janela "Diagnóstico" (toque no selo da balança) mostra o que chegou cru.
(function () {
  const N = window.BalancaNativa; if (!N) return;
  const CFG_PADRAO = { baud: 9600, bits: 8, par: "N", stop: 1, pedido: "05", intervalo: 400, usar: "auto" }; // pedido "05" = ENQ
  const ler = () => { try { return { ...CFG_PADRAO, ...JSON.parse(localStorage.getItem("balSerial") || "{}") }; } catch (e) { return { ...CFG_PADRAO }; } };
  const salvar = (c) => { try { localStorage.setItem("balSerial", JSON.stringify(c)); } catch (e) {} };
  let C = ler(), est = { estado: "desconectada", detalhe: "" }, buf = [], log = [], ultimo = null, iguais = 0, trava = false, preenchi = null, tPed = 0, ultChegou = 0;

  // ---------- selo no topo ----------
  const selo = document.createElement("button");
  selo.id = "selo-bal"; selo.type = "button";
  selo.style.cssText = "border:0;border-radius:999px;padding:7px 14px;font:600 .85rem system-ui;cursor:pointer;margin-left:8px;white-space:nowrap";
  let pintado = "";
  const pinta = () => { // só mexe na tela quando o selo muda (mexer a cada leitura deixava o tablet lento)
    const ok = est.estado === "conectada", vivo = ok && Date.now() - ultChegou < 3000;
    const txt = ok ? (vivo ? "⚖ Balança " + (ultimo && ultimo.peso != null ? fmtKg(ultimo.peso) : "ok") : "⚖ Balança sem resposta") : est.estado === "sempermissao" ? "⚖ Permitir o cabo" : "⚖ Balança desligada";
    const cor = vivo ? "v" : ok ? "o" : "x"; if (txt + cor === pintado) return; pintado = txt + cor;
    selo.textContent = txt;
    selo.style.background = vivo ? "#e1f2e6" : ok ? "#fff0d6" : "#ffe1e1"; selo.style.color = vivo ? "#1e7e3e" : ok ? "#a35b00" : "#a50f14";
  };
  const fmtKg = (kg) => kg.toFixed(3).replace(".", ",") + " kg";
  const poe = () => { const h = document.querySelector("header"); if (h && !document.getElementById("selo-bal")) h.appendChild(selo); pinta(); };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", poe) : poe();
  selo.onclick = abrirDiag;

  // ---------- bytes que chegam ----------
  window.balancaEvento = (tipo, d) => {
    if (tipo === "estado") { est = d; pinta(); if (diagAberto) desenharDiag(); return; }
    if (tipo !== "dados") return;
    ultChegou = Date.now();
    for (let i = 0; i + 1 < d.hex.length; i += 2) buf.push(parseInt(d.hex.substr(i, 2), 16));
    if (buf.length > 512) buf = buf.slice(-256);
    if (!tQuadros) tQuadros = setTimeout(() => { tQuadros = 0; quadros(); }, 120); // junta os pedacinhos: processa no máximo ~8x por segundo
  };
  let tQuadros = 0;
  // separa em mensagens: termina em ETX (03), CR (0d) ou LF (0a)
  function quadros() {
    let k;
    while ((k = buf.findIndex((b) => b === 0x03 || b === 0x0d || b === 0x0a)) >= 0) {
      const q = buf.slice(0, k + 1); buf = buf.slice(k + 1);
      const txt = q.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "")).join("").trim();
      if (!txt) continue;
      const r = entender(q, txt);
      log.unshift({ t: new Date().toLocaleTimeString("pt-BR"), hex: q.map((b) => b.toString(16).padStart(2, "0")).join(" "), txt, r }); log = log.slice(0, 30);
      if (r) aplicar(r);
      if (diagAberto) desenharDiag();
    }
    pinta();
  }
  // devolve { peso (kg), total (R$)? } ou null
  function entender(q, txt) {
    const instavel = /[?]|I{2,}|instav|moviment/i.test(txt) || q.includes(0x3f);
    // Toledo: só dígitos (5 ou 6) = peso com 3 casas decimais
    if (/^\d{5,6}$/.test(txt)) return { peso: parseInt(txt, 10) / 1000, instavel };
    if (/^[NSIs]{1,2}\d{5,6}$/.test(txt.replace(/\s/g, ""))) return { peso: parseInt(txt.replace(/\D/g, ""), 10) / 1000, instavel: instavel || /^I/.test(txt) };
    if (/^-+$|^S{3,}$/.test(txt)) return { peso: 0, instavel: true }; // traços/sobrecarga
    const nums = (txt.match(/-?\d+[.,]\d+|\d+/g) || []).map((x) => Number(x.replace(",", ".")));
    if (!nums.length) return null;
    if (C.usar === "total" && nums.length >= 1) return { peso: null, total: nums[nums.length - 1], instavel };
    // Toledo com preço/total (ex.: " 00406     0      0      0"): só números inteiros, o 1º com 5/6 dígitos = peso em gramas
    const partes = txt.split(/\s+/);
    if (partes.every((x) => /^\d+$/.test(x)) && /^\d{5,6}$/.test(partes[0])) return { peso: parseInt(partes[0], 10) / 1000, instavel };
    if (nums.length >= 3) return { peso: nums[0], total: nums[2], instavel }; // computadora: peso, preço/kg, total
    return { peso: nums[0] > 50 ? nums[0] / 1000 : nums[0], instavel }; // número grande sem vírgula = gramas
  }
  // põe o peso/valor na tela da balança quando o prato está parado
  function aplicar(r) {
    const kg = r.peso, igual = ultimo && ultimo.peso === kg && ultimo.total === r.total;
    iguais = igual ? iguais + 1 : 0; ultimo = r;
    if (kg != null && kg < 0.005) { trava = false; preenchi = null; return; } // prato saiu da balança: libera a próxima
    if (r.instavel || iguais < 2) return; // espera parar (3 leituras iguais)
    if (typeof ultTecla !== "undefined" && Date.now() - ultTecla < 4000) return; // a pessoa está digitando: não mexe na tela agora
    if (cents && !(preenchi && preenchi.c === cents)) return; // valor digitado na mão: a balança não passa por cima
    // lançou e limpou a tela com o mesmo prato ainda em cima: não preenche de novo até tirar o prato
    if (preenchi && cents === "" && peso === "") { trava = true; preenchi = null; }
    if (trava) return;
    const g = kg != null ? String(Math.round(kg * 1000)) : "", c = r.total > 0 ? String(Math.round(r.total * 100)) : "";
    if (preenchi && preenchi.g === g && preenchi.c === c) return;
    let mudou = false;
    if (g && cfg().usarPeso) { peso = g; mudou = true; }
    if (c) { cents = c; mudou = true; } else if (g && cfg().precoKg > 0 && !cfg().usarPeso) { cents = String(Math.round(kg * cfg().precoKg * 100)); mudou = true; }
    if (!mudou) return; // sem preço/kg e sem campo de peso: não tem o que pôr na tela
    preenchi = { g, c };
    if (campo === "comanda" && !comanda) { /* deixa a pessoa digitar a comanda; o valor já está pronto */ }
    tela();
  }
  // pede o peso de tempos em tempos (modo sob demanda)
  // (se a balança não responde há 10 s, pede só a cada 3 s: cada pedido trava a página um instante dentro do app)
  setInterval(() => { const calada = Date.now() - ultChegou > 10000, iv = calada ? 3000 : C.intervalo; if (est.estado === "conectada" && C.pedido && Date.now() - tPed >= iv) { tPed = Date.now(); N.enviar(C.pedido); } }, 250);
  setInterval(pinta, 1000);
  try { est = JSON.parse(N.estado()); } catch (e) {}
  if (est.estado !== "conectada") { if (C.baud !== 9600 || C.par !== "N" || C.bits !== 8 || C.stop !== 1) N.configurar(C.baud, C.bits, C.par, C.stop); else N.conectar(); }

  // ---------- diagnóstico ----------
  let diagAberto = false, fundo = null;
  function abrirDiag() {
    if (est.estado !== "conectada") N.conectar();
    fundo = document.createElement("div");
    fundo.style.cssText = "position:fixed;inset:0;background:#2a141099;z-index:9999;display:grid;place-items:center;padding:16px";
    fundo.onclick = (e) => { if (e.target === fundo) fechar(); };
    document.body.appendChild(fundo); diagAberto = true; desenharDiag();
  }
  function fechar() { diagAberto = false; if (fundo) fundo.remove(); fundo = null; }
  function desenharDiag() {
    if (!fundo) return;
    const op = (v, l, at) => `<option value="${v}" ${String(at) === String(v) ? "selected" : ""}>${l}</option>`;
    fundo.innerHTML = `<div style="background:#fff;color:#2a1410;border-radius:14px;padding:16px;width:min(640px,100%);max-height:90vh;overflow:auto;font:15px system-ui">
      <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:18px">Balança · diagnóstico</b><button id="bd-x" style="border:0;background:#f3e8d8;border-radius:8px;padding:8px 14px;font-weight:700">Fechar</button></div>
      <p style="margin:8px 0">Cabo: <b>${est.estado}</b> ${est.detalhe ? "· " + est.detalhe : ""}<br>Última leitura: <b>${ultimo ? (ultimo.peso != null ? fmtKg(ultimo.peso) : "") + (ultimo.total ? " · R$ " + ultimo.total.toFixed(2).replace(".", ",") : "") + (ultimo.instavel ? " (mexendo)" : "") : "nada ainda"}</b></p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">
        <label>Velocidade<select id="bd-baud" style="width:100%;padding:8px">${[2400, 4800, 9600, 19200, 38400].map((b) => op(b, b, C.baud)).join("")}</select></label>
        <label>Formato<select id="bd-fmt" style="width:100%;padding:8px">${[["8N1", "8N1"], ["7E1", "7E1"], ["8E1", "8E1"], ["7O1", "7O1"]].map(([v, l]) => op(v, l, C.bits + C.par + C.stop)).join("")}</select></label>
        <label>Pedido<select id="bd-ped" style="width:100%;padding:8px">${[["05", "ENQ (Toledo)"], ["50", "P"], ["0d", "Enter"], ["", "Nenhum (contínuo)"]].map(([v, l]) => op(v, l, C.pedido)).join("")}</select></label>
        <label>Usar<select id="bd-usar" style="width:100%;padding:8px">${[["auto", "Automático"], ["total", "Só o valor R$"]].map(([v, l]) => op(v, l, C.usar)).join("")}</select></label>
      </div>
      <div style="display:flex;gap:8px;margin:10px 0"><button id="bd-pedir" style="flex:1;border:0;background:#a30d12;color:#fff;border-radius:8px;padding:10px;font-weight:700">Pedir peso agora</button><button id="bd-recon" style="flex:1;border:0;background:#f3e8d8;border-radius:8px;padding:10px;font-weight:700">Reconectar</button></div>
      <div style="font:12px ui-monospace,monospace;background:#f7f1e8;border-radius:8px;padding:8px;max-height:40vh;overflow:auto">${log.length ? log.map((l) => `<div style="border-bottom:1px solid #e6d9c7;padding:4px 0">${l.t} <b>${l.txt.replace(/[<>&]/g, "")}</b> → ${l.r ? (l.r.peso != null ? fmtKg(l.r.peso) : "") + (l.r.total ? " R$" + l.r.total : "") : "?"}<br><span style="color:#857066">${l.hex}</span></div>`).join("") : "Nada chegou da balança ainda."}</div>
      <p style="font-size:12px;color:#857066;margin:8px 0 0">Servidor: ${location.host} · IP do tablet: ${N.ip()} · <a href="#" id="bd-serv">trocar servidor</a></p></div>`;
    const novo = () => { const f = fundo.querySelector("#bd-fmt").value; C = { ...C, baud: +fundo.querySelector("#bd-baud").value, bits: +f[0], par: f[1], stop: +f[2], pedido: fundo.querySelector("#bd-ped").value, usar: fundo.querySelector("#bd-usar").value }; salvar(C); };
    fundo.querySelector("#bd-x").onclick = fechar;
    fundo.querySelector("#bd-pedir").onclick = () => N.enviar(C.pedido || "05");
    fundo.querySelector("#bd-recon").onclick = () => { novo(); N.configurar(C.baud, C.bits, C.par, C.stop); };
    ["#bd-baud", "#bd-fmt"].forEach((s) => (fundo.querySelector(s).onchange = () => { novo(); N.configurar(C.baud, C.bits, C.par, C.stop); }));
    ["#bd-ped", "#bd-usar"].forEach((s) => (fundo.querySelector(s).onchange = novo));
    fundo.querySelector("#bd-serv").onclick = (e) => { e.preventDefault(); if (confirm("Procurar o servidor do caixa de novo?")) N.trocarServidor(); };
  }
})();
