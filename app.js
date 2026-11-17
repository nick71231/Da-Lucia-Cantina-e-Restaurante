const $ = (s) => document.querySelector(s);
const brl = (n) => "R$" + n.toFixed(2).replace(".", ",");
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ler = (k, p) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : p; } catch (e) { return p; } };
const SEM_SYNC = ["pedidos", "fila", "contador", "carrinho", "cfgT", "pin", "tecladoVirtual", "tokenAdmin", "impFalhas", "cfgSujo"]; // o que NÃO vai pro backup automático
let tSync;
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} if (!SEM_SYNC.includes(k)) { try { localStorage.setItem("cfgSujo", "1"); } catch (e) {} agendaSync(); } };  // cfgSujo = mudança ainda não enviada ao servidor

let indisponiveis = new Set(ler("indisponiveis", [])); // itens escondidos pelo admin
let extras = ler("extras", {});                        // itens novos criados no admin
let carrinho = [];
let tela = "descanso";                                     // menu | montar | sucesso | admin
let montagem = null, ultimo = null, nomeCliente = "", tHold, tIdle, pinDigitado = "", abaAdmin = "cardapio", diaRel = null;
const hoje = () => new Date().toLocaleDateString("en-CA");
let removidos = new Set(ler("removidos", [])), bebidasExtras = ler("bebidasExtras", []), modoApagar = false, enviando = false, filtroAdmin = "", etapaAtual = null, prodAtual = null, ajusteAtual = "aparencia";
const pinAtual = () => String(ler("pin", PIN_ADMIN));
const bebidasLista = () => [...BEBIDAS, ...bebidasExtras].filter((b, i, a) => a.findIndex((x) => x.nome === b.nome) === i && !removidos.has("bebida:" + b.nome));
const temBebida = () => bebidasLista().some((b) => !indisponiveis.has("bebida:" + b.nome));
let docesExtras = ler("docesExtras", []);
const docesLista = () => [...(typeof DOCES_TOTEM !== "undefined" ? DOCES_TOTEM : []), ...docesExtras].filter((b, i, a) => a.findIndex((x) => x.nome === b.nome) === i && !removidos.has("doce:" + b.nome));
const temDoce = () => docesLista().some((b) => !indisponiveis.has("doce:" + b.nome));
const avulsos = (tp) => (tp === "doce" ? docesLista() : bebidasLista()); // bebidas e doces: itens com preço próprio, fora da marmitex

const categorias = () => etapasLista().map((c) => ({ ...c, itens: [...new Set([...c.itens, ...(extras[c.id] || [])])].filter((n) => !removidos.has(c.id + ":" + n)) }));
const ehSem = (n) => /^\s*sem\s/i.test(n); // "Sem Arroz", "Sem Salada"... sempre por último, pro cliente achar fácil
const disponiveis = (c) => { const l = c.itens.filter((n) => !indisponiveis.has(c.id + ":" + n)); return [...l.filter((n) => !ehSem(n)), ...l.filter(ehSem)]; };
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2000); };

const logoPeq = () => `<div class="logo-box" data-acao="logo"><img class="logo" src="${esc(ler("logoPequena", "img/logo.png"))}" alt="Da Lúcia"></div>`;
const topo = (titulo) => `<header class="topo">${logoPeq()}<h1>${esc(titulo)}</h1>${["menu", "montar", "bebidas", "doces"].includes(tela) && ler("mostrarInicio", true) ? '<button class="btn-inicio" data-acao="sair">⌂ Início</button>' : ""}</header>`;

// ===== TELAS =====
// ===== TELAS DO CLIENTE (visual novo: simples, grande e com o próximo passo sempre claro) =====
const topo2 = (titulo, sub) => `<header class="t-topo">${logoPeq()}<div class="t-tit"><h1>${titulo}</h1>${sub ? `<p>${sub}</p>` : ""}</div>${["menu", "montar", "bebidas", "doces"].includes(tela) && ler("mostrarInicio", true) ? '<button class="t-inicio" data-acao="sair">✕ Cancelar pedido</button>' : ""}</header>`;
const temPreco = (n) => /R\$/.test(n);
function htmlMenu() {
  const prods = marmitexLista().filter((m) => !indisponiveis.has("produto:" + m.id)), tem = carrinho.length > 0;
  return topo2(tem ? "Quer mais alguma coisa?" : nomeCliente ? `Olá, ${esc(nomeCliente)}! Escolha sua marmitex` : "Escolha sua marmitex",
      tem ? "Escolha outra marmitex, ou toque em <b>Finalizar pedido</b> ao lado →" : "Toque na marmitex que você quer. Depois você monta do seu jeito.") +
    `<section class="t-corpo"><div class="t-produtos">${prods.map((m) => `<button class="t-prod" data-acao="marmitex" data-id="${m.id}">
      <div class="t-prod-foto"><img class="foto" src="${m.foto}" alt=""></div><div class="t-prod-info"><b>${esc(m.nome)}</b>${temPreco(m.nome) ? "" : `<span class="t-preco">${brl(m.preco)}</span>`}<span class="t-montar">Montar →</span></div></button>`).join("")}
      ${tem && temBebida() ? `<button class="t-prod t-prod-beb" data-acao="bebidas"><div class="t-prod-foto"><span>🥤</span></div><div class="t-prod-info"><b>Bebidas</b><span class="t-montar">Ver bebidas →</span></div></button>` : ""}
      ${tem && temDoce() ? `<button class="t-prod t-prod-beb" data-acao="doces"><div class="t-prod-foto"><span>🍬</span></div><div class="t-prod-info"><b>Doces</b><span class="t-montar">Ver doces →</span></div></button>` : ""}</div></section>`;
}
const regraTxt = (min, lim) => (min === lim ? (lim === 1 ? "Escolha 1 opção" : `Escolha ${lim} opções`) : min === 0 ? `Escolha até ${lim} (se quiser)` : `Escolha de ${min} a ${lim} opções`);
const passos2 = (passos, i) => `<div class="t-passos"><span class="t-passo-n">${i < passos.length ? `Etapa ${i + 1} de ${passos.length}` : "Última etapa"}</span><div class="t-trilho">${[...passos.map((c) => c.nome), "Revisar"].map((n, k) => `<i class="${k < i ? "feito" : k === i ? "atual" : ""}" title="${esc(n)}"></i>`).join("")}</div></div>`;
function htmlMontar() {
  if (montagem.i === montagem.passos.length) return htmlObs();
  const { marm, passos, i, escolhas } = montagem, cat = passos[i];
  const itens = disponiveis(cat), lim = Math.min(marm.regras[cat.id].max, itens.length), min = Math.min(marm.regras[cat.id].min, lim), sel = escolhas[cat.id] || [];
  const prox = i + 1 < passos.length ? "Próximo: " + esc(passos[i + 1].nome) + " →" : "Revisar →", falta = Math.max(0, min - sel.length);
  return topo2(esc(cat.pergunta), regraTxt(min, lim) + (cat.adicional ? ` · <b>+ ${brl(cat.adicional)}</b>` : "")) + passos2(passos, i) +
    `<section class="t-corpo"><div class="t-itens">${itens.map((n) => `<button class="t-item ${sel.includes(n) ? "sel" : ""}" data-acao="escolher" data-item="${esc(n)}">
      ${FOTOS[n] ? `<img class="t-item-foto" src="${esc(FOTOS[n])}" alt="">` : `<span class="t-item-ini">${esc(n.trim().charAt(0).toUpperCase())}</span>`}<span class="t-item-nome">${esc(n)}</span><span class="t-check">✓</span></button>`).join("")}</div></section>
    <footer class="t-barra"><button class="t-sec" data-acao="voltar">← ${i === 0 ? "Trocar marmitex" : "Voltar"}</button>
    <div class="t-info">${montagem.aviso ? `<b class="t-aviso">${montagem.aviso}</b>` : falta ? `Escolha ${falta === 1 && min === 1 ? "uma opção" : "mais " + falta}` : `<b class="t-okk">✓ ${sel.length ? sel.length + (lim > 1 ? " de " + lim : "") + " escolhida" + (sel.length > 1 ? "s" : "") : "Nenhuma (tudo bem)"}</b>`}</div>
    <button class="t-prim" data-acao="proximo" ${sel.length >= min ? "" : "disabled"}>${prox}</button></footer>`;
}
const OBS_CHIPS = ["Sem cebola", "Sem pimenta", "Pouco sal", "Capricha no feijão", "Sem salada"];
function htmlObs() { // tela de revisão: tudo que foi escolhido + observação (sem popup)
  const { marm, passos, escolhas, pagos } = montagem, extra = passos.reduce((s, c) => s + ((escolhas[c.id] || []).length ? c.adicional || 0 : 0), 0), obs = montagem.obs || "";
  const tem = (t) => obs.split(",").map((x) => x.trim().toLowerCase()).includes(t.toLowerCase());
  return topo2("Confira sua marmitex", esc(marm.nome) + " · <b>" + brl(marm.preco + extra) + "</b>") + passos2(passos, passos.length) +
    `<section class="t-corpo"><div class="t-rev">${passos.map((c, k) => { const it = escolhas[c.id] || [], nao = pagos[c.id] === false;
      return `<div class="t-rev-l"><span class="t-rev-r">${esc(c.nome)}</span><span class="t-rev-v ${it.length ? "" : "vazio"}">${it.length ? esc(it.join(", ")) : nao ? "Não quis" : "Nenhum"}${c.adicional && it.length ? ` <em>+ ${brl(c.adicional)}</em>` : ""}</span><button class="t-trocar" data-acao="irPasso" data-n="${k}">Trocar</button></div>`; }).join("")}</div>
    <div class="t-obs"><h3>Alguma observação? <small>opcional</small></h3><div class="t-chips">${OBS_CHIPS.map((t) => `<button class="t-chip ${tem(t) ? "on" : ""}" data-acao="chipObs" data-txt="${t}">${tem(t) ? "✓ " : ""}${t}</button>`).join("")}</div>
    <textarea id="obs" maxlength="80" placeholder="Ou escreva aqui...">${esc(obs)}</textarea></div></section>
    <footer class="t-barra"><button class="t-sec" data-acao="voltar">← Voltar</button><div class="t-info">Esta marmitex<b class="t-val">${brl(marm.preco + extra)}</b></div>
    <button class="t-prim t-ok" data-acao="proximo">✓ Adicionar ao pedido</button></footer>`;
}
function htmlAvulsos(tp) { // tela de bebidas ou de doces: toca pra adicionar, +/− pra ajustar
  const D = tp === "doce", ic = D ? "🍬" : "🥤", un = D ? "doce" : "bebida", lista = avulsos(tp).filter((b) => !indisponiveis.has(tp + ":" + b.nome)), qb = carrinho.filter((c) => c.tipo === tp).reduce((s, c) => s + c.qtd, 0);
  return topo2(D ? "Quer um docinho?" : "Quer uma bebida?", "Toque pra adicionar. Toque de novo pra mais um" + (D ? "." : "a.")) + `<section class="t-corpo"><div class="t-bebs">${lista.map((b) => {
    const q = (carrinho.find((c) => c.key === tp + "|" + b.nome) || {}).qtd || 0, f = D ? null : fotoBebida(b.nome);
    return `<div class="t-beb ${q ? "tem" : ""}"><button class="t-beb-bt" data-acao="pedirBebida" data-tp="${tp}" data-nome="${esc(b.nome)}">${f ? `<img class="foto-bebida" src="fotos/bebidas/${f}.jpg" alt="" onerror="this.outerHTML='<span>🥤</span>'">` : `<span>${ic}</span>`}<b>${esc(b.nome)}</b><small>${brl(b.preco)}</small></button>
      ${q ? `<div class="t-beb-q"><button data-acao="menosBeb" data-tp="${tp}" data-nome="${esc(b.nome)}" aria-label="Tirar um">−</button><b>${q}</b><button data-acao="pedirBebida" data-tp="${tp}" data-nome="${esc(b.nome)}" aria-label="Mais um">+</button></div>` : ""}</div>`;
  }).join("")}</div></section><footer class="t-barra"><div class="t-info">${qb ? `<b class="t-okk">✓ ${qb} ${un}${qb > 1 ? "s" : ""} no pedido</b>` : `Nenhum${D ? "" : "a"} ${un} escolhid${D ? "o" : "a"}`}</div><button class="t-prim ${qb ? "t-ok" : "t-neutro"}" data-acao="semBebida">${qb ? "Pronto, ver meu pedido →" : `Não quero ${un} →`}</button></footer>`;
}
const htmlBebidas = () => htmlAvulsos("bebida"), htmlDoces = () => htmlAvulsos("doce");

