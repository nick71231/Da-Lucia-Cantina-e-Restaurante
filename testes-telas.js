// Testa as TELAS de verdade (abre totem, caixa e balança num navegador simulado, clica nas abas e confere o que aparece).
// Precisa uma vez:  npm install     (instala o jsdom, só pra testes)      Rodar:  node testes-telas.js
let JSDOM, VirtualConsole; try { ({ JSDOM, VirtualConsole } = require("jsdom")); } catch (e) { console.error("\nTESTES DE TELA NÃO EXECUTADOS: falta instalar o jsdom. Rode  npm install  e tente de novo.\n"); process.exit(2); }
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const PORTA = 3998, B = "http://localhost:" + PORTA, dir = fs.mkdtempSync(path.join(os.tmpdir(), "totem-telas-")), nodeFetch = globalThis.fetch;
let ok = 0, falhas = 0, erros = [];
const t = (c, n) => { c ? ok++ : falhas++; console.log((c ? "  ok    " : "  FALHOU ") + n); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (m, u, body, tok) => { const r = await nodeFetch(B + u, { method: m, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return r.json().catch(() => ({})); };
const srv = spawn(process.execPath, ["server.js"], { cwd: __dirname, env: { ...process.env, PORTA, DADOS_DIR: dir, BACKUP_EXTRA: "" } });
let saida = ""; srv.stdout.on("data", (d) => (saida += d)); srv.stderr.on("data", (d) => (saida += d));
const sobe = () => new Promise((res, rej) => { const i = setInterval(() => { if (saida.includes("Servidor no ar")) { clearInterval(i); res(); } }, 100); setTimeout(() => rej(new Error("servidor não subiu: " + saida)), 8000); });

async function abre(caminho, antes) { // abre uma página do servidor como se fosse um navegador
  const vc = new VirtualConsole(); vc.on("jsdomError", (e) => erros.push(caminho + ": " + (e.detail && e.detail.message || e.message)));
  const dom = await JSDOM.fromURL(B + caminho, { runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) {
    w.fetch = (u, o) => nodeFetch(new URL(u, B).href, o); w.AbortController = AbortController; w.alert = (m) => erros.push(caminho + " alert: " + m); w.confirm = () => true; w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = () => {}; w.addEventListener("error", (e) => erros.push(caminho + ": " + e.message)); if (antes) antes(w);
  } });
  await new Promise((r) => (dom.window.document.readyState === "complete" ? r() : dom.window.addEventListener("load", r))); await dorme(900); return dom.window;
}
const clica = async (w, sel) => { const el = w.document.querySelector(sel); if (!el) throw new Error("não achei " + sel); el.click(); await dorme(500); };
const toca = async (w, sel) => { const el = w.document.querySelector(sel); if (!el) throw new Error("não achei " + sel); el.dispatchEvent(new w.Event("pointerdown", { bubbles: true, cancelable: true })); await dorme(300); }; // teclado da balança reage ao toque (pointerdown), não ao click
const texto = (w, sel) => (w.document.querySelector(sel) || { textContent: "" }).textContent;

(async () => {
  await sobe();
  const admin = (await api("POST", "/api/login", { role: "admin", pin: "12345" })).token, cx = (await api("POST", "/api/login", { role: "caixa", pin: "2222" })).token, bl = (await api("POST", "/api/login", { role: "balanca", pin: "3333" })).token;
  await api("POST", "/api/balanca", { comanda: 36, valor: 85.36, uid: "s1" }, bl);
  await api("POST", "/api/balanca", { comanda: 36, valor: 12, nome: "Suco Grande", uid: "s2" }, bl);   // bebida: era o que quebrava a lista
  await api("POST", "/api/pedidos", { uid: "s3", nome: "Ana", comanda: 36, itens: [{ nome: "Marmitex de R$22,00", preco: 22, qtd: 1, grupos: [{ rotulo: "Arroz", itens: ["Branco"] }] }] });
  await api("POST", "/api/pedidos", { uid: "s4", nome: "Beto", itens: [{ nome: "Marmitex de R$24,00", preco: 24, qtd: 1, grupos: [{ rotulo: "Carne", itens: ["Bife"] }] }] });
  await api("POST", "/api/clientes", { nome: "Elza" }, cx);
  const mesT = new Date().toLocaleDateString("en-CA").slice(0, 7), almC = await api("POST", "/api/clientes", { nome: "ALMOÇO", empresa: "CARAMURU" }, cx);
  await api("POST", "/api/lancamentos", { clienteId: almC.id, dia: mesT + "-03", qtd: 4, valor: 120 }, cx); await api("POST", "/api/lancamentos", { clienteId: almC.id, dia: mesT + "-20", qtd: 2, valor: 77 }, cx);
  const cafeC = await api("POST", "/api/clientes", { nome: "CAFE DA MANHÃ", empresa: "CARAMURU" }, cx); await api("POST", "/api/lancamentos", { clienteId: cafeC.id, dia: mesT + "-04", valor: 300, obs: "30x marmitex R$ 10,00 = R$ 300,00 (WhatsApp)" }, cx);

  console.log("\nCaixa");
  const w = await abre("/caixa.html", (win) => { win.sessionStorage.setItem("caixaToken", admin); win.sessionStorage.setItem("caixaRole", "admin"); });
  { const wc = await abre("/caixa.html", (win) => win.sessionStorage.setItem("caixaToken", cx)); t(!wc.document.querySelector('[data-aba="painel"]'), "funcionário (senha do caixa) não vê o Painel de faturamento"); t(!w.document.querySelector('[data-aba="painel"]'), "Painel saiu do caixa (os números ficam no Fechamento e na Gestão do site)"); }
  t(texto(w, "#lista").includes("C36") && texto(w, "#lista").includes("Beto"), "'Em aberto' mostra a comanda com bebida e o pedido do totem");
  t(texto(w, "#n-aberto") === "2", "contador de abertos bate (2)");
  for (const [aba, esperado] of [["clientes", "Novo cliente"], ["aberto", "C36"], ["gaveta", "Gaveta de hoje"], ["aberto", "C36"], ["fechamento", "Por forma de pagamento"], ["contas", "A receber"], ["conta", ""], ["pagos", ""], ["aberto", "C36"]]) {
    await clica(w, `[data-aba="${aba}"]`);
    t(texto(w, "#lista").includes(esperado) && texto(w, "#lista").trim().length > 0, `aba ${aba}: mostra o conteúdo certo (sem ficar com a aba anterior)`);
  }
  { // conta da Caramuru: filtro de quinzena e planilha com a quantidade de almoços
    await clica(w, '[data-aba="contas"]'); await clica(w, '[data-a="abrirConta"][data-k="e:CARAMURU"]');
    await clica(w, '[data-a="ctQuinz"][data-q="1"]'); const q1 = texto(w, "#lista");
    { const qc = texto(w, ".q-cards"); t(q1.includes("420,00") && /refei\S*\s*34(?!\d)/i.test(qc) && !q1.includes("77,00") && !/do m\S+s todo|Pago no m\S+s|A pagar \(m/.test(q1), "conta: 1ª quinzena mostra só o consumo do dia 1 ao 15, com os almoços (nada do mês todo)"); }
    await clica(w, '[data-a="ctVisao"][data-v="planilha"]'); const cels = [...w.document.querySelectorAll("td.cel")].map((x) => x.textContent.trim()).filter(Boolean);
    t(cels.sort().join() === "30,4" && w.document.querySelectorAll("tr:not(.tot-fim) > td.dia").length <= 8 && /TOTAL GERAL/.test(texto(w, ".grade")), "planilha da Caramuru: só os dias da quinzena e a célula mostra a quantidade de almoços");
    await clica(w, '[data-a="ctQuinz"][data-q="2"]'); t(texto(w, "#lista").includes("77,00") && !texto(w, "#lista").includes("120,00"), "2ª quinzena mostra só do dia 16 ao fim");
    await clica(w, '[data-a="voltaLista"]'); await clica(w, '[data-aba="aberto"]');
  }
  { // clientes: "MARMITA" no nome vai pro grupo Marmita; avulso com consumo de 3 dias atrás sem pagar = alerta de fiado
    const zm = await api("POST", "/api/clientes", { nome: "ZECA MARMITA" }, cx), zf = await api("POST", "/api/clientes", { nome: "ZECA FIADO" }, cx);
    // dona 23/11: fiado avisa com 5 dias (3 dias ainda não); quem é "conta mensal" não entra no aviso de fiado
    const zn = await api("POST", "/api/clientes", { nome: "ZECA NOVO" }, cx), zc = await api("POST", "/api/clientes", { nome: "ZECA MENSAL", cobranca: "mensal" }, cx);
    const dd = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA");
    await api("POST", "/api/lancamentos", { clienteId: zf.id, dia: dd(6), valor: 40 }, cx); await api("POST", "/api/lancamentos", { clienteId: zn.id, dia: dd(3), valor: 15 }, cx);
    await api("POST", "/api/lancamentos", { clienteId: zc.id, dia: dd(6), valor: 70 }, cx); await api("POST", "/api/lancamentos", { clienteId: zm.id, dia: dd(6), valor: 50 }, cx);
    const wf = await abre("/caixa.html", (win) => { win.sessionStorage.setItem("caixaToken", admin); win.sessionStorage.setItem("caixaRole", "admin"); }); await dorme(4600);
    const avF = texto(wf, "#aviso-fiado");
    t(avF.includes("ZECA FIADO") && !avF.includes("ZECA MARMITA") && !avF.includes("ZECA MENSAL") && !avF.includes("ZECA NOVO") && /5 dias/.test(avF), "alerta de fiado: só fiado com 5+ dias sem pagar (3 dias, marmita e conta mensal não)");
    const fech = wf.eval("contasDoFechamento(contasCli || null)") || [];
    { const C = await api("GET", "/api/contas?mes=" + new Date().toLocaleDateString("en-CA").slice(0, 7), undefined, cx); const nomes = wf.eval("(c) => contasDoFechamento(c).map((x) => x.nome)")(C);
      t(nomes.includes("ZECA MENSAL") && nomes.includes("ZECA MARMITA") && !nomes.includes("ZECA FIADO"), "fechamento do mês (dia 25): lista conta mensal e marmita com saldo, não o fiado"); void fech; }
    await clica(wf, '[data-aba="clientes"]'); await clica(wf, '[data-a="cliFiltro"][data-f="marm"]');
    t(texto(wf, "#lista").includes("ZECA MARMITA") && !texto(wf, "#lista").includes("ZECA FIADO"), "clientes: quem tem MARMITA no nome fica no grupo Marmita, não nos avulsos");
    wf.close();
  }
  { // comandas JUNTADAS no Receber: o "Marcar na conta" continua aparecendo e marca todas (dona 23/11: sumia)
    const abertos = (await api("GET", "/api/pedidos?dia=" + new Date().toLocaleDateString("en-CA"), undefined, cx)).filter((p) => p.status === "aguardando");
    w.abrirAcerto(abertos.map((p) => p.id)); await dorme(100);
    t(abertos.length >= 2 && !w.document.querySelector("#ac-conta").hidden, "comandas juntadas: o botão Marcar na conta aparece");
    await clica(w, "#ac-conta"); await dorme(100);
    t(!!w.document.querySelector("#busca-cli"), "comandas juntadas: Marcar na conta abre a escolha do cliente");
    await clica(w, '[data-a="fechar"]'); await dorme(100);
  }
  await clica(w, '[data-a="receber"]'); // 1º cartão = pedido do Beto (1 item)
  t(!w.document.querySelector("#modal").hidden && w.document.querySelectorAll(".ac-li").length === 1 && w.document.querySelector("#ac-ok").disabled, "janela de acerto lista o item e só libera depois de escolher a forma");
  { // Receber em painel na direita: Esc fecha, F1..F5 escolhem a forma (e o F5 não recarrega), Marcar na conta, imprimir sempre
    const m = w.document.querySelector("#modal"), d = w.document;
    t(m.classList.contains("lado") && /aberta às \d\d:\d\d · origem: /.test(texto(w, "#ac-sub")) && !d.querySelector("#ac-conta").hidden, "Receber abre como painel na direita (subtítulo com hora e origem, botão Marcar na conta)");
    d.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await dorme(100);
    t(m.hidden, "Esc fecha o painel do Receber");
    await clica(w, '[data-a="receber"]');
    const f5 = new w.KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }); d.dispatchEvent(f5); await dorme(100);
    t(f5.defaultPrevented && d.querySelector('.ac-tile[data-f="refeicao"]').classList.contains("on"), "F5 escolhe Refeição (e não recarrega a página)");
    const imp = d.querySelector("#ac-imp"); imp.checked = true; imp.dispatchEvent(new w.Event("change", { bubbles: true })); await dorme(50);
    t(/^Receber · Imprimir R\$/.test(texto(w, "#ac-ok")), "marcando 'imprimir sempre', o botão vira Receber · Imprimir");
    imp.checked = false; imp.dispatchEvent(new w.Event("change", { bubbles: true })); await dorme(50);
    const f2 = new w.KeyboardEvent("keydown", { key: "F2", bubbles: true, cancelable: true }); d.dispatchEvent(f2); await dorme(100);
  }
  t(!w.document.querySelector("#ac-ok").disabled && w.document.querySelector('.ac-tile[data-f="pix"]').classList.contains("on"), "escolhida a forma (F2 = Pix), o botão Receber libera");
  await clica(w, "#ac-ok"); await dorme(400);
  t(!w.document.querySelector("#comp-bar").hidden && /Imprimir comprovante/.test(texto(w, "#comp-bar")), "depois de receber, pergunta se quer imprimir o comprovante");
  const hojeISO = new Date().toLocaleDateString("en-CA"), lista1 = await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, cx);
  t(lista1.find((p) => p.nome === "Beto").status === "pago" && lista1.find((p) => p.nome === "Beto").pagamentos[0].forma === "pix", "pedido do Beto recebido no pix pela tela");
  await clica(w, '[data-a="receber"]'); // agora é a comanda 36 (3 itens)
  t(w.document.querySelectorAll(".ac-li").length === 3, "comanda 36 lista os 3 itens");
  await clica(w, '[data-a="acDividir"]'); t(w.document.querySelectorAll(".ac-item").length === 3, "Dividir abre os 3 itens pra escolher um por um");
  await clica(w, '[data-a="acItem"]'); await clica(w, '[data-a="acSet"][data-f="dinheiro"]');
  const rec = w.document.querySelector("#ac-rec"); rec.value = "300"; rec.dispatchEvent(new w.Event("input", { bubbles: true })); await dorme(150);
  await clica(w, "#ac-ok"); await dorme(400);
  const c36 = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, cx)).find((p) => p.tipo === "balanca" && p.numero === 36);
  t(c36.status === "aguardando" && c36.pagamentos.length === 1 && c36.itens.filter((c) => c.pago).length === 2, "acerto parcial: 2 itens pagos em dinheiro, 1 continua em aberto");
  const sem = await abre("/caixa.html"); t(!sem.document.querySelector("#gate").hidden, "sem login o caixa mostra a tela de senha"); sem.close();
  { // motoboy (pente fino 23/11): o "tem que trazer em dinheiro" segue o que está RECEBIDO no caixa, não só o que o cliente escolheu no site
    const ent = (n, v, pag, gs, extra) => ({ id: "d" + n, tipo: "delivery", numero: n, entrega: "entrega", entregador: "Kevin", valor: v, pagPrevisto: pag, status: gs.length ? "pago" : "aguardando", itens: [{ iid: "i" + n, preco: v - 5, qtd: 1 }, { iid: "t" + n, tipo: "taxa", preco: 5, qtd: 1 }], pagamentos: gs, ...extra });
    const lista = [ent(1, 40, "dinheiro", [{ forma: "dinheiro", valor: 40 }]), ent(2, 50, "dinheiro", [{ forma: "dinheiro", valor: 50 }], { trocoPara: 100 }),
      ent(3, 30, "dinheiro", [{ forma: "pix", valor: 30 }]), ent(4, 25, "cartao_entrega", [{ forma: "debito", valor: 25 }], { cartaoTipo: "debito" }), ent(5, 20, "dinheiro", [])];
    const c = w.eval("contaBoy")(lista);
    t(c.din === 110 && c.troco === 50 && c.traz === 160 && c.pix === 30 && c.car === 25 && c.nCar === 1 && c.taxas === 25 && c.total === 165,
      "motoboy: traz 40 + 50 + 20 (ainda não recebido) + 50 de troco = 160; o que o cliente pagou no Pix não entra no dinheiro: " + JSON.stringify(c));
  }
  { // Fechamento: marmita/lançamento que foi direto pra conta (sem pedido "na conta") entra no "Marcado na conta" (23/11 mostrava 289 em vez de 589)
    const elza = (await api("GET", "/api/clientes", undefined, cx)).find((x) => x.nome === "Elza");
    await api("POST", "/api/lancamentos", { clienteId: elza.id, dia: hojeISO, valor: 61.5, obs: "1x marmita R$61,50 (WhatsApp)" }, cx);
    await clica(w, '[data-aba="fechamento"]'); await dorme(1500); await clica(w, '[data-aba="fechamento"]');
    t(/Marcado na conta[^]*?61,50/.test(texto(w, "#lista")) && /marmita\(s\)\/lançamento\(s\) R\$\s*61,50/.test(texto(w, "#lista")), "Fechamento: marmita lançada direto na conta entra no 'Marcado na conta'");
    await clica(w, '[data-aba="aberto"]');
  }
  w.close();

  console.log("\nBalança");
  const bw = await abre("/balanca.html", (win) => win.localStorage.setItem("tokenBalanca", bl));
  t(texto(bw, "#lista").includes("Comanda 36") && texto(bw, "#lista").includes("Suco Grande"), "lista mostra a comanda 36 com a bebida");
  for (const k of ["3", "6"]) await toca(bw, `[data-k="${k}"]`);
  await clica(bw, '[data-t="bebidas"]'); t(bw.document.querySelectorAll(".beb").length >= 20, "aba Bebidas mostra a lista (27)");
  await clica(bw, ".beb"); const apos = (await api("GET", "/api/pedidos?dia=" + new Date().toLocaleDateString("en-CA"), undefined, bl)).find((p) => p.tipo === "balanca");
  t(apos.itens.length === 4, "tocar na bebida lança na comanda digitada (4 itens)");
  await clica(bw, '[data-cat="Sorvetes"]'); t(bw.document.querySelectorAll(".beb.sorv").length >= 5 && bw.document.querySelectorAll(".beb:not(.sorv)").length === 0, "balança: filtro Sorvetes mostra só sorvetes");
  await clica(bw, ".beb.sorv"); const aposS = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.tipo === "balanca" && p.numero === 36);
  t(aposS.itens.length === 5 && aposS.itens[4].tipo === "doce" && /Sorvete/.test(aposS.itens[4].nome), "tocar no sorvete lança na comanda como sorvete (não como prato nem bebida)");
  await clica(bw, '[data-cat="Todas"]');
  await toca(bw, "#limpar"); await clica(bw, '[data-t="comandas"]');
  for (const k of ["4", "1"]) await toca(bw, `[data-k="${k}"]`);
  await clica(bw, "#reg"); for (const k of ["2", "5", "0", "0"]) await toca(bw, `[data-k="${k}"]`);
  bw.document.querySelector("#nome-cmd").value = "Joana"; await clica(bw, "#reg"); await dorme(400);
  const c41 = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.tipo === "balanca" && p.numero === 41);
  t(c41 && c41.nome === "Joana" && c41.valor === 25, "balança registra a comanda 41 (R$ 25,00) com o nome Joana");
  t(texto(bw, "#lista").includes("Joana"), "o nome aparece no cartão da comanda");
  // valor já veio da balança: digitou a comanda e o botão já é "Lançar" (sem passar pelo "Próximo: valor")
  bw.eval('cents = "1850"; tela();'); for (const k of ["4", "2"]) await toca(bw, `[data-k="${k}"]`);
  t(/Lançar R\$\s?18,50 na comanda 42/.test(texto(bw, "#reg")), "com valor da balança, o botão vira 'Lançar R$ 18,50 na comanda 42'");
  await clica(bw, "#reg"); await dorme(400);
  const c42 = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.tipo === "balanca" && p.numero === 42);
  t(c42 && c42.valor === 18.5, "um toque só lança R$ 18,50 na comanda 42");
  { // dona 23/11 (2ª vez): abriu o nome SEM valor, a balança do cabo pôs o valor enquanto digitava -> salvar o nome NÃO pode apagar o valor
    for (const k of ["4", "3"]) await toca(bw, `[data-k="${k}"]`);
    bw.eval('cents = ""; peso = ""; tela();'); await clica(bw, "#so-nome");
    bw.eval('cents = "2210"; tn.texto = "Carla";'); // valor chegou da balança com o teclado do nome aberto
    const bSalva = [...bw.document.querySelectorAll("#tn .tn-b")].find((b) => /Salvar o nome/.test(b.textContent)); bSalva.click(); await dorme(800);
    const c43 = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.tipo === "balanca" && p.numero === 43);
    t(c43 && c43.nome === "Carla" && c43.valor === 22.1, "valor que chegou com o teclado do nome aberto é lançado junto com o nome (não some)");
  }
  // no app Android o confirm() do navegador não aparece e responde "não" sozinho: o ✕ tem que usar a janela da própria página
  bw.confirm = () => false;
  const extra = (await api("POST", "/api/balanca", { comanda: 41, valor: 7, uid: "s-apagar" }, bl)); await bw.carregar(true); await dorme(300);
  const c41e = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.id === c41.id), iApagar = c41e.itens.length - 1;
  if (!bw.document.querySelector(`[data-rm^="${c41.id}|"]`) && bw.document.querySelector('[data-vcmd="41"]')) await clica(bw, '[data-vcmd="41"]');
  await clica(bw, `[data-rm="${c41.id}|${iApagar}"]`);
  const simBt = [...bw.document.querySelectorAll("button")].find((b) => b.textContent === "Sim");
  t(!!simBt && /Apagar este lançamento/.test(bw.document.body.textContent), "✕ abre a janela 'Apagar este lançamento?' da página (não o confirm do navegador)");
  if (simBt) { simBt.click(); await dorme(600); }
  const c41x = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.id === c41.id);
  t(!!extra && c41x.itens.length === iApagar && c41x.valor === 25, "tocar em Sim apaga só aquele lançamento (comanda 41 volta a R$ 25,00)");
  bw.close();
  const bs = await abre("/balanca.html"); t(!bs.document.querySelector("#modal").hidden && texto(bs, "#modal").includes("Entrar na balança"), "sem login a balança pede a senha"); bs.close();

  console.log("\nGarçom");
  const gw = await abre("/garcom.html", (win) => win.localStorage.setItem("tokenBalanca", bl)); await dorme(300);
  await clica(gw, '[data-cmd="41"]'); await clica(gw, '[data-cat="Sorvetes"]');
  const bSorv = [...gw.document.querySelectorAll(".beb")]; t(bSorv.length >= 5 && bSorv.every((b) => /Sorvete/.test(b.textContent)), "garçom: categoria Sorvetes na grade");
  await clica(gw, ".beb"); await dorme(400);
  const c41s = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.tipo === "balanca" && p.numero === 41);
  t(c41s.itens.some((c) => c.tipo === "doce" && /Sorvete/.test(c.nome)) && /Sorvete/.test(texto(gw, ".na-cmd")), "garçom lança sorvete na comanda e ele aparece em 'Na comanda'");
  gw.close();
  console.log("\nCaixa: bebida, sorvete e doce na hora de receber");
  const w2 = await abre("/caixa.html", (win) => win.sessionStorage.setItem("caixaToken", cx)); const idRec = w2.document.querySelector('[data-a="receber"]').dataset.id;
  await clica(w2, '[data-a="receber"]'); await clica(w2, '[data-a="dcAbrir"]');
  t(w2.document.querySelectorAll(".dc-cat").length === 4 && !!w2.document.querySelector(".dc-it.c-b") && !!w2.document.querySelector(".dc-it.c-s") && !!w2.document.querySelector(".dc-it.c-d"), "caixa: tela de extras tem bebidas, sorvetes e doces");
  await clica(w2, ".dc-it.c-b"); await clica(w2, ".dc-it.c-s"); await clica(w2, ".dc-it.c-s");
  t(w2.document.querySelectorAll(".dc-it.tem").length === 2 && texto(w2, "#dc-soma").includes("3 itens"), "tocar adiciona (com contador no cartão e soma embaixo)");
  await clica(w2, ".dc-it.c-s .dc-menos"); t(texto(w2, "#dc-soma").includes("2 itens"), "o − no cartão tira 1");
  await clica(w2, '[data-a="dcFechar"]'); await clica(w2, '[data-a="acSet"][data-f="pix"]'); await clica(w2, "#ac-ok"); await dorme(500);
  const c36b = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, cx)).find((p) => p.id === idRec);
  t(!!c36b && c36b.status === "pago" && c36b.itens.some((c) => c.tipo === "bebida" && c.pago && c.nome !== "Suco Grande") && c36b.itens.some((c) => c.tipo === "doce" && /Sorvete/.test(c.nome) && c.pago), "caixa lança bebida e sorvete na comanda e recebe tudo junto");
  w2.close();

  console.log("\nTotem");
  const tw = await abre("/"); t(!!tw.document.querySelector(".descanso"), "abre na tela de descanso");
  await clica(tw, ".descanso"); t(texto(tw, "#principal").includes("Qual é o seu nome"), "toque na tela vai pra tela do nome");
  tw.close();

  t(erros.length === 0, "nenhum erro de JavaScript nas telas" + (erros.length ? ": " + erros.slice(0, 3).join(" | ") : ""));
  console.log("\n" + (falhas ? "FALHARAM " + falhas : "TUDO CERTO") + " (" + ok + " ok)\n"); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error("Erro no teste:", e.message); srv.kill(); process.exit(1); });
