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
    w.fetch = (u, o) => nodeFetch(new URL(u, B).href, o); w.alert = (m) => erros.push(caminho + " alert: " + m); w.confirm = () => true; w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = () => {}; w.addEventListener("error", (e) => erros.push(caminho + ": " + e.message)); if (antes) antes(w);
  } });
  await new Promise((r) => (dom.window.document.readyState === "complete" ? r() : dom.window.addEventListener("load", r))); await dorme(900); return dom.window;
}
const clica = async (w, sel) => { const el = w.document.querySelector(sel); if (!el) throw new Error("não achei " + sel); el.click(); await dorme(500); };
const texto = (w, sel) => (w.document.querySelector(sel) || { textContent: "" }).textContent;

(async () => {
  await sobe();
  const admin = (await api("POST", "/api/login", { role: "admin", pin: "12345" })).token, cx = (await api("POST", "/api/login", { role: "caixa", pin: "2222" })).token, bl = (await api("POST", "/api/login", { role: "balanca", pin: "3333" })).token;
  await api("POST", "/api/balanca", { comanda: 36, valor: 85.36, uid: "s1" }, bl);
  await api("POST", "/api/balanca", { comanda: 36, valor: 12, nome: "Suco Grande", uid: "s2" }, bl);   // bebida: era o que quebrava a lista
  await api("POST", "/api/pedidos", { uid: "s3", nome: "Ana", comanda: 36, itens: [{ nome: "Marmitex de R$22,00", preco: 22, qtd: 1, grupos: [{ rotulo: "Arroz", itens: ["Branco"] }] }] });
  await api("POST", "/api/pedidos", { uid: "s4", nome: "Beto", itens: [{ nome: "Marmitex de R$24,00", preco: 24, qtd: 1, grupos: [{ rotulo: "Carne", itens: ["Bife"] }] }] });
  await api("POST", "/api/clientes", { nome: "Elza" }, cx);

  console.log("\nCaixa");
  const w = await abre("/caixa.html", (win) => win.sessionStorage.setItem("caixaToken", cx));
  t(texto(w, "#lista").includes("C36") && texto(w, "#lista").includes("Beto"), "'Em aberto' mostra a comanda com bebida e o pedido do totem");
  t(texto(w, "#n-aberto") === "2", "contador de abertos bate (2)");
  for (const [aba, esperado] of [["clientes", "Novo cliente"], ["aberto", "C36"], ["painel", "Vendas por hora"], ["gaveta", "Gaveta de dinheiro"], ["aberto", "C36"], ["fechamento", "Por forma de pagamento"], ["contas", "Mês"], ["conta", ""], ["pagos", ""], ["aberto", "C36"]]) {
    await clica(w, `[data-aba="${aba}"]`);
    t(texto(w, "#lista").includes(esperado) && texto(w, "#lista").trim().length > 0, `aba ${aba}: mostra o conteúdo certo (sem ficar com a aba anterior)`);
  }
  await clica(w, '[data-a="receber"]'); // 1º cartão = pedido do Beto (1 item)
  t(!w.document.querySelector("#modal").hidden && w.document.querySelectorAll(".ac-item").length === 1 && w.document.querySelector("#ac-ok").disabled, "janela de acerto lista o item e só libera depois de escolher a forma");
  await clica(w, '[data-a="acSet"][data-f="pix"]'); t(!w.document.querySelector("#ac-ok").disabled, "escolhida a forma, o botão Receber libera");
  await clica(w, "#ac-ok"); await dorme(400);
  const hojeISO = new Date().toLocaleDateString("en-CA"), lista1 = await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, cx);
  t(lista1.find((p) => p.nome === "Beto").status === "pago" && lista1.find((p) => p.nome === "Beto").pagamentos[0].forma === "pix", "pedido do Beto recebido no pix pela tela");
  await clica(w, '[data-a="receber"]'); // agora é a comanda 36 (3 itens)
  t(w.document.querySelectorAll(".ac-item").length === 3, "comanda 36 lista os 3 itens");
  await clica(w, '[data-a="acItem"]'); await clica(w, '[data-a="acSet"][data-f="dinheiro"]');
  const rec = w.document.querySelector("#ac-rec"); rec.value = "300"; rec.dispatchEvent(new w.Event("input", { bubbles: true })); await dorme(150);
  await clica(w, "#ac-ok"); await dorme(400);
  const c36 = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, cx)).find((p) => p.tipo === "balanca" && p.numero === 36);
  t(c36.status === "aguardando" && c36.pagamentos.length === 1 && c36.itens.filter((c) => c.pago).length === 2, "acerto parcial: 2 itens pagos em dinheiro, 1 continua em aberto");
  const sem = await abre("/caixa.html"); t(!sem.document.querySelector("#gate").hidden, "sem login o caixa mostra a tela de senha"); sem.close();
  w.close();

  console.log("\nBalança");
  const bw = await abre("/balanca.html", (win) => win.localStorage.setItem("tokenBalanca", bl));
  t(texto(bw, "#lista").includes("Comanda 36") && texto(bw, "#lista").includes("Suco Grande"), "lista mostra a comanda 36 com a bebida");
  for (const k of ["3", "6"]) await clica(bw, `[data-k="${k}"]`);
  await clica(bw, '[data-t="bebidas"]'); t(bw.document.querySelectorAll(".beb").length >= 20, "aba Bebidas mostra a lista (27)");
  await clica(bw, ".beb"); const apos = (await api("GET", "/api/pedidos?dia=" + new Date().toLocaleDateString("en-CA"), undefined, bl)).find((p) => p.tipo === "balanca");
  t(apos.itens.length === 4, "tocar na bebida lança na comanda digitada (4 itens)");
  await clica(bw, "#limpar"); await clica(bw, '[data-t="comandas"]');
  for (const k of ["4", "1"]) await clica(bw, `[data-k="${k}"]`);
  await clica(bw, "#reg"); for (const k of ["2", "5", "0", "0"]) await clica(bw, `[data-k="${k}"]`);
  bw.document.querySelector("#nome-cmd").value = "Joana"; await clica(bw, "#reg"); await dorme(400);
  const c41 = (await api("GET", "/api/pedidos?dia=" + hojeISO, undefined, bl)).find((p) => p.tipo === "balanca" && p.numero === 41);
  t(c41 && c41.nome === "Joana" && c41.valor === 25, "balança registra a comanda 41 (R$ 25,00) com o nome Joana");
  t(texto(bw, "#lista").includes("Joana"), "o nome aparece no cartão da comanda");
  bw.close();
  const bs = await abre("/balanca.html"); t(!bs.document.querySelector("#modal").hidden && texto(bs, "#modal").includes("Entrar na balança"), "sem login a balança pede a senha"); bs.close();

  console.log("\nTotem");
  const tw = await abre("/"); t(!!tw.document.querySelector(".descanso"), "abre na tela de descanso");
  await clica(tw, ".descanso"); t(texto(tw, "#principal").includes("Qual é o seu nome"), "toque na tela vai pra tela do nome");
  tw.close();

  t(erros.length === 0, "nenhum erro de JavaScript nas telas" + (erros.length ? ": " + erros.slice(0, 3).join(" | ") : ""));
  console.log("\n" + (falhas ? "FALHARAM " + falhas : "TUDO CERTO") + " (" + ok + " ok)\n"); srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error("Erro no teste:", e.message); srv.kill(); process.exit(1); });