function htmlNome() {
  const obrig = ler("nomeObrigatorio", true);
  return topo2("Qual é o seu nome?", "A gente te chama pelo nome quando o pedido ficar pronto.") + `<section class="t-corpo t-nome"><input id="nome" maxlength="30" placeholder="Digite seu nome" autocomplete="off" value="${esc(nomeCliente)}">
    <div class="t-nome-bts"><button class="t-sec" data-acao="inicio">← Voltar</button><button id="btn-nome" class="t-prim" data-acao="continuar" ${nomeCliente.trim() || !obrig ? "" : "disabled"}>Continuar →</button></div>${obrig ? "" : `<p class="t-dica">Se preferir, é só tocar em Continuar sem nome.</p>`}</section>`;
}
function htmlCarrinho() {
  const un = carrinho.reduce((s, c) => s + c.qtd, 0), val = carrinho.reduce((s, c) => s + c.qtd * c.preco, 0);
  return `<div class="cx"><h2>Seu pedido ${un ? `<small>${un} ${un === 1 ? "item" : "itens"}</small>` : ""}</h2><div class="cx-itens">` + (carrinho.length ? carrinho.map((c, i) => { const esc2 = (c.grupos || []).flatMap((g) => g.itens);
    return `<div class="cx-it"><div class="cx-top"><b>${c.tipo === "bebida" ? "🥤 " : c.tipo === "doce" ? "🍬 " : "🍱 "}${esc(c.nome)}</b><span>${brl(c.preco * c.qtd)}</span></div>${esc2.length ? `<p>${esc(esc2.join(" · "))}</p>` : ""}${c.obs ? `<p class="cx-obs">Obs: ${esc(c.obs)}</p>` : ""}
      <div class="cx-ctl"><button data-acao="menos" data-i="${i}" aria-label="Menos">−</button><b>${c.qtd}</b><button data-acao="mais" data-i="${i}" aria-label="Mais">+</button><button class="cx-rm" data-acao="remover" data-i="${i}">Remover</button></div></div>`; }).join("")
    : `<div class="cx-vazio"><span>🍱</span>Seu pedido está vazio.<br>Escolha uma marmitex ao lado.</div>`) +
    `</div><div class="cx-rod">${carrinho.length ? `<div class="cx-tot"><span>Total</span><b>${brl(val)}</b></div>` : ""}<button class="btn-finalizar cx-fin ${carrinho.length && tela === "menu" ? "chama" : ""}" data-acao="finalizar" ${carrinho.length ? "" : "disabled"}>Finalizar pedido${carrinho.length ? " · " + brl(val) : ""}</button></div></div>`;
}
(() => { const st = document.createElement("style"); st.textContent = `
/* formato novo + paleta original do Da Lúcia (laranja, vermelho, creme, serifa) */
body { --t-v: var(--vermelho, #A50F14); --t-l: var(--laranja, #FFA500); --t-le: var(--lar-esc, #FF8A00); --t-ve: var(--verm-esc, #7d0a0e); --t-tinta: var(--tinta, #2B1710); --t-muted: #8a6f60; --t-som: var(--sombra, 0 10px 30px rgba(120,50,10,.14)); --t-somg: var(--sombra-g, 0 18px 44px rgba(120,50,10,.22)); --t-serif: var(--serif, Georgia, serif); }
#principal:has(.t-topo) { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.t-topo { position: relative; display: flex; align-items: center; gap: 20px; padding: 18px 32px 8px; }
.t-topo .logo-box { flex-shrink: 0; } .t-topo .logo-box .logo { width: 76px !important; height: 76px !important; border-radius: 50%; object-fit: cover; }
.t-tit { flex: 1; min-width: 0; } .t-tit h1 { margin: 0; font: 600 clamp(1.5rem, 2.8vw, 2.1rem)/1.15 var(--t-serif); color: var(--t-tinta); }
.t-tit h1::after { content: ""; display: block; width: 54px; height: 5px; border-radius: 3px; margin-top: 8px; background: linear-gradient(90deg, var(--t-l), var(--t-v)); }
.t-tit p { margin: 8px 0 0; color: #7a5c4a; font-size: 1.08rem; } .t-tit p b { color: var(--t-v); }
.t-inicio { flex-shrink: 0; align-self: center; padding: 12px 20px; border: 0; border-radius: 999px; background: rgba(165,15,20,.08); color: var(--t-v); font-weight: 700; font-size: 1rem; }
.t-corpo { flex: 1; min-height: 0; overflow-y: auto; padding: 14px 32px 24px; }
/* passos */
.t-passos { display: flex; align-items: center; gap: 14px; padding: 6px 32px 4px; }
.t-passo-n { font-weight: 700; color: var(--t-v); font-size: .95rem; white-space: nowrap; } .t-trilho { flex: 1; display: flex; gap: 6px; }
.t-trilho i { flex: 1; height: 8px; border-radius: 999px; background: #fff; box-shadow: inset 0 0 0 1px #efe0cf; } .t-trilho i.feito { background: #FFD58A; box-shadow: none; } .t-trilho i.atual { background: linear-gradient(90deg, var(--t-v), var(--t-ve)); box-shadow: none; }
/* produtos */
.t-produtos { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 22px; padding-top: 10px; }
.t-prod { display: flex; flex-direction: column; padding: 12px; border: 0; border-radius: 28px; background: #fff; text-align: left; box-shadow: var(--t-som); }
.t-prod-foto { height: 170px; border-radius: 20px; background: #FFE3A8; display: grid; place-items: center; overflow: hidden; box-shadow: inset 0 0 0 2px rgba(255,165,0,.35); } .t-prod-foto img { width: 100%; height: 100%; object-fit: cover; } .t-prod-foto span { font-size: 4rem; }
.t-prod-info { display: flex; flex-direction: column; gap: 6px; padding: 12px 6px 4px; } .t-prod-info b { font: 700 1.2rem/1.25 var(--t-serif); color: var(--t-tinta); }
.t-preco { font: 700 1.2rem var(--t-serif); color: var(--t-v); }
.t-montar { margin-top: 4px; align-self: flex-start; padding: 9px 16px; border-radius: 999px; background: linear-gradient(135deg, var(--t-l), var(--t-le)); color: #fff; font-weight: 700; font-size: .95rem; box-shadow: 0 4px 10px rgba(255,140,0,.3); }
.t-prod-beb .t-prod-foto { height: 120px; }
/* itens das etapas: escolhido fica laranja com ✓ vermelho */
.t-itens { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 14px; }
.t-item { position: relative; display: flex; align-items: center; gap: 14px; min-height: 84px; padding: 6px 56px 6px 6px; border: 2px solid transparent; border-radius: 22px; background: #fff; text-align: left; box-shadow: var(--t-som); }
.t-item-foto { width: 72px; height: 72px; flex-shrink: 0; border-radius: 16px; object-fit: cover; } .t-item-ini { width: 60px; height: 60px; margin-left: 6px; flex-shrink: 0; border-radius: 16px; display: grid; place-items: center; background: #FFF0D2; color: #b06a00; font: 700 1.4rem var(--t-serif); }
.t-item-nome { font: 1.15rem/1.25 var(--t-serif); color: var(--t-tinta); }
.t-check { position: absolute; right: 18px; top: 50%; width: 32px; height: 32px; margin-top: -16px; border-radius: 50%; border: 2px solid #d9c7b8; display: grid; place-items: center; color: transparent; font: 700 1.1rem Arial; }
.t-item.sel { background: linear-gradient(135deg, var(--t-l), var(--t-le)); border-color: #fff; box-shadow: var(--t-somg); } .t-item.sel .t-item-nome { color: #fff; font-weight: 700; } .t-item.sel .t-item-ini { background: rgba(255,255,255,.3); color: #fff; }
.t-item.sel .t-check { background: var(--t-v); border-color: #fff; color: #fff; animation: pop .35s cubic-bezier(.2,1.6,.4,1); }
/* barra de baixo (flutuante, como a original) */
.t-barra { display: flex; align-items: center; gap: 14px; margin: 0 24px 18px; padding: 14px 18px; border-radius: 26px; background: rgba(255,255,255,.92); box-shadow: var(--t-somg); }
.t-info { flex: 1; text-align: center; color: #7a5c4a; font-size: 1.05rem; } .t-info .t-okk { color: #b06a00; } .t-info .t-aviso { color: var(--t-v); } .t-info .t-val { display: block; font: 700 1.5rem var(--t-serif); color: var(--t-tinta); }
.t-prim, .t-sec { min-height: 62px; padding: 0 26px; border-radius: 18px; font-weight: 700; font-size: 1.12rem; }
.t-prim { border: 0; color: #fff; background: linear-gradient(135deg, var(--t-v), var(--t-ve)); box-shadow: 0 8px 18px rgba(165,15,20,.35); }
.t-prim.t-neutro { background: #fff; color: var(--t-v); border: 2px solid var(--t-v); box-shadow: none; }
.t-prim:disabled { background: #cbbab0; color: #fff; box-shadow: none; opacity: 1; }
.t-sec { border: 2px solid var(--t-v); background: #fff; color: var(--t-v); }
/* revisão */
.t-rev { background: #fff; border-radius: 24px; padding: 6px 20px; box-shadow: var(--t-som); }
.t-rev-l { display: grid; grid-template-columns: 160px 1fr auto; align-items: center; gap: 14px; padding: 14px 0; border-top: 1px dashed #f0dfcb; } .t-rev-l:first-child { border-top: 0; }
.t-rev-r { font-weight: 700; color: #b06a00; font-size: .92rem; text-transform: uppercase; letter-spacing: .03em; } .t-rev-v { font: 1.15rem var(--t-serif); color: var(--t-tinta); } .t-rev-v.vazio { color: #b9a594; } .t-rev-v em { font-style: normal; font-weight: 700; color: var(--t-v); }
.t-trocar { padding: 10px 18px; border: 2px solid var(--t-v); border-radius: 999px; background: #fff; font-weight: 700; color: var(--t-v); }
.t-obs { margin-top: 16px; background: #fff; border-radius: 24px; padding: 16px 20px; box-shadow: var(--t-som); } .t-obs h3 { margin: 0 0 12px; font: 600 1.25rem var(--t-serif); } .t-obs h3 small { font: 500 .9rem Inter, Arial; color: var(--t-muted); }
.t-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; } .t-chip { padding: 12px 18px; border: 0; border-radius: 999px; background: #FFF0D2; color: #8a4b00; font-weight: 700; font-size: 1rem; } .t-chip.on { background: linear-gradient(135deg, var(--t-l), var(--t-le)); color: #fff; box-shadow: 0 4px 10px rgba(255,140,0,.35); }
.t-obs textarea { width: 100%; height: 76px; min-height: 0; margin: 0; padding: 12px 16px; border: 2px solid #f0dfcb; border-radius: 16px; font: 1.1rem Inter, Arial; box-shadow: none; resize: none; }
/* bebidas */
.t-bebs { display: grid; grid-template-columns: repeat(auto-fill, minmax(175px, 1fr)); gap: 18px; padding-top: 10px; }
.t-beb { position: relative; display: flex; flex-direction: column; border: 3px solid transparent; border-radius: 28px; background: #fff; box-shadow: var(--t-som); overflow: hidden; } .t-beb.tem { border-color: var(--t-l); }
.t-beb-bt { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 18px 10px 14px; min-height: 0; border: 0; border-radius: 0; background: transparent; text-align: center; } .t-beb-bt img { width: 100%; height: 100px; object-fit: contain; } .t-beb-bt > span { font-size: 3rem; line-height: 100px; } .t-beb-bt b { font-size: 1.02rem; color: var(--t-tinta); } .t-beb-bt small { color: var(--t-v); font-weight: 700; font-size: 1.1rem; }
.t-beb-q { display: flex; align-items: center; justify-content: space-between; padding: 6px; background: linear-gradient(135deg, var(--t-l), var(--t-le)); } .t-beb-q button { width: 52px; height: 46px; min-height: 0; padding: 0; border: 0; border-radius: 14px; background: #fff; font-size: 1.5rem; color: var(--t-v); box-shadow: 0 2px 6px rgba(0,0,0,.15); } .t-beb-q b { font: 700 1.4rem var(--t-serif); color: #fff; }
/* nome */
.t-nome { display: flex; flex-direction: column; align-items: center; gap: 22px; padding-top: 34px; } .t-nome input { width: min(600px, 100%); height: 80px; padding: 0 26px; border: 3px solid transparent; border-radius: 24px; font: 600 1.7rem var(--t-serif); text-align: center; box-shadow: var(--t-somg); outline: 0; }
.t-nome input:focus { border-color: var(--t-l); box-shadow: 0 0 0 8px rgba(255,165,0,.25), var(--t-somg); }
.t-nome-bts { display: flex; gap: 12px; width: min(600px, 100%); } .t-nome-bts .t-prim { flex: 1; } .t-dica { color: var(--t-muted); }
/* carrinho laranja com letra branca (original), no formato novo */
#carrinho .cx { display: flex; flex-direction: column; height: 100%; min-height: 0; }
#carrinho .cx h2 { margin: 0 0 14px; text-align: center; font: 700 1.5rem var(--t-serif); } #carrinho .cx h2 small { display: block; font: 600 .85rem Inter, Arial; opacity: .9; margin-top: 2px; }
.cx-itens { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.cx-it { background: rgba(255,255,255,.2); border-radius: 18px; padding: 12px 14px; } .cx-top { display: flex; justify-content: space-between; gap: 10px; } .cx-top b { font-size: 1.05rem; } .cx-top span { font-weight: 800; white-space: nowrap; }
.cx-it p { margin: 4px 0 0; font-size: .88rem; font-weight: 500; line-height: 1.35; opacity: .95; } .cx-it .cx-obs { font-style: italic; font-weight: 700; }
.cx-ctl { display: flex; align-items: center; gap: 8px; margin-top: 10px; } .cx-ctl button { width: 42px; height: 42px; min-height: 0; padding: 0; border: 0; border-radius: 12px; background: #fff; color: var(--t-v); font-size: 1.3rem; box-shadow: 0 2px 6px rgba(0,0,0,.15); } .cx-ctl b { min-width: 20px; text-align: center; font-size: 1.1rem; }
.cx-ctl .cx-rm { width: auto; margin-left: auto; padding: 0 12px; font-size: .85rem; }
.cx-vazio { margin: 26px 8px; text-align: center; line-height: 1.5; opacity: .95; } .cx-vazio span { display: block; font-size: 3rem; margin-bottom: 8px; }
.cx-rod { margin-top: 12px; padding-top: 12px; border-top: 1px dashed rgba(255,255,255,.6); } .cx-tot { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; } .cx-tot span { font-weight: 700; } .cx-tot b { font: 700 1.6rem var(--t-serif); }
.cx-fin { width: 100%; min-height: 64px; border: 2px solid rgba(255,255,255,.7); border-radius: 18px; color: #fff; font-weight: 800; font-size: 1.12rem; background: linear-gradient(135deg, var(--t-v), var(--t-ve)); box-shadow: 0 8px 18px rgba(165,15,20,.35); }
.cx-fin:disabled { background: rgba(255,255,255,.25); border-color: rgba(255,255,255,.4); box-shadow: none; opacity: 1; }
.cx-fin.chama { animation: tChama 2.2s ease-in-out infinite; } @keyframes tChama { 0%, 100% { box-shadow: 0 8px 18px rgba(165,15,20,.35); } 50% { box-shadow: 0 0 0 8px rgba(255,255,255,.45), 0 8px 18px rgba(165,15,20,.35); } }
.entra .t-topo, .entra .t-passos { animation: desce .4s ease-out backwards; } .entra .t-corpo > * { animation: sobe .45s ease-out backwards; } .entra .t-barra { animation: sobe .45s .12s ease-out backwards; }
@media (max-width: 900px) { .t-topo { padding: 14px 16px 6px; } .t-corpo { padding: 10px 16px 20px; } .t-passos { padding: 6px 16px 2px; } .t-barra { margin: 0 12px 12px; } .t-rev-l { grid-template-columns: 1fr auto; } .t-rev-r { grid-column: 1 / -1; } .t-prim, .t-sec { padding: 0 16px; } .t-topo .logo-box .logo { width: 58px !important; height: 58px !important; } }
`; document.head.appendChild(st); })();

function htmlSucesso() { // tela limpa: sem botões. Volta sozinha depois de imprimir, ou tocando em qualquer lugar
  return `<section class="suc" data-acao="inicio">
    <div class="suc-ok">✓</div>
    <h1 class="suc-tit">Pedido enviado!</h1>
    <p class="suc-ola">Obrigado${nomeCliente ? ", <b>" + esc(nomeCliente) + "</b>" : ""}!</p>
    <div class="suc-num"><small>SEU NÚMERO</small><strong>${ultimo.numero}</strong></div>
    ${ultimo.comanda ? `<p class="suc-info">Entrou na comanda <b>${ultimo.comanda}</b>. Você paga tudo no final!</p>` : ""}
    ${ultimo.pendente ? `<p class="suc-alerta">⚠ O pedido ainda não chegou ao caixa. Avise um atendente!</p>` : `<p class="suc-info">Retire sua comanda e aguarde ser chamado.</p>`}
    <div class="suc-rod" id="suc-rod">Imprimindo sua comanda...</div>
  </section><div class="suc-logo">${logoPeq()}</div>`;
}

let chavePrev = "";
function render() {
  const area = () => $(".t-corpo") || $(".conteudo"), chave = tela + (montagem ? montagem.i : ""), sc = area() ? area().scrollTop : 0;
  $("#principal").innerHTML = { bebidas: htmlBebidas, doces: htmlDoces, descanso: htmlDescanso, nome: htmlNome, menu: htmlMenu, montar: htmlMontar, sucesso: htmlSucesso, admin: htmlAdmin }[tela]();
  $("#carrinho").innerHTML = htmlCarrinho();
  document.body.classList.toggle("sem-carrinho", ["descanso", "nome", "admin", "sucesso"].includes(tela));
  $("#principal").classList.toggle("entra", chave !== chavePrev); // anima só quando a tela muda
  if (chave === chavePrev && area()) area().scrollTop = sc;
  if (tela === "admin" && filtroAdmin) aplicarFiltro(); // a busca continua valendo depois de redesenhar
  chavePrev = chave;
  if (tela === "nome") Promise.resolve().then(() => { const n = $("#nome"); if (n) n.focus(); });
  if (tela === "admin" && abaAdmin === "ajustes" && ajusteAtual === "uso") avisoSenhas();
  aplicarFiltro();
  resetIdle();
}

// ===== AÇÕES =====
function iniciar(marm) {
  const passos = categorias().filter((c) => marm.regras[c.id].max > 0 && disponiveis(c).length > 0);
  if (!passos.length) return toast("Nenhum item disponível no momento.");
  montagem = { marm, passos, i: 0, escolhas: {}, aviso: "", obs: "", pagos: {} };
  tela = "montar"; render();
}

// ----- etapa com valor adicional (ex.: Salada Separada +R$1,00): pergunta antes, pra ninguém pagar sem querer -----
const pagoPendente = (n) => { const c = montagem.passos[n]; return !!c && c.adicional > 0 && montagem.pagos[c.id] === undefined && !(montagem.escolhas[c.id] || []).length; };
function avancarPara(n) {
  if (n < montagem.passos.length && pagoPendente(n)) return perguntarPago(n);
  montagem.i = n; render();
}
function perguntarPago(n) {
  const c = montagem.passos[n], nome = c.nome.replace(/\s*[-–]\s*R\$\s*[\d.,]+\s*$/, ""), ic = /salada/i.test(nome) ? "🥗" : /sobremesa|doce/i.test(nome) ? "🍮" : "➕";
  const m = $("#modal"); m.hidden = false;
  m.innerHTML = `<div class="modal-caixa larga pp"><div class="pp-ic">${ic}</div><h2>Quer ${esc(nome)}?</h2><p class="pp-sub">É opcional e custa <b>+ ${brl(c.adicional)}</b> na marmitex</p>
    <div class="pp-bts"><button class="pp-nao" data-acao="pagoNao" data-n="${n}">Não, obrigado</button><button class="pp-sim" data-acao="pagoSim" data-n="${n}">Sim, quero<small>+ ${brl(c.adicional)}</small></button></div></div>`;
}
function perguntarObs() {
  const m = $("#modal"); m.hidden = false;
  m.innerHTML = `<div class="modal-caixa larga"><h2>Quer fazer alguma observação?</h2>
    <p style="font-size:1.1em">Por exemplo: sem cebola, pouco sal...</p>
    <button class="op-pag" data-acao="obsSim">✏️ Sim, escrever observação</button>
    <button class="op-pag" data-acao="obsNao">✅ Não, adicionar ao carrinho</button></div>`;
}
function responderPago(n, quer) {
  const c = montagem.passos[n]; $("#modal").hidden = true;
  montagem.pagos[c.id] = quer;
  if (quer) { montagem.i = n; return render(); }
  montagem.escolhas[c.id] = []; avancarPara(n + 1);
}

function escolher(nome) {
  const cat = montagem.passos[montagem.i], lim = Math.min(montagem.marm.regras[cat.id].max, disponiveis(cat).length);
  let arr = montagem.escolhas[cat.id] || [];
  montagem.aviso = "";
  if (arr.includes(nome)) arr = arr.filter((n) => n !== nome);
  else if (lim === 1) arr = [nome];
  else if (arr.length < lim) arr = [...arr, nome];
  else montagem.aviso = "Você já escolheu o máximo. Toque numa marcada pra trocar.";
  montagem.escolhas[cat.id] = arr; render();
  const min = Math.min(montagem.marm.regras[cat.id].min, lim), i0 = montagem.i, m0 = montagem;
  const acabouDeMarcar = arr.includes(nome) && arr.length === lim && lim >= 1 && arr.length >= min; // completou o máximo (1 de 1, 2 de 2...)
  if (acabouDeMarcar) setTimeout(() => { if (montagem === m0 && montagem.i === i0 && tela === "montar" && (montagem.escolhas[cat.id] || []).length === lim) avancarPara(i0 + 1); }, lim === 1 ? 420 : 700); // segue sozinho pra próxima etapa
}

function adicionar() {
  const { marm, passos, escolhas } = montagem;
  const grupos = passos.map((c) => ({ rotulo: c.nome, itens: escolhas[c.id] || [], ...(c.adicional > 0 ? { adicional: true } : {}) })).filter((g) => g.itens.length);
  const extra = passos.reduce((s, c) => s + ((escolhas[c.id] || []).length ? c.adicional || 0 : 0), 0);
  const key = marm.id + "|" + grupos.map((g) => [...g.itens].sort().join(",")).join("|") + "|" + montagem.obs.trim();
  const ex = carrinho.find((c) => c.key === key);
  if (ex) ex.qtd++; else carrinho.push({ key, nome: marm.nome, preco: marm.preco + extra, grupos, obs: montagem.obs.trim(), qtd: 1 });
  salvar("carrinho", carrinho); montagem = null; tela = temBebida() ? "bebidas" : "menu"; render(); toast("Marmitex adicionada!"); pulsaCarrinho();
}


const novoUid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
function perguntarComanda() { // quem está almoçando pode colocar a marmitex na própria comanda
  if (!carrinho.length) return;
  if (!ler("perguntarComanda", true)) return finalizar();
  const m = $("#modal"); m.hidden = false;
  m.innerHTML = `<div class="modal-caixa larga pp"><h2>Como você vai pagar?</h2><p class="pp-sub">Escolha uma opção</p>
    <div class="pp-ops"><button class="pp-op" data-acao="pagarCaixa"><span>💳</span><b>Pagar no caixa</b><small>Pra levar ou comer aqui</small></button>
    <button class="pp-op" data-acao="naComanda"><span>🍽</span><b>Na minha comanda</b><small>Estou almoçando e pago tudo no final</small></button></div>
    <button class="pp-voltar" data-acao="fecharModal">← Voltar ao pedido</button></div>`;
}
function pedirNumeroComanda() {
  $("#modal").innerHTML = `<div class="modal-caixa larga pp"><div class="pp-ic">🎫</div><h2>Qual o número da sua comanda?</h2><p class="pp-sub">É o número do cartão que você pegou na entrada.</p>
    <input id="num-comanda" class="campo-comanda pp-num" inputmode="numeric" maxlength="4" placeholder="Ex.: 12">
    <div class="pp-bts"><button class="pp-nao" data-acao="fecharModal">Voltar</button><button class="pp-sim" data-acao="confirmarComanda">Confirmar</button></div></div>`;
  Promise.resolve().then(() => { const i = $("#num-comanda"); if (i) i.focus(); });
}
async function finalizar(comandaNum) {
  if (enviando) return; enviando = true;
  const dia = hoje(), c = ler("contador", {}), local = (c.dia === dia ? c.n : 0) + 1;
  const ped = { uid: novoUid(), comanda: comandaNum || undefined, dia, nome: nomeCliente, quando: Date.now(), itens: carrinho,
    unidades: carrinho.reduce((s, c) => s + c.qtd, 0), valor: carrinho.reduce((s, c) => s + c.qtd * c.preco, 0) };
  let numero = local, pendente = false;
  // Wi-Fi lento: o cliente vê que está enviando (antes a tela ficava parada sem resposta e ele tocava de novo)
  const tEnv = setTimeout(() => { if (!enviando) return; const m = $("#modal"); m.hidden = false; m.innerHTML = `<div class="modal-caixa larga pp"><div class="pp-ic">⏳</div><h2>Enviando seu pedido…</h2><p class="pp-sub">Só um instante</p></div>`; }, 600);
  try { // manda pro servidor (o caixa enxerga na hora); ele devolve o número do pedido
    // Wi-Fi ruim: espera no máximo 8 s (antes o cliente ficava olhando a tela parada); não chegou, vai pra fila e o servidor não duplica (uid)
    const ab = typeof AbortController !== "undefined" ? new AbortController() : null, tm = ab && setTimeout(() => ab.abort(), 8000);
    let r; try { r = await fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ped), signal: ab ? ab.signal : undefined }); } finally { clearTimeout(tm); }
    if (!r.ok) throw 0; numero = (await r.json()).numero;
  } catch (e) { pendente = true; salvar("fila", [...ler("fila", []), { ...ped, numero: local }]); } // servidor fora: guarda e reenvia depois
  clearTimeout(tEnv); $("#modal").hidden = true;
  salvar("contador", { dia, n: Math.max(local, numero) });
  ultimo = { ...ped, numero, pendente }; salvar("pedidos", [...ler("pedidos", []), ultimo]);
  carrinho = []; tela = "sucesso"; enviando = false; render();
  setTimeout(() => imprimirEVoltar(), 300);
}

