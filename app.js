const $ = (s) => document.querySelector(s);
const brl = (n) => "R$" + n.toFixed(2).replace(".", ",");
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ler = (k, p) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : p; } catch (e) { return p; } };
const SEM_SYNC = ["pedidos", "fila", "contador", "carrinho", "cfgT", "pin", "tecladoVirtual", "tokenAdmin", "impFalhas"]; // o que NÃO vai pro backup automático
let tSync;
const salvar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} if (!SEM_SYNC.includes(k)) agendaSync(); };

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

const categorias = () => etapasLista().map((c) => ({ ...c, itens: [...new Set([...c.itens, ...(extras[c.id] || [])])].filter((n) => !removidos.has(c.id + ":" + n)) }));
const disponiveis = (c) => c.itens.filter((n) => !indisponiveis.has(c.id + ":" + n));
const toast = (m) => { const t = $("#toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2000); };

const logoPeq = () => `<div class="logo-box" data-acao="logo"><img class="logo" src="${esc(ler("logoPequena", "img/logo.png"))}" alt="Da Lúcia"></div>`;
const topo = (titulo) => `<header class="topo">${logoPeq()}<h1>${esc(titulo)}</h1>${["menu", "montar", "bebidas"].includes(tela) && ler("mostrarInicio", true) ? '<button class="btn-inicio" data-acao="sair">⌂ Início</button>' : ""}</header>`;

// ===== TELAS =====
function htmlMenu() {
  return topo(nomeCliente ? "Olá, " + nomeCliente + "! Escolha sua marmitex" : "Escolha sua marmitex") + `<section class="conteudo grade">` +
    marmitexLista().filter((m) => !indisponiveis.has("produto:" + m.id)).map((m) => `<button class="produto" data-acao="marmitex" data-id="${m.id}">
      <div class="foto-box"><img class="foto" src="${m.foto}" alt=""></div><span>${esc(m.nome)}</span></button>`).join("") +
    (temBebida() ? `<button class="produto" data-acao="bebidas"><div class="foto-box bebida-box">🥤</div><span>Bebidas</span></button>` : "") + `</section>`;
}

function htmlMontar() {
  if (montagem.i === montagem.passos.length) return htmlObs();
  const { marm, passos, i, escolhas } = montagem, cat = passos[i];
  const itens = disponiveis(cat), lim = Math.min(marm.regras[cat.id].max, itens.length), min = Math.min(marm.regras[cat.id].min, lim), sel = escolhas[cat.id] || [];
  const ult = i === passos.length - 1;
  return topo(`${cat.pergunta}${cat.adicional ? " (+" + brl(cat.adicional) + ")" : ""} - ${min === lim ? lim + (lim === 1 ? " Opção" : " Opções") : "de " + min + " a " + lim + " Opções"}`) + progresso(passos, i) + `<section class="conteudo">` +
    itens.map((n) => `<button class="linha ${sel.includes(n) ? "sel" : ""}" data-acao="escolher" data-item="${esc(n)}">
      ${FOTOS[n] ? `<img class="foto-item" src="${esc(FOTOS[n])}" alt="">` : ""}
      <span class="nome">${esc(n)}</span><span class="bolinha"></span></button>`).join("") +
    `</section><footer class="barra"><button class="btn-sec" data-acao="voltar">${i === 0 ? "Cancelar" : "Voltar"}</button>
    <span class="contagem">${sel.length} escolhida(s) (mín. ${min}, máx. ${lim})${montagem.aviso ? "<br><b>" + montagem.aviso + "</b>" : ""}</span>
    <button class="btn-prim" data-acao="proximo" ${sel.length >= min ? "" : "disabled"}>Próximo</button></footer>`;
}

function htmlSucesso() {
  return topo("Pedido enviado!") + `<section class="conteudo sucesso"><p>Obrigado${nomeCliente ? ", " + esc(nomeCliente) : ""}!<br>Seu número é</p><strong>${ultimo.numero}</strong>
    ${ultimo.comanda ? `<p class="na-comanda">Entrou na comanda <b>${ultimo.comanda}</b>. Você paga tudo no final!</p>` : ""}${ultimo.pendente ? `<p class="aviso-pend">⚠ O pedido ainda não chegou ao caixa. Avise um atendente!</p>` : `<p>A comanda foi enviada para a cozinha. Aguarde ser chamado!</p>`}
    <div class="barra-centro"><button class="btn-prim" data-acao="inicio">Novo pedido</button>
    <button class="btn-sec" data-acao="imprimir">Imprimir de novo</button></div></section>`;
}

const ABAS = [["Dia a dia", [["cardapio", "🍽", "Hoje"], ["relatorio", "📊", "Relatório"]]],
  ["Montar o cardápio", [["itens", "🧩", "Etapas e itens"], ["produtos", "🍱", "Produtos"]]],
  ["Configurar", [["impressao", "🖨", "Impressão"], ["ajustes", "⚙", "Ajustes"]]]];
function htmlAdmin() {
  const corpo = { cardapio: adminCardapio, itens: adminItens, relatorio: adminRelatorio, produtos: ajustesMarmitex, impressao: adminImpressao, ajustes: adminAjustes }[abaAdmin]();
  return `<header class="topo adm-topo">${logoPeq()}<h1>Administração</h1><button class="btn-sec" data-acao="inicio">Sair</button></header>
    <div class="adm-corpo"><nav class="menu-adm">${ABAS.map(([g, its]) => `<small>${g}</small>` + its.map(([id, ic, nome]) =>
      `<button class="${abaAdmin === id ? "on" : ""}" data-acao="aba" data-aba="${id}"><span>${ic}</span>${nome}</button>`).join("")).join("")}</nav>
    <section class="conteudo admin">${corpo}</section></div>`;
}

function htmlCarrinho() {
  const un = carrinho.reduce((s, c) => s + c.qtd, 0), val = carrinho.reduce((s, c) => s + c.qtd * c.preco, 0);
  return `<h2>Carrinho</h2><div class="itens">` + (carrinho.length ? carrinho.map((c, i) => `<div class="item-carrinho">
    <p>${c.qtd}x ${esc((c.grupos || []).length ? (c.grupos || []).flatMap((g) => g.itens).join(", ") : c.nome)}${c.obs ? `<br><i>Obs: ${esc(c.obs)}</i>` : ""}</p>
    <div class="controles"><span>${brl(c.preco)}</span><button data-acao="menos" data-i="${i}">−</button>
    <button data-acao="mais" data-i="${i}">+</button><button data-acao="remover" data-i="${i}" title="Remover">🗑</button></div></div>`).join("")
    : `<p class="vazio">Carrinho vazio. Escolha uma marmitex!</p>`) +
    `</div><div class="rodape"><p>Total - ${un} unidade${un === 1 ? "" : "s"}<br><span class="valor-total">Valor - ${brl(val)}</span></p>
    <button class="btn-finalizar" data-acao="finalizar" ${carrinho.length ? "" : "disabled"}>Finalizar</button></div>`;
}

let chavePrev = "";
function render() {
  const chave = tela + (montagem ? montagem.i : ""), sc = $(".conteudo") ? $(".conteudo").scrollTop : 0;
  $("#principal").innerHTML = { bebidas: htmlBebidas, descanso: htmlDescanso, nome: htmlNome, menu: htmlMenu, montar: htmlMontar, sucesso: htmlSucesso, admin: htmlAdmin }[tela]();
  $("#carrinho").innerHTML = htmlCarrinho();
  document.body.classList.toggle("sem-carrinho", ["descanso", "nome", "admin"].includes(tela));
  $("#principal").classList.toggle("entra", chave !== chavePrev); // anima só quando a tela muda
  if (chave === chavePrev && $(".conteudo")) $(".conteudo").scrollTop = sc;
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
  montagem = { marm, passos, i: 0, escolhas: {}, aviso: "", obs: "" };
  tela = "montar"; render();
}

function escolher(nome) {
  const cat = montagem.passos[montagem.i], lim = Math.min(montagem.marm.regras[cat.id].max, disponiveis(cat).length);
  let arr = montagem.escolhas[cat.id] || [];
  montagem.aviso = "";
  if (arr.includes(nome)) arr = arr.filter((n) => n !== nome);
  else if (lim === 1) arr = [nome];
  else if (arr.length < lim) arr = [...arr, nome];
  else montagem.aviso = "Máximo atingido. Toque numa escolhida para trocar.";
  montagem.escolhas[cat.id] = arr; render();
}

function adicionar() {
  const { marm, passos, escolhas } = montagem;
  const grupos = passos.map((c) => ({ rotulo: c.nome, itens: escolhas[c.id] || [] })).filter((g) => g.itens.length);
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
  m.innerHTML = `<div class="modal-caixa larga"><h2>Como você vai pagar?</h2>
    <button class="op-pag" data-acao="pagarCaixa">💳 Pagar no caixa<small>Pedido normal: pra levar ou comer aqui</small></button>
    <button class="op-pag" data-acao="naComanda">🍽 Colocar na minha comanda<small>Estou almoçando e pago tudo no final</small></button>
    <button class="btn-sec" data-acao="fecharModal">Voltar</button></div>`;
}
function pedirNumeroComanda() {
  $("#modal").innerHTML = `<div class="modal-caixa larga"><h2>Qual o número da sua comanda?</h2><p>É o número do cartão que você pegou na entrada.</p>
    <input id="num-comanda" class="campo-comanda" inputmode="numeric" maxlength="4" placeholder="Número da comanda">
    <div class="op-botoes"><button class="btn-sec" data-acao="fecharModal">Voltar</button><button class="btn-prim" data-acao="confirmarComanda">Confirmar</button></div></div>`;
  Promise.resolve().then(() => { const i = $("#num-comanda"); if (i) i.focus(); });
}
async function finalizar(comandaNum) {
  if (enviando) return; enviando = true;
  const dia = hoje(), c = ler("contador", {}), local = (c.dia === dia ? c.n : 0) + 1;
  const ped = { uid: novoUid(), comanda: comandaNum || undefined, dia, nome: nomeCliente, quando: Date.now(), itens: carrinho,
    unidades: carrinho.reduce((s, c) => s + c.qtd, 0), valor: carrinho.reduce((s, c) => s + c.qtd * c.preco, 0) };
  let numero = local, pendente = false;
  try { // manda pro servidor (o caixa enxerga na hora); ele devolve o número do pedido
    const r = await fetch("/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ped) });
    if (!r.ok) throw 0; numero = (await r.json()).numero;
  } catch (e) { pendente = true; salvar("fila", [...ler("fila", []), { ...ped, numero: local }]); } // servidor fora: guarda e reenvia depois
  salvar("contador", { dia, n: Math.max(local, numero) });
  ultimo = { ...ped, numero, pendente }; salvar("pedidos", [...ler("pedidos", []), ultimo]);
  carrinho = []; tela = "sucesso"; enviando = false; render();
  setTimeout(() => imprimirTicket(linhasComanda(ultimo)), 300);
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
  if (a === "proximo") { if (montagem.i < montagem.passos.length) { montagem.i++; montagem.aviso = ""; render(); } else adicionar(); return; }
  if (a === "voltar") { if (montagem.i === 0) { montagem = null; tela = "menu"; } else montagem.i--; return render(); }
  if (a === "sair") { if ((carrinho.length || montagem) && !confirm("Cancelar o pedido e voltar para o início?")) return; return reiniciar(); }
  if (a === "etapaAtual") { etapaAtual = d.id; filtroAdmin = ""; return render(); }
  if (a === "prodAtual") { prodAtual = d.id; return render(); }
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
  if (a === "pedirBebida") return addBebida(d.nome);
  if (a === "semBebida") { tela = "menu"; return render(); }
  if (a === "bebidas") { tela = "bebidas"; return render(); }
  if (a === "modoApagar") { modoApagar = !modoApagar; return render(); }
  if (a === "apagarItem") {
    const i = d.id.indexOf(":"), cat = d.id.slice(0, i), nome = d.id.slice(i + 1);
    if (!confirm(`Apagar "${nome}" do cardápio?`)) return;
    bebidasExtras = bebidasExtras.filter((b) => b.nome !== nome); extras[cat] = (extras[cat] || []).filter((n) => n !== nome); removidos.add(d.id);
    salvar("extras", extras); salvar("bebidasExtras", bebidasExtras); salvar("removidos", [...removidos]); return render();
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
    if (!nome || !(preco >= 0) || bebidasLista().some((b) => b.nome === nome)) return toast("Digite um nome novo e o preço (ex.: 6,50).");
    bebidasExtras.push({ nome, preco }); removidos.delete("bebida:" + nome); salvar("bebidasExtras", bebidasExtras); salvar("removidos", [...removidos]);
  }
  if (a === "chipObs") { montagem.obs = (montagem.obs ? montagem.obs + ", " : "") + d.txt; return render(); }
  if (a === "tecla") { if (pinDigitado.length < 8) pinDigitado += d.n; return desenharPin(); }
  if (a === "okPin") return entrarAdmin();
  if (a === "apagarPin") { pinDigitado = pinDigitado.slice(0, -1); return desenharPin(); }
  if (a === "cancelarPin") { $("#modal").hidden = true; return; }
  if (a === "aba") { abaAdmin = d.aba; modoApagar = false; filtroAdmin = ""; render(); $(".conteudo").scrollTop = 0; return; }
  if (a === "impRel") return imprimirTicket(linhasRelatorio());
  if (a === "apagarDia") { const dia = diaRel || hoje(); if (confirm("Apagar todos os pedidos de " + dataBR(dia) + "?")) { salvar("pedidos", ler("pedidos", []).filter((p) => p.dia !== dia)); render(); } return; }
  if (a === "imprimir") return imprimirTicket(linhasComanda(ultimo));
  if (a === "mais") return mudarQtd(+d.i, 1);
  if (a === "menos") return mudarQtd(+d.i, -1);
  if (a === "remover") return mudarQtd(+d.i, -999);
  if (a === "finalizar") return perguntarComanda();
  if (a === "inicio") return reiniciar();
  if (a === "toggle") { indisponiveis.has(d.id) ? indisponiveis.delete(d.id) : indisponiveis.add(d.id); }
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

function htmlNome() {
  return topo("Qual é o seu nome?") + `<section class="conteudo nome-tela"><p>Vamos te chamar pelo nome quando o pedido ficar pronto.</p>
    <input id="nome" maxlength="30" placeholder="Digite seu nome" autocomplete="off" value="${esc(nomeCliente)}">
    <div class="barra-centro"><button class="btn-sec" data-acao="inicio">Cancelar</button>
    <button id="btn-nome" class="btn-prim" data-acao="continuar" ${nomeCliente.trim() || !ler("nomeObrigatorio", true) ? "" : "disabled"}>Continuar</button></div></section>`;
}

function reiniciar() { carrinho = []; nomeCliente = ""; montagem = null; tela = "descanso"; render(); }
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
function htmlObs() {
  return topo("Alguma observação?") + progresso(montagem.passos, montagem.passos.length) + `<section class="conteudo nome-tela"><p>Opcional. Ex.: sem cebola, pouco sal...</p>
    <textarea id="obs" maxlength="80" placeholder="Escreva aqui (opcional)">${esc(montagem.obs)}</textarea>
    <div class="chips cc">${["Sem cebola", "Sem pimenta", "Pouco sal", "Capricha no feijão"].map((t) => `<button class="chip on" data-acao="chipObs" data-txt="${t}">${t}</button>`).join("")}</div></section>
    <footer class="barra"><button class="btn-sec" data-acao="voltar">Voltar</button><span class="contagem">Última etapa</span>
    <button class="btn-prim" data-acao="proximo">Adicionar ao carrinho</button></footer>`;
}

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

function addBebida(nome) {
  const b = bebidasLista().find((x) => x.nome === nome), key = "bebida|" + nome, ex = carrinho.find((c) => c.key === key);
  if (!b) return;
  if (ex) ex.qtd++; else carrinho.push({ key, tipo: "bebida", nome, preco: b.preco, grupos: [], obs: "", qtd: 1 });
  salvar("carrinho", carrinho); render(); pulsaCarrinho();
}
function htmlBebidas() {
  const lista = bebidasLista().filter((b) => !indisponiveis.has("bebida:" + b.nome));
  return topo("Quer uma bebida?") + `<section class="conteudo grade">${lista.map((b) => {
    const q = (carrinho.find((c) => c.key === "bebida|" + b.nome) || {}).qtd || 0;
    return `<button class="bebida" data-acao="pedirBebida" data-nome="${esc(b.nome)}">${q ? `<em>${q}</em>` : ""}<span>🥤</span><b>${esc(b.nome)}</b><small>${brl(b.preco)}</small></button>`;
  }).join("")}</section><footer class="barra"><span class="contagem">Toque para adicionar. Para tirar, use o carrinho.</span><button class="btn-prim" data-acao="semBebida">Continuar</button></footer>`;
}
const listaDe = (id) => id === "produto" ? marmitexLista().map((m) => ({ key: "produto:" + m.id, label: m.nome + " - " + brl(m.preco) })) : id === "bebida"
  ? bebidasLista().map((b) => ({ key: "bebida:" + b.nome, label: b.nome + " - " + brl(b.preco) }))
  : categorias().find((c) => c.id === id).itens.map((n) => ({ key: id + ":" + n, label: n }));
const nomeEtapa = (id) => (id === "produto" ? "Produtos" : id === "bebida" ? "Bebidas" : (etapasLista().find((c) => c.id === id) || {}).nome);
function pillsEtapas(contador, prod) {
  const et = [...(prod ? [["produto", "Produtos"]] : []), ...etapasLista().map((c) => [c.id, c.nome]), ["bebida", "Bebidas"]];
  if (!et.some(([id]) => id === etapaAtual)) etapaAtual = et[0][0];
  return `<div class="pills">${et.map(([id, nome]) => { const l = listaDe(id), on = l.filter((i) => !indisponiveis.has(i.key)).length;
    return `<button class="pill ${id === etapaAtual ? "on" : ""}" data-acao="etapaAtual" data-id="${id}">${esc(nome)}${contador ? ` <small>${on}/${l.length}</small>` : ""}</button>`; }).join("")}</div>`;
}
function adminCardapio() { // aba HOJE: só liga/desliga o que tem no dia
  const pills = pillsEtapas(true, true), lista = listaDe(etapaAtual), on = lista.filter((i) => !indisponiveis.has(i.key)).length;
  return cardapiosBloco() + `<div class="ajuda">🍽 <b>O que vai ter hoje?</b> Em <b>Produtos</b> você liga ou desliga as marmitex do dia (ex.: Feijoada completa). Nas outras, escolha os itens. <b>Laranja</b> = aparece pro cliente, <b>cinza</b> = escondido. Os números mostram quantos estão ligados.</div>${pills}
    <div class="bloco"><div class="bloco-topo"><h3>${esc(nomeEtapa(etapaAtual))} <small>${on} de ${lista.length} ligados</small></h3>
    <button data-acao="todos" data-cat="${etapaAtual}">Ligar todos</button><button data-acao="nenhum" data-cat="${etapaAtual}">Desligar todos</button></div>
    <input id="busca-adm" class="busca" placeholder="Buscar item..." value="${esc(filtroAdmin)}">
    <div class="chips">${lista.map((i) => `<button class="chip ${indisponiveis.has(i.key) ? "" : "on"}" data-acao="toggle" data-id="${esc(i.key)}">${esc(i.label)}</button>`).join("") || "<p>Nenhum item ainda. Adicione na aba Etapas e itens.</p>"}</div></div>`;
}
function adminItens() { // aba ETAPAS E ITENS: criar e apagar
  const pills = pillsEtapas(false), lista = listaDe(etapaAtual), beb = etapaAtual === "bebida";
  return `<div class="ajuda">🧩 <b>Aqui você cria e apaga itens e etapas.</b> Um item novo já entra ligado. Pra escolher o que tem hoje, use a aba <b>Hoje</b>.</div>${pills}
    <div class="bloco"><h3>${esc(nomeEtapa(etapaAtual))} <small>${lista.length} itens</small></h3>
    <div class="chips">${lista.map((i) => `<span class="chip on item-edit">${esc(i.label)} <b data-acao="apagarItem" data-id="${esc(i.key)}">✕</b></span>`).join("") || "<p>Nenhum item.</p>"}</div>
    <h4>Adicionar</h4>${beb ? `<div class="novo"><input id="nova-bebida" placeholder="Nova bebida"><input id="preco-bebida" inputmode="decimal" placeholder="Preço (ex.: 6,50)"><button data-acao="novaBebida">Adicionar</button></div>`
      : `<div class="novo"><textarea id="novo-${etapaAtual}" rows="3" placeholder="Digite um item, ou cole vários (um por linha)"></textarea><button data-acao="addExtra" data-cat="${etapaAtual}">Adicionar</button></div>`}</div>
    ${beb ? "" : posicaoBloco()}
    ${beb ? "" : `<div class="bloco perigo"><h3>Apagar esta etapa</h3><p>Remove a etapa ${esc(nomeEtapa(etapaAtual))} e todos os itens dela.</p><button class="btn-sec" data-acao="apagarEtapa" data-id="${etapaAtual}">Apagar etapa</button></div>`}
    <div class="bloco"><h3>Criar uma etapa nova</h3><p>Ex.: Sobremesa, Molho. Depois vá em <b>Produtos</b> e diga quantos itens dela o cliente escolhe.</p>
    <div class="novo"><input id="ne-nome" placeholder="Nome da etapa"><button data-acao="novaEtapa">Criar etapa</button></div></div>`;
}

function adminAjustes() {
  const abas = [["aparencia", "🎨 Aparência"], ["uso", "🔒 Segurança e uso"], ["dados", "💾 Dados e servidor"]];
  const idle = ler("idle", 90), t = parseInt(localStorage.getItem("cfgT") || "0", 10);
  const corpo = {
    aparencia: () => `<div class="ajuda">🎨 Cores, textos e logos do totem.</div>${aparencia()}
      <div class="bloco"><h3>Logos</h3><p>Logo redonda (topo e canto):</p><input type="file" accept="image/*" data-logo="logoPequena">
      <p>Logo grande (tela de descanso):</p><input type="file" accept="image/*" data-logo="logoGrande">
      <p><button data-acao="resetLogos">Voltar às logos padrão (pasta img)</button></p></div>`,
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
function dadosDia() {
  const dia = diaRel || hoje(), ps = ler("pedidos", []).filter((p) => p.dia === dia), tipo = {}, item = {};
  ps.forEach((p) => p.itens.forEach((c) => {
    const t = (tipo[c.nome] = tipo[c.nome] || { q: 0, v: 0 }); t.q += c.qtd; t.v += c.qtd * c.preco;
    ((c.grupos || []).length ? (c.grupos || []).flatMap((g) => g.itens) : [c.nome]).forEach((n) => { item[n] = (item[n] || 0) + c.qtd; });
  }));
  const un = soma(ps, (p) => soma(p.itens.filter((c) => c.tipo !== "bebida"), (c) => c.qtd)), beb = soma(ps, (p) => soma(p.itens.filter((c) => c.tipo === "bebida"), (c) => c.qtd)), val = soma(ps, (p) => p.valor);
  return { dia, ps, tipo, un, beb, val, medio: ps.length ? val / ps.length : 0, rank: Object.entries(item).sort((a, b) => b[1] - a[1]).slice(0, 10) };
}

function adminRelatorio() {
  const r = dadosDia(), max = r.rank.length ? r.rank[0][1] : 1;
  const dias = [...new Set([...ler("pedidos", []).map((p) => p.dia), hoje()])].sort().reverse();
  return `<div class="rel-topo"><label>Dia: <select id="sel-dia">${dias.map((x) => `<option value="${x}" ${x === r.dia ? "selected" : ""}>${dataBR(x)}</option>`).join("")}</select></label>
    <button class="btn-sec" data-acao="impRel">Imprimir resumo</button><button class="btn-sec" data-acao="apagarDia">Apagar este dia</button></div>
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
  if (!r.ok) return { ok: false, erro: erroImp(j.erro) };
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
function imprimirTicket(linhas) {
  const k = impCfg();
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
  salvar("fila", resta);
}
setInterval(enviarFila, 15000);

// ===== PERSONALIZAÇÃO (etapas, preços, cores, textos) =====
const etapasLista = () => {
  const rem = ler("etapasRemovidas", []), ad = ler("etapasAdicional", {}), ord = ler("etapasOrdem", []), inf = ler("etapasInfo", {});
  return [...CATEGORIAS, ...ler("etapasExtras", [])].filter((c) => !rem.includes(c.id)).map((c) => { const i = inf[c.id] || {}, nome = i.nome || c.nome; return { ...c, nome, pergunta: i.pergunta || c.pergunta || "Escolha: " + nome, adicional: ad[c.id] || 0 }; })
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

function ajustesMarmitex() { // aba PRODUTOS
  const ps = marmitexLista(); if (!ps.some((p) => p.id === prodAtual)) prodAtual = ps.length ? ps[0].id : null;
  const m = ps.find((p) => p.id === prodAtual), num = (campo, c) => `<input type="number" min="0" max="9" data-cfg="${m.id}|${campo}|${c.id}" value="${m.regras[c.id][campo]}">`;
  const txt = (r) => (r.max === 0 ? "não aparece" : r.min === r.max ? "escolhe " + r.max : "de " + r.min + " a " + r.max);
  return `<div class="ajuda">🍱 <b>Produtos</b> são as marmitex da tela inicial. Pra cada uma você define nome, preço, foto e <b>quantos itens</b> o cliente escolhe em cada etapa.</div>
    <div class="pills">${ps.map((p) => `<button class="pill ${p.id === prodAtual ? "on" : ""}" data-acao="prodAtual" data-id="${p.id}">${esc(p.nome)}</button>`).join("")}</div>` +
    (m ? `<div class="bloco"><div class="bloco-topo"><h3>${esc(m.nome)}</h3><button data-acao="duplicar" data-id="${m.id}">Duplicar</button><button data-acao="apagarProduto" data-id="${m.id}">Apagar produto</button></div>
      <h4>Nome e preço</h4><div class="novo"><input data-cfg="${m.id}|nome" value="${esc(m.nome)}"><input data-cfg="${m.id}|preco" inputmode="decimal" value="${m.preco.toFixed(2).replace(".", ",")}"></div>
      <h4>Foto</h4><p>${m.foto ? `<img class="mini" src="${m.foto}" alt="">` : ""}<input type="file" accept="image/*" data-foto="${m.id}"></p>
      <h4>Etapas deste produto</h4><p>Mínimo e máximo de itens que o cliente escolhe. Máximo 0 = a etapa não aparece.</p>
      <table class="regras"><tr><th>Etapa</th><th>Mínimo</th><th>Máximo</th><th>Resultado</th></tr>
      ${etapasLista().map((c) => `<tr><td>${esc(c.nome)}</td><td>${num("min", c)}</td><td>${num("max", c)}</td><td>${txt(m.regras[c.id])}</td></tr>`).join("")}</table></div>` : "") +
    `<div class="bloco"><h3>Novo produto</h3><div class="novo"><input id="np-nome" placeholder="Nome (ex.: Marmitex Fit)"><input id="np-preco" inputmode="decimal" placeholder="Preço"><button data-acao="novoProduto">Criar produto</button></div>
    <p>Dica: <b>Duplicar</b> copia um produto com todas as etapas dele.</p></div>`;
}
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
  { id: "loja", nome: "Nome do restaurante", texto: "DA LUCIA", mostrar: true, tam: "grande", alin: "c", neg: true },
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
  const add = (id, texto) => { const b = B[id]; if (b.mostrar && texto) L.push({ t: texto, s: b.tam, a: b.alin, b: b.neg }); };
  add("loja", B.loja.texto); add("titulo", B.titulo.texto); add("numero", "PEDIDO " + p.numero); if (p.comanda) L.push({ t: "NA COMANDA " + p.comanda, s: "grande", a: "c", b: true });
  add("cliente", p.nome ? p.nome.toUpperCase() : ""); add("data", new Date(p.quando).toLocaleString("pt-BR")); if (tr) L.push(tr);
  p.itens.forEach((c) => {
    add("itens", `${c.qtd}x ${c.nome}`);
    (c.grupos || []).forEach((g) => add("detalhes", `${g.rotulo}: ${g.itens.join(", ")}`));
    if (c.obs) add("obs", "OBS: " + c.obs);
    if (tr) L.push(tr);
  });
  add("total", `Total: ${p.unidades} un - ${brl(p.valor)}`); add("rodape", p.comanda ? "Cobrado na comanda " + p.comanda : B.rodape.texto);
  return L;
}
function escpos(linhas) {
  const k = impCfg(), enc = new TextEncoder(), by = [0x1B, 0x40];
  linhas.forEach((l) => {
    const [gs, f, fb] = TAMS[l.s || (l.g ? "grande" : "normal")] || TAMS.normal, al = { l: 0, c: 1, r: 2 }[l.a || (l.c ? "c" : "l")];
    quebrar(l.t, Math.max(8, Math.floor(largura() * f))).forEach((txt) =>
      by.push(0x1B, 0x4D, fb, 0x1B, 0x61, al, 0x1B, 0x45, l.b ? 1 : 0, 0x1D, 0x21, gs, ...enc.encode(txt + "\n")));
  });
  by.push(0x1B, 0x4D, 0, 0x1B, 0x64, k.avanco); if (k.corte) by.push(0x1D, 0x56, 0x42, 0x00); // avança o papel e corta
  return by;
}
const amostra = () => ({ numero: 12, nome: "Nicolas", quando: Date.now(), unidades: 2, valor: 44,
  itens: [{ qtd: 2, nome: "Marmitex de R$22,00", obs: "sem cebola", grupos: [{ rotulo: "Arroz", itens: ["Arroz Branco"] }, { rotulo: "Feijão", itens: ["Feijão Tradicional"] }, { rotulo: "Carne", itens: ["Carne de Panela"] }] }] });
const PREV = { pequena: ".8em", normal: "1em", alta: "1em", grande: "2em", gigante: "3em" };
function previa() {
  const html = linhasComanda(amostra()).map((l) => {
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
const todasChaves = () => ["produto", ...etapasLista().map((c) => c.id), "bebida"].flatMap((id) => listaDe(id).map((i) => i.key));
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
function cardapiosBloco() {
  const cs = ler("cardapios", {}), nomes = Object.keys(cs), ativo = ler("cardapioAtivo", ""), DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  return `<div class="bloco"><h3>Cardápios salvos${ativo ? ` <small>último aplicado: ${esc(ativo)}</small>` : ""}</h3>
    <p>Monte o cardápio nas etapas aqui embaixo e salve com um nome. Depois é só tocar em <b>Aplicar</b>.</p>
    ${nomes.length ? `<table class="regras cdp"><tr><th>Cardápio</th><th></th><th></th><th>Dia automático</th><th></th></tr>${nomes.map((n) => `<tr><td><b>${esc(n)}</b><br><small>${cs[n].on.length} itens ligados</small></td>
      <td><button class="btn-sec" data-acao="aplicarCardapio" data-nome="${esc(n)}">Aplicar</button></td>
      <td><button data-acao="atualizarCardapio" data-nome="${esc(n)}">Atualizar com o de agora</button></td>
      <td><select data-cd="${esc(n)}"><option value="-1">Nenhum</option>${DIAS.map((x, i) => `<option value="${i}" ${cs[n].dia === i ? "selected" : ""}>${x}</option>`).join("")}</select></td>
      <td><button data-acao="apagarCardapio" data-nome="${esc(n)}">✕</button></td></tr>`).join("")}</table>` : `<p class="vazio">Nenhum cardápio salvo ainda.</p>`}
    <div class="novo"><input id="cardapio-nome" placeholder="Nome do cardápio (ex.: Segunda)"><button data-acao="salvarCardapio">Salvar o cardápio de agora</button></div></div>`;
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
  return `<p>Papel: <button data-acao="papel" data-cols="32">58 mm</button> <button data-acao="papel" data-cols="48">80 mm</button>
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
    if (["ip", "porta", "modo"].includes(d.imp)) statusImp = null; c[d.imp] = v; salvar("impCfg", c); toast("Salvo!"); render();
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

aplicarCores();

// ===== SINCRONIZAÇÃO AUTOMÁTICA DAS CONFIGURAÇÕES COM O SERVIDOR =====
function snapshot() { const d = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!SEM_SYNC.includes(k)) d[k] = localStorage.getItem(k); } return d; }
function agendaSync() { clearTimeout(tSync); tSync = setTimeout(enviarConfig, 2000); } // 2s depois da última mudança
async function enviarConfig() {
  const tk = localStorage.getItem("tokenAdmin"); if (!tk) return; // só quem entrou como admin neste aparelho grava as configurações
  const t = Date.now();
  try {
    const r = await fetch("/api/config", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tk }, body: JSON.stringify({ t, dados: snapshot() }) });
    if (r.ok) localStorage.setItem("cfgT", String(t)); else if (r.status === 401 || r.status === 403) localStorage.removeItem("tokenAdmin");
  } catch (e) { /* sem servidor agora: manda na próxima mudança */ }
}
async function puxarConfig() {
  try {
    const r = await fetch("/api/config"); if (!r.ok) return;
    const srv = await r.json(), local = parseInt(localStorage.getItem("cfgT") || "0", 10);
    if (!srv.t) return enviarConfig();                      // servidor ainda sem cópia: manda a daqui
    if (srv.t > local && tela === "descanso") {             // servidor tem versão mais nova: aplica (só com o totem parado)
      Object.keys(snapshot()).forEach((k) => localStorage.removeItem(k));
      Object.entries(srv.dados).forEach(([k, v]) => localStorage.setItem(k, v));
      localStorage.setItem("cfgT", String(srv.t)); location.reload();
    } else if (local > srv.t) enviarConfig();
  } catch (e) {}
}

render();
puxarConfig();
setInterval(puxarConfig, 60000);
aplicarAgendado(); setInterval(aplicarAgendado, 600000);
