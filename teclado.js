/* Teclado na tela (versão leve): troca o teclado nativo do tablet por um teclado simples do sistema.
   Como usar: <script src="teclado.js"></script> no fim da página.
   Por aparelho:  ?teclado=sempre | nunca | auto  na URL (ou localStorage "tecladoVirtual").
   Auto = aparece só em telas de toque (no PC com mouse continua o teclado físico). */
(function () {
  "use strict";
  const modoCfg = () => new URLSearchParams(location.search).get("teclado") || localStorage.getItem("tecladoVirtual") || "auto";
  const ativo = () => { const m = modoCfg(); return m === "sempre" || m === "1" || (m === "auto" && window.matchMedia && matchMedia("(pointer: coarse)").matches); };
  const IGNORA = ["checkbox", "radio", "file", "color", "date", "month", "time", "range", "button", "submit", "hidden", "datetime-local", "reset", "image"];
  const VARIANTES = { a: "áàâã", e: "éê", i: "í", o: "óôõ", u: "úü", c: "ç" };
  let painel, corpo, alvo = null, valorIni = "", manual = false, kb = "", camada = "abc", rep;

  const st = document.createElement("style");
  st.textContent = `
#tec{position:fixed;left:0;right:0;bottom:0;z-index:2000;background:#eceae6;border-top:1px solid #d6d2cc;padding:10px 12px 14px;transform:translateY(105%);transition:transform .16s ease-out;user-select:none;-webkit-user-select:none;touch-action:none;font-family:Inter,Arial,sans-serif}
#tec.on{transform:none}
#tec .tk-corpo{max-width:1100px;margin:0 auto}
#tec .tk-top{display:flex;gap:8px;height:54px;margin-bottom:8px}
#tec .tk-var{flex:1;display:flex;gap:8px;overflow:hidden}
#tec .tk-lin{display:flex;gap:8px;margin-bottom:8px}
#tec .tk{flex:1;min-width:0;min-height:0;height:clamp(56px,8.4vh,80px);padding:0;border:0;border-radius:12px;background:#fff;color:#222;font:600 1.65rem/1 Inter,Arial,sans-serif;box-shadow:0 2px 0 rgba(0,0,0,.2);text-transform:none}
#tec .tk:active{background:#d8d5d0;transform:none}
#tec .tk-up .tk-lin .tk:not(.tk-esp):not(.tk-ok):not(.tk-esc):not(.tk-sw){text-transform:uppercase}
#tec .tk-v{flex:0 0 76px;height:100%;background:#fff;border:1px solid #bbb}
#tec .tk-x{flex:0 0 76px;height:100%;min-height:0;padding:0;border:0;border-radius:12px;background:#d8d5d0;color:#444;font-size:1.4rem}
#tec .tk-esc,#tec .tk-sh,#tec .tk-sw{flex:1.4;background:#d8d5d0}
#tec .tk-esp{flex:5}
#tec .tk-ok{flex:1.8;background:#2b7a4b;color:#fff;font-weight:700;font-size:1.5rem}
#tec .tk-sh.on{background:#444;color:#fff}
#tec .tk-num{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;max-width:560px;margin:0 auto 8px}
#tec .tk-num .tk{height:clamp(64px,9.4vh,92px);font-size:2.1rem}
#tec .tk-oklg{display:block;width:100%;max-width:560px;margin:0 auto;height:clamp(60px,8.6vh,80px)}
#tec .tk-vazio{background:transparent;box-shadow:none;pointer-events:none}
body.tec-on{padding-bottom:var(--tec-h,0px)!important}
body.tec-on .modal{align-items:flex-start;padding:10px 10px var(--tec-h,0px)}
body.tec-on .caixa-modal,body.tec-on .modal-caixa{max-height:calc(100vh - var(--tec-h,0px) - 20px);overflow-y:auto}`;
  document.head.appendChild(st);

  // ---------- prepara os campos (tira o teclado nativo) ----------
  function prep(el) {
    if (!el || !el.matches || !el.matches("input, textarea") || IGNORA.includes(el.type) || el.dataset.tec === "off" || el.readOnly) return;
    if (!el.dataset.tecModo) { // descobre o tipo de teclado ANTES de mexer no inputmode
      const im = el.getAttribute("inputmode") || "";
      el.dataset.tecModo = im === "decimal" ? "decimal" : (im === "numeric" || im === "tel" || el.type === "number") ? "numeric" : "text";
    }
    if (ativo()) { if (el.type === "number") el.type = "text"; el.setAttribute("inputmode", "none"); el.setAttribute("autocomplete", "off"); }
  }
  const varrer = (r) => { if (r.nodeType !== 1) return; prep(r); if (r.querySelectorAll) r.querySelectorAll("input, textarea").forEach(prep); };
  new MutationObserver((ms) => { ms.forEach((m) => m.addedNodes.forEach(varrer)); if (alvo && !alvo.isConnected) fechar(false); }).observe(document.documentElement, { childList: true, subtree: true });
  varrer(document.body);

  // ---------- painel ----------
  const pararRep = () => { clearTimeout(rep); clearInterval(rep); };
  function criar() {
    painel = document.createElement("div"); painel.id = "tec"; painel.innerHTML = '<div class="tk-corpo"></div>'; corpo = painel.firstChild;
    painel.addEventListener("pointerdown", (e) => { // age no toque e NÃO tira o foco do campo
      const b = e.target.closest("button[data-k]"); if (!b) return; e.preventDefault(); tecla(b.dataset.k);
      if (b.dataset.k === "⌫") rep = setTimeout(() => { rep = setInterval(() => { if (!alvo) return pararRep(); tecla("⌫"); }, 70); }, 420);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => painel.addEventListener(ev, pararRep));
    ["pointerup", "pointercancel"].forEach((ev) => document.addEventListener(ev, pararRep));
    painel.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(painel);
  }
  const k = (rot, cls, a) => `<button class="tk ${cls || ""}" data-k="${a}">${rot}</button>`;
  const lin = (s) => `<div class="tk-lin">${[...s].map((c) => k(c, "", c)).join("")}</div>`;
  function montar(m) {
    kb = m; painel.dataset.m = m + camada;
    const topo = '<div class="tk-top"><div class="tk-var"></div><button class="tk-x" data-k="X">▾</button></div>';
    if (m === "text" && camada === "abc") {
      corpo.innerHTML = topo + lin("qwertyuiop") + lin("asdfghjklç") + `<div class="tk-lin">${k("⇧", "tk-sh", "⇧")}${[..."zxcvbnm"].map((c) => k(c, "", c)).join("")}${k("⌫", "tk-esc", "⌫")}</div>` +
        `<div class="tk-lin">${k("123", "tk-sw", "123")}${k(",", "", ",")}${k("espaço", "tk-esp", " ")}${k(".", "", ".")}${k("OK", "tk-ok", "OK")}</div>`;
    } else if (m === "text") { // números e símbolos
      corpo.innerHTML = topo + lin("1234567890") + lin("@-_/:()+=") + `<div class="tk-lin">${k("ABC", "tk-sw", "ABC")}${[...".,?!'"].map((c) => k(c, "", c)).join("")}${k("⌫", "tk-esc", "⌫")}</div>` +
        `<div class="tk-lin">${k("espaço", "tk-esp", " ")}${k("OK", "tk-ok", "OK")}</div>`;
    } else {
      corpo.innerHTML = `<div class="tk-num">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => k(n, "", n)).join("")}${m === "dec" ? k(",", "", ",") : k("", "tk-vazio", "")}${k(0, "", 0)}${k("⌫", "tk-esc", "⌫")}</div>${k("OK", "tk-ok tk-oklg", "OK")}`;
    }
  }
  function autoCap(el) {
    if (kb !== "text" || camada !== "abc" || el.type === "password" || el.dataset.tecCap === "off") return false;
    const s = el.selectionStart == null ? el.value.length : el.selectionStart, antes = el.value.slice(0, s);
    if (el.tagName === "TEXTAREA") return antes === "" || /[.!?]\s$/.test(antes); // texto longo: maiúscula só no começo das frases
    return antes === "" || /\s$/.test(antes); // nomes: maiúscula em cada palavra
  }
  function atualizar() {
    const el = alvo; if (!el) return;
    const s = el.selectionStart == null ? el.value.length : el.selectionStart, up = kb === "text" && (manual || autoCap(el));
    painel.classList.toggle("tk-up", up);
    const sh = painel.querySelector(".tk-sh"); if (sh) sh.classList.toggle("on", up);
    const strip = painel.querySelector(".tk-var");
    if (strip) { // sugestão de acentos para a letra que acabou de ser digitada
      const ch = s > 0 ? el.value[s - 1] : "", lista = camada === "abc" ? VARIANTES[ch.toLowerCase()] : "", maiuscula = ch !== "" && ch === ch.toUpperCase() && ch !== ch.toLowerCase();
      strip.innerHTML = lista ? [...lista].map((x) => { const y = maiuscula ? x.toUpperCase() : x; return k(y, "tk-v", "v:" + y); }).join("") : "";
    }
  }
  function tecla(a) {
    const el = alvo; if (!el) return;
    if (a === "OK") return confirmar();
    if (a === "X") return fechar(true);
    if (a === "⇧") { manual = !manual; return atualizar(); }
    if (a === "123" || a === "ABC") { camada = a === "123" ? "num" : "abc"; montar("text"); return atualizar(); }
    const max = el.maxLength > 0 ? el.maxLength : 1e9;
    let s = el.selectionStart == null ? el.value.length : el.selectionStart; const e = el.selectionEnd == null ? s : el.selectionEnd;
    if (a === "⌫") { if (s === e) { if (s === 0) return; s--; } el.setRangeText("", s, e, "end"); }
    else if (a.startsWith("v:")) { if (s > 0) el.setRangeText(a.slice(2), s - 1, s, "end"); }
    else {
      let c = a;
      if (/^[a-zç]$/.test(c) && (manual || autoCap(el))) c = c.toUpperCase();
      if (c === "," && kb === "dec" && el.value.includes(",")) return;
      if (el.value.length - (e - s) + c.length > max) return;
      el.setRangeText(c, s, e, "end"); manual = false;
    }
    el.dispatchEvent(new Event("input", { bubbles: true })); atualizar();
  }
  function confirmar() {
    const el = alvo; if (!el) return;
    if (el.tagName !== "TEXTAREA") el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true })); // as telas reagem ao Enter (ex.: seguir pro cardápio)
    if (alvo === el) fechar(true);
  }
  function abrir(el) {
    if (alvo && alvo !== el && alvo.isConnected && alvo.value !== valorIni) alvo.dispatchEvent(new Event("change", { bubbles: true }));
    alvo = el; valorIni = el.value; manual = false; camada = "abc";
    if (!painel) criar();
    const m = el.tagName === "TEXTAREA" ? "text" : el.dataset.tecModo === "decimal" ? "dec" : el.dataset.tecModo === "numeric" ? "num" : "text";
    montar(m);
    painel.classList.add("on"); document.body.classList.add("tec-on");
    document.documentElement.style.setProperty("--tec-h", painel.offsetHeight + "px");
    atualizar(); setTimeout(() => { if (alvo === el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); }, 180);
  }
  function fechar(dispara) {
    const el = alvo; alvo = null;
    if (painel) painel.classList.remove("on");
    document.body.classList.remove("tec-on"); document.documentElement.style.setProperty("--tec-h", "0px");
    if (el && el.isConnected) { if (dispara && el.value !== valorIni) el.dispatchEvent(new Event("change", { bubbles: true })); if (document.activeElement === el) el.blur(); }
  }
  document.addEventListener("focusin", (e) => { const el = e.target; if (!el.dataset || !el.dataset.tecModo || !ativo()) return; prep(el); abrir(el); });
  document.addEventListener("focusout", (e) => {
    if (e.target !== alvo) return;
    setTimeout(() => { const a = document.activeElement; if (alvo && (!a || !a.dataset || !a.dataset.tecModo)) fechar(true); }, 120);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && alvo) fechar(true); });
  document.addEventListener("input", () => { if (alvo) atualizar(); }); // teclado físico (PC) também atualiza o painel
})();