const mudarQtd = (i, d) => { carrinho[i].qtd += d; if (carrinho[i].qtd <= 0) carrinho.splice(i, 1); salvar("carrinho", carrinho); render(); };
const setCat = (id, ligado) => listaDe(id).forEach((i) => (ligado ? indisponiveis.delete(i.key) : indisponiveis.add(i.key)));

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-acao]"); if (!el) return;
  const d = el.dataset, a = d.acao;
  if (a === "logo") return;
  if (a === "comecar") { tela = "nome"; return render(); }
  if (a === "continuar") { nomeCliente = nomeCliente.trim(); if (!nomeCliente && ler("nomeObrigatorio", true)) return; tela = "menu"; return render(); }
  if (a === "marmitex") return iniciar(marmitexLista().find((m) => m.id === d.id));
  if (a === "escolher") return escolher(d.item);
  if (a === "proximo") { if (montagem.i < montagem.passos.length) { montagem.aviso = ""; avancarPara(montagem.i + 1); } else adicionar(); return; }
  if (a === "voltar") { let j = montagem.i - 1; while (j >= 0 && montagem.pagos[montagem.passos[j].id] === false) j--; if (j < 0) { montagem = null; tela = "menu"; } else montagem.i = j; return render(); }
  if (a === "sair") { if ((carrinho.length || montagem) && !confirm("Cancelar o pedido e voltar para o início?")) return; return reiniciar(); }
  if (a === "etapaAtual") { etapaAtual = d.id; filtroAdmin = ""; return render(); }
  if (a === "prodAtual") { prodAtual = d.id; return render(); }
  if (a === "regra") { const [id, campo, cat] = d.k.split("|"), cfg = ler("marmitexCfg", {}), o = (cfg[id] = cfg[id] || {}), m = marmitexLista().find((x) => x.id === id); o.regras = o.regras || {}; const r = (o.regras[cat] = o.regras[cat] || {}), atual = m ? m.regras[cat] : { min: 0, max: 0 };
    r.min = r.min !== undefined ? r.min : atual.min; r.max = r.max !== undefined ? r.max : atual.max; r[campo] = Math.max(0, Math.min(9, (r[campo] || 0) + Number(d.n)));
    if (campo === "min" && r.min > r.max) r.max = r.min; if (campo === "max" && r.min > r.max) r.min = r.max; salvar("marmitexCfg", cfg); return render(); }
  if (a === "moverEtapa") { const ids = etapasLista().map((c) => c.id), i = ids.indexOf(d.id), j = i + +d.dir;
    if (j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]]; salvar("etapasOrdem", ids); }
  if (a === "backup") return baixarBackup();
  if (a === "ajusteAtual") { ajusteAtual = d.id; return render(); }
  if (a === "syncAgora") { enviarConfig().then(() => { toast("Sincronizado!"); render(); }); return; }
  if (a === "salvarCardapio") { const nome = $("#cardapio-nome").value.trim(); if (!nome) return toast("Dê um nome (ex.: Segunda).");
    const cs = ler("cardapios", {}); cs[nome] = { on: ligadosAgora(), dia: cs[nome] ? cs[nome].dia : -1 }; salvar("cardapios", cs); salvar("cardapioAtivo", nome); toast("Cardápio salvo!"); }
  if (a === "atualizarCardapio") { const cs = ler("cardapios", {}); if (cs[d.nome]) { cs[d.nome].on = ligadosAgora(); salvar("cardapios", cs); toast("Cardápio atualizado!"); } }
  if (a === "aplicarCardapio") { aplicarCardapio(d.nome); toast('Cardápio "' + d.nome + '" aplicado!'); }
  if (a === "apagarCardapio") { if (!confirm('Apagar o cardápio salvo "' + d.nome + '"?')) return; const cs = ler("cardapios", {}); delete cs[d.nome]; salvar("cardapios", cs); }
  if (a === "duplicarEtapa") {
    const c = etapasLista().find((x) => x.id === d.id), nova = { id: "e" + Date.now(), nome: c.nome + " (cópia)", itens: [...categorias().find((x) => x.id === d.id).itens] };
    salvar("etapasExtras", [...ler("etapasExtras", []), nova]);
    if (c.adicional) { const ad = ler("etapasAdicional", {}); ad[nova.id] = c.adicional; salvar("etapasAdicional", ad); }
    const cfg = ler("marmitexCfg", {}); // mesmos mínimos/máximos em cada produto
    marmitexLista().forEach((m) => { cfg[m.id] = cfg[m.id] || {}; cfg[m.id].regras = cfg[m.id].regras || {}; cfg[m.id].regras[nova.id] = { ...m.regras[d.id] }; });
    salvar("marmitexCfg", cfg); etapaAtual = nova.id; toast("Etapa duplicada! Troque o nome dela abaixo.");
  }
  if (a === "pagarCaixa") { $("#modal").hidden = true; return finalizar(); }
  if (a === "naComanda") return pedirNumeroComanda();
  if (a === "confirmarComanda") { const n = parseInt(($("#num-comanda").value || "").trim(), 10); if (!(n >= 1 && n <= 9999)) return toast("Digite o número da sua comanda."); $("#modal").hidden = true; return finalizar(n); }
  if (a === "fecharModal") { $("#modal").hidden = true; return; }
  if (a === "obsSim" || a === "obsNao") { if (!montagem) return; $("#modal").hidden = true; if (a === "obsNao") return adicionar(); montagem.obsOk = true; montagem.i = montagem.passos.length; return render(); }
  if (a === "pagoSim" || a === "pagoNao") { if (montagem) responderPago(+d.n, a === "pagoSim"); return; }
  if (a === "pedirBebida") return addBebida(d.nome, d.tp);
  if (a === "semBebida") { tela = "menu"; return render(); }
  if (a === "bebidas") { tela = "bebidas"; return render(); }
  if (a === "doces") { tela = "doces"; return render(); }
  if (a === "modoApagar") { modoApagar = !modoApagar; return render(); }
  if (a === "apagarItem") {
    const i = d.id.indexOf(":"), cat = d.id.slice(0, i), nome = d.id.slice(i + 1);
    if (!confirm(`Apagar "${nome}" do cardápio?`)) return;
    if (cat === "bebida") bebidasExtras = bebidasExtras.filter((b) => b.nome !== nome); if (cat === "doce") docesExtras = docesExtras.filter((b) => b.nome !== nome); extras[cat] = (extras[cat] || []).filter((n) => n !== nome); removidos.add(d.id);
    salvar("extras", extras); salvar("bebidasExtras", bebidasExtras); salvar("docesExtras", docesExtras); salvar("removidos", [...removidos]); return render();
  }
  if (a === "salvarPin") {
    const v = ($("#novo-pin").value || "").trim(), role = $("#pin-role").value; if (!/^\d{4,8}$/.test(v)) return toast("Use de 4 a 8 números.");
    fetch("/api/senhas", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + (localStorage.getItem("tokenAdmin") || "") }, body: JSON.stringify({ role, pin: v }) })
      .then(async (r) => { const j = await r.json().catch(() => ({})); toast(r.ok ? "Senha alterada!" : j.erro || "Não foi possível alterar."); if (r.ok) { $("#novo-pin").value = ""; avisoSenhas(); } })
      .catch(() => toast("Sem conexão com o servidor.")); return;
  }
  if (a === "papel") { const c = ler("impCfg", {}); c.cols = +d.cols; salvar("impCfg", c); }
  if (a === "novoProduto" || a === "duplicar") {
    const base = a === "duplicar" ? marmitexLista().find((m) => m.id === d.id) : null;
    const nome = base ? base.nome + " (cópia)" : $("#np-nome").value.trim(), preco = base ? base.preco : parseFloat($("#np-preco").value.replace(",", "."));
    if (!nome || !(preco >= 0)) return toast("Digite o nome e o preço (ex.: 26,00).");
    const id = "p" + Date.now(), cfg = ler("marmitexCfg", {}); prodAtual = id;
    salvar("produtosExtras", [...ler("produtosExtras", []), { id, nome, preco, regras: {} }]);
    if (base) { cfg[id] = { regras: JSON.parse(JSON.stringify(base.regras)) }; salvar("marmitexCfg", cfg); }
    toast("Produto criado! Ajuste as etapas dele.");
  }
  if (a === "apagarProduto") {
    if (!confirm("Apagar este produto?")) return;
    const ext = ler("produtosExtras", []);
    if (ext.some((m) => m.id === d.id)) salvar("produtosExtras", ext.filter((m) => m.id !== d.id)); else salvar("produtosRemovidos", [...ler("produtosRemovidos", []), d.id]);
  }
  if (a === "novaEtapa") {
    const nome = $("#ne-nome").value.trim(); if (!nome) return toast("Digite o nome da etapa (ex.: Sobremesa).");
    salvar("etapasExtras", [...ler("etapasExtras", []), { id: (etapaAtual = "e" + Date.now()), nome, pergunta: "Escolha: " + nome, itens: [] }]);
    toast("Etapa criada! Defina o mínimo/máximo em cada produto e adicione os itens no Cardápio do dia.");
  }
  if (a === "apagarEtapa") {
    if (!confirm("Apagar esta etapa e seus itens?")) return;
    const ext = ler("etapasExtras", []);
    if (ext.some((c) => c.id === d.id)) salvar("etapasExtras", ext.filter((c) => c.id !== d.id)); else salvar("etapasRemovidas", [...ler("etapasRemovidas", []), d.id]);
  }
  if (a === "restaurarEstrutura") { salvar("produtosRemovidos", []); salvar("etapasRemovidas", []); }
  if (a === "resetCores") { salvar("cores", {}); location.reload(); return; }
  if (a === "ligarTudo") indisponiveis.clear();
  if (a === "restaurar") { removidos.clear(); salvar("removidos", []); }
  if (a === "novaBebida") {
    const nome = $("#nova-bebida").value.trim(), preco = parseFloat($("#preco-bebida").value.replace(",", "."));
    const tp = d.tp === "doce" ? "doce" : "bebida";
    if (!nome || !(preco >= 0) || avulsos(tp).some((b) => b.nome === nome)) return toast("Digite um nome novo e o preço (ex.: 6,50).");
    if (tp === "doce") { docesExtras.push({ nome, preco }); salvar("docesExtras", docesExtras); } else { bebidasExtras.push({ nome, preco }); salvar("bebidasExtras", bebidasExtras); }
    removidos.delete(tp + ":" + nome); salvar("removidos", [...removidos]);
  }
  if (a === "chipObs") { const ps = (montagem.obs || "").split(",").map((x) => x.trim()).filter(Boolean), k = ps.findIndex((x) => x.toLowerCase() === d.txt.toLowerCase()); if (k >= 0) ps.splice(k, 1); else ps.push(d.txt); montagem.obs = ps.join(", "); return render(); }
  if (a === "irPasso") { const k = +d.n, c = montagem.passos[k]; if (c.adicional > 0 && montagem.pagos[c.id] === false) { montagem.pagos[c.id] = undefined; return perguntarPago(k); } montagem.i = k; return render(); }
  if (a === "menosBeb") { const k = carrinho.findIndex((c) => c.key === (d.tp || "bebida") + "|" + d.nome); if (k >= 0) mudarQtd(k, -1); return; }
  if (a === "tecla") { if (pinDigitado.length < 8) pinDigitado += d.n; return desenharPin(); }
  if (a === "okPin") return entrarAdmin();
  if (a === "apagarPin") { pinDigitado = pinDigitado.slice(0, -1); return desenharPin(); }
  if (a === "cancelarPin") { $("#modal").hidden = true; if (VEIO_DA_BALANCA) location.href = "balanca.html"; return; }
  if (a === "aba") { abaAdmin = d.aba; modoApagar = false; filtroAdmin = ""; render(); $(".conteudo").scrollTop = 0; return; }
  if (a === "impRel") return imprimirTicket(linhasRelatorio());
  if (a === "relAtualizar") { relCache = { dia: null, ps: null, erro: "", carregando: false }; return render(); }
  if (a === "apagarDia") { const dia = diaRel || hoje(); if (confirm("Apagar todos os pedidos de " + dataBR(dia) + "?")) { salvar("pedidos", ler("pedidos", []).filter((p) => p.dia !== dia)); render(); } return; }
  if (a === "imprimir") return imprimirEVoltar();
  if (a === "mais") return mudarQtd(+d.i, 1);
  if (a === "menos") return mudarQtd(+d.i, -1);
  if (a === "remover") return mudarQtd(+d.i, -999);
  if (a === "finalizar") return perguntarComanda();
  if (a === "inicio") { if (VEIO_DA_BALANCA) { location.href = "balanca.html"; return; } return reiniciar(); }
  if (a === "toggle") { indisponiveis.has(d.id) ? indisponiveis.delete(d.id) : indisponiveis.add(d.id); filtroAdmin = ""; } // limpa a busca depois de clicar no item
  if (a === "resetLogos") { try { localStorage.removeItem("logoPequena"); localStorage.removeItem("logoGrande"); } catch (e) {} toast("Logos padrão restauradas."); }
  if (a === "testarImp") return testarConexao();
  if (a === "reimprimirFalhas") return reimprimirFalhas();
  if (a === "fecharFalhaImp") return fecharFalhaImp();
  if (a === "limparFalhas") { if (confirm("Descartar os pedidos que não foram impressos?")) { salvar("impFalhas", []); fecharFalhaImp(); render(); } return; }
  if (a === "testeImp") return imprimirTicket(linhasComanda(amostra()));
  if (a === "todos") setCat(d.cat, true);
  if (a === "nenhum") setCat(d.cat, false);
  if (a === "addExtra") {
    const c = categorias().find((x) => x.id === d.cat);
    const novos = [...new Set($("#novo-" + d.cat).value.split(/[\n;]+/).map((t) => t.trim()).filter((t) => t && !c.itens.includes(t)))];
    if (!novos.length) return toast("Digite um ou mais nomes novos (um por linha).");
    extras[d.cat] = [...(extras[d.cat] || []), ...novos]; novos.forEach((n) => removidos.delete(d.cat + ":" + n));
    salvar("extras", extras); salvar("removidos", [...removidos]); toast(novos.length + " item(ns) adicionado(s)!");
  }
  salvar("indisponiveis", [...indisponiveis]); render();
});

// imagem que não carregou: logo vira texto, foto some
document.addEventListener("error", (e) => {
  const t = e.target; if (t.tagName !== "IMG") return;
  if (t.classList.contains("logo")) t.outerHTML = `<div class="logo logo-texto">Da Lúcia</div>`;
  else if (t.classList.contains("logo-grande")) t.outerHTML = `<div class="logo-grande-texto">Da Lúcia<small>CANTINA & RESTAURANTE</small></div>`;
  else if (t.classList.contains("foto")) t.outerHTML = '<span class="sem-foto">🍱</span>';
}, true);

// ===== DESCANSO, NOME, INATIVIDADE =====
function htmlDescanso() {
  return `<div class="descanso" data-acao="comecar">
    <img class="logo-grande" src="${esc(ler("logoGrande", "img/logo-grande.png"))}" alt="Da Lúcia Cantina & Restaurante">
    ${ler("avisoDescanso", "") ? `<p class="aviso">${esc(ler("avisoDescanso", ""))}</p>` : ""}<div class="toque">${esc(ler("textoToque", "Toque na tela para iniciar"))}</div>
    <div class="logo-canto">${logoPeq()}</div></div>`;
}

async function imprimirEVoltar() { // imprime a comanda; se deu certo, volta pra tela inicial depois de 2 segundos
  const ok = await imprimirTicket(linhasComanda(ultimo));
  const rod = $("#suc-rod"); if (tela !== "sucesso" || !rod) return;
  if (ok === true) {
    rod.innerHTML = '✓ Comanda impressa! Voltando ao início...<div class="suc-barra"><i></i></div>';
    const id = ultimo && ultimo.numero; setTimeout(() => { if (tela === "sucesso" && ultimo && ultimo.numero === id) reiniciar(); }, 4000);
  } else rod.textContent = "Toque na tela para voltar ao início";
}
function reiniciar() { carrinho = []; nomeCliente = ""; montagem = null; tela = "descanso"; $("#modal").hidden = true; $("#modal").innerHTML = ""; render(); } // fecha qualquer popup aberto (salada, observação, pagamento) senão ele trava a tela inicial
// sem mexer na tela: volta pro descanso e limpa o carrinho (90s; 30s na tela de sucesso)
function resetIdle() {
  clearTimeout(tIdle);
  if (tela === "descanso" || tela === "admin") return;
  tIdle = setTimeout(reiniciar, tela === "sucesso" ? 30000 : ler("idle", 90) * 1000);
}

// segurar a logo por 1,5s abre o PIN do funcionário
document.addEventListener("pointerdown", (e) => { resetIdle(); if (e.target.closest('[data-acao="logo"]')) tHold = setTimeout(pedirPin, 1500); });
["pointerup", "pointercancel"].forEach((ev) => document.addEventListener(ev, () => clearTimeout(tHold)));
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("input", (e) => { if (e.target.id === "busca-adm") { filtroAdmin = e.target.value; aplicarFiltro(); } if (e.target.id === "obs") montagem.obs = e.target.value; if (e.target.id === "nome") { nomeCliente = e.target.value; $("#btn-nome").disabled = !nomeCliente.trim() && ler("nomeObrigatorio", true); } });
document.addEventListener("keydown", (e) => {
  resetIdle();
  if (e.key === "Enter" && e.target.id === "nome" && e.target.value.trim()) { nomeCliente = e.target.value.trim(); tela = "menu"; render(); }
});
// enviar logo pelo admin (fica salva no tablet)
document.addEventListener("change", (e) => {
  const k = e.target.dataset && e.target.dataset.logo, f = e.target.files && e.target.files[0];
  if (!k || !f) return;
  if (f.size > 1500000) return toast("Imagem grande demais (máx. 1,5 MB).");
  const r = new FileReader(); r.onload = () => { salvar(k, r.result); toast("Logo salva!"); }; r.readAsDataURL(f);
});

