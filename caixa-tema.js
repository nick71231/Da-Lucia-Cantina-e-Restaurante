// Visual do caixa: ícones desenhados (SVG) no lugar dos emojis.
// As telas do caixa escrevem emojis direto no HTML (🖨, 💵, 🛵...). Em vez de mexer em cada lugar, este arquivo observa a
// página e troca cada emoji conhecido por um ícone de traço fino, da mesma cor do texto. Emoji desconhecido fica como está.
(function () {
  const P = {
    recibo: '<path d="M5 3h14v18l-2.5-1.6L14 21l-2-1.6L10 21l-2.5-1.6L5 21z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    ok: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-5.2"/>',
    livro: '<path d="M5 4.5A2.5 2.5 0 0 1 7.5 2H19v15H7.5A2.5 2.5 0 0 0 5 19.5z"/><path d="M5 19.5A2.5 2.5 0 0 0 7.5 22H19v-5"/>',
    cancel: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    fecha: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4M9 12.5l2 2 4-4.5"/>',
    moto: '<path d="M2.5 6.5h11v9.5h-11zM13.5 9.5h4l3 3.2V16h-7"/><circle cx="6.5" cy="17.5" r="1.9"/><circle cx="16.5" cy="17.5" r="1.9"/>',
    grafico: '<path d="M3 21h18"/><path d="M6.5 17v-5M11 17V7M15.5 17v-7M20 17V4"/>',
    nota: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 12h.01M18 12h.01"/>',
    caderno: '<path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6z"/><path d="M6 3v18M3.5 7.5H6M3.5 12H6M3.5 16.5H6M10 8h5"/>',
    pessoas: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    relogio: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2h5"/>',
    sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    semsino: '<path d="M6 8a6 6 0 0 1 9.5-4.9M18 8c0 7 3 9 3 9H9M6 8c0 3-.6 5.2-1.4 6.6M10.3 21a1.9 1.9 0 0 0 3.4 0M3 3l18 18"/>',
    impressora: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    certo: '<path d="M20 6 9 17l-5-5"/>',
    xis: '<path d="M18 6 6 18M6 6l12 12"/>',
    mais: '<path d="M12 5v14M5 12h14"/>',
    cartao: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
    talher: '<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2.5 0-4 2.5-4 6.5S14.5 14 17 14"/>',
    alerta: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    predio: '<rect x="4" y="2" width="16" height="20" rx="1.5"/><path d="M9.5 22v-4h5v4M8.5 6h.01M12 6h.01M15.5 6h.01M8.5 10h.01M12 10h.01M15.5 10h.01M8.5 14h.01M12 14h.01M15.5 14h.01"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    celular: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    carteira: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M21 8h-6a3 3 0 0 0 0 6h6z"/>',
    enviar: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
    lapis: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    arquivo: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
    elo: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    copo: '<path d="M6 8h12l-1.5 13h-9z"/><path d="M5 8h14M12 8l1.5-6H17"/>',
    pix: '<path d="M12 2.8 21.2 12 12 21.2 2.8 12z"/><path d="M8.5 12h7"/>',
    semnet: '<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 4.2-2.4M19 12.9a10 10 0 0 0-2.5-1.7M1.5 9a15 15 0 0 1 4.3-2.7M22.5 9A15 15 0 0 0 12 4.5c-.9 0-1.8.1-2.6.2M12 20h.01"/>',
    trofeu: '<path d="M8 21h8M12 16v5M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
    prancheta: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.5h6V4M9 10h6M9 14h6"/>',
    banco: '<path d="M3 21h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M12 3l9 5H3z"/>',
    seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    texto: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    tomada: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    sacola: '<path d="M5 7h14l-1 14H6z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>',
    caixa: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
    brilho: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
    baixar: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    girar: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    lixo: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>',
    voltar: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    cadeado: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    disquete: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>',
    whats: '<path d="M3.5 20.5 5 16a8.5 8.5 0 1 1 3.2 3.1z"/><path d="M9 9.5c.3 2.2 2.3 4.2 4.6 4.6l1.1-1.2 1.8.8-.4 1.6c-3.8.4-7.6-3.4-7.2-7.2l1.6-.4.8 1.8z"/>',
    ferramenta: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    sorvete: '<path d="M7 10a5 5 0 0 1 10 0z"/><path d="M7.5 10 12 22l4.5-12"/>',
    gota: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    tesoura: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
    porta: '<path d="M14 3h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5M10 17l5-5-5-5M15 12H3"/>',
  };
  const E = { "🧃": "copo", "💧": "gota", "🍺": "copo", "🍷": "copo", "🛠": "ferramenta", "🔧": "ferramenta", "⚙": "engrenagem", "🍦": "sorvete", "🍨": "sorvete", "✂": "tesoura", "🚫": "cancel", "🗒": "fecha", "🧾": "recibo", "✅": "ok", "✔": "certo", "✓": "certo", "✕": "xis", "✖": "xis", "❌": "xis", "📒": "caderno", "📕": "livro",
    "🛵": "moto", "🚚": "moto", "📈": "grafico", "📊": "grafico", "💵": "nota", "💸": "nota", "👥": "pessoas", "👤": "pessoa", "⏱": "relogio", "⏰": "relogio",
    "🔔": "sino", "🔕": "semsino", "🖨": "impressora", "➕": "mais", "💳": "cartao", "🍽": "talher", "⚠": "alerta", "🏢": "predio", "🔍": "busca", "🔎": "busca",
    "📲": "celular", "📞": "celular", "📱": "celular", "💰": "carteira", "👛": "carteira", "📤": "enviar", "✎": "lapis", "✏": "lapis", "📝": "texto", "🗃": "arquivo", "🗂": "arquivo",
    "🔗": "elo", "🥤": "copo", "⚡": "pix", "💠": "pix", "📡": "semnet", "🏆": "trofeu", "📋": "prancheta", "🏦": "banco", "➜": "seta", "🔌": "tomada",
    "🏃": "sacola", "🛍": "sacola", "🍱": "caixa", "📦": "caixa", "✨": "brilho", "🎉": "brilho", "⬇": "baixar", "📥": "baixar", "↻": "girar", "🔄": "girar", "📅": "agenda", "🗓": "agenda",
    "🗑": "lixo", "↩": "voltar", "🔒": "cadeado", "💾": "disquete", "💬": "whats", "🚪": "porta" };
  const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
  window.icone = (n) => `<span class="ic ic-${n}">${svg(n)}</span>`;
  const RE = new RegExp("(" + Object.keys(E).sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\uFE0F?", "g");
  const PULA = /^(OPTION|TEXTAREA|SCRIPT|STYLE|TITLE|INPUT|SELECT)$/;
  function trocaTexto(no) {
    const t = no.nodeValue; RE.lastIndex = 0; if (!RE.test(t)) return;
    const pai = no.parentNode; if (!pai || PULA.test(pai.nodeName) || pai.closest(".extrato, [contenteditable], .ico")) return;
    const f = document.createDocumentFragment(); let i = 0; RE.lastIndex = 0; let m;
    while ((m = RE.exec(t))) {
      if (m.index > i) f.appendChild(document.createTextNode(t.slice(i, m.index)));
      const s = document.createElement("span"); s.className = "ic ic-" + E[m[1]]; s.innerHTML = svg(E[m[1]]); f.appendChild(s);
      i = m.index + m[0].length; if (t[i] === " ") { f.appendChild(document.createTextNode(" ")); i++; }
    }
    if (i < t.length) f.appendChild(document.createTextNode(t.slice(i)));
    pai.replaceChild(f, no);
  }
  // sem a lista de sugestões do navegador (histórico do que já foi digitado) tampando a tela ao digitar comanda, nome, valor...
  function semSugestao(el) { if (el.tagName === "INPUT" && !/^(checkbox|radio|file|color|range|date|month|hidden)$/i.test(el.type || "") && el.getAttribute("autocomplete") !== "off") { el.setAttribute("autocomplete", "off"); el.setAttribute("autocorrect", "off"); el.setAttribute("spellcheck", "false"); } }
  function limpaPlaceholder(el) { const p = el.getAttribute("placeholder"); if (p && (RE.lastIndex = 0, RE.test(p))) el.setAttribute("placeholder", p.replace(RE, "").trim()); }
  function varre(raiz) {
    if (!raiz) return;
    if (raiz.nodeType === 3) return trocaTexto(raiz);
    if (raiz.nodeType !== 1) return;
    if (raiz.hasAttribute("placeholder")) limpaPlaceholder(raiz);
    if (raiz.tagName === "INPUT") semSugestao(raiz); else if (raiz.querySelectorAll) raiz.querySelectorAll("input").forEach(semSugestao);
    if (PULA.test(raiz.nodeName)) return;
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT), nos = []; let n; while ((n = w.nextNode())) nos.push(n);
    nos.forEach(trocaTexto);
    raiz.querySelectorAll("[placeholder]").forEach(limpaPlaceholder);
  }
  function liga() {
    varre(document.body);
    new MutationObserver((ms) => { for (const m of ms) { if (m.type === "characterData") trocaTexto(m.target); else m.addedNodes.forEach(varre); } })
      .observe(document.body, { childList: true, subtree: true, characterData: true });
    // título da aba aberta no topo
    const tit = document.getElementById("titulo-aba");
    const poeTitulo = () => { const b = document.querySelector(".abas [data-aba].on"); if (tit && b) tit.textContent = b.dataset.rot || b.textContent.trim(); };
    if (tit) new MutationObserver(poeTitulo).observe(document.querySelector(".abas"), { attributes: true, subtree: true, attributeFilter: ["class"] });
    poeTitulo();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", liga); else liga();
})();