// ===== OBSERVAÇÃO, SENHA, ADMIN, RELATÓRIO, IMPRESSÃO =====
function pedirPin() { pinDigitado = ""; $("#modal").hidden = true; desenharPin(); }
const pontosPin = () => Array.from({ length: Math.max(4, pinDigitado.length) }, (_, i) => `<span class="${i < pinDigitado.length ? "cheio" : ""}"></span>`).join("");
function desenharPin(erro) {
  const m = $("#modal"), msg = typeof erro === "string" ? erro : erro ? "Senha incorreta, tente de novo" : "Digite a senha";
  if (!m.hidden && $("#pin-pontos")) { // já está aberta: só troca os pontinhos
    $("#pin-pontos").innerHTML = pontosPin(); $("#pin-msg").textContent = msg; $("#pin-msg").className = erro ? "erro" : ""; return;
  }
  m.hidden = false;
  m.innerHTML = `<div class="modal-caixa"><h2>Área do funcionário</h2><p id="pin-msg" class="${erro ? "erro" : ""}">${msg}</p><div class="pontos" id="pin-pontos">${pontosPin()}</div>
    <div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-acao="tecla" data-n="${n}">${n}</button>`).join("")}
    <button data-acao="cancelarPin">Cancelar</button><button data-acao="tecla" data-n="0">0</button><button data-acao="apagarPin">⌫</button></div>
    <button class="btn-prim" data-acao="okPin" style="width:100%;margin-top:10px">Entrar</button></div>`;
}
async function entrarAdmin() { // quem confere a senha é o servidor
  const pin = pinDigitado; if (pin.length < 4) return desenharPin("Digite a senha");
  const admitir = () => { pinDigitado = ""; $("#modal").hidden = true; tela = "admin"; abaAdmin = "cardapio"; diaRel = null; modoApagar = false; render(); };
  if (location.protocol === "file:") { if (pin === String(PIN_ADMIN)) return admitir(); pinDigitado = ""; return desenharPin("Senha incorreta"); } // sem servidor (só pra testar localmente)
  try {
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "admin", pin }) }), j = await r.json().catch(() => ({}));
    if (r.ok && j.role === "admin") { localStorage.setItem("tokenAdmin", j.token); return admitir(); }
    pinDigitado = ""; desenharPin(r.status === 429 ? "Muitas tentativas. Aguarde alguns minutos." : r.ok ? "Essa senha não é de administrador" : "Senha incorreta");
  } catch (e) { pinDigitado = ""; desenharPin("Sem conexão com o servidor"); }
}
async function avisoSenhas() { // avisa se alguma senha ainda é a padrão
  try {
    const r = await fetch("/api/senhas", { headers: { Authorization: "Bearer " + (localStorage.getItem("tokenAdmin") || "") } }); if (!r.ok) return;
    const p = Object.keys((await r.json()).padrao || {}), el = $("#aviso-senhas");
    if (el && p.length) { el.hidden = false; el.textContent = "⚠ Ainda é a senha padrão em: " + p.join(", ") + ". Troque agora."; }
  } catch (e) {}
}

function addBebida(nome, tp) { // também serve pros doces (tp = "doce")
  tp = tp === "doce" ? "doce" : "bebida";
  const b = avulsos(tp).find((x) => x.nome === nome), key = tp + "|" + nome, ex = carrinho.find((c) => c.key === key);
  if (!b) return;
  if (ex) ex.qtd++; else carrinho.push({ key, tipo: tp, nome, preco: b.preco, grupos: [], obs: "", qtd: 1 });
  salvar("carrinho", carrinho); render(); pulsaCarrinho();
}
// foto da bebida: escolhe o arquivo em fotos/bebidas/ pelo nome cadastrado (sem foto = continua o 🥤)
function fotoBebida(nome) {
  const n = String(nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const zero = /zero|sem acucar|diet|light/.test(n), grande = /600|pet|garrafa/.test(n), lata = /lata|350/.test(n);
  if (/h2o/.test(n)) return "h2oh-limao";
  if (/guaran/.test(n)) return grande ? (zero ? "guarana-600-zero" : "guarana-600") : (zero ? "guarana-zero-lata" : "guarana-lata");
  if (/sprite/.test(n)) return zero ? "sprite-zero-lata" : "sprite-lata";
  if (/pepsi/.test(n)) return zero || /black/.test(n) ? "pepsi-black-lata" : "pepsi-lata";
  if (/fanta/.test(n)) return /uva/.test(n) ? "fanta-uva" : /maracuj/.test(n) ? "fanta-maracuja" : /laranja/.test(n) ? "fanta-laranja" : null;
  if (/del ?valle|dell ?valle/.test(n)) return /uva/.test(n) ? "del-valle-uva" : /pessego/.test(n) ? "del-valle-pessego" : /maracuj/.test(n) ? "del-valle-maracuja" : /manga/.test(n) ? "del-valle-manga" : /goiaba/.test(n) ? "del-valle-goiaba" : null;
  if (/schwepp|scheppez/.test(n) && /citrus/.test(n)) return "schweppes-citrus";
  if (/\bcha\b|ice ?tea|leao/.test(n)) return /pessego/.test(n) ? "cha-pessego" : /limao/.test(n) ? "cha-limao" : null;
  if (/suco/.test(n)) return /viag|levar/.test(n) ? "suco-natural-g-viagem" : /\bp\b|pequeno|300/.test(n) ? "suco-natural-p" : "suco-natural-g";
  if (/tonica|schweppes/.test(n)) return "agua-tonica";
  if (/agua/.test(n)) return /com ?gas|gasosa/.test(n) ? "agua-com-gas" : "agua-sem-gas";
  if (/coca/.test(n) && /\bks\b|retorn|vidro|290/.test(n)) return zero ? "coca-ks-zero" : "coca-ks";
  if (/coca/.test(n)) return zero ? (grande ? "coca-600-zero" : "coca-lata-zero") : (lata ? "coca-lata" : "coca-600");
  return null;
}
const listaDe = (id) => id === "produto" ? marmitexLista().map((m) => ({ key: "produto:" + m.id, label: m.nome + " - " + brl(m.preco) })) : id === "bebida"
  ? bebidasLista().map((b) => ({ key: "bebida:" + b.nome, label: b.nome + " - " + brl(b.preco) })) : id === "doce"
  ? docesLista().map((b) => ({ key: "doce:" + b.nome, label: b.nome + " - " + brl(b.preco) }))
  : categorias().find((c) => c.id === id).itens.slice().sort((x, y) => x.localeCompare(y, "pt-BR", { sensitivity: "base", numeric: true })).map((n) => ({ key: id + ":" + n, label: n })); // ordem alfabética
const nomeEtapa = (id) => (id === "produto" ? "Produtos" : id === "bebida" ? "Bebidas" : id === "doce" ? "Doces" : (etapasLista().find((c) => c.id === id) || {}).nome);
function adminAjustes() {
  const abas = [["aparencia", "🎨 Aparência"], ["uso", "🔒 Segurança e uso"], ["dados", "💾 Dados e servidor"]];
  const idle = ler("idle", 90), t = parseInt(localStorage.getItem("cfgT") || "0", 10);
  const corpo = {
    aparencia: () => `<div class="ajuda">🎨 Cores, textos e logos do totem.</div>${aparencia()}
      <div class="bloco"><h3>Logos</h3><div class="a2-logos">
        <div class="a2-logo"><img src="${esc(ler("logoPequena", "img/logo.png"))}" alt="" class="red" onerror="this.style.visibility='hidden'"><b>Logo redonda</b><small>topo, canto e papel impresso</small><label class="a2-b">📷 Trocar<input type="file" accept="image/*" data-logo="logoPequena" hidden></label></div>
        <div class="a2-logo"><img src="${esc(ler("logoGrande", "img/logo-grande.png"))}" alt="" onerror="this.style.visibility='hidden'"><b>Logo grande</b><small>tela de descanso</small><label class="a2-b">📷 Trocar<input type="file" accept="image/*" data-logo="logoGrande" hidden></label></div></div>
      <p><button class="a2-b" data-acao="resetLogos">↩ Voltar às logos padrão (pasta img)</button></p></div>`,
    uso: () => `<div class="ajuda">🔒 Como o totem se comporta com o cliente e quem entra no admin.</div>
      <div class="bloco"><h3>Botão Início</h3><label><input type="checkbox" data-opt="mostrarInicio" ${ler("mostrarInicio", true) ? "checked" : ""}> Mostrar o botão "Início" pro cliente voltar à tela de descanso</label></div>
      <div class="bloco"><h3>Pedido na comanda</h3><label><input type="checkbox" data-opt="perguntarComanda" ${ler("perguntarComanda", true) ? "checked" : ""}> Ao finalizar, perguntar se o pedido entra na comanda de quem está almoçando</label></div>
      <div class="bloco"><h3>Teclado na tela</h3><p>Troca o teclado do Android por um teclado do próprio sistema (nome, observação e campos do admin).</p>
      <select data-tecl="1">${[["auto", "Automático (só em telas de toque)"], ["sempre", "Sempre"], ["nunca", "Nunca (usar o teclado do aparelho)"]].map(([v, t]) => `<option value="${v}" ${(localStorage.getItem("tecladoVirtual") || "auto") === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="bloco"><h3>Nome do cliente</h3><label><input type="checkbox" data-opt="nomeObrigatorio" ${ler("nomeObrigatorio", true) ? "checked" : ""}> Exigir o nome do cliente antes de começar o pedido</label></div>
      <div class="bloco"><h3>Cardápio automático</h3><label><input type="checkbox" data-opt="autoCardapio" ${ler("autoCardapio", false) ? "checked" : ""}> Aplicar sozinho, a cada dia, o cardápio salvo marcado com aquele dia da semana</label><p>O dia de cada cardápio você escolhe na aba <b>Hoje</b>.</p></div>
      <div class="bloco"><h3>Tamanho dos textos</h3><select data-esc="1">${[[16, "Normal"], [18, "Grande"], [20, "Muito grande"]].map(([v, t]) => `<option value="${v}" ${ler("escala", 16) === v ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="bloco"><h3>Tempo de inatividade</h3><p>Se o cliente largar o totem parado, ele volta pra tela inicial e limpa o carrinho depois de:</p>
      <select id="sel-idle">${[30, 60, 90, 120, 180].map((x) => `<option value="${x}" ${x === idle ? "selected" : ""}>${x} segundos</option>`).join("")}</select></div>
      <div class="bloco"><h3>Senhas do sistema</h3><p>Cada nível tem a sua senha: <b>admin</b> (tudo), <b>caixa</b> (receber e contas) e <b>balança</b> (só lançar). Quem estava logado com a senha antiga é desconectado.</p>
      <p id="aviso-senhas" class="aviso-pend" hidden></p>
      <div class="novo"><select id="pin-role"><option value="admin">Admin</option><option value="caixa">Caixa</option><option value="balanca">Balança</option></select><input id="novo-pin" inputmode="numeric" maxlength="8" placeholder="Nova senha (4 a 8 números)"><button data-acao="salvarPin">Salvar senha</button></div></div>`,
    dados: () => `<div class="ajuda">💾 Cópia de segurança das configurações e ajuda quando algo some por engano.</div>
      <div class="bloco"><h3>Servidor</h3><p>${t ? "Última cópia das configurações no servidor: <b>" + new Date(t).toLocaleString("pt-BR") + "</b>" : "Ainda sem cópia no servidor (desligado ou sem conexão)."}</p>
      <p>Isso acontece sozinho a cada mudança. O botão força na hora.</p><button class="btn-sec" data-acao="syncAgora">Sincronizar agora</button></div>
      <div class="bloco"><h3>Backup em arquivo</h3><p>Baixa um arquivo com produtos, etapas, cardápio, cores e impressão.</p>
      <button class="btn-sec" data-acao="backup">Baixar backup</button><p>Restaurar de um arquivo: <input type="file" accept=".json" data-restore="1"></p></div>
      <div class="bloco"><h3>Desfazer</h3><p><button class="btn-sec" data-acao="ligarTudo">Ligar todos os itens</button></p>
      <p><button class="btn-sec" data-acao="restaurar">Restaurar itens apagados</button></p><p><button class="btn-sec" data-acao="restaurarEstrutura">Restaurar produtos e etapas apagados</button></p></div>`,
  }[ajusteAtual]();
  return `<div class="pills">${abas.map(([id, nome]) => `<button class="pill ${ajusteAtual === id ? "on" : ""}" data-acao="ajusteAtual" data-id="${id}">${nome}</button>`).join("")}</div>${corpo}`;
}

const soma = (a, f) => a.reduce((s, x) => s + f(x), 0);
const dataBR = (d) => d.split("-").reverse().join("/");
// relCache: pedidos do totem buscados no servidor pro dia escolhido (o tablet só guarda os que ELE fez, e perde ao trocar de endereço)
// só o que foi vendido NO TOTEM: fora comandas da balança, delivery e os doces que o caixa lança (marcados origem "caixa";
// os antigos, sem marca, são os pedidos só de doce sem nome de cliente ou com nome "Doces - ...")
const ehDoce = (c) => c.tipo === "doce" || String(c.key || "").startsWith("doce|");
const doTotem = (p) => !p.tipo && p.status !== "cancelado" && p.origem !== "caixa" && !((p.itens || []).length && p.itens.every(ehDoce) && (!p.nome || /^Doces - /.test(p.nome)));
let relCache = { dia: null, ps: null, erro: "", carregando: false };
async function carregarRel(dia) {
  relCache = { dia, ps: null, erro: "", carregando: true };
  try {
    const r = await fetch("/api/pedidos?dia=" + dia, { headers: { Authorization: "Bearer " + (localStorage.getItem("tokenAdmin") || "") } });
    if (r.status === 401 || r.status === 403) throw new Error("sessão do admin expirou: saia e entre de novo no admin");
    if (!r.ok) throw new Error("o servidor respondeu " + r.status);
    const L = await r.json();
    relCache = { dia, ps: L.filter(doTotem), erro: "", carregando: false };
  } catch (e) { relCache = { dia, ps: null, erro: e.message === "Failed to fetch" ? "sem conexão com o servidor" : e.message, carregando: false }; }
  if (tela === "admin" && abaAdmin === "relatorio" && (diaRel || hoje()) === dia) render();
}
function dadosDia() {
  const dia = diaRel || hoje();
  if (relCache.dia !== dia && !relCache.carregando) carregarRel(dia);
  const doServidor = relCache.dia === dia && Array.isArray(relCache.ps), ps = doServidor ? relCache.ps : ler("pedidos", []).filter((p) => p.dia === dia), tipo = {}, item = {};
  ps.forEach((p) => p.itens.forEach((c) => {
    const t = (tipo[c.nome] = tipo[c.nome] || { q: 0, v: 0 }); t.q += c.qtd; t.v += c.qtd * c.preco;
    ((c.grupos || []).length ? (c.grupos || []).flatMap((g) => g.itens) : [c.nome]).forEach((n) => { item[n] = (item[n] || 0) + c.qtd; });
  }));
  const un = soma(ps, (p) => soma(p.itens.filter((c) => c.tipo !== "bebida" && c.tipo !== "doce"), (c) => c.qtd)), beb = soma(ps, (p) => soma(p.itens.filter((c) => c.tipo === "bebida"), (c) => c.qtd)), val = soma(ps, (p) => p.valor);
  return { dia, ps, tipo, un, beb, val, medio: ps.length ? val / ps.length : 0, rank: Object.entries(item).sort((a, b) => b[1] - a[1]).slice(0, 10), doServidor };
}

function adminRelatorio() {
  const r = dadosDia(), max = r.rank.length ? r.rank[0][1] : 1;
  const dias = [...new Set([...Array.from({ length: 60 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toLocaleDateString("en-CA"); }), ...ler("pedidos", []).map((p) => p.dia)])].sort().reverse();
  const aviso = relCache.dia === r.dia && relCache.carregando && !r.doServidor ? `<p class="rel-aviso">Buscando as vendas no servidor…</p>` : !r.doServidor && relCache.dia === r.dia && relCache.erro ? `<p class="rel-aviso erro">Não consegui buscar no servidor (${esc(relCache.erro)}). Mostrando só os pedidos guardados neste aparelho.</p>` : "";
  return `<div class="rel-topo"><label>Dia: <select id="sel-dia">${dias.map((x) => `<option value="${x}" ${x === r.dia ? "selected" : ""}>${dataBR(x)}</option>`).join("")}</select></label>
    <button class="btn-sec" data-acao="impRel">Imprimir resumo</button><button class="btn-sec" data-acao="relAtualizar">Atualizar</button></div>${aviso}
    <div class="cards"><div><b>${r.ps.length}</b>pedidos</div><div><b>${r.un}</b>marmitex</div><div><b>${r.beb}</b>bebidas</div><div><b>${brl(r.val)}</b>faturamento</div><div><b>${brl(r.medio)}</b>ticket médio</div></div>
    <h3>Por tipo</h3><table>${Object.entries(r.tipo).map(([n, t]) => `<tr><td>${esc(n)}</td><td>${t.q}x</td><td>${brl(t.v)}</td></tr>`).join("") || "<tr><td>Sem vendas.</td></tr>"}</table>
    <h3>Itens mais pedidos</h3>${r.rank.map(([n, q]) => `<div class="rank"><span>${esc(n)}</span><i style="width:${(q / max) * 60}%"></i><b>${q}</b></div>`).join("") || "<p>Sem vendas.</p>"}
    <h3>Pedidos do dia</h3><table>${[...r.ps].reverse().map((p) => `<tr><td>#${p.numero}</td><td>${new Date(p.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td><td>${esc(p.nome || "-")}</td><td>${p.unidades} un</td><td>${brl(p.valor)}</td></tr>`).join("") || "<tr><td>Sem pedidos.</td></tr>"}</table>`;
}

// ----- impressão (ESC/POS) -----
const semAcento = (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function quebrar(t, larg) {
  const out = []; let l = "";
  semAcento(t).split(" ").forEach((p) => { if ((l + " " + p).trim().length > larg && l) { out.push(l); l = p; } else l = (l + " " + p).trim(); });
  if (l) out.push(l); return out;
}
function linhasRelatorio() {
  const r = dadosDia(), tr = { t: "-".repeat(largura()) };
  const L = [{ t: "RELATORIO DO DIA", c: 1, b: 1 }, { t: dataBR(r.dia), c: 1 }, tr, { t: `Pedidos: ${r.ps.length}`, b: 1 }, { t: `Marmitex: ${r.un}`, b: 1 }, { t: `Bebidas: ${r.beb}` },
    { t: `Faturamento: ${brl(r.val)}`, b: 1 }, { t: `Ticket medio: ${brl(r.medio)}` }, tr];
  Object.entries(r.tipo).forEach(([n, t]) => L.push({ t: `${t.q}x ${n} = ${brl(t.v)}` }));
  L.push(tr, { t: "MAIS PEDIDOS", b: 1 }); r.rank.slice(0, 5).forEach(([n, q]) => L.push({ t: `${q}x ${n}` }));
  return L;
}
// ----- envio pra impressora de rede (pelo servidor) -----
const ipValido = (ip) => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || "").trim()); return !!m && m.slice(1).every((n) => +n <= 255); };
function erroImp(msg) { // traduz o erro técnico pra uma frase que qualquer um entende
  const m = String(msg || "").toLowerCase();
  if (/refused|econnrefused/.test(m)) return "A impressora recusou a conexão. Confira a porta (normalmente 9100) e se a impressão por rede está ativa nela.";
  if (/timed? ?out|timeout|etimedout/.test(m)) return "A impressora não respondeu a tempo. Confira se está ligada, com o cabo de rede no roteador, e se o IP está certo.";
  if (/unreach|enetunreach|no route/.test(m)) return "O computador não encontra esse IP na rede. Confira se o IP está certo e se tudo está na mesma rede.";
  if (/enotfound|getaddrinfo|invalid/.test(m)) return "Endereço inválido. Use o IP da impressora, por exemplo 192.168.1.50.";
  if (/reset|econnreset|epipe/.test(m)) return "A conexão com a impressora caiu no meio do envio. Tente de novo.";
  return msg ? "Erro da impressora: " + msg : "Não foi possível falar com a impressora.";
}
const bytesParaB64 = (bytes) => { let b = ""; bytes.forEach((x) => (b += String.fromCharCode(x))); return btoa(b); };
async function mandarParaImpressora(dados, k) {
  const t0 = performance.now(), ac = new AbortController(), to = setTimeout(() => ac.abort(), 12000); let r, j = {};
  try {
    r = await fetch("/api/imprimir", { method: "POST", headers: { "Content-Type": "application/json" }, signal: ac.signal, body: JSON.stringify({ ip: String(k.ip).trim(), porta: k.porta || 9100, dados }) });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    return { ok: false, erro: e && e.name === "AbortError" ? "A impressora demorou demais para responder. Confira se está ligada e com o cabo de rede." : "Não consegui falar com o computador (servidor). Confira se ele está ligado e com o programa aberto." };
  } finally { clearTimeout(to); }
  if (!r.ok) return { ok: false, erro: erroImp(j.erro) + (j.ip ? " (o servidor tentou " + j.ip + ":" + j.porta + ")" : "") };
  return { ok: true, ms: Math.round(performance.now() - t0) };
}
// teste de conexão (não gasta papel: só manda o comando de "iniciar" pra impressora)
let statusImp = null;
const htmlStatusImp = () => `<div id="imp-status" class="imp-status ${statusImp ? statusImp.tipo : "vazio"}">${statusImp ? statusImp.html : "Ainda não testado. Toque em “Testar conexão”."}</div>`;
function pintarStatusImp() { const el = $("#imp-status"); if (el) el.outerHTML = htmlStatusImp(); }
async function testarConexao() {
  const k = impCfg();
  if (!k.ip) { statusImp = { tipo: "erro", html: "✕ Digite o IP da impressora primeiro." }; return pintarStatusImp(); }
  if (!ipValido(k.ip)) { statusImp = { tipo: "erro", html: "✕ Esse IP parece incorreto. Use o formato 192.168.1.50." }; return pintarStatusImp(); }
  statusImp = { tipo: "testando", html: "⏳ Testando a conexão..." }; pintarStatusImp();
  if (!(await enviarConfig())) { statusImp = { tipo: "erro", html: "✕ Não consegui gravar o IP no servidor. Entre como admin (segure o logo e digite a senha) e tente de novo." }; return pintarStatusImp(); }
  const r = await mandarParaImpressora(bytesParaB64([0x1B, 0x40]), k);
  statusImp = r.ok ? { tipo: "ok", html: `✓ Impressora conectada <small>(respondeu em ${r.ms} ms)</small>` } : { tipo: "erro", html: "✕ " + esc(r.erro) };
  pintarStatusImp();
}
// pedidos que não saíram ficam guardados pra imprimir de novo
const falhasImp = () => ler("impFalhas", []);
function guardarFalha(f) { const l = falhasImp(); l.push({ ...f, id: Date.now() + Math.random() }); salvar("impFalhas", l.slice(-30)); }
function mostrarFalhaImp(erro) {
  let el = $("#falha-imp"); if (!el) { el = document.createElement("div"); el.id = "falha-imp"; document.body.appendChild(el); }
  const n = falhasImp().length;
  el.innerHTML = `<div class="fi-corpo"><div class="fi-ic">🖨️</div><div class="fi-txt"><b>${n > 1 ? n + " pedidos não foram impressos" : "O pedido não foi impresso"}</b><span>${esc(erro || "")}</span><small>Avise um atendente. O pedido ficou guardado e pode ser impresso de novo.</small></div>
    <div class="fi-bt"><button data-acao="reimprimirFalhas">Tentar de novo</button><button data-acao="fecharFalhaImp">Fechar</button></div></div>`;
  el.hidden = false;
}
const fecharFalhaImp = () => { const el = $("#falha-imp"); if (el) el.hidden = true; };
async function reimprimirFalhas() {
  const k = impCfg(), fila = falhasImp(); if (!fila.length) { fecharFalhaImp(); return toast("Não tem nada pra imprimir."); }
  toast("Imprimindo...");
  const restantes = []; let erro = "";
  for (const f of fila) { const r = k.ip ? await mandarParaImpressora(f.dados, k) : { ok: false, erro: "Falta o IP da impressora (Admin → Impressão)." }; if (!r.ok) { restantes.push(f); erro = r.erro; } }
  salvar("impFalhas", restantes);
  if (restantes.length) mostrarFalhaImp(erro); else { fecharFalhaImp(); toast("Tudo impresso!"); }
  if (tela === "admin") render();
}
function blocoFalhas() {
  const l = falhasImp(); if (!l.length) return "";
  return `<div class="bloco"><h3>⚠ Pedidos que não foram impressos (${l.length})</h3><p>Ficaram guardados porque a impressora não respondeu. Confira se ela está ligada e toque em reimprimir.</p>
    <ul class="imp-falhas">${l.map((f) => `<li><b>${esc(f.titulo || "Pedido")}</b><span>${new Date(f.quando).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span></li>`).join("")}</ul>
    <p><button class="btn-sec" data-acao="reimprimirFalhas">Reimprimir todos</button> <button class="btn-sec" data-acao="limparFalhas">Descartar</button></p></div>`;
}
async function enviarServidor(bytes, k, titulo) {
  const dados = bytesParaB64(bytes);
  let r = k.ip ? await mandarParaImpressora(dados, k) : { ok: false, erro: "Falta o IP da impressora (Admin → Impressão)." };
  if (!r.ok && k.ip) { await new Promise((res) => setTimeout(res, 1200)); r = await mandarParaImpressora(dados, k); } // uma segunda tentativa antes de avisar
  if (r.ok) { toast("Impresso!"); return true; }
  guardarFalha({ dados, titulo: titulo || "Pedido", quando: Date.now() }); mostrarFalhaImp(r.erro);
  if (tela === "admin") render();
  return false;
}
async function imprimirTicket(linhas) {
  const k = impCfg(); await prepararLogoImp(); // a logo do cabeçalho precisa estar carregada antes de montar os bytes
  if (k.modo === "servidor") return enviarServidor(escpos(linhas), k, ((linhas.find((l) => /comanda|pedido|ticket|relat/i.test(l.t || "")) || linhas.find((l) => l.t && l.t.trim()) || {}).t || "").trim().slice(0, 40));
  if (k.modo === "rawbt" && /android/i.test(navigator.userAgent)) {
    let b = ""; escpos(linhas).forEach((x) => (b += String.fromCharCode(x)));
    const url = "intent:base64," + btoa(b) + "#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;";
    if (k.via === "fully" && window.fully && typeof fully.startIntent === "function") fully.startIntent(url); else window.location.href = url;
  } else { $("#comanda").innerHTML = "<pre>" + esc(linhas.map((l) => l.t).join("\n")) + "</pre>"; window.print(); }
}
document.addEventListener("change", (e) => { if (e.target.id === "sel-idle") { salvar("idle", +e.target.value); toast("Salvo!"); }
  if (e.target.id === "sel-dia") { diaRel = e.target.value; render(); } });

// ===== PROGRESSO, BUSCA NO ADMIN, REENVIO =====
const progresso = (passos, i) => `<div class="progresso">${[...passos.map((c) => c.nome), "Obs"].map((n, k) => `<span class="${k < i ? "feito" : k === i ? "atual" : ""}">${n}</span>`).join("")}</div>`;
function aplicarFiltro() {
  const q = semAcento(filtroAdmin).toLowerCase();
  document.querySelectorAll(".admin .chip").forEach((c) => (c.hidden = !!q && !semAcento(c.textContent).toLowerCase().includes(q)));
}
async function enviarFila() { // pedidos que não chegaram no servidor
  const fila = ler("fila", []), resta = []; if (!fila.length) return;
  for (const p of fila) {
    try { const r = await fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) }); if (!r.ok && r.status >= 500) resta.push(p); }
    catch (e) { resta.push(p); }
  }
  // pedido que entrou na fila ENQUANTO esta reenviava não pode sumir (antes era apagado aqui)
  const novos = ler("fila", []).filter((x) => !fila.some((f) => f.uid === x.uid)); salvar("fila", resta.concat(novos));
}
setInterval(enviarFila, 15000);

// ===== PERSONALIZAÇÃO (etapas, preços, cores, textos) =====
// valor padrão da etapa: se não houver ajuste no admin, usa o "adicional" do dados.js ou o "- R$ 1,00" escrito no nome
const valorNoNome = (nome) => { const m = String(nome || "").match(/R\$\s*(\d+(?:[.,]\d+)?)\s*$/); return m ? parseFloat(m[1].replace(",", ".")) : 0; };
const etapasLista = () => {
  const rem = ler("etapasRemovidas", []), ad = ler("etapasAdicional", {}), ord = ler("etapasOrdem", []), inf = ler("etapasInfo", {});
  return [...CATEGORIAS, ...ler("etapasExtras", [])].filter((c) => !rem.includes(c.id)).map((c) => { const i = inf[c.id] || {}, nome = i.nome || c.nome; return { ...c, nome, pergunta: i.pergunta || c.pergunta || "Escolha: " + nome, adicional: ad[c.id] !== undefined ? ad[c.id] : (c.adicional || valorNoNome(c.nome)) }; })
    .sort((a, b) => { const i = ord.indexOf(a.id), j = ord.indexOf(b.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); });
};
const marmitexLista = () => {
  const cfg = ler("marmitexCfg", {}), rem = ler("produtosRemovidos", []);
  return [...MARMITEX, ...ler("produtosExtras", [])].filter((m) => !rem.includes(m.id)).map((m) => {
    const o = cfg[m.id] || {}, regras = {};
    etapasLista().forEach((c) => {
      const n = (m.regras && m.regras[c.id]) || 0, ov = (o.regras && o.regras[c.id]) || {};
      const max = ov.max !== undefined ? ov.max : n, min = Math.min(ov.min !== undefined ? ov.min : (n ? 1 : 0), max);
      regras[c.id] = { min, max };
    });
    return { ...m, nome: o.nome || m.nome, preco: o.preco !== undefined ? o.preco : m.preco, foto: ler("foto:" + m.id, m.foto || ""), regras };
  });
};
const aplicarCores = () => { document.documentElement.style.fontSize = ler("escala", 16) + "px"; const c = ler("cores", {}); Object.keys(c).forEach((k) => document.documentElement.style.setProperty(k, c[k])); };

function aparencia() {
  const cores = ler("cores", {});
  return `<div class="bloco"><h3>Aparência e textos</h3>
    <p>Cor principal (laranja): <input type="color" data-cor="--laranja" value="${cores["--laranja"] || "#FFA500"}">
    Cor de destaque (vermelho): <input type="color" data-cor="--vermelho" value="${cores["--vermelho"] || "#A50F14"}">
    <button data-acao="resetCores">Cores originais</button></p>
    <p>Texto da tela de descanso:</p><input class="busca" data-txt="textoToque" value="${esc(ler("textoToque", "Toque na tela para iniciar"))}">
    <p>Aviso na tela de descanso (opcional):</p><input class="busca" data-txt="avisoDescanso" placeholder="Ex.: Hoje tem feijoada completa!" value="${esc(ler("avisoDescanso", ""))}">
    </div>`;
}

document.addEventListener("change", (e) => {
  const d = e.target.dataset || {};
  if (d.cfg) {
    const [id, campo, cat] = d.cfg.split("|"), cfg = ler("marmitexCfg", {}), o = (cfg[id] = cfg[id] || {}); let v = e.target.value.trim();
    if (campo === "nome") { if (!v) return toast("O nome não pode ficar vazio."); o.nome = v; }
    else if (campo === "preco") { v = parseFloat(v.replace(",", ".")); if (!(v >= 0)) return toast("Preço inválido."); o.preco = v; }
    else { o.regras = o.regras || {}; const r = (o.regras[cat] = o.regras[cat] || {}); r[campo] = Math.max(0, Math.min(9, parseInt(v) || 0)); }
    salvar("marmitexCfg", cfg); render(); toast("Salvo!");
  }
  if (d.cor) { const c = ler("cores", {}); c[d.cor] = e.target.value; salvar("cores", c); aplicarCores(); toast("Cor salva!"); }
  if (d.txt) { salvar(d.txt, e.target.value); toast("Salvo!"); }
});
function pulsaCarrinho() { const c = $("#carrinho"); c.classList.remove("pulsa"); void c.offsetWidth; c.classList.add("pulsa"); }

// ===== LAYOUT DA COMANDA (tamanhos de letra, alinhamento, prévia) =====
const TAMS = { pequena: [0, 1.3, 1], normal: [0, 1, 0], alta: [1, 1, 0], grande: [0x11, 0.5, 0], gigante: [0x22, 1 / 3, 0] }; // [tamanho GS!, fator de colunas, fonte B]
const LAYOUT = () => [
  { id: "loja", nome: "Cabeçalho: logo no canto + nome", texto: "DA LÚCIA", mostrar: true, tam: "grande", alin: "l", neg: true },
  { id: "titulo", nome: "Título", texto: "COMANDA", mostrar: true, tam: "normal", alin: "c", neg: true },
  { id: "numero", nome: "Número do pedido", mostrar: true, tam: "gigante", alin: "c", neg: true },
  { id: "cliente", nome: "Nome do cliente", mostrar: true, tam: "grande", alin: "c", neg: true },
  { id: "data", nome: "Data e hora", mostrar: true, tam: "pequena", alin: "c", neg: false },
  { id: "itens", nome: "Produto (ex.: 2x Marmitex)", mostrar: true, tam: "alta", alin: "l", neg: true },
  { id: "detalhes", nome: "Etapas escolhidas", mostrar: true, tam: "normal", alin: "l", neg: false },
  { id: "obs", nome: "Observação", mostrar: true, tam: "alta", alin: "l", neg: true },
  { id: "total", nome: "Total", mostrar: true, tam: "alta", alin: "l", neg: true },
  { id: "rodape", nome: "Frase final", texto: ler("rodapeComanda", "Pagar no caixa"), mostrar: true, tam: "normal", alin: "c", neg: false },
];
const layoutBlocos = () => { const o = ler("layout", {}), r = {}; LAYOUT().forEach((b) => (r[b.id] = { ...b, ...(o[b.id] || {}) })); return r; };

function linhasComanda(p) {
  const B = layoutBlocos(), sep = ler("layoutSep", "-"), tr = sep ? { t: sep.repeat(largura()), s: "normal" } : null, L = [];
  const adics = new Set(etapasLista().filter((c) => c.adicional > 0).map((c) => c.nome));
  const add = (id, texto) => { const b = B[id]; if (b.mostrar && texto) L.push({ t: texto, s: b.tam, a: b.alin, b: b.neg }); };
  if (B.loja.mostrar) L.push({ logo: true, t: B.loja.texto || "DA LÚCIA" }); add("titulo", B.titulo.texto); add("numero", "PEDIDO " + p.numero); if (p.comanda) L.push({ t: "NA COMANDA " + p.comanda, s: "grande", a: "c", b: true });
  add("cliente", p.nome ? p.nome.toUpperCase() : ""); add("data", new Date(p.quando).toLocaleString("pt-BR")); if (tr) L.push(tr);
  p.itens.forEach((c) => {
    add("itens", `${c.qtd}x ${c.nome}`);
    (c.grupos || []).forEach((g) => {
      if (g.adicional || adics.has(g.rotulo)) { const b = B.detalhes; if (b.mostrar) L.push({ t: "+ ADICIONAL: " + g.itens.join(", "), s: "alta", a: b.alin, b: true }); } // etapa paga a mais (ex.: salada separada): sai grande e em negrito
      else add("detalhes", g.itens.join(", ")); // só o que foi escolhido, sem o nome da etapa
    });
    if (c.obs) add("obs", "OBS: " + c.obs);
    if (tr) L.push(tr);
  });
  add("total", `Total: ${p.unidades} un - ${brl(p.valor)}`); add("rodape", p.comanda ? "Cobrado na comanda " + p.comanda : B.rodape.texto);
  return L;
}
function escpos(linhas) {
  const k = impCfg(), enc = new TextEncoder(), by = [0x1B, 0x40];
  linhas.forEach((l) => {
    if (l.logo) { const cab = cabecalhoESC(logoImp.img, largura() >= 42 ? 576 : 384, l.t); for (let i = 0; i < cab.length; i++) by.push(cab[i]); return; }
    const [gs, f, fb] = TAMS[l.s || (l.g ? "grande" : "normal")] || TAMS.normal, al = { l: 0, c: 1, r: 2 }[l.a || (l.c ? "c" : "l")];
    quebrar(l.t, Math.max(8, Math.floor(largura() * f))).forEach((txt) =>
      by.push(0x1B, 0x4D, fb, 0x1B, 0x61, al, 0x1B, 0x45, l.b ? 1 : 0, 0x1D, 0x21, gs, ...enc.encode(txt + "\n")));
  });
  by.push(0x1B, 0x4D, 0, 0x1B, 0x64, k.avanco); if (k.corte) by.push(0x1D, 0x56, 0x42, 0x00); // avança o papel e corta
  return by;
}
// ----- cabeçalho com a LOGO NO CANTO SUPERIOR ESQUERDO (mesmo desenho do papel do caixa) -----
const logoImp = { src: null, img: null };
const carregarImgImp = (src) => new Promise((ok) => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i.width ? i : null); i.onerror = () => ok(null); i.src = src; });
async function prepararLogoImp() { // usa a logo do admin; se não tiver, a da pasta img
  const src = ler("logoPequena", "img/logo.png"); if (logoImp.src === src && logoImp.img) return;
  logoImp.img = (await carregarImgImp(src)) || (await carregarImgImp("img/logo.png")); logoImp.src = src;
}
function cabecalhoESC(img, dots, nome) {
  const H = 130, cv = document.createElement("canvas"); cv.width = dots; cv.height = H;
  const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, dots, H);
  let x = 0;
  if (img) { let h = H, w = Math.round((img.width * h) / img.height); if (w > dots * 0.42) { w = Math.round(dots * 0.42); h = Math.round((img.height * w) / img.width); } g.drawImage(img, 0, Math.round((H - h) / 2), w, h); x = w + 16; }
  const larg = dots - x - 4, sub = "Cantina & Restaurante"; let fs = 46;
  g.fillStyle = "#000"; g.textBaseline = "middle";
  const fonte = (s) => (g.font = `bold ${s}px Georgia, "Times New Roman", serif`);
  fonte(fs); while (g.measureText(nome).width > larg && fs > 16) fonte((fs -= 2));
  g.fillText(nome, x, H * 0.4);
  let fs2 = Math.round(fs * 0.5); g.font = `${fs2}px Arial, sans-serif`; while (g.measureText(sub).width > larg && fs2 > 10) g.font = `${--fs2}px Arial, sans-serif`;
  g.fillText(sub, x, H * 0.73);
  const px = g.getImageData(0, 0, dots, H).data, cinza = new Float32Array(dots * H), preto = new Uint8Array(dots * H);
  for (let i = 0; i < cinza.length; i++) cinza[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  for (let y = 0; y < H; y++) for (let xx = 0; xx < dots; xx++) { // logo com pontilhado, texto com corte simples
    const i = y * dots + xx, v = cinza[i];
    if (xx >= x) { preto[i] = v < 140 ? 1 : 0; continue; }
    const novo = v < 128 ? 0 : 255, err = v - novo; preto[i] = novo === 0 ? 1 : 0;
    if (xx + 1 < x) cinza[i + 1] += (err * 7) / 16;
    if (y + 1 < H) { if (xx > 0) cinza[i + dots - 1] += (err * 3) / 16; cinza[i + dots] += (err * 5) / 16; if (xx + 1 < x) cinza[i + dots + 1] += err / 16; }
  }
  const rb = dots / 8, by = [0x1B, 0x61, 0];
  for (let y0 = 0; y0 < H; y0 += 48) { // GS v 0 em faixas
    const h = Math.min(48, H - y0); by.push(0x1D, 0x76, 0x30, 0, rb & 255, rb >> 8, h & 255, h >> 8);
    for (let y = y0; y < y0 + h; y++) for (let b = 0; b < rb; b++) { let v = 0; for (let k = 0; k < 8; k++) v |= preto[y * dots + b * 8 + k] << (7 - k); by.push(v); }
  }
  by.push(0x0A); return by;
}
const amostra = () => ({ numero: 12, nome: "Nicolas", quando: Date.now(), unidades: 2, valor: 44,
  itens: [{ qtd: 2, nome: "Marmitex de R$22,00", obs: "sem cebola", grupos: [{ rotulo: "Arroz", itens: ["Arroz Branco"] }, { rotulo: "Feijão", itens: ["Feijão Tradicional"] }, { rotulo: "Carne", itens: ["Carne de Panela"] }, { rotulo: "Salada Separada", itens: ["Alface"], adicional: true }] }] });
const PREV = { pequena: ".8em", normal: "1em", alta: "1em", grande: "2em", gigante: "3em" };
function previa() {
  const html = linhasComanda(amostra()).map((l) => {
    if (l.logo) return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px"><img src="${esc(ler("logoPequena", "img/logo.png"))}" alt="" style="height:64px;width:auto;filter:grayscale(1)" onerror="this.remove()"><div style="text-align:left;line-height:1.1"><div style="font:700 1.6em Georgia,serif">${esc(l.t)}</div><div style="font-family:Arial,sans-serif">Cantina &amp; Restaurante</div></div></div>`;
    const f = (TAMS[l.s] || TAMS.normal)[1], al = { l: "left", c: "center", r: "right" }[l.a || "l"];
    return quebrar(l.t, Math.max(8, Math.floor(largura() * f))).map((t) => `<div style="text-align:${al};font-weight:${l.b ? 700 : 400};font-size:${PREV[l.s] || "1em"};white-space:pre;${l.s === "alta" ? "transform:scaleY(1.6);transform-origin:top;margin-bottom:.6em;" : ""}">${esc(t)}</div>`).join("");
  }).join("");
  return `<div class="papel" style="width:calc(${largura()}ch + 32px)">${html}</div>`;
}
function adminImpressao() {
  const B = layoutBlocos(), op = (arr, v) => arr.map(([k, t]) => `<option value="${k}" ${k === v ? "selected" : ""}>${t}</option>`).join("");
  const T = [["pequena", "Pequena"], ["normal", "Normal"], ["alta", "Alta"], ["grande", "Grande"], ["gigante", "Gigante"]], A = [["l", "Esquerda"], ["c", "Centro"], ["r", "Direita"]];
  return `<div class="bloco"><h3>Papel e impressora</h3>${impressaoCfg()}</div>${blocoFalhas()}
    <div class="bloco"><h3>Layout da comanda</h3><p>Escolha o que sai impresso e o tamanho de cada parte. A prévia mostra como fica.</p>
    <table class="regras lay"><tr><th>Parte</th><th>Mostrar</th><th>Tamanho</th><th>Alinhar</th><th>Negrito</th></tr>
    ${LAYOUT().map((b) => { const x = B[b.id]; return `<tr><td>${b.nome}${b.texto !== undefined ? `<br><input data-lay="${b.id}|texto" value="${esc(x.texto)}">` : ""}</td>
      <td><input type="checkbox" data-lay="${b.id}|mostrar" ${x.mostrar ? "checked" : ""}></td>
      <td><select data-lay="${b.id}|tam">${op(T, x.tam)}</select></td><td><select data-lay="${b.id}|alin">${op(A, x.alin)}</select></td>
      <td><input type="checkbox" data-lay="${b.id}|neg" ${x.neg ? "checked" : ""}></td></tr>`; }).join("")}</table>
    <p>Separador entre as partes: <select data-lay="_sep">${op([["-", "Traços ----"], ["=", "Igual ===="], ["*", "Estrelas ****"], ["", "Nenhum"]], ler("layoutSep", "-"))}</select></p></div>
    <div class="bloco"><h3>Prévia</h3><div class="previa">${previa()}</div><p><button class="btn-sec" data-acao="testeImp">Imprimir comanda de teste</button></p></div>`;
}
document.addEventListener("change", (e) => {
  const d = e.target.dataset || {}; if (!d.lay) return;
  const [id, campo] = d.lay.split("|"), v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
  if (id === "_sep") salvar("layoutSep", v); else { const o = ler("layout", {}); o[id] = o[id] || {}; o[id][campo] = v; salvar("layout", o); }
  toast("Salvo!"); render();
});

function posicaoBloco() {
  const l = etapasLista(), i = l.findIndex((c) => c.id === etapaAtual), c = l[i]; if (!c) return "";
  return `<div class="bloco"><h3>Esta etapa</h3>
    <p>Nome: <input data-inf="${c.id}|nome" value="${esc(c.nome)}"></p>
    <p>Pergunta que o cliente vê: <input data-inf="${c.id}|pergunta" value="${esc(c.pergunta)}" style="width:min(440px,100%)"></p>
    <p>Posição no pedido: <b>${i + 1}ª de ${l.length}</b>
    <button data-acao="moverEtapa" data-id="${c.id}" data-dir="-1" ${i === 0 ? "disabled" : ""}>⬆ Subir</button>
    <button data-acao="moverEtapa" data-id="${c.id}" data-dir="1" ${i === l.length - 1 ? "disabled" : ""}>⬇ Descer</button></p>
    <p>Valor adicional (R$) quando o cliente escolhe algo desta etapa: <input data-ad="${c.id}" inputmode="decimal" placeholder="0,00" style="width:110px" value="${c.adicional ? c.adicional.toFixed(2).replace(".", ",") : ""}"></p>
    <p><button data-acao="duplicarEtapa" data-id="${c.id}">Duplicar esta etapa</button> (copia os itens e os mínimos/máximos)</p></div>`;
}
function baixarBackup() {
  const dados = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!SEM_SYNC.includes(k)) dados[k] = localStorage.getItem(k); }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ app: "totem-da-lucia", dados })], { type: "application/json" }));
  a.download = "backup-totem-" + hoje() + ".json"; a.click();
}
document.addEventListener("change", (e) => {
  const d = e.target.dataset || {};
  if (d.ad) { const ad = ler("etapasAdicional", {}); ad[d.ad] = Math.max(0, parseFloat(e.target.value.replace(",", ".")) || 0); salvar("etapasAdicional", ad); toast("Salvo!"); render(); }
  if (d.restore && e.target.files[0]) {
    const fr = new FileReader();
    fr.onload = () => { try { const b = JSON.parse(fr.result); if (b.app !== "totem-da-lucia") throw 0;
      Object.entries(b.dados).forEach(([k, v]) => localStorage.setItem(k, v)); alert("Backup restaurado! O totem vai recarregar."); location.reload(); }
      catch (err) { toast("Esse arquivo não é um backup válido."); } };
    fr.readAsText(e.target.files[0]);
  }
});

document.addEventListener("change", (e) => { const o = e.target.dataset && e.target.dataset.opt; if (o) { salvar(o, e.target.checked); toast("Salvo!"); } });

// ===== CARDÁPIOS SALVOS =====
// ===================== ADMIN DO TOTEM (visual novo, mesma paleta) =====================
const ABAS = [["Dia a dia", [["cardapio", "🍽", "Hoje", "O que aparece pro cliente hoje"], ["relatorio", "📊", "Relatório", "Vendas feitas no totem"]]],
  ["Montar o cardápio", [["itens", "🧩", "Etapas e itens", "Arroz, feijão, carnes, bebidas..."], ["produtos", "🍱", "Produtos", "Marmitex, preço, foto e regras"]]],
  ["Configurar", [["impressao", "🖨", "Impressão", "Impressora e papel da comanda"], ["ajustes", "⚙", "Ajustes", "Aparência, segurança e backup"]]]];
function htmlAdmin() {
  const corpo = { cardapio: adminCardapio, itens: adminItens, relatorio: adminRelatorio, produtos: ajustesMarmitex, impressao: adminImpressao, ajustes: adminAjustes }[abaAdmin](), at = ABAS.flatMap((g) => g[1]).find((a) => a[0] === abaAdmin) || ["", "", "", ""];
  return `<div class="adm2"><header class="a2-topo">${logoPeq()}<div class="a2-tit"><h1>Administração</h1><small>Totem Da Lúcia</small></div><button class="a2-sair" data-acao="inicio">Sair do admin ✕</button></header>
    <div class="a2-corpo"><nav class="a2-menu">${ABAS.map(([g, its]) => `<small>${g}</small>` + its.map(([id, ic, nome, sub]) => `<button class="${abaAdmin === id ? "on" : ""}" data-acao="aba" data-aba="${id}"><span class="a2-ic">${ic}</span><span class="a2-n"><b>${nome}</b><i>${sub}</i></span></button>`).join("")).join("")}</nav>
    <section class="conteudo admin a2-conteudo"><div class="a2-cab"><h2>${at[1]} ${at[2]}</h2><p>${at[3]}</p></div>${corpo}</section></div></div>`;
}
function pillsEtapas(contador, prod) {
  const et = [...(prod ? [["produto", "Produtos"]] : []), ...etapasLista().map((c) => [c.id, c.nome]), ["bebida", "Bebidas"], ["doce", "Doces"]];
  if (!et.some(([id]) => id === etapaAtual)) etapaAtual = et[0][0];
  return `<div class="pills a2-pills">${et.map(([id, nome]) => { const l = listaDe(id), on = l.filter((i) => !indisponiveis.has(i.key)).length;
    return `<button class="pill ${id === etapaAtual ? "on" : ""} ${contador && !on ? "zero" : ""}" data-acao="etapaAtual" data-id="${id}">${esc(nome)}${contador ? ` <small>${on}/${l.length}</small>` : ""}</button>`; }).join("")}</div>`;
}
function adminCardapio() { // HOJE: 1) atalho dos cardápios salvos  2) liga/desliga  3) salvar
  const pills = pillsEtapas(true, true), lista = listaDe(etapaAtual), on = lista.filter((i) => !indisponiveis.has(i.key)).length, ativo = ler("cardapioAtivo", ""), cs = ler("cardapios", {}), nomes = Object.keys(cs), tot = todasChaves().length, lig = ligadosAgora().length;
  return `<div class="a2-hero"><div class="a2-hero-t"><small>No totem agora</small><b>${ativo ? esc(ativo) : "Cardápio do dia"}</b><span>${lig} de ${tot} itens aparecendo pro cliente</span></div>
      ${nomes.length ? `<div class="a2-hero-c"><small>Trocar pra um cardápio salvo:</small><div>${nomes.map((n) => `<button class="${n === ativo ? "on" : ""}" data-acao="aplicarCardapio" data-nome="${esc(n)}">${n === ativo ? "✓ " : ""}${esc(n)}</button>`).join("")}</div></div>` : ""}</div>
    <div class="a2-card"><div class="a2-card-t"><span class="a2-num">1</span><div><h3>Ajuste o que tem hoje</h3><p>Toque num item pra mostrar ou esconder. <b>Laranja com ✓</b> = o cliente vê. <b>Branco</b> = escondido.</p></div></div>${pills}
      <div class="a2-barra"><div><b>${esc(nomeEtapa(etapaAtual))}</b><span>${on} de ${lista.length} ligados</span></div><input id="busca-adm" class="busca" placeholder="🔍 Buscar item..." value="${esc(filtroAdmin)}">
      <button data-acao="todos" data-cat="${etapaAtual}">Ligar todos</button><button data-acao="nenhum" data-cat="${etapaAtual}">Desligar todos</button></div>
      <div class="chips a2-itens">${lista.map((i) => { const ok = !indisponiveis.has(i.key); return `<button class="chip ${ok ? "on" : ""}" data-acao="toggle" data-id="${esc(i.key)}"><span>${ok ? "✓" : ""}</span>${esc(i.label)}</button>`; }).join("") || `<p class="a2-vazio">Nenhum item ainda. Crie em <b>Etapas e itens</b>.</p>`}</div></div>
    ${cardapiosBloco()}`;
}
function cardapiosBloco() {
  const cs = ler("cardapios", {}), nomes = Object.keys(cs), ativo = ler("cardapioAtivo", ""), DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return `<div class="a2-card"><div class="a2-card-t"><span class="a2-num">2</span><div><h3>Cardápios salvos</h3><p>Salve o de hoje com um nome (ex.: <i>Segunda</i>) e depois é só tocar nele lá em cima. ${ler("autoCardapio", false) ? "O <b>dia automático</b> está ligado." : "Dá pra aplicar sozinho no dia certo (ligue em Ajustes → Segurança e uso)."}</p></div></div>
    ${nomes.length ? `<div class="a2-cdps">${nomes.map((n) => `<div class="a2-cdp ${n === ativo ? "ativo" : ""}"><div class="a2-cdp-n"><b>${esc(n)}</b><small>${cs[n].on.length} itens${n === ativo ? " · no totem agora" : ""}</small></div>
      <label class="a2-dia">Dia automático <select data-cd="${esc(n)}"><option value="-1">Nenhum</option>${DIAS.map((x, i) => `<option value="${i}" ${cs[n].dia === i ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <button class="a2-b" data-acao="atualizarCardapio" data-nome="${esc(n)}" title="Grava o que está ligado agora neste cardápio">↻ Atualizar</button>
      <button class="a2-b prim" data-acao="aplicarCardapio" data-nome="${esc(n)}">Aplicar</button><button class="a2-x" data-acao="apagarCardapio" data-nome="${esc(n)}" title="Apagar">✕</button></div>`).join("")}</div>` : `<p class="a2-vazio">Nenhum cardápio salvo ainda.</p>`}
    <div class="novo a2-novo"><input id="cardapio-nome" placeholder="Nome (ex.: Segunda, Feijoada, Sábado)"><button data-acao="salvarCardapio">💾 Salvar o de agora</button></div></div>`;
}
function adminItens() { // ETAPAS E ITENS: lista de etapas à esquerda, edição à direita
  const l = etapasLista(), beb = etapaAtual === "bebida" || etapaAtual === "doce", doc = etapaAtual === "doce";
  if (!beb && !l.some((c) => c.id === etapaAtual)) etapaAtual = l.length ? l[0].id : "bebida";
  const lista = listaDe(etapaAtual), c = l.find((x) => x.id === etapaAtual), i = l.indexOf(c);
  const lado = `<div class="a2-lista"><small>Ordem das etapas pro cliente</small>${l.map((x, k) => `<div class="a2-et ${x.id === etapaAtual ? "on" : ""}"><button class="a2-et-b" data-acao="etapaAtual" data-id="${x.id}"><span class="a2-et-n">${k + 1}</span><span><b>${esc(x.nome)}</b><i>${listaDe(x.id).length} itens${x.adicional ? " · +" + brl(x.adicional) : ""}</i></span></button>
      <span class="a2-et-m"><button data-acao="moverEtapa" data-id="${x.id}" data-dir="-1" ${k === 0 ? "disabled" : ""} title="Subir">▲</button><button data-acao="moverEtapa" data-id="${x.id}" data-dir="1" ${k === l.length - 1 ? "disabled" : ""} title="Descer">▼</button></span></div>`).join("")}
    <div class="a2-et ${etapaAtual === "bebida" ? "on" : ""}"><button class="a2-et-b" data-acao="etapaAtual" data-id="bebida"><span class="a2-et-n">🥤</span><span><b>Bebidas</b><i>${listaDe("bebida").length} bebidas</i></span></button></div>
    <div class="a2-et ${doc ? "on" : ""}"><button class="a2-et-b" data-acao="etapaAtual" data-id="doce"><span class="a2-et-n">🍬</span><span><b>Doces</b><i>${listaDe("doce").length} doces</i></span></button></div>
    <div class="a2-nova"><small>Criar etapa nova</small><div class="novo"><input id="ne-nome" placeholder="Ex.: Sobremesa"><button data-acao="novaEtapa">＋</button></div></div></div>`;
  const itens = `<div class="a2-card"><div class="a2-card-t"><div><h3>${doc ? "🍬 Doces" : beb ? "🥤 Bebidas" : esc(c.nome)} <small>${lista.length} ${doc ? "doces" : beb ? "bebidas" : "itens"}</small></h3><p>${doc ? "Nome e preço de cada doce. Aparecem pro cliente em <b>Doces</b>, depois da 1ª marmitex." : beb ? "Nome e preço de cada bebida." : "Tudo que pode aparecer nesta etapa. O que vai ter <b>hoje</b> você escolhe na aba Hoje."}</p></div></div>
    <div class="chips a2-edit">${lista.map((x) => `<span class="chip on item-edit">${esc(x.label)} <b data-acao="apagarItem" data-id="${esc(x.key)}" title="Apagar">✕</b></span>`).join("") || `<p class="a2-vazio">Nenhum item ainda.</p>`}</div>
    <h4>Adicionar</h4>${beb ? `<div class="novo a2-novo"><input id="nova-bebida" placeholder="Nome ${doc ? "do doce" : "da bebida"}"><input id="preco-bebida" inputmode="decimal" placeholder="Preço (ex.: ${doc ? "3,50" : "6,50"})"><button data-acao="novaBebida" data-tp="${doc ? "doce" : "bebida"}">＋ Adicionar</button></div>`
      : `<div class="novo a2-novo"><textarea id="novo-${etapaAtual}" rows="2" placeholder="Digite um item, ou cole vários (um por linha)"></textarea><button data-acao="addExtra" data-cat="${etapaAtual}">＋ Adicionar</button></div>`}</div>`;
  const cfg = beb || !c ? "" : `<div class="a2-card"><div class="a2-card-t"><div><h3>Como esta etapa aparece</h3><p>É a ${i + 1}ª de ${l.length} etapas. Mude a ordem nas setinhas ▲▼ da lista.</p></div></div>
    <div class="a2-form"><label>Nome da etapa<input data-inf="${c.id}|nome" value="${esc(c.nome)}"></label><label>Pergunta que o cliente vê<input data-inf="${c.id}|pergunta" value="${esc(c.pergunta)}"></label>
    <label>Valor a mais (R$) <small>se o cliente escolher algo daqui o totem pergunta antes (ex.: Salada Separada)</small><input data-ad="${c.id}" inputmode="decimal" placeholder="0,00 (grátis)" value="${c.adicional ? c.adicional.toFixed(2).replace(".", ",") : ""}"></label></div>
    <div class="a2-acoes"><button class="a2-b" data-acao="duplicarEtapa" data-id="${c.id}">⧉ Duplicar etapa</button><button class="a2-b perigo" data-acao="apagarEtapa" data-id="${c.id}">🗑 Apagar etapa</button></div></div>`;
  return `<div class="a2-split">${lado}<div class="a2-dir">${itens}${cfg}</div></div>`;
}
function ajustesMarmitex() { // PRODUTOS: cartões à esquerda, edição à direita
  const ps = marmitexLista(); if (!ps.some((p) => p.id === prodAtual)) prodAtual = ps.length ? ps[0].id : null;
  const m = ps.find((p) => p.id === prodAtual);
  const stp = (campo, c) => `<div class="a2-stp"><button data-acao="regra" data-k="${m.id}|${campo}|${c.id}" data-n="-1">−</button><input type="number" min="0" max="9" data-cfg="${m.id}|${campo}|${c.id}" value="${m.regras[c.id][campo]}"><button data-acao="regra" data-k="${m.id}|${campo}|${c.id}" data-n="1">+</button></div>`;
  const txt = (r) => (r.max === 0 ? `<span class="a2-tag off">não aparece</span>` : `<span class="a2-tag">${r.min === r.max ? "escolhe " + r.max : r.min === 0 ? "até " + r.max + " (opcional)" : "de " + r.min + " a " + r.max}</span>`);
  const lado = `<div class="a2-lista">${ps.map((p) => `<button class="a2-prod ${p.id === prodAtual ? "on" : ""} ${indisponiveis.has("produto:" + p.id) ? "off" : ""}" data-acao="prodAtual" data-id="${p.id}">${p.foto ? `<img src="${p.foto}" alt="">` : `<span class="a2-sf">🍱</span>`}<span><b>${esc(p.nome)}</b><i>${brl(p.preco)}${indisponiveis.has("produto:" + p.id) ? " · escondido hoje" : ""}</i></span></button>`).join("")}
    <div class="a2-nova"><small>Produto novo</small><input id="np-nome" placeholder="Nome (ex.: Marmitex Fit)"><div class="novo"><input id="np-preco" inputmode="decimal" placeholder="Preço"><button data-acao="novoProduto">＋</button></div></div></div>`;
  const dir = !m ? `<div class="a2-card"><p class="a2-vazio">Crie o primeiro produto ao lado.</p></div>` : `<div class="a2-card"><div class="a2-prod-ed"><div class="a2-foto">${m.foto ? `<img src="${m.foto}" alt="">` : `<span>🍱</span>`}<label class="a2-b">📷 Trocar foto<input type="file" accept="image/*" data-foto="${m.id}" hidden></label></div>
      <div class="a2-form"><label>Nome do produto<input data-cfg="${m.id}|nome" value="${esc(m.nome)}"></label><label>Preço (R$)<input data-cfg="${m.id}|preco" inputmode="decimal" value="${m.preco.toFixed(2).replace(".", ",")}"></label>
      <div class="a2-acoes"><button class="a2-b" data-acao="duplicar" data-id="${m.id}">⧉ Duplicar</button><button class="a2-b perigo" data-acao="apagarProduto" data-id="${m.id}">🗑 Apagar</button></div></div></div></div>
    <div class="a2-card"><div class="a2-card-t"><div><h3>Quanto o cliente escolhe em cada etapa</h3><p><b>Mínimo</b> = obrigatório escolher. <b>Máximo 0</b> = a etapa não aparece neste produto.</p></div></div>
      <div class="a2-regras"><div class="a2-rh"><span>Etapa</span><span>Mínimo</span><span>Máximo</span><span>O cliente vê</span></div>${etapasLista().map((c) => `<div class="a2-r ${m.regras[c.id].max === 0 ? "off" : ""}"><b>${esc(c.nome)}</b>${stp("min", c)}${stp("max", c)}${txt(m.regras[c.id])}</div>`).join("")}</div></div>`;
  return `<div class="a2-split">${lado}<div class="a2-dir">${dir}</div></div>`;
}

const todasChaves = () => ["produto", ...etapasLista().map((c) => c.id), "bebida", "doce"].flatMap((id) => listaDe(id).map((i) => i.key));
const ligadosAgora = () => todasChaves().filter((k) => !indisponiveis.has(k));
function aplicarCardapio(nome) {
  const m = ler("cardapios", {})[nome]; if (!m) return;
  const on = new Set(m.on); indisponiveis = new Set(todasChaves().filter((k) => !on.has(k)));
  salvar("indisponiveis", [...indisponiveis]); salvar("cardapioAtivo", nome);
}
function aplicarAgendado() { // de manhã aplica o cardápio marcado com o dia da semana (só com o totem parado)
  if (!ler("autoCardapio", false) || tela !== "descanso" || ler("ultimoAuto", "") === hoje()) return;
  const cs = ler("cardapios", {}), nome = Object.keys(cs).find((n) => cs[n].dia === new Date().getDay());
  salvar("ultimoAuto", hoje()); if (nome) { aplicarCardapio(nome); render(); }
}
document.addEventListener("change", (e) => {
  const d = e.target.dataset || {};
  if (d.cd) { const cs = ler("cardapios", {}); if (cs[d.cd]) { cs[d.cd].dia = +e.target.value; salvar("cardapios", cs); toast("Salvo!"); render(); } }
  if (d.inf) { const [id, campo] = d.inf.split("|"), inf = ler("etapasInfo", {}); inf[id] = inf[id] || {}; inf[id][campo] = e.target.value.trim(); salvar("etapasInfo", inf); toast("Salvo!"); render(); }
  if (d.esc) { salvar("escala", +e.target.value); aplicarCores(); toast("Salvo!"); }
});

document.addEventListener("change", (e) => { if (e.target.dataset && e.target.dataset.tecl) { localStorage.setItem("tecladoVirtual", e.target.value); toast("Salvo! Recarregando..."); setTimeout(() => location.reload(), 700); } });

// ===== IMPRESSORA E FOTO DOS PRODUTOS =====
const impCfg = () => ({ cols: LARGURA, avanco: 4, corte: true, grande: false, modo: IMPRESSAO, via: "link", ip: "", porta: 9100, ...ler("impCfg", {}) });
const largura = () => impCfg().cols;
function impressaoCfg() {
  const c = impCfg(), op = (v, t) => `<option value="${v}" ${c.modo === v ? "selected" : ""}>${t}</option>`;
  return `<p>Papel: <button class="a2-b ${+c.cols === 32 ? "prim" : ""}" data-acao="papel" data-cols="32">58 mm</button> <button class="a2-b ${+c.cols === 48 ? "prim" : ""}" data-acao="papel" data-cols="48">80 mm</button>
    ou colunas por linha: <input type="number" min="16" max="80" data-imp="cols" value="${c.cols}"></p>
    <p>Linhas em branco antes do corte: <input type="number" min="0" max="12" data-imp="avanco" value="${c.avanco}">
    <label><input type="checkbox" data-imp="corte" ${c.corte ? "checked" : ""}> cortar o papel no final</label></p>
    <p>Como imprimir: <select data-imp="modo">${op("servidor", "Impressora de rede, pelo servidor (recomendado)")}${op("rawbt", "USB/Bluetooth pelo app RawBT")}${op("navegador", "Janela do navegador")}</select></p>
    ${c.modo === "servidor" ? `<p>IP da impressora: <input data-imp="ip" placeholder="192.168.1.50" value="${esc(c.ip || "")}"> porta: <input type="number" data-imp="porta" value="${c.porta || 9100}" style="width:120px">${c.ip && !ipValido(c.ip) ? `<small class="imp-aviso">⚠ Esse IP parece incorreto. Use o formato 192.168.1.50</small>` : ""}</p>
      <p><button class="btn-sec" data-acao="testarImp">🔌 Testar conexão</button></p>${htmlStatusImp()}
      <p><small>O computador (servidor) manda direto pra impressora, sem app nenhum no tablet. Tablet, computador e impressora precisam estar na mesma rede. Dica: deixe o IP da impressora fixo no roteador (reserva de DHCP) para ele não mudar sozinho.</small></p>` : ""}
    ${c.modo === "rawbt" ? `<p>Envio pro RawBT: <select data-imp="via"><option value="link" ${c.via === "link" ? "selected" : ""}>Link (padrão)</option><option value="fully" ${c.via === "fully" ? "selected" : ""}>Fully Kiosk (startIntent)</option></select></p>
      <p><small>No Fully Kiosk: Configurações → Web Content → ligue <b>Open URL Schemes in other apps</b>.</small></p>` : ""}`;
}
function lerFoto(file, id) { // reduz a foto pra caber no armazenamento do tablet
  const img = new Image(), fr = new FileReader();
  fr.onload = () => { img.onload = () => {
    const w = Math.min(700, img.width), cv = document.createElement("canvas"); cv.width = w; cv.height = Math.round((img.height * w) / img.width);
    cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); salvar("foto:" + id, cv.toDataURL("image/jpeg", 0.8)); toast("Foto salva!"); render();
  }; img.src = fr.result; };
  fr.readAsDataURL(file);
}
document.addEventListener("change", (e) => {
  const d = e.target.dataset || {};
  if (d.foto && e.target.files[0]) lerFoto(e.target.files[0], d.foto);
  if (d.imp) {
    const c = ler("impCfg", {}); let v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    if (["cols", "avanco", "porta"].includes(d.imp)) v = Math.max(0, parseInt(v) || 0); if (d.imp === "grande") v = v === "1";
    if (["ip", "porta", "modo"].includes(d.imp)) statusImp = null; c[d.imp] = v; salvar("impCfg", c); render();
    if (["ip", "porta", "modo"].includes(d.imp)) { clearTimeout(tSync); enviarConfig().then((ok) => toast(ok ? "Salvo no servidor!" : "⚠ Salvo só neste aparelho. Entre como admin (segure o logo) para o servidor usar esse IP.")); } else toast("Salvo!");
  }
});

// ----- estilos do teste de conexão e do aviso de falha na impressão -----
(() => { const st = document.createElement("style"); st.textContent = `
.imp-status { margin: 10px 0; padding: 12px 14px; border-radius: 14px; font-weight: 600; line-height: 1.4; }
.imp-status small { font-weight: 500; opacity: .8; }
.imp-status.vazio { background: #f3ede6; color: #8a6f60; font-weight: 500; }
.imp-status.testando { background: #fff3d6; color: #7a3b00; } .imp-status.ok { background: #e9f6ec; color: #16793a; } .imp-status.erro { background: #fde0e0; color: #a50f14; }
.imp-aviso { display: block; margin-top: 4px; color: #a50f14; font-weight: 600; }
.imp-falhas { list-style: none; padding: 0; margin: 8px 0; } .imp-falhas li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #eee; }
#falha-imp { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); z-index: 3000; width: min(680px, 94vw); } #falha-imp[hidden] { display: none; }
#falha-imp .fi-corpo { display: flex; align-items: center; gap: 14px; background: #fff; border: 3px solid #a50f14; border-radius: 22px; padding: 16px 18px; box-shadow: 0 18px 44px rgba(0,0,0,.35); }
#falha-imp .fi-ic { font-size: 2.2rem; } #falha-imp .fi-txt { flex: 1; display: flex; flex-direction: column; gap: 3px; line-height: 1.3; }
#falha-imp .fi-txt b { font: 700 1.15rem Georgia, serif; color: #a50f14; } #falha-imp .fi-txt span { font-size: .92rem; } #falha-imp .fi-txt small { color: #8a6f60; }
#falha-imp .fi-bt { display: flex; flex-direction: column; gap: 8px; }
#falha-imp .fi-bt button { min-height: 46px; padding: 10px 18px; border-radius: 14px; border: 2px solid #a50f14; background: #a50f14; color: #fff; font-weight: 700; white-space: nowrap; }
#falha-imp .fi-bt button + button { background: #fff; color: #a50f14; }
`; document.head.appendChild(st); })();

// ----- estilos da tela "Pedido enviado!" -----
(() => { const st = document.createElement("style"); st.textContent = `
.suc { min-height: 100vh; box-sizing: border-box; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 24px 60px; cursor: pointer; animation: sucEntra .45s ease both; }
.suc-ok { width: 88px; height: 88px; border-radius: 50%; background: #1b8a3c; color: #fff; font-size: 48px; line-height: 1; display: grid; place-items: center; box-shadow: 0 12px 30px rgba(27,138,60,.28); animation: sucPop .55s .1s cubic-bezier(.2,1.6,.4,1) both; }
.suc-tit { font: 700 2.6rem Georgia, serif; color: #2b1a12; margin: 22px 0 4px; }
.suc-ola { font-size: 1.3rem; color: #6b5446; margin: 0 0 26px; }
.suc-num { display: flex; flex-direction: column; align-items: center; padding: 16px 64px 20px; border-radius: 30px; background: #fff; box-shadow: 0 16px 44px rgba(120,40,10,.12); }
.suc-num small { letter-spacing: .22em; font-weight: 700; font-size: .85rem; color: #9a7b66; }
.suc-num strong { font: 700 7.5rem/1 Georgia, serif; color: var(--vermelho, #A50F14); margin-top: 8px; }
.suc-info { font-size: 1.2rem; color: #4a3428; margin: 26px 0 0; max-width: 560px; }
.suc-alerta { font-size: 1.15rem; font-weight: 700; color: #a50f14; background: #fde0e0; padding: 12px 20px; border-radius: 16px; margin: 24px 0 0; }
.suc-rod { margin-top: 36px; font-size: 1rem; color: #a08c7d; }
.suc-barra { width: 220px; height: 5px; border-radius: 5px; background: #eadfd3; overflow: hidden; margin: 12px auto 0; }
.suc-barra i { display: block; height: 100%; width: 100%; background: var(--vermelho, #A50F14); transform-origin: left; animation: sucBarra 4s linear forwards; }
.suc-logo { position: fixed; top: 16px; left: 16px; z-index: 5; }
@keyframes sucEntra { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes sucPop { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes sucBarra { from { transform: scaleX(0); } to { transform: scaleX(1); } }
`; document.head.appendChild(st); })();

(() => { const st = document.createElement("style"); st.textContent = `
/* ===== popups do cliente ===== */
.modal-caixa.pp { width: min(560px, 92vw); padding: 30px 30px 26px; text-align: center; border-radius: 32px; }
.pp-ic { width: 84px; height: 84px; margin: 0 auto 10px; border-radius: 50%; display: grid; place-items: center; font-size: 2.6rem; background: #FFF0D2; }
.pp h2 { font: 700 1.8rem/1.2 var(--serif, Georgia, serif); color: var(--tinta, #2B1710); margin: 0; } .pp-sub { margin: 8px 0 22px; font-size: 1.15rem; color: #7a5c4a; } .pp-sub b { color: var(--vermelho); }
.pp-bts { display: grid; grid-template-columns: 1fr 1.25fr; gap: 12px; }
.pp-bts button { min-height: 76px; border-radius: 20px; font-size: 1.2rem; font-weight: 700; } .pp-bts button small { display: block; font-size: .9rem; font-weight: 600; opacity: .9; margin-top: 2px; }
.pp-nao { border: 2px solid #e6d5c3; background: #fff; color: #6b4a38; }
.pp-sim { border: 0; color: #fff; background: linear-gradient(135deg, var(--laranja), var(--lar-esc, #FF8A00)); box-shadow: 0 8px 18px rgba(255,140,0,.35); }
.pp-ops { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; } .pp-op { display: flex; flex-direction: column; align-items: center; gap: 6px; min-height: 170px; padding: 18px 14px; border: 2px solid #f0dfcb; border-radius: 24px; background: #fff; box-shadow: var(--sombra); }
.pp-op span { font-size: 2.6rem; } .pp-op b { font: 700 1.25rem var(--serif, Georgia, serif); color: var(--tinta); } .pp-op small { color: #8a6f60; font-weight: 500; font-size: .95rem; line-height: 1.3; }
.pp-op:active { border-color: var(--laranja); background: #fff8ec; }
.pp-voltar { margin-top: 16px; border: 0; background: transparent; color: #8a6f60; font-weight: 700; min-height: 44px; }
.pp-num { width: 100%; height: 84px; margin: 0 0 18px; font: 700 2.6rem var(--serif, Georgia, serif) !important; text-align: center; border: 3px solid var(--laranja) !important; border-radius: 22px !important; box-shadow: 0 0 0 6px rgba(255,165,0,.18) !important; }
@media (max-width: 560px) { .pp-ops, .pp-bts { grid-template-columns: 1fr; } }

/* ===== ADMIN: estrutura ===== */
.adm2 { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.a2-topo { display: flex; align-items: center; gap: 16px; padding: 14px 28px; }
.a2-topo .logo { width: 62px !important; height: 62px !important; } .a2-tit { flex: 1; } .a2-tit h1 { margin: 0; font: 700 1.8rem/1.1 var(--serif); color: var(--tinta); } .a2-tit small { color: #9a7b66; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; font-size: .72rem; }
.a2-sair { min-height: 48px; padding: 0 20px; border: 2px solid var(--vermelho); border-radius: 999px; background: #fff; color: var(--vermelho); font-weight: 700; }
.a2-corpo { flex: 1; min-height: 0; display: flex; gap: 8px; padding: 0 0 0 16px; }
.a2-menu { width: 250px; flex-shrink: 0; display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 20px; overflow-y: auto; }
.a2-menu small { margin: 14px 12px 4px; color: #9a7b66; font-weight: 700; text-transform: uppercase; font-size: .7rem; letter-spacing: .1em; }
.a2-menu button { display: flex; align-items: center; gap: 12px; min-height: 0; padding: 11px 12px; border: 0; border-radius: 18px; background: transparent; text-align: left; color: var(--tinta); }
.a2-menu .a2-ic { width: 42px; height: 42px; flex-shrink: 0; display: grid; place-items: center; border-radius: 14px; background: #fff; box-shadow: 0 2px 8px rgba(120,50,10,.08); font-size: 1.25rem; }
.a2-n b { display: block; font-size: 1.02rem; } .a2-n i { display: block; font-style: normal; font-weight: 500; font-size: .78rem; color: #8a6f60; line-height: 1.25; }
.a2-menu button.on { background: linear-gradient(135deg, var(--laranja), var(--lar-esc)); color: #fff; box-shadow: var(--sombra); } .a2-menu button.on .a2-ic { background: rgba(255,255,255,.25); box-shadow: none; } .a2-menu button.on .a2-n i { color: rgba(255,255,255,.9); }
.a2-conteudo { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 28px 40px 14px !important; }
.a2-cab { margin: 6px 0 16px; } .a2-cab h2 { margin: 0; font: 700 1.6rem var(--serif); color: var(--tinta); } .a2-cab p { margin: 2px 0 0; color: #8a6f60; }
@media (max-width: 900px) { .a2-corpo { flex-direction: column; padding: 0; } .a2-menu { width: auto; flex-direction: row; overflow-x: auto; padding: 4px 12px 8px; } .a2-menu small, .a2-n i { display: none; } .a2-menu button { flex-shrink: 0; } .a2-conteudo { padding: 4px 14px 30px !important; } }
/* cartões, títulos, botões */
.adm2 .a2-card, .adm2 .bloco { background: #fff; border: 0; border-radius: 24px; box-shadow: var(--sombra); padding: 18px 20px; margin-bottom: 16px; max-width: 1100px; }
.a2-card-t { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 14px; } .a2-card-t h3 { margin: 0; font: 700 1.25rem var(--serif); color: var(--tinta); } .a2-card-t h3 small { font: 600 .85rem Inter, Arial; color: #9a7b66; margin-left: 6px; } .a2-card-t p { margin: 4px 0 0; color: #7a5c4a; line-height: 1.4; }
.a2-num { width: 36px; height: 36px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; background: linear-gradient(135deg, var(--vermelho), var(--verm-esc)); color: #fff; font: 700 1.1rem var(--serif); }
.adm2 h4 { margin: 16px 0 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .08em; color: #9a7b66; }
.a2-b { display: inline-flex; align-items: center; gap: 6px; min-height: 46px; padding: 0 16px; border: 2px solid #eadccb; border-radius: 14px; background: #fff; color: var(--tinta); font-weight: 700; cursor: pointer; }
.a2-b.prim { border: 0; color: #fff; background: linear-gradient(135deg, var(--vermelho), var(--verm-esc)); box-shadow: 0 6px 14px rgba(165,15,20,.25); } .a2-b.perigo { border-color: #f0c4c4; color: var(--vermelho); }
.a2-x { width: 46px; height: 46px; min-height: 0; padding: 0; border: 2px solid #f0c4c4; border-radius: 14px; background: #fff; color: var(--vermelho); }
.a2-acoes { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
.a2-vazio { color: #9a7b66; padding: 10px 0; }
.adm2 .ajuda { display: none; } /* as explicações agora ficam no título de cada parte */
/* HOJE */
.a2-hero { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; padding: 18px 22px; border-radius: 24px; color: #fff; background: linear-gradient(135deg, var(--laranja), var(--lar-esc)); box-shadow: var(--sombra-g); max-width: 1100px; }
.a2-hero-t { flex: 1 1 260px; } .a2-hero-t small { font-weight: 700; text-transform: uppercase; letter-spacing: .1em; font-size: .72rem; opacity: .9; } .a2-hero-t b { display: block; font: 700 1.9rem/1.15 var(--serif); } .a2-hero-t span { opacity: .95; }
.a2-hero-c { flex: 1 1 320px; } .a2-hero-c small { display: block; font-weight: 700; margin-bottom: 6px; opacity: .95; } .a2-hero-c div { display: flex; flex-wrap: wrap; gap: 8px; }
.a2-hero-c button { min-height: 46px; padding: 0 18px; border: 2px solid rgba(255,255,255,.7); border-radius: 999px; background: rgba(255,255,255,.15); color: #fff; font-weight: 700; } .a2-hero-c button.on { background: #fff; color: var(--vermelho); border-color: #fff; }
.a2-pills { gap: 8px; } .a2-pills .pill { box-shadow: none; border: 2px solid #f0dfcb; background: #fff; padding: 10px 16px; } .a2-pills .pill.on { border-color: var(--vermelho); background: var(--vermelho); color: #fff; } .a2-pills .pill.zero:not(.on) { color: #b9a594; }
.a2-barra { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 4px 0 12px; padding: 10px 12px; border-radius: 18px; background: #fff8ec; }
.a2-barra > div { flex: 1 1 160px; } .a2-barra > div b { display: block; font: 700 1.15rem var(--serif); } .a2-barra > div span { color: #8a6f60; font-size: .88rem; }
.a2-barra .busca { flex: 1 1 200px; width: auto; min-height: 46px; margin: 0; background: #fff; } .a2-barra button { min-height: 46px; padding: 0 14px; border: 2px solid #eadccb; border-radius: 14px; background: #fff; font-weight: 700; }
.a2-itens { gap: 8px; } .admin .chip[hidden] { display: none; } /* busca do admin: sem isso o display:inline-flex abaixo vence o "hidden" e nada some */ .a2-itens .chip { display: inline-flex; align-items: center; gap: 8px; min-height: 48px; padding: 8px 16px 8px 10px; border: 2px solid #eadccb; border-radius: 16px; background: #fff; color: #9a8676; text-decoration: none; font-weight: 600; box-shadow: none; }
.a2-itens .chip span { width: 24px; height: 24px; flex-shrink: 0; display: grid; place-items: center; border-radius: 50%; border: 2px solid #d9c7b8; font-size: .8rem; }
.a2-itens .chip.on { border-color: transparent; background: linear-gradient(135deg, var(--laranja), var(--lar-esc)); color: #fff; font-weight: 700; box-shadow: 0 4px 10px rgba(255,140,0,.25); } .a2-itens .chip.on span { background: var(--vermelho); border-color: #fff; color: #fff; }
.a2-cdps { display: flex; flex-direction: column; gap: 8px; } .a2-cdp { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: 18px; background: #fffaf4; border: 2px solid transparent; } .a2-cdp.ativo { border-color: var(--laranja); }
.a2-cdp-n { flex: 1 1 160px; } .a2-cdp-n b { display: block; font: 700 1.15rem var(--serif); } .a2-cdp-n small { color: #8a6f60; }
.a2-dia { display: flex; align-items: center; gap: 6px; margin: 0 !important; font-size: .85rem !important; font-weight: 700; color: #8a6f60; } .a2-dia select { min-height: 46px; margin: 0 !important; }
.a2-novo { margin-top: 12px; } .a2-novo input, .a2-novo textarea { background: #fff !important; }
/* ETAPAS e PRODUTOS: lista + edição */
.a2-split { display: grid; grid-template-columns: 290px 1fr; gap: 16px; align-items: start; max-width: 1180px; } @media (max-width: 1000px) { .a2-split { grid-template-columns: 1fr; } }
.a2-lista { display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 24px; background: #fff; box-shadow: var(--sombra); position: sticky; top: 0; }
.a2-lista > small, .a2-nova small { margin: 2px 6px 4px; color: #9a7b66; font-weight: 700; text-transform: uppercase; font-size: .7rem; letter-spacing: .08em; }
.a2-et { display: flex; align-items: center; gap: 4px; border-radius: 16px; } .a2-et.on { background: #fff3da; box-shadow: inset 0 0 0 2px var(--laranja); }
.a2-et-b { flex: 1; display: flex; align-items: center; gap: 10px; min-height: 0; padding: 8px; border: 0; background: transparent; text-align: left; }
.a2-et-n { width: 32px; height: 32px; flex-shrink: 0; display: grid; place-items: center; border-radius: 10px; background: #f6efe7; font: 700 .95rem var(--serif); color: #7a5a48; } .a2-et.on .a2-et-n { background: var(--vermelho); color: #fff; }
.a2-et-b b { display: block; font-size: .98rem; } .a2-et-b i { display: block; font-style: normal; font-size: .78rem; color: #8a6f60; }
.a2-et-m { display: flex; flex-direction: column; gap: 2px; padding-right: 4px; } .a2-et-m button { width: 34px; height: 24px; min-height: 0; padding: 0; border: 0; border-radius: 8px; background: #f6efe7; font-size: .7rem; color: #7a5a48; } .a2-et-m button:disabled { opacity: .25; }
.a2-nova { margin-top: 8px; padding-top: 10px; border-top: 1px dashed #eadccb; display: flex; flex-direction: column; gap: 6px; } .a2-nova .novo { margin: 0; } .a2-nova input { min-height: 46px; flex: 1; min-width: 0; } .a2-nova button { min-width: 52px; padding: 0 12px !important; }
.a2-edit .chip.item-edit { display: inline-flex; align-items: center; min-height: 44px; padding: 6px 6px 6px 16px; border-radius: 14px; background: #fff3da; color: #7a3b00; box-shadow: none; } .a2-edit .chip b { margin-left: 10px; width: 32px; height: 32px; display: grid; place-items: center; padding: 0; border-radius: 10px; background: #fff; color: var(--vermelho); }
.a2-form { display: grid; gap: 12px; flex: 1; } .a2-form label { display: flex !important; flex-direction: column; align-items: stretch !important; gap: 6px !important; margin: 0 !important; font-weight: 700; font-size: .9rem !important; color: #6b4a38; } .a2-form label small { font-weight: 500; color: #8a6f60; } .a2-form input { width: 100% !important; min-height: 48px; font-size: 1.05rem; }
.a2-prod { display: flex; align-items: center; gap: 10px; min-height: 0; padding: 8px; border: 2px solid transparent; border-radius: 16px; background: transparent; text-align: left; } .a2-prod.on { border-color: var(--laranja); background: #fff3da; } .a2-prod.off { opacity: .55; }
.a2-prod img, .a2-sf { width: 56px; height: 46px; flex-shrink: 0; border-radius: 12px; object-fit: cover; background: #FFE3A8; display: grid; place-items: center; font-size: 1.4rem; } .a2-prod b { display: block; font: 700 1rem var(--serif); } .a2-prod i { display: block; font-style: normal; font-size: .82rem; color: var(--vermelho); font-weight: 700; }
.a2-prod-ed { display: flex; gap: 20px; flex-wrap: wrap; } .a2-foto { width: 220px; display: flex; flex-direction: column; gap: 8px; } .a2-foto img, .a2-foto span { width: 220px; height: 160px; border-radius: 20px; object-fit: cover; background: #FFE3A8; display: grid; place-items: center; font-size: 3.5rem; } .a2-foto .a2-b { justify-content: center; }
.a2-regras { display: flex; flex-direction: column; } .a2-rh, .a2-r { display: grid; grid-template-columns: 1.3fr 140px 140px 1fr; align-items: center; gap: 10px; padding: 8px 4px; } .a2-rh { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #9a7b66; border-bottom: 2px solid #f1e6da; }
.a2-r { border-bottom: 1px solid #f6ece0; } .a2-r b { font: 700 1.02rem var(--serif); } .a2-r.off b { color: #b9a594; }
.a2-stp { display: flex; align-items: center; gap: 4px; background: #f6efe7; border-radius: 14px; padding: 3px; width: max-content; } .a2-stp button { width: 38px; height: 38px; min-height: 0; padding: 0; border: 0; border-radius: 11px; background: #fff; font-size: 1.2rem; color: var(--vermelho); box-shadow: 0 1px 2px rgba(0,0,0,.08); }
.a2-stp input { width: 44px !important; min-height: 0 !important; padding: 6px 0 !important; border: 0 !important; background: transparent !important; text-align: center; font: 700 1.1rem var(--serif) !important; -moz-appearance: textfield; } .a2-stp input::-webkit-inner-spin-button { -webkit-appearance: none; }
.a2-logos { display: flex; gap: 14px; flex-wrap: wrap; margin-bottom: 8px; } .a2-logo { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 220px; padding: 14px; border-radius: 20px; background: #fffaf4; text-align: center; }
.a2-logo img { width: 150px; height: 110px; object-fit: contain; border-radius: 14px; background: var(--vermelho); padding: 6px; } .a2-logo img.red { width: 110px; border-radius: 50%; padding: 0; } .a2-logo small { color: #8a6f60; margin-bottom: 6px; }
.a2-tag { justify-self: start; padding: 5px 12px; border-radius: 999px; background: #e9f6ec; color: #16793a; font-weight: 700; font-size: .85rem; } .a2-tag.off { background: #f3ede6; color: #9a8676; }
@media (max-width: 700px) { .a2-rh { display: none; } .a2-r { grid-template-columns: 1fr 1fr; } .a2-r b { grid-column: 1 / -1; } }
/* RELATÓRIO, IMPRESSÃO e AJUSTES (o que já existia, com o mesmo acabamento) */
.adm2 .bloco h3 { font: 700 1.2rem var(--serif); margin: 0 0 10px; } .adm2 .bloco > p { color: #6b4a38; line-height: 1.45; }
.adm2 .pills:not(.a2-pills) .pill { box-shadow: none; border: 2px solid #f0dfcb; background: #fff; } .adm2 .pills:not(.a2-pills) .pill.on { background: var(--vermelho); border-color: var(--vermelho); color: #fff; }
.adm2 .rel-topo { background: #fff; padding: 12px 16px; border-radius: 20px; box-shadow: var(--sombra); max-width: 1100px; } .adm2 .rel-topo select { min-height: 46px; border-radius: 12px; }
.adm2 .cards { max-width: 1100px; } .adm2 .cards div { border-radius: 20px; padding: 16px; } .adm2 .cards b { font: 700 1.6rem var(--serif); }
.adm2 table:not(.lay):not(.cdp) { background: #fff; border-radius: 20px; box-shadow: var(--sombra); overflow: hidden; max-width: 1100px; } .adm2 table:not(.lay):not(.cdp) td { padding: 12px 14px; border-bottom: 1px solid #f6ece0; }
.adm2 .admin h3, .adm2 > h3 { font: 700 1.2rem var(--serif); }
.adm2 .rank { max-width: 1100px; background: #fff; padding: 8px 14px; border-radius: 14px; margin-bottom: 6px; }
.adm2 .bloco label:has(input[type=checkbox]) { padding: 12px 14px; border-radius: 16px; background: #fffaf4; margin: 0 !important; cursor: pointer; }
.adm2 .bloco input[type=checkbox]:not(.lay input) { -webkit-appearance: none; appearance: none; position: relative; flex-shrink: 0; width: 52px !important; height: 30px !important; border-radius: 999px; background: #e3d6c8; cursor: pointer; transition: background .2s; }
.adm2 .bloco input[type=checkbox]:not(.lay input)::after { content: ""; position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%; background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,.25); transition: transform .2s; }
.adm2 .bloco input[type=checkbox]:not(.lay input):checked { background: linear-gradient(135deg, var(--laranja), var(--lar-esc)); } .adm2 .bloco input[type=checkbox]:not(.lay input):checked::after { transform: translateX(22px); }
.adm2 .bloco select, .adm2 .bloco input:not([type=checkbox]):not([type=color]):not([type=file]) { min-height: 46px; border: 2px solid #eadccb; border-radius: 14px; background: #fffaf4; }
.adm2 .bloco button:not(.pill):not(.a2-b):not(.a2-x) { min-height: 46px; border-radius: 14px; }
.adm2 .bloco .btn-sec { border-width: 2px; }
`; document.head.appendChild(st); })();

aplicarCores();

// ===== SINCRONIZAÇÃO AUTOMÁTICA DAS CONFIGURAÇÕES COM O SERVIDOR =====
function snapshot() { const d = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!SEM_SYNC.includes(k)) d[k] = localStorage.getItem(k); } return d; }
function agendaSync() { clearTimeout(tSync); tSync = setTimeout(enviarConfig, 2000); } // 2s depois da última mudança
async function enviarConfig() {
  const tk = localStorage.getItem("tokenAdmin"); if (!tk) return false; // só quem entrou como admin neste aparelho grava as configurações
  const t = Date.now();
  try {
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tk }, body: JSON.stringify({ t, dados: snapshot() }) });
    if (r.ok) { localStorage.setItem("cfgT", String(t)); localStorage.removeItem("cfgSujo"); return true; }
    if (r.status === 401 || r.status === 403) localStorage.removeItem("tokenAdmin");
  } catch (e) { /* sem servidor agora: manda na próxima mudança */ }
  return false;
}
async function puxarConfig() {
  try {
    // 1º pergunta só a versão (uns bytes); baixa tudo (logo, fotos: ~400 KB) só quando o servidor tem uma mais nova
    const r0 = await fetch("/api/config?so=t"); if (!r0.ok) return;
    let srv = await r0.json(); const local = parseInt(localStorage.getItem("cfgT") || "0", 10);
    if (srv.t && srv.t > local && tela === "descanso" && localStorage.getItem("cfgSujo") !== "1") { const r = await fetch("/api/config"); if (!r.ok) return; srv = await r.json(); }
    if (!srv.t) return enviarConfig();                      // servidor ainda sem cópia: manda a daqui
    if (localStorage.getItem("cfgSujo") === "1") return enviarConfig(); // mudança local ainda não enviada: tenta mandar em vez de apagar com a cópia velha do servidor
    if (srv.t > local && tela === "descanso") {             // servidor tem versão mais nova: aplica (só com o totem parado)
      Object.keys(snapshot()).forEach((k) => localStorage.removeItem(k));
      Object.entries(srv.dados).forEach(([k, v]) => localStorage.setItem(k, v));
      localStorage.setItem("cfgT", String(srv.t)); location.reload();
    } else if (local > srv.t) enviarConfig();
  } catch (e) {}
}

// aberto pelo botão Admin da balança (index.html?admin=1): já pede a senha do admin; ao sair/cancelar volta pra balança
const VEIO_DA_BALANCA = new URLSearchParams(location.search).get("admin") === "1";
render();
if (VEIO_DA_BALANCA) pedirPin();
puxarConfig();
setInterval(puxarConfig, 60000);
aplicarAgendado(); setInterval(aplicarAgendado, 600000);
