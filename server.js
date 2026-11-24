// Servidor do totem: guarda os pedidos e entrega pro caixa. Rodar: node server.js
const crypto = require("crypto"), net = require("net"), http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const PORTA = Number(process.env.PORTA) || 3000, PUB = __dirname, DIR_DADOS = process.env.DADOS_DIR ? path.resolve(process.env.DADOS_DIR) : path.join(__dirname, "dados"); // dados ficam numa pasta que o site NÃO entrega
fs.mkdirSync(DIR_DADOS, { recursive: true });
const ARQ = path.join(DIR_DADOS, "pedidos.json");
if (!process.env.DADOS_DIR) [["pedidos.json", ARQ], ["config.json", path.join(DIR_DADOS, "config.json")]].forEach(([velho, novo]) => { // só na instalação normal: com DADOS_DIR (testes) nunca mistura dados antigos // traz os arquivos antigos (a cópia original continua onde estava)
  const o = path.join(__dirname, velho); if (!fs.existsSync(novo) && fs.existsSync(o)) fs.copyFileSync(o, novo);
});
const cents = (n) => Math.round(Number(n) * 100) / 100;
const recalcComanda = (p) => { p.unidades = p.itens.length; p.valor = cents(p.itens.reduce((s, c) => s + c.preco * (c.qtd || 1), 0)); };
const valorItem = (c) => cents(c.preco * (c.qtd || 1));
// recebimentos válidos de um pedido (pedidos antigos, de um pagamento só, viram um recebimento)
const pagsDe = (p) => p.status === "cancelado" ? [] : (p.pagamentos && p.pagamentos.length ? p.pagamentos.filter((g) => !g.estornado) : (p.status === "pago" ? [{ forma: p.pagamento, valor: p.valor, dia: p.dia, quando: p.pagoEm || p.quando }] : []));
function fecharSePago(ped) { // quando todos os itens estão pagos, o pedido fecha
  if (ped.itens.length && ped.itens.every((c) => c.pago)) { ped.status = "pago"; ped.pagoEm = Date.now(); const f = [...new Set((ped.pagamentos || []).filter((g) => !g.estornado).map((g) => g.forma))]; ped.pagamento = f.length === 1 ? f[0] : "misto"; }
}
const FORMAS_VALIDAS = ["dinheiro", "pix", "credito", "debito", "refeicao", "cartao"]; // "cartao" fica só pra vendas antigas
function acertar(ped, sel, recebido, papel) { // sel = [{ iid, forma }]: cada item escolhido com a sua forma de pagamento
  if (ped.status !== "aguardando") return { s: 409, erro: "o pedido não está em aberto" };
  if (!Array.isArray(sel) || !sel.length || sel.length > 80) return { s: 400, erro: "escolha pelo menos um item" };
  const grupos = {}, vistos = new Set();
  for (const x of sel) {
    const c = ped.itens.find((i) => i.iid === (x && x.iid));
    if (!c || vistos.has(c.iid)) return { s: 400, erro: "item inválido" };
    if (c.pago) return { s: 409, erro: "um dos itens já foi pago" };
    if (!FORMAS_VALIDAS.includes(x.forma)) return { s: 400, erro: "forma de pagamento inválida" };
    vistos.add(c.iid); (grupos[x.forma] = grupos[x.forma] || []).push(c);
  }
  const agora = Date.now(), recs = [];
  for (const forma of Object.keys(grupos)) {
    const itens = grupos[forma], valor = cents(itens.reduce((s, c) => s + valorItem(c), 0)), r = { id: uid("g"), forma, itens: itens.map((c) => c.iid), valor, dia: hoje(), quando: agora, operador: papel };
    if (forma === "dinheiro") { const rec = cents(recebido); if (!(rec >= valor)) return { s: 400, erro: "o valor recebido é menor que o total em dinheiro" }; r.recebido = rec; r.troco = cents(rec - valor); }
    recs.push(r);
  }
  ped.pagamentos = ped.pagamentos || [];
  recs.forEach((r) => { ped.pagamentos.push(r); r.itens.forEach((iid) => { ped.itens.find((i) => i.iid === iid).pago = { forma: r.forma, pagId: r.id, quando: agora }; }); if (r.forma === "dinheiro") { ped.recebido = r.recebido; ped.troco = r.troco; } });
  fecharSePago(ped);
  return { ok: true };
}
// pagar o que está em aberto com 2 (até 4) formas POR VALOR (ex.: marmita R$24 = R$18 no dinheiro + R$6 no Pix).
// Cada parte vira um recebimento com o seu valor (o fechamento soma certo em cada forma); as partes ficam ligadas
// por "dividido" e o estorno de uma desfaz todas.
// conta = { cli, valor }: uma parte vai pra CONTA de um cliente (dona 24/11: "paga R$14 e marca R$10 na conta da Gilmara", em qualquer pedido).
// As outras partes são recebidas; o pedido fica "na conta" com o resto (valConta = valor - recebido) e um lançamento desse valor.
function acertarValores(ped, partes, recebido, papel, conta) {
  if (ped.status !== "aguardando") return { s: 409, erro: "o pedido não está em aberto" };
  const abertos = ped.itens.filter((c) => !c.pago), total = cents(abertos.reduce((s, c) => s + valorItem(c), 0));
  if (!abertos.length) return { s: 400, erro: "nada em aberto" };
  if (!Array.isArray(partes) || partes.length < (conta ? 1 : 2) || partes.length > 4) return { s: 400, erro: "informe de 2 a 4 formas" };
  const ps = partes.map((x) => ({ forma: String(x && x.forma), valor: cents(Number(x && x.valor)) }));
  if (ps.some((x) => !FORMAS_VALIDAS.includes(x.forma) || !(x.valor > 0)) || new Set(ps.map((x) => x.forma)).size !== ps.length) return { s: 400, erro: "formas ou valores inválidos" };
  if (conta && !(conta.valor > 0)) return { s: 400, erro: "valor da conta inválido" };
  if (Math.abs(cents(ps.reduce((s, x) => s + x.valor, 0) + (conta ? conta.valor : 0)) - total) > 0.009) return { s: 400, erro: "a soma das partes tem que dar " + total.toFixed(2).replace(".", ",") };
  const agora = Date.now(), grupo = uid("d"), recs = ps.map((x) => ({ id: uid("g"), forma: x.forma, itens: abertos.map((c) => c.iid), valor: x.valor, dia: hoje(), quando: agora, operador: papel, dividido: grupo }));
  const din = recs.find((r) => r.forma === "dinheiro");
  if (din) { const rec = recebido === undefined || recebido === null || recebido === "" ? din.valor : cents(recebido); if (!(rec >= din.valor)) return { s: 400, erro: "o valor recebido é menor que a parte em dinheiro" }; din.recebido = rec; din.troco = cents(rec - din.valor); ped.recebido = rec; ped.troco = din.troco; }
  ped.pagamentos = ped.pagamentos || []; recs.forEach((r) => ped.pagamentos.push(r));
  abertos.forEach((c) => { c.pago = { forma: "dividido", pagId: recs[0].id, dividido: grupo, quando: agora }; });
  if (conta) { // o resto vai pra conta do cliente: pedido "na conta" (só o resto é cobrado depois)
    const jaPago = cents(ps.reduce((s, x) => s + x.valor, 0));
    ped.status = "conta"; ped.clienteId = conta.cli.id; ped.clienteIds = [conta.cli.id]; ped.pagamento = "conta"; ped.contaParcial = grupo;
    db.lancamentos = db.lancamentos.filter((l) => l.pedidoId !== ped.id);
    db.lancamentos.push({ id: uid("l"), clienteId: conta.cli.id, dia: ped.dia, qtd: 0, valor: cents(conta.valor), obs: (rotuloPed(ped) + " (resto - já pago R$" + jaPago.toFixed(2).replace(".", ",") + ")").slice(0, 120), pedidoId: ped.id });
    return { ok: true };
  }
  fecharSePago(ped);
  return { ok: true };
}
const rotuloPed = (ped) => (ped.tipo === "delivery" ? "Delivery D" + ped.numero : ped.tipo !== "balanca" ? "Pedido #" + ped.numero : ped.numero > 10000 ? "Marmitex M" + (ped.numero - 10000) : "Comanda " + ped.numero);
// desfez a conta de um pedido pago em parte + resto na conta: estorna as partes recebidas juntas (o pedido volta inteiro pro "em aberto")
function desfazContaParcial(ped) {
  const g = ped.contaParcial; if (!g) return; delete ped.contaParcial;
  (ped.pagamentos || []).forEach((x) => { if (x.dividido === g && !x.estornado) x.estornado = { motivo: "desfez a conta (pago em parte + resto na conta)", quando: Date.now() }; });
  ped.itens.forEach((c) => { if (c.pago && c.pago.dividido === g) delete c.pago; });
}
const TRANS = { aguardando: ["pago", "conta", "cancelado"], conta: ["aguardando", "cancelado"], pago: ["cancelado"], cancelado: [] }; // mudanças de estado permitidas
// lê os dados. Se o pedidos.json estiver estragado (luz caiu no meio da gravação, disco...), usa o .tmp ou o backup mais novo.
// NUNCA liga vazio por engano: antes, um arquivo estragado fazia o servidor subir sem nada e a próxima gravação apagava tudo.
function lerDados() {
  if (!fs.existsSync(ARQ)) return { pedidos: [] }; // instalação nova
  const dirB = path.join(DIR_DADOS, "backups"), bks = fs.existsSync(dirB) ? fs.readdirSync(dirB).filter((a) => /^pedidos-.*\.json$/.test(a)).sort().reverse().map((a) => path.join(dirB, a)) : [];
  for (const f of [ARQ, ARQ + ".tmp", ...bks]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!d || !Array.isArray(d.pedidos)) continue;
      if (f !== ARQ) { console.error("ATENÇÃO: pedidos.json estava estragado. Usei " + path.basename(f) + " (o estragado ficou guardado como pedidos.json.estragado-*)."); try { fs.copyFileSync(ARQ, ARQ + ".estragado-" + Date.now()); } catch (e) {} }
      return d;
    } catch (e) {}
  }
  console.error("ERRO GRAVE: não consegui ler o pedidos.json nem nenhum backup. O servidor NÃO liga, pra não apagar nada. Chame o suporte.");
  process.exit(1);
}
let db = lerDados();
db.pedidos = db.pedidos || []; db.caixa = db.caixa || {};
db.clientes = db.clientes || []; db.lancamentos = db.lancamentos || []; db.pagamentos = db.pagamentos || []; db.enviados = db.enviados || {};
db.entregadores = Array.isArray(db.entregadores) ? db.entregadores : []; // motoboys (nomes)
// cartão na entrega dos pedidos do site entrava como "Cartão" genérico: passa pra crédito/débito/refeição (o tipo que o cliente escolheu)
db.pedidos.forEach((p) => {
  if (p.tipo !== "delivery" || p.pagPrevisto !== "cartao_entrega" || !["credito", "debito", "refeicao"].includes(p.cartaoTipo)) return;
  let mudou = false; (p.pagamentos || []).forEach((g) => { if (g.forma === "cartao" && g.auto === "site") { g.forma = p.cartaoTipo; mudou = true; } });
  if (mudou) { p.itens.forEach((c) => { if (c.pago && c.pago.forma === "cartao") c.pago.forma = p.cartaoTipo; }); if (p.pagamento === "cartao") p.pagamento = p.cartaoTipo; }
});
// limpeza pontual: se existir dados/apagar-pedidos.json (lista de uid/id), apaga SÓ esses pedidos ao ligar,
// guarda uma cópia de tudo antes (dados/antes-de-apagar-*.json) e renomeia a lista pra não repetir
try {
  const ARQ_AP = path.join(DIR_DADOS, "apagar-pedidos.json"), alvo = new Set(JSON.parse(fs.readFileSync(ARQ_AP, "utf8")).map(String));
  const sai = (p) => alvo.has(String(p.uid)) || alvo.has(String(p.id)), n = db.pedidos.filter(sai).length;
  if (n) {
    fs.writeFileSync(path.join(DIR_DADOS, "antes-de-apagar-" + Date.now() + ".json"), JSON.stringify(db));
    db.pedidos = db.pedidos.filter((p) => !sai(p));
    fs.writeFileSync(ARQ + ".tmp", JSON.stringify(db)); fs.renameSync(ARQ + ".tmp", ARQ);
  }
  fs.renameSync(ARQ_AP, ARQ_AP + ".feito-" + Date.now());
  console.log(`apagar-pedidos.json: ${n} pedido(s) apagado(s)`);
} catch (e) { if (e.code !== "ENOENT") console.error("apagar-pedidos.json: " + e.message); }
db.pedidos.forEach((p) => (p.itens || []).forEach((c) => { c.grupos = c.grupos || []; })); // dados antigos: todo item tem "grupos"
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
db.pedidos.forEach((p) => (p.itens || []).forEach((c) => { c.iid = c.iid || uid("i"); })); // dados antigos: todo item tem identificador
// "conta" = a empresa (quando o cliente tem empresa, ela paga por todos) ou o próprio cliente
const chaveDe = (id) => { const c = db.clientes.find((x) => x.id === id); return c && c.empresa ? "e:" + c.empresa : "c:" + id; };
db.pagamentos.forEach((x) => { if (!x.chave && x.clienteId) x.chave = chaveDe(x.clienteId); });
Object.keys(db.enviados).forEach((k) => { const [m, id] = [k.slice(0, 7), k.slice(8)]; if (!/^[ce]:/.test(id)) { delete db.enviados[k]; db.enviados[m + "|" + chaveDe(id)] = true; } });
const fiscal = require("./fiscal")({ DIR_DADOS }); // cupom fiscal (NFC-e) direto na SEFAZ-SP
const ARQ_CFG = path.join(DIR_DADOS, "config.json");           // cópia das configurações do totem (cardápio, produtos, cores...)
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(ARQ_CFG, "utf8")); } catch (e) {}
if (cfg.dados) delete cfg.dados.pin; // a senha nunca fica na cópia das configurações
// gravação segura: uma fila por arquivo, escreve num arquivo temporário e troca no fim; só responde "ok" depois de gravar
const filas = {};
function gravarArquivo(arq, obj) {
  const f = (filas[arq] = filas[arq] || { esperando: [], rodando: false, dados: "" });
  f.dados = JSON.stringify(obj);
  return new Promise((ok, falha) => { f.esperando.push({ ok, falha }); if (!f.rodando) rodar(arq, f); });
}
function rodar(arq, f) {
  f.rodando = true; const lote = f.esperando.splice(0), tmp = arq + ".tmp";
  const fim = (err) => { if (err) console.error("ERRO ao gravar " + path.basename(arq) + ":", err.message); lote.forEach((x) => (err ? x.falha(err) : x.ok())); f.rodando = false; if (f.esperando.length) rodar(arq, f); };
  fs.writeFile(tmp, f.dados, (e) => (e ? fim(e) : fs.rename(tmp, arq, fim)));
}
// versão dos dados: muda a cada gravação. A balança manda a versão que já tem e, se nada mudou, não baixa tudo de novo
const VERSAO_INICIO = Date.now().toString(36); let versaoN = 0;
const versaoDb = () => VERSAO_INICIO + "-" + versaoN;
const gravar = () => { versaoN++; return gravarArquivo(ARQ, db); };
// pedidos do dia no formato enxuto da balança: comandas abertas completas; fechadas só com o resumo (o dia inteiro pesava ~250 KB a cada 4 s e o tablet travava no almoço)
function pedidosBalanca(dia) {
  const out = [];
  for (const x of db.pedidos) {
    if (x.dia !== dia) continue;
    if (x.tipo === "balanca") {
      if (x.status === "aguardando") out.push(x);
      else if (x.status === "pago" || x.status === "conta") out.push({ id: x.id, tipo: x.tipo, dia: x.dia, numero: x.numero, nome: x.nome, quando: x.quando, valor: x.valor, status: x.status, itens: (x.itens || []).map((c) => ({ tipo: c.tipo, origem: c.origem, peso: c.peso })) });
    } else if (x.status === "aguardando") out.push(x); // pedidos do totem esperando no caixa (pra pôr numa comanda)
    else if (x.movido) out.push({ id: x.id, tipo: x.tipo, numero: x.numero, status: x.status, movido: x.movido, itens: [] }); // pra saber se o lançamento veio de um pedido do totem
  }
  return out;
}
// ---------- senhas e sessões (3 níveis: balança < caixa < admin) ----------
const ARQ_IMPCX = path.join(DIR_DADOS, "impressora-caixa.json"); // impressora do caixa (separada da do totem)
let impCaixa = {}; try { impCaixa = JSON.parse(fs.readFileSync(ARQ_IMPCX, "utf8")) || {}; } catch (e) {}
const IP_PRIVADO = /^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/;
const ARQ_SEG = path.join(DIR_DADOS, "seguranca.json"), ARQ_SES = path.join(DIR_DADOS, "sessoes.json");
let seg = { pins: {}, padrao: {} }, sessoes = {}; const tentativas = {}, impressoes = {};
try { seg = JSON.parse(fs.readFileSync(ARQ_SEG, "utf8")); } catch (e) {}
try { sessoes = JSON.parse(fs.readFileSync(ARQ_SES, "utf8")); } catch (e) {}
seg.pins = seg.pins || {}; seg.padrao = seg.padrao || {};
const SESSAO_MS = Number(process.env.SESSAO_MS) || 30 * 864e5;
const NIVEL = { balanca: 1, caixa: 2, admin: 3 }, PADRAO = { admin: "12345", caixa: "2222", balanca: "3333" };
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const mkPin = (pin) => { const salt = crypto.randomBytes(8).toString("hex"); return { salt, h: crypto.scryptSync(String(pin), salt, 32).toString("hex") }; };
const confere = (pin, reg) => { if (!reg) return false; const a = Buffer.from(crypto.scryptSync(String(pin), reg.salt, 32).toString("hex")), b = Buffer.from(reg.h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
let primeira = false; Object.keys(NIVEL).forEach((r) => { if (!seg.pins[r]) { seg.pins[r] = mkPin(PADRAO[r]); seg.padrao[r] = true; primeira = true; } });
if (primeira) fs.writeFileSync(ARQ_SEG, JSON.stringify(seg));
const tokenDe = (req) => { const m = (req.headers.authorization || "").match(/^Bearer ([a-f0-9]{48})$/); return m ? m[1] : null; };
const papelDe = (req) => { const t = tokenDe(req), s = t && sessoes[sha(t)]; return s && s.exp > Date.now() ? s.role : null; };
function nivelRota(m, p) { // quem pode o quê (0 = qualquer um)
  if (!p.startsWith("/api/") || p === "/api/login" || p === "/api/saude") return 0;
  if ((p === "/api/pedidos" && m === "POST") || (p === "/api/imprimir" && m === "POST") || (p === "/api/config" && m === "GET")) return 0; // totem do cliente
  if (p === "/api/config" || p === "/api/senhas" || p === "/api/fiscal/certificado" || p === "/api/fiscal/ambiente") return 3; // certificado e produção x teste: só o admin
  if (p === "/api/balanca" || (p === "/api/pedidos" && m === "GET") || (/^\/api\/pedidos\//.test(p) && m === "PATCH")) return 1;
  return 2; // caixa: clientes, contas, pagamentos, gaveta, backup...
}
function gavetaDia(dia) { // gaveta de dinheiro: quanto deve ter fisicamente
  const g = db.caixa[dia] || {}, mov = g.movimentos || [], soma = (a) => cents(a.reduce((s, x) => s + x, 0));
  const vendas = soma(db.pedidos.flatMap(pagsDe).filter((g) => g.forma === "dinheiro" && g.dia === dia).map((g) => g.valor)); // só o dinheiro de cada recebimento
  const contas = soma(db.pagamentos.filter((x) => x.data === dia && x.forma === "dinheiro").map((x) => x.valor));
  const sup = soma(mov.filter((m) => m.tipo === "suprimento").map((m) => m.valor)), san = soma(mov.filter((m) => m.tipo === "sangria").map((m) => m.valor));
  return { dia, abertura: g.abertura || null, movimentos: mov, fechamento: g.fechamento || null, vendasDinheiro: vendas, contasDinheiro: contas, suprimentos: sup, sangrias: san, esperado: g.abertura ? cents(g.abertura.valor + vendas + contas + sup - san) : null };
}
function backup() { // uma cópia por dia (guarda as últimas 30)
  try {
    const dir = path.join(DIR_DADOS, "backups"), dia = hoje(); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "pedidos-" + dia + ".json"), JSON.stringify(db)); fs.writeFileSync(path.join(dir, "config-" + dia + ".json"), JSON.stringify(cfg));
    if (process.env.BACKUP_EXTRA) { // cópia extra (pendrive, pasta do Drive/OneDrive...)
      // notas fiscais (XML autorizados e cancelamentos): têm que ser guardadas 5 anos -> cópia no OneDrive também (só copia o que ainda não está lá)
      try { const de = path.join(DIR_DADOS, "nfce"), para = path.join(process.env.BACKUP_EXTRA, "notas-fiscais"); const copia = (a, b) => { if (!fs.existsSync(a)) return; for (const f of fs.readdirSync(a, { withFileTypes: true })) { const x = path.join(a, f.name), y = path.join(b, f.name); if (f.isDirectory()) copia(x, y); else if (!fs.existsSync(y) || /avulsos\.json$/.test(f.name)) { fs.mkdirSync(b, { recursive: true }); fs.copyFileSync(x, y); } } }; copia(de, para); }
      catch (e) { console.error("cópia das notas fiscais falhou:", e.message); }
      try { const ex = process.env.BACKUP_EXTRA; fs.mkdirSync(ex, { recursive: true }); ["pedidos-", "config-"].forEach((pre) => { fs.copyFileSync(path.join(dir, pre + dia + ".json"), path.join(ex, pre + dia + ".json")); fs.readdirSync(ex).filter((a) => a.startsWith(pre) && a.endsWith(".json")).sort().slice(0, -30).forEach((a) => fs.unlinkSync(path.join(ex, a))); }); } // na nuvem também só os últimos 30 dias (não lota o OneDrive)
      catch (e) { console.error("cópia extra do backup falhou:", e.message); }
    }
    ["pedidos-", "config-"].forEach((pre) => fs.readdirSync(dir).filter((a) => a.startsWith(pre)).sort().slice(0, -30).forEach((a) => fs.unlinkSync(path.join(dir, a))));
  } catch (e) { console.error("backup falhou:", e.message); }
}
const hoje = () => new Date().toLocaleDateString("en-CA");
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png",
  ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2" };
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
const corpo = (req, max = 1e6) => new Promise((ok, falha) => {
  let b = "", n = 0;
  req.on("data", (c) => { n += c.length; if (n > max) { falha(Object.assign(new Error("corpo grande demais"), { status: 413 })); req.destroy(); } else b += c; });
  req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { falha(Object.assign(new Error("JSON inválido"), { status: 400 })); } });
  req.on("error", falha);
});
const erro400 = (m) => Object.assign(new Error(m), { status: 400 });
function limparPedido(b) { // o servidor não confia no total: confere os itens e recalcula o valor
  if (!Array.isArray(b.itens) || !b.itens.length || b.itens.length > 60) throw erro400("pedido sem itens");
  const itens = b.itens.map((c) => {
    const qtd = Number(c.qtd), preco = Number(c.preco);
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 99 || !Number.isFinite(preco) || preco < 0 || preco > 1000) throw erro400("item inválido");
    return { iid: uid("i"), key: String(c.key || "").slice(0, 400), tipo: c.tipo === "bebida" || c.tipo === "doce" ? c.tipo : undefined, nome: String(c.nome || "").slice(0, 80), preco: cents(preco), qtd, obs: String(c.obs || "").slice(0, 120),
      grupos: (Array.isArray(c.grupos) ? c.grupos : []).slice(0, 15).map((g) => ({ rotulo: String(g.rotulo || "").slice(0, 40), itens: (Array.isArray(g.itens) ? g.itens : []).slice(0, 20).map((x) => String(x).slice(0, 80)) })) };
  });
  const valor = cents(itens.reduce((s, c) => s + c.preco * c.qtd, 0)); if (valor > 5000) throw erro400("valor muito alto");
  return { itens, valor, unidades: itens.reduce((s, c) => s + c.qtd, 0), nome: String(b.nome || "").slice(0, 40), dia: /^\d{4}-\d\d-\d\d$/.test(b.dia || "") ? b.dia : hoje(), quando: Number(b.quando) || Date.now() };
}
backup(); setInterval(backup, 6 * 3600 * 1000);

// ---------- pedidos do site de delivery: o servidor busca no site e põe no caixa ----------
// Configuração em dados/delivery.json (fica fora do git):  { "url": "https://seu-site.vercel.app", "token": "o mesmo CAIXA_TOKEN/PRINT_TOKEN da Vercel" }
const ARQ_DEL = path.join(DIR_DADOS, "delivery.json");
let delCfg = {}; try { delCfg = JSON.parse(fs.readFileSync(ARQ_DEL, "utf8")) || {}; } catch (e) {}
const DEL_URL = String(process.env.DELIVERY_URL || delCfg.url || "").trim().replace(/\/+$/, ""), DEL_TOKEN = String(process.env.DELIVERY_TOKEN || delCfg.token || "").trim();
const delEstado = { ativo: !!(DEL_URL && DEL_TOKEN), ultimo: null, erro: null, importados: 0 };
const TOKEN_SITE = /^[0-9a-f-]{36}$/;
async function delApi(acao, extra = {}) {
  const r = await fetch(DEL_URL + "/api/caixa", { method: "POST", headers: { "Content-Type": "application/json", "x-caixa-token": DEL_TOKEN }, body: JSON.stringify({ acao, ...extra }), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "o site respondeu " + r.status);
  return j;
}
function pedidoDoSite(s) { // converte o pedido do site pro formato do caixa (o site já recalculou preços e total no banco dele)
  const t = (v, n) => String(v || "").trim().slice(0, n), e = s.endereco && typeof s.endereco === "object" ? s.endereco : null;
  const itens = (Array.isArray(s.itens) ? s.itens : []).slice(0, 60).map((c) => ({ iid: uid("i"), key: t(c.key, 400), tipo: c.tipo === "bebida" ? "bebida" : undefined, nome: t(c.nome, 80),
    preco: cents(Math.max(0, Number(c.preco) || 0)), qtd: Math.max(1, Math.min(99, parseInt(c.qtd, 10) || 1)), obs: t(c.obs, 120),
    grupos: (Array.isArray(c.grupos) ? c.grupos : []).slice(0, 15).map((g) => ({ rotulo: t(g && g.rotulo, 40), itens: (Array.isArray(g && g.itens) ? g.itens : []).slice(0, 20).map((x) => t(x, 80)), ...(g && g.adicional === true ? { adicional: true } : {}) })) }));
  const taxa = cents(Math.max(0, Number(s.taxa_entrega) || 0));
  if (taxa > 0) itens.push({ iid: uid("i"), tipo: "taxa", nome: "Taxa de entrega", preco: taxa, qtd: 1, obs: "", grupos: [] }); // vira item: dá pra receber por item como o resto
  const quando = Date.parse(s.criado_em) || Date.now(), numero = Number(s.numero) || 0;
  const p = { id: quando + "-d" + numero, uid: "site:" + s.token, siteToken: s.token, tipo: "delivery", numero, dia: /^\d{4}-\d\d-\d\d$/.test(s.dia || "") ? s.dia : hoje(), quando,
    nome: t(s.nome, 40), telefone: t(s.telefone, 15), entrega: s.tipo_entrega === "entrega" ? "entrega" : "retirada",
    endereco: e ? { rua: t(e.rua, 80), numero: t(e.numero, 10), bairro: t(e.bairro, 50), complemento: t(e.complemento, 60) } : null,
    pagPrevisto: t(s.forma_pagamento, 20), cartaoTipo: ["credito", "debito", "refeicao"].includes(s.cartao_tipo) ? s.cartao_tipo : undefined, trocoPara: Number(s.troco_para) > 0 ? cents(Number(s.troco_para)) : null, obsPedido: t(s.obs, 200),
    itens, status: "aguardando", pagamento: null };
  p.valor = cents(itens.reduce((x, c) => x + c.preco * c.qtd, 0)); p.unidades = itens.reduce((x, c) => x + c.qtd, 0);
  if (Math.abs(p.valor - (Number(s.total) || 0)) > 0.01) console.error(`delivery: D${numero} somou ${p.valor} mas o site diz ${s.total}`);
  return p;
}
// cliente da conta pra um pedido de marmita: pelo telefone; senão pelo nome sem "marmita/mta" ("Polyana - MARMITA" = "POLYANA MARMITA")
const semAcS = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nomeBase = (s) => semAcS(s).replace(/[^a-z ]/g, " ").split(/\s+/).filter((w) => w && !/^(marmitas?|marmit|mta)$/.test(w)).join(" ");
// um cliente pode ter VÁRIOS telefones no cadastro, separados por / , ; ou " e " (dona 23/11: pedia de 2 números e caía em 2 contas)
const telsCli = (t) => String(t || "").split(/[\/,;]|\se\s/).map((x) => x.replace(/\D/g, "").slice(-8)).filter((x) => x.length === 8);
const brl2 = (v) => "R$" + Number(v || 0).toFixed(2).replace(".", ",");
function clienteDoPedido(p) {
  const ativos = db.clientes.filter((c) => c.ativo !== false), fim = (t) => String(t || "").replace(/\D/g, "").slice(-8), tel = fim(p.telefone);
  if (tel.length === 8) { const c = ativos.find((x) => telsCli(x.telefone).includes(tel)); if (c) return c; }
  const nb = nomeBase(p.nome); if (!nb) return null;
  let l = ativos.filter((c) => nomeBase(c.nome) === nb); if (l.length === 1) return l[0];
  const pri = nb.split(" ")[0]; l = ativos.filter((c) => /marmit|mta/.test(semAcS(c.nome)) && nomeBase(c.nome).split(" ")[0] === pri); // só o 1º nome, entre os clientes de marmita
  return l.length === 1 ? l[0] : null;
}
function contaDoPedido(p) { // cliente com conta pra um pedido "na conta": telefone; senão o nome do cliente (ou da empresa) dentro do nome do pedido. Tem que dar 1 só.
  const ativos = db.clientes.filter((c) => c.ativo !== false), fim = (t) => String(t || "").replace(/\D/g, "").slice(-8), tel = fim(p.telefone);
  if (tel.length === 8) { const l = ativos.filter((x) => telsCli(x.telefone).includes(tel)); if (l.length === 1) return l[0]; }
  const np = " " + nomeBase(p.nome) + " ", tem = (s) => { const b = nomeBase(s); return b.length >= 3 && np.includes(" " + b + " "); };
  // pelo nome: só nome com 2 palavras ou mais ("JOSE ROBERTO"), ou cliente de empresa. Nome de 1 palavra ("MARIA") casaria com outra Maria qualquer.
  let l = ativos.filter((c) => tem(c.nome) && (nomeBase(c.nome).includes(" ") || c.empresa)); if (l.length === 1) return l[0];
  if (!l.length) { l = ativos.filter((c) => c.empresa && tem(c.empresa)); if (l.length && l.every((c) => c.empresa === l[0].empresa)) return l.find((c) => nomeBase(c.nome) === nomeBase(c.empresa)) || l[0]; }
  return null;
}
// pedido do site chega no caixa JÁ RECEBIDO, na forma que o cliente escolheu (Pix, dinheiro com troco, cartão na entrega)
const FORMA_DO_SITE = { pix: "pix", dinheiro: "dinheiro", cartao_entrega: "cartao" };
function pagarDoSite(p) {
  // cliente de marmita (pedido pelo robô, "conta"): não cobra nada aqui. Sem nada a receber, já fecha; se pediu algo pago (ex.: bebida), fica em aberto pro caixa
  if (p.pagPrevisto === "conta") {
    // marmita: lança sozinho na conta do cliente (valor da marmita dele) e fecha. Não achou a conta, ou é "valor livre": fica em aberto pro caixa lançar.
    const marm = p.itens.filter((c) => /^marmita$/i.test(c.nome)), cli = marm.length ? clienteDoPedido(p) : null;
    // pedido normal "na conta" ("marca na conta", "fiado", "pra marcar"): acha a conta e já marca (o caixa não precisa fazer nada).
    // Pelo telefone cadastrado; se pediu de outro celular, pelo nome que deu no pedido ("DER - Ronaldo" -> DER). Na dúvida (0 ou 2+), fica em aberto pro caixa.
    if (!marm.length && p.valor > 0) {
      const c2 = contaDoPedido(p), abertos = p.itens.filter((c) => !c.pago);
      if (c2 && p.valor > 0 && abertos.length) {
        p.status = "conta"; p.clienteId = c2.id; p.clienteIds = [c2.id]; p.pagamento = "conta"; p.contaAuto = true;
        db.lancamentos.push({ id: uid("l"), clienteId: c2.id, dia: p.dia, qtd: 0, valor: cents(abertos.reduce((t, c) => t + valorItem(c), 0)), obs: "Delivery D" + p.numero + " (WhatsApp)", pedidoId: p.id, itensIds: abertos.map((c) => c.iid) });
      }
      return;
    }
    if (cli) {
      const n = marm.reduce((s, c) => s + c.qtd, 0), valor = cents((Number(cli.valorRefeicao) || 0) * n);
      if (!cli.telefone && p.telefone) cli.telefone = p.telefone; // da próxima vez acha direto pelo telefone
      if (valor > 0) { db.lancamentos.push({ id: uid("l"), clienteId: cli.id, dia: p.dia, qtd: 0, valor, obs: `${n}x marmita ${brl2(cli.valorRefeicao)} (WhatsApp) - pedido ${p.entrega === "retirada" ? "R" : "E"}${p.numero}`.slice(0, 120), pedidoId: p.id }); p.contaCliente = cli.id; }
    }
    if (p.valor === 0 && (!marm.length || p.contaCliente)) { p.status = "pago"; p.pagamento = "marmita"; p.pagoEm = Date.now(); p.pagoAuto = true; }
    return;
  }
  const forma = p.pagPrevisto === "cartao_entrega" && ["credito", "debito", "refeicao"].includes(p.cartaoTipo) ? p.cartaoTipo : FORMA_DO_SITE[p.pagPrevisto]; // cartão na entrega: crédito/débito/refeição (o que o cliente escolheu); sem tipo: "Cartão"
  if (!forma || !p.itens.length) return; // forma desconhecida: fica em aberto pro caixa
  const r = acertar(p, p.itens.map((c) => ({ iid: c.iid, forma })), forma === "dinheiro" ? Math.max(p.valor, p.trocoPara || 0) : 0, "site");
  if (r.ok) { p.pagoAuto = true; p.pagamentos.forEach((g) => (g.auto = "site")); } else console.error("delivery: não consegui lançar o pagamento de D" + p.numero + ": " + r.erro);
}
// fila do robô de WhatsApp (pasta WHATS-BOT): o servidor só anota a mensagem; quem manda é o robô. Se o robô estiver parado, nada trava.
const ARQ_WHATS = path.join(DIR_DADOS, "whats-fila.json");
let filaWhats = []; try { filaWhats = JSON.parse(fs.readFileSync(ARQ_WHATS, "utf8")) || []; } catch (e) {}
const rs = (n) => "R$ " + Number(n || 0).toFixed(2).replace(".", ",");
// mensagem de confirmação no WhatsApp (o pedido do site só chega aqui depois de aceito, por isso "já está em produção")
function textoWhats(p, loja = {}, agora = Date.now()) {
  const e = p.endereco || {}, ent = p.entrega !== "retirada", S = (v) => String(v || "").trim();
  const PG = { conta: "📒 Na sua conta", pix: "💠 Pix", dinheiro: "💵 Dinheiro", cartao_entrega: "💳 Cartão na entrega" };
  const min = Number(ent ? loja.tempo_entrega_min ?? loja.tempo_estimado_min : loja.tempo_retirada_min ?? loja.tempo_estimado_min) || (ent ? 45 : 20);
  const hm = (ms) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  const de = agora + Math.max(5, min - 15) * 60e3, ate = agora + (min + 15) * 60e3; // janela de 30 min em volta do tempo do site
  const cidade = S(loja.cidade_entrega).replace(/\s*[,-]\s*[A-Z]{2}$/, ""); // "Cachoeira Paulista, SP" -> "Cachoeira Paulista"
  const taxa = p.itens.filter((c) => c.tipo === "taxa").reduce((x, c) => x + c.preco * c.qtd, 0);
  const SEP = "-".repeat(30); // tracinhos separando as partes da mensagem
  // começo e fim da mensagem: editáveis no painel do site (Configurações > Mensagens do WhatsApp); vazio = o texto de sempre
  const topo = String(loja.msg_confirma_topo || "").trim() || "Da Lúcia por aqui! 😄🍽️\nSeu pedido já está em produção — feito com muito carinho e sabor! 👩‍🍳🔥";
  const fimTxt = String(loja.msg_confirma_fim || "").trim() || "Obrigado pela preferência, se precisar de algo é só chamar! 😉";
  const L = [...topo.split(/\r?\n/), "", `*Pedido nº ${p.numero}*`, SEP, "*DETALHES DO PEDIDO*"];
  const M = (v) => S(v).toLocaleUpperCase("pt-BR");
  p.itens.filter((c) => c.tipo !== "taxa").forEach((c, i) => { // um bloco por produto: nome, quantidade, valor e cada etapa com o que foi escolhido
    L.push(i ? SEP : "", `Produto: ${M(c.nome)}`, `Quantidade: ${c.qtd}`); if (c.preco > 0) L.push(`Valor: ${rs(c.preco * c.qtd)}`);
    for (const g of c.grupos || []) {
      const rot = M(g.rotulo); L.push(`  ${rot}${g.adicional && !/ADICIONAL/.test(rot) ? " ADICIONAL" : ""}`);
      (g.itens || []).forEach((x) => L.push(`    1 ${M(x)}`));
    }
    if (c.tipo !== "bebida") L.push(`Observação: ${S(c.obs)}`);
  });
  L.push(SEP);
  if (p.obsPedido) L.push(`📝 Obs: ${S(p.obsPedido)}`, "");
  L.push((PG[p.pagPrevisto] || "💳 " + S(p.pagPrevisto)) + (p.cartaoTipo ? ({ debito: " (débito)", credito: " (crédito)", refeicao: " - cartão refeição" })[p.cartaoTipo] : "") + (p.pagPrevisto === "dinheiro" && p.trocoPara ? ` (troco para ${rs(p.trocoPara)})` : ""), "");
  if (ent) {
    L.push(p.pagPrevisto === "conta" ? "🛵 Delivery" : `🛵 Delivery (${taxa > 0 ? "taxa de: " + rs(taxa) : "entrega grátis"})`);
    L.push("🏠 " + [S(e.rua) + (S(e.numero) ? ", Nº " + S(e.numero) : "") + (S(e.complemento) ? " - " + S(e.complemento) : ""), S(e.bairro), cidade].filter(Boolean).join(", "));
    L.push(`(Previsão de Entrega: entre ${hm(de)} e ${hm(ate)})`);
  } else L.push("🏃 Retirada na loja", `(Previsão: pronto entre ${hm(de)} e ${hm(ate)})`);
  if (p.pagPrevisto !== "conta" || p.valor > 0) L.push(SEP, `*Total: ${rs(p.valor)}*`); L.push(SEP);
  // Pix: a loja não tem como ver sozinha que o dinheiro caiu, então a marmitex só entra em produção com o comprovante
  // (o caixa já marca como recebido no Pix sozinho; o comprovante é o que confirma de verdade)
  if (p.pagPrevisto === "pix") L.push("⚠ *Pagamento no Pix:* pra gente começar a preparar sua marmitex, mande o *comprovante do Pix* aqui nesta conversa 🙏", "");
  L.push(fimTxt);
  return L.join("\n");
}
function avisarWhats(p, loja) {
  const tel = String(p.telefone || "").replace(/\D/g, ""); if (tel.length < 10) return;
  const texto = textoWhats(p, loja);
  filaWhats.push({ id: p.id, tel, texto, quando: Date.now() }); filaWhats = filaWhats.slice(-200);
  gravarArquivo(ARQ_WHATS, filaWhats).catch(() => {});
}
let sincronizando = false;
async function sincronizarDelivery() {
  if (!delEstado.ativo || sincronizando) return;
  sincronizando = true;
  try {
    const { pedidos = [], loja = {} } = await delApi("novos");
    for (const s of pedidos) {
      if (!s || !TOKEN_SITE.test(String(s.token || ""))) continue;
      let p = db.pedidos.find((x) => x.uid === "site:" + s.token); // já veio antes (o aviso pro site falhou): não duplica
      if (!p) { p = pedidoDoSite(s); pagarDoSite(p); db.pedidos.push(p); await gravar(); delEstado.importados++; if (!/^\[WhatsApp\]/.test(String(s.obs || ""))) avisarWhats(p, loja); } // pedido do WhatsApp: o robô já mandou a confirmação (com o Pix); não manda outra
      await delApi("importado", { token: s.token, id_local: p.id }); // só avisa o site depois de gravar aqui
    }
    // cancelado no site depois de vir pro caixa: cancela aqui também (o pago automático sai das vendas; o recebido à mão no caixa, não)
    // (inclui o que foi pra conta sozinho: cancelado no site, sai da conta do cliente também; antes continuava cobrado)
    const abertos = db.pedidos.filter((x) => x.tipo === "delivery" && x.siteToken && (x.status === "aguardando" || ((x.pagoAuto || x.contaAuto) && (x.status === "pago" || x.status === "conta") && Date.now() - x.quando < 2 * 864e5))).slice(-70);
    // REATIVADO no site (pente fino 23/11): o caixa cancelava quando o site cancelava, mas não voltava quando o pedido era
    // reativado no painel (19/11: 4 pedidos entregues e pagos sumiram das vendas). Confere os cancelados pelo site dos últimos 3 dias.
    const cancSite = db.pedidos.filter((x) => x.tipo === "delivery" && x.siteToken && x.status === "cancelado" && x.motivoCancelamento === "cancelado no site" && Date.now() - x.quando < 3 * 864e5).slice(-30); // o site aceita até 100 por vez (70 + 30)
    if (abertos.length || cancSite.length) {
      const { pedidos: sit = [] } = await delApi("situacao", { tokens: [...abertos, ...cancSite].map((x) => x.siteToken) });
      let mudou = false;
      sit.filter((x) => x && x.status && x.status !== "cancelado").forEach((x) => {
        const p = cancSite.find((y) => y.siteToken === x.token); if (!p) return;
        delete p.motivoCancelamento; mudou = true;
        if (p.pagoAuto && p.itens.length && p.itens.every((c) => c.pago) && pagsDe({ ...p, status: "pago" }).length) { p.status = "pago"; } // volta pras vendas com o pagamento automático que já tinha
        else {
          p.status = "aguardando"; delete p.contaAuto; delete p.contaCliente; delete p.pagoAuto; delete p.pagoEm; p.clienteId = null; delete p.clienteIds; p.pagamento = null;
          // pedido "na conta"/marmita do robô: o cancelamento tirou o lançamento da conta do cliente -> lança de novo, igual quando chegou (antes voltava sem cobrar)
          if (p.pagPrevisto === "conta" && !db.lancamentos.some((l) => l.pedidoId === p.id)) pagarDoSite(p);
        }
        console.log("delivery: D" + p.numero + " reativado no site -> voltou pro caixa (" + p.status + ")");
      });
      sit.filter((x) => x && x.status === "cancelado").forEach((x) => {
        const p = abertos.find((y) => y.siteToken === x.token);
        if (p && (p.contaAuto ? p.status === "conta" : p.pagoAuto ? p.status === "pago" : !pagsDe(p).length && !p.itens.some((c) => c.pago))) {
          p.status = "cancelado"; p.motivoCancelamento = "cancelado no site"; mudou = true;
          db.lancamentos = db.lancamentos.filter((l) => l.pedidoId !== p.id); // marmita/conta lançada sozinha: tira da conta do cliente
        }
      });
      if (mudou) await gravar();
    }
    await conferirWhats();
    delEstado.ultimo = Date.now(); delEstado.erro = null;
  } catch (e) {
    const m = e.name === "TimeoutError" ? "o site não respondeu" : e.message;
    if (delEstado.erro !== m) console.error("delivery: " + m); // não enche o log com o mesmo erro a cada busca
    delEstado.erro = m;
  } finally { sincronizando = false; }
}
// resultado do robô de WhatsApp (WHATS-BOT\enviados.json): marca o pedido do site com "tem WhatsApp" ou "número SEM WhatsApp" e avisa o site
const ARQ_WENV = process.env.WHATS_ENVIADOS || path.join(__dirname, "..", "WHATS-BOT", "enviados.json");
async function conferirWhats() {
  let env; try { env = JSON.parse(fs.readFileSync(ARQ_WENV, "utf8")) || {}; } catch (e) { return; }
  let mudou = false;
  for (const p of db.pedidos.filter((x) => x.tipo === "delivery" && !x.whats && Date.now() - x.quando < 2 * 864e5)) {
    const r = env[p.id]; if (!r) continue;
    const sem = !r.ok && r.erro === "número sem WhatsApp";
    if (!r.ok && !sem) continue; // falha do robô/internet não diz nada sobre o número
    try { if (p.siteToken) await delApi("whats", { token: p.siteToken, ok: !!r.ok, erro: sem ? "número sem WhatsApp" : null }); } catch (e) { continue; } // site fora: tenta na próxima
    p.whats = r.ok ? "ok" : "sem"; mudou = true;
  }
  if (mudou) await gravar();
}
// ---------- ponte do cardápio: o totem manda no cardápio do site (o que está ligado hoje, produtos, preços, etapas, adicionais e bebidas) ----------
// Mesma conta do app.js (etapasLista / marmitexLista / bebidasLista). Doces ficam só no totem. Desliga com "cardapio": false no dados\delivery.json.
const vm = require("vm");
function cardapioDoTotem() {
  if (!cfg || !cfg.t || !cfg.dados) return null; // o totem ainda não mandou as configurações: não mexe no site
  let P; try { P = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "dados.js"), "utf8") + "\n;({ MARMITEX, CATEGORIAS, BEBIDAS, SO_BALANCA: typeof SO_BALANCA !== 'undefined' ? SO_BALANCA : [], SUCO_SABORES: typeof SUCO_SABORES !== 'undefined' ? SUCO_SABORES : [] })"); } catch (e) { return null; }
  const d = cfg.dados, L = (k, p) => { try { return d[k] == null ? p : JSON.parse(d[k]); } catch (e) { return p; } };
  const ind = new Set(L("indisponiveis", [])), rem = new Set(L("removidos", [])), extras = L("extras", {});
  const valorNoNome = (nome) => { const m = String(nome || "").match(/R\$\s*(\d+(?:[.,]\d+)?)\s*$/); return m ? parseFloat(m[1].replace(",", ".")) : 0; };
  const erem = L("etapasRemovidas", []), ad = L("etapasAdicional", {}), ord = L("etapasOrdem", []), inf = L("etapasInfo", {});
  const ets = [...P.CATEGORIAS, ...L("etapasExtras", [])].filter((c) => c && c.id && !erem.includes(c.id)).map((c) => {
    const i = inf[c.id] || {}, nome = i.nome || c.nome;
    return { id: c.id, nome, pergunta: i.pergunta || c.pergunta || "Escolha: " + nome, adicional: Number(ad[c.id] !== undefined ? ad[c.id] : (c.adicional || valorNoNome(c.nome))) || 0,
      itens: [...new Set([...(c.itens || []), ...(extras[c.id] || [])])].filter((n) => !rem.has(c.id + ":" + n)) };
  }).sort((a, b) => { const i = ord.indexOf(a.id), j = ord.indexOf(b.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); });
  const mc = L("marmitexCfg", {}), prem = L("produtosRemovidos", []);
  const produtos = [...P.MARMITEX, ...L("produtosExtras", [])].filter((m) => m && m.id && !prem.includes(m.id)).map((m) => {
    const o = mc[m.id] || {}, regras = {};
    ets.forEach((c) => { const n = (m.regras && m.regras[c.id]) || 0, ov = (o.regras && o.regras[c.id]) || {}, max = ov.max !== undefined ? ov.max : n; regras[c.id] = { min: Math.min(ov.min !== undefined ? ov.min : (n ? 1 : 0), max), max }; });
    return { id: m.id, nome: o.nome || m.nome, preco: Number(o.preco !== undefined ? o.preco : m.preco) || 0, disponivel: !ind.has("produto:" + m.id), regras };
  });
  const bebidas = [...P.BEBIDAS, ...L("bebidasExtras", [])].filter((b, i, a) => b && b.nome && a.findIndex((x) => x.nome === b.nome) === i && !rem.has("bebida:" + b.nome))
    .flatMap((b) => { // só balança (ex.: Suco Pequeno): desligada no site
      const ok = !ind.has("bebida:" + b.nome) && !P.SO_BALANCA.includes(b.nome), preco = Number(b.preco) || 0;
      // SUCO: no site/robô vai um por sabor ("Suco Grande - Laranja"); sabor desligado no admin do totem = indisponível
      if (/^suco\b/i.test(String(b.nome).trim()) && P.SUCO_SABORES.length && !P.SO_BALANCA.includes(b.nome)) return [{ nome: b.nome, preco, disponivel: false }, ...P.SUCO_SABORES.map((s) => ({ nome: b.nome + " - " + s, preco, disponivel: ok && !ind.has("sabor:" + s) }))];
      return [{ nome: b.nome, preco, disponivel: ok }];
    });
  return { etapas: ets.map((c) => ({ id: c.id, nome: c.nome, pergunta: c.pergunta, adicional: c.adicional, itens: c.itens.map((n) => ({ nome: n, disponivel: !ind.has(c.id + ":" + n) })) })), produtos, bebidas };
}
let cardEnviado = "", cardQuando = 0, enviandoCard = false;
async function enviarCardapio() {
  if (!delEstado.ativo || delCfg.cardapio === false || enviandoCard) return;
  const c = cardapioDoTotem(); if (!c) return;
  const s = JSON.stringify(c);
  if (s === cardEnviado && Date.now() - cardQuando < 30 * 60e3) return; // só manda quando muda (e a cada 30 min, por garantia)
  enviandoCard = true;
  try { await delApi("cardapio", { cardapio: c }); cardEnviado = s; cardQuando = Date.now(); delEstado.cardapio = { quando: cardQuando, erro: null }; }
  catch (e) { const m = e.name === "TimeoutError" ? "o site não respondeu" : e.message; if (!delEstado.cardapio || delEstado.cardapio.erro !== m) console.error("cardápio pro site: " + m); delEstado.cardapio = { quando: cardQuando || null, erro: m }; }
  finally { enviandoCard = false; }
}
if (delEstado.ativo) {
  setInterval(sincronizarDelivery, Number(process.env.DELIVERY_INTERVALO_MS) || 20000); setTimeout(sincronizarDelivery, 2000);
  setInterval(enviarCardapio, Number(process.env.CARDAPIO_INTERVALO_MS) || 60000); setTimeout(enviarCardapio, 3000);
}
// ----- GESTÃO (área do dono no site): o caixa manda o RESUMO de cada dia (vendas, formas, mais vendidos, gaveta) -----
// Só números do dia, sem nome/telefone de cliente. Manda hoje e ontem a cada 10 min; na 1ª vez manda os últimos 90 dias.
function resumoGestao(dia) {
  const r2 = (n) => cents(n), canal = (p) => (p.tipo === "delivery" ? "delivery" : "salao");
  const R = { dia, recebido: { salao: {}, delivery: {} }, pedidos: { salao: 0, delivery: 0 }, cancelados: 0, naConta: 0, contasRecebidas: {}, taxasEntrega: 0, itens: {}, porHora: Array(24).fill(0) };
  const add = (o, k, v) => { o[k] = r2((o[k] || 0) + v); };
  for (const p of db.pedidos) {
    for (const g of pagsDe(p)) if ((g.dia || p.dia) === dia && g.valor > 0) { add(R.recebido[canal(p)], g.forma || "outro", g.valor); R.porHora[new Date(g.quando || p.quando).getHours()] = r2(R.porHora[new Date(g.quando || p.quando).getHours()] + g.valor); }
    if (p.dia !== dia) continue;
    if (p.status === "cancelado") { R.cancelados++; continue; }
    const vale = p.status === "pago" || p.status === "conta" || pagsDe(p).length;
    if (!vale) continue;
    R.pedidos[canal(p)]++;
    if (p.status === "conta") R.naConta = r2(R.naConta + p.valor - pagsDe(p).reduce((s, g) => s + g.valor, 0));
    for (const c of p.itens || []) {
      if (c.tipo === "taxa") { R.taxasEntrega = r2(R.taxasEntrega + valorItem(c)); continue; }
      if (!(p.status === "pago" || p.status === "conta" || c.pago)) continue;
      const n = String(c.nome || "?").slice(0, 60), x = R.itens[n] || (R.itens[n] = { q: 0, v: 0, beb: c.tipo === "bebida" ? 1 : 0 });
      x.q += c.qtd || 1; x.v = r2(x.v + valorItem(c));
    }
  }
  // marmitas e lançamentos feitos direto na conta. O lançamento de um pedido que está "na conta" NÃO entra de novo (já foi somado acima: antes contava 2x)
  const naContaJa = new Set(db.pedidos.filter((p) => p.dia === dia && p.status === "conta").map((p) => p.id));
  R.naConta = r2(R.naConta + db.lancamentos.filter((l) => l.dia === dia && !(l.pedidoId && naContaJa.has(l.pedidoId))).reduce((s, l) => s + (Number(l.valor) || 0), 0));
  for (const x of db.pagamentos.filter((x) => x.data === dia)) add(R.contasRecebidas, x.forma || "outro", Number(x.valor) || 0);
  const g = gavetaDia(dia), mov = g.movimentos || [];
  R.gaveta = { abertura: g.abertura ? g.abertura.valor : null, fechamento: g.fechamento ? { contado: g.fechamento.contado ?? g.fechamento.valor ?? null, diferenca: g.fechamento.diferenca ?? null } : null,
    esperado: g.esperado, sangrias: r2(mov.filter((m) => m.tipo === "sangria" && m.categoria !== "motoboy").reduce((s, m) => s + m.valor, 0)),
    motoboys: r2(mov.filter((m) => m.categoria === "motoboy").reduce((s, m) => s + m.valor, 0)), suprimentos: g.suprimentos,
    sangriasLista: mov.filter((m) => m.tipo === "sangria" && m.categoria !== "motoboy").map((m) => ({ motivo: String(m.motivo || "Sangria").slice(0, 60), valor: r2(m.valor) })) }; // cada sangria com o nome que foi digitado (a Gestão mostra assim)
  return R;
}
const gestaoEnv = {}; let gestaoPrimeira = true, enviandoGestao = false, gestaoUltCompleto = 0;
async function enviarGestao() {
  if (!delEstado.ativo || enviandoGestao) return;
  enviandoGestao = true;
  try {
    if (Date.now() - gestaoUltCompleto > 3600e3) { gestaoPrimeira = true; gestaoUltCompleto = Date.now(); } // de hora em hora confere os 90 dias (conta marcada ou corrigida em dia antigo também chega na Gestão; só manda o que mudou)
    const dias = gestaoPrimeira ? [...new Set([...db.pedidos.map((p) => p.dia), ...Object.keys(db.caixa)])].filter((d) => d && d >= addDiasG(hoje(), -90)).sort() : [addDiasG(hoje(), -1), hoje()];
    const mudou = dias.map(resumoGestao).filter((r) => { const s = JSON.stringify(r); if (gestaoEnv[r.dia] === s) return false; r._s = s; return true; });
    for (let i = 0; i < mudou.length; i += 30) {
      const lote = mudou.slice(i, i + 30);
      await delApi("gestao", { resumos: lote.map(({ _s, ...r }) => r) });
      lote.forEach((r) => (gestaoEnv[r.dia] = r._s));
    }
    gestaoPrimeira = false; delEstado.gestao = { quando: Date.now(), erro: null };
  } catch (e) { const m = e.name === "TimeoutError" ? "o site não respondeu" : e.message; if (!delEstado.gestao || delEstado.gestao.erro !== m) console.error("gestão pro site: " + m); delEstado.gestao = { quando: Date.now(), erro: m }; }
  finally { enviandoGestao = false; }
}
// ----- FECHAMENTO DO DIA NO WHATSAPP (dona 23/11): todo dia a partir das 15h, 1 vez, pro número da dona (o robô do WhatsApp envia) -----
// Número e hora em dados\resumo-zap.json ({ "tel": "12991076412", "hora": 15 }); "tel": "" desliga. Dia sem movimento não manda.
const ARQ_RZ = path.join(DIR_DADOS, "resumo-zap.json");
let rz = { tel: process.env.DADOS_DIR ? "" : "12991076412", hora: 15, ultimo: "" }; try { rz = { ...rz, ...JSON.parse(fs.readFileSync(ARQ_RZ, "utf8")) }; } catch (e) {}
function textoFechamento(dia) {
  const R = resumoGestao(dia), soma = (o) => cents(Object.values(o).reduce((s, v) => s + v, 0)), b = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); // R$ 6.228,79
  const sal = soma(R.recebido.salao), del = soma(R.recebido.delivery), tot = cents(sal + del), fo = {};
  [R.recebido.salao, R.recebido.delivery].forEach((o) => Object.entries(o).forEach(([k, v]) => (fo[k] = cents((fo[k] || 0) + v))));
  const NF = { dinheiro: "💵 Dinheiro", pix: "💠 Pix", debito: "💳 Débito", credito: "💳 Crédito", refeicao: "🍽️ Refeição", cartao: "💳 Cartão" };
  const abertos = db.pedidos.filter((p) => p.dia === dia && p.status === "aguardando" && (p.itens || []).length), vAb = cents(abertos.reduce((s, p) => s + p.valor - pagsDe(p).reduce((t, g) => t + g.valor, 0), 0));
  const contas = soma(R.contasRecebidas), g = R.gaveta || {}, dow = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(dia + "T12:00:00").getDay()];
  const L = [`📊 *Fechamento Da Lúcia — ${dia.slice(8)}/${dia.slice(5, 7)} (${dow})*`, "", `💰 *Total recebido: ${b(tot + contas)}*`];
  Object.entries(fo).sort((x, y) => y[1] - x[1]).forEach(([k, v]) => L.push(`   ${NF[k] || k}: ${b(v)}`));
  // delivery separado em ENTREGA e RETIRADA (dona 24/11), pela data do recebimento (igual ao total)
  const dl = { entrega: { v: 0, ids: new Set() }, retirada: { v: 0, ids: new Set() } };
  for (const x of db.pedidos) if (x.tipo === "delivery") for (const g of pagsDe(x)) if ((g.dia || x.dia) === dia && g.valor > 0) { const k = x.entrega === "retirada" ? "retirada" : "entrega"; dl[k].v = cents(dl[k].v + g.valor); dl[k].ids.add(x.id); }
  L.push("", `🍽️ Salão: ${R.pedidos.salao} pedidos · ${b(sal)}`, `🛵 Entrega: ${dl.entrega.ids.size} pedidos · ${b(dl.entrega.v)}${R.taxasEntrega ? ` (taxas ${b(R.taxasEntrega)})` : ""}`, `🏃 Retirada: ${dl.retirada.ids.size} pedidos · ${b(dl.retirada.v)}`);
  if (R.naConta) L.push(`📒 Marcado na conta: ${b(R.naConta)}`);
  if (contas) L.push(`📥 Contas recebidas: ${b(contas)}`);
  if (g.motoboys) L.push(`🛵 Pago aos motoboys: ${b(g.motoboys)}`);
  if (g.sangrias) L.push(`➖ Retiradas da gaveta: ${b(g.sangrias)}`);
  if (R.cancelados) L.push(`❌ Cancelados: ${R.cancelados}`);
  if (abertos.length) L.push("", `⚠️ *Ficou em aberto hoje: ${abertos.length} · ${b(vAb)}*`);
  L.push("", g.fechamento ? `💵 Gaveta fechada: contado ${b(g.fechamento.contado)} · ${Math.abs(g.fechamento.diferenca || 0) < 0.01 ? "bateu ✅" : (g.fechamento.diferenca > 0 ? "sobrou " : "faltou ") + b(Math.abs(g.fechamento.diferenca)) + " ⚠️"}`
    : g.esperado != null ? `💵 Gaveta: deve ter ${b(g.esperado)} (ainda não foi fechada)` : "💵 Gaveta não foi aberta hoje");
  return { texto: L.join("\n"), movimento: tot + contas + R.pedidos.salao + R.pedidos.delivery > 0 };
}
async function mandarFechamento() {
  const dia = hoje(); if (!rz.tel || rz.ultimo === dia || new Date().getHours() < (Number(rz.hora) || 15)) return;
  const { texto, movimento } = textoFechamento(dia); rz.ultimo = dia;
  if (movimento) { filaWhats.push({ id: "fechamento-" + dia, tel: String(rz.tel).replace(/\D/g, ""), texto, quando: Date.now() }); filaWhats = filaWhats.slice(-200); await gravarArquivo(ARQ_WHATS, filaWhats).catch(() => {}); console.log("fechamento do dia na fila do WhatsApp (" + rz.tel + ")"); }
  await gravarArquivo(ARQ_RZ, rz).catch(() => {});
}
setInterval(() => mandarFechamento().catch((e) => console.error("fechamento no WhatsApp: " + e.message)), 60e3); setTimeout(() => mandarFechamento().catch(() => {}), 5000);
function addDiasG(d, n) { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); }
if (delEstado.ativo) { setInterval(enviarGestao, Number(process.env.GESTAO_INTERVALO_MS) || 10 * 60e3); setTimeout(enviarGestao, 15000); }

async function tratar(req, res) {
  const url = new URL(req.url, "http://x"), p = decodeURIComponent(url.pathname);
  const nivel = nivelRota(req.method, p);
  if (nivel > 0) {
    const papel = papelDe(req);
    if (!papel) return json(res, 401, { erro: "faça login" });
    if (NIVEL[papel] < nivel) return json(res, 403, { erro: "sem permissão para isso" });
    req.papel = papel;
  }
  if (p === "/api/pedidos" && req.method === "GET") {
    const dia = url.searchParams.get("dia"), tipo = url.searchParams.get("tipo"), st = url.searchParams.get("status");
    if (url.searchParams.get("para") === "balanca" && dia) { // ?para=balanca&v=<versão que o tablet já tem>: 204 = nada mudou
      const v = versaoDb(); res.setHeader("X-Versao", v); res.setHeader("Access-Control-Expose-Headers", "X-Versao");
      if (url.searchParams.get("v") === v) { res.writeHead(204); return res.end(); }
      return json(res, 200, pedidosBalanca(dia));
    }
    // ?tipo=balanca&status=aguardando: só as comandas abertas (o celular do garçom baixa bem menos que o dia inteiro)
    return json(res, 200, db.pedidos.filter((x) => (!dia || x.dia === dia) && (!tipo || (x.tipo || "totem") === tipo) && (!st || x.status === st)));
  }
  if (p === "/api/pedidos" && req.method === "POST") {           // totem manda o pedido
    const b = await corpo(req), base = limparPedido(b), uidp = String(b.uid || "").slice(0, 80), com = b.comanda ? Number(b.comanda) : 0;
    if (com && (!Number.isInteger(com) || com < 1 || com > 9999)) return json(res, 400, { erro: "número de comanda inválido" });
    if (uidp) { const ja = db.pedidos.find((x) => x.uid === uidp); if (ja) return json(res, 200, ja); } // mesmo pedido reenviado: não duplica
    const numero = Math.max(0, ...db.pedidos.filter((x) => x.dia === base.dia && !x.tipo).map((x) => x.numero)) + 1; // quem dá o número é o servidor (comandas e delivery têm numeração própria)
    const novo = { ...base, uid: uidp || undefined, numero, numeroLocal: Number(b.numero) || undefined, origem: b.origem === "caixa" ? "caixa" : undefined, id: Date.now() + "-" + numero, status: com ? "comanda" : "aguardando", pagamento: null, comanda: com || undefined };
    if (com) { // entra na comanda aberta (se ainda não existir, abre uma); quem paga é o caixa, tudo junto
      let cmd = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === base.dia && x.numero === com && x.status === "aguardando");
      if (!cmd) { cmd = { id: Date.now() + "-c" + com, tipo: "balanca", dia: base.dia, numero: com, nome: "", quando: Date.now(), itens: [], unidades: 0, valor: 0, status: "aguardando", pagamento: null }; db.pedidos.push(cmd); }
      if (!cmd.nome && base.nome) cmd.nome = base.nome; // a comanda ganha o nome de quem pediu a marmitex
      base.itens.forEach((c) => cmd.itens.push({ iid: uid("i"), qtd: c.qtd, nome: c.nome + (base.nome ? " (" + base.nome + ")" : ""), preco: c.preco, grupos: c.grupos, obs: c.obs, tipo: c.tipo, hora: Date.now(), origem: "totem", pedidoId: novo.id }));
      recalcComanda(cmd); novo.comandaId = cmd.id;
    }
    db.pedidos.push(novo); await gravar(); return json(res, 200, novo);
  }
  if (p === "/api/recebimentos" && req.method === "GET") { // dinheiro que ENTROU no período, pela data do RECEBIMENTO (igual à gaveta):
    // comanda de ontem recebida hoje conta hoje. O Fechamento do caixa usa isto (antes somava pelo dia do pedido e não batia com a gaveta)
    const de = String(url.searchParams.get("de") || ""), ate = String(url.searchParams.get("ate") || de);
    if (!/^\d{4}-\d\d-\d\d$/.test(de) || !/^\d{4}-\d\d-\d\d$/.test(ate)) return json(res, 400, { erro: "período inválido" });
    const out = [];
    for (const x of db.pedidos) for (const g of pagsDe(x)) { const d = g.dia || x.dia; if (d >= de && d <= ate && g.valor > 0) out.push({ forma: g.forma, valor: g.valor, dia: d, quando: g.quando || x.quando, pedidoId: x.id, pedidoDia: x.dia, tipo: x.tipo || "totem", numero: x.numero, entrega: x.tipo === "delivery" ? (x.entrega === "retirada" ? "retirada" : "entrega") : undefined }); }
    return json(res, 200, out);
  }
  if (p === "/api/lancamentos" && req.method === "GET") { // tudo que foi marcado em conta no período (inclui marmita do WhatsApp e lançado à mão): o Fechamento soma
    const de = String(url.searchParams.get("de") || ""), ate = String(url.searchParams.get("ate") || de);
    if (!/^\d{4}-\d\d-\d\d$/.test(de) || !/^\d{4}-\d\d-\d\d$/.test(ate)) return json(res, 400, { erro: "período inválido" });
    return json(res, 200, db.lancamentos.filter((l) => l.dia >= de && l.dia <= ate).map((l) => ({ id: l.id, dia: l.dia, valor: l.valor, pedidoId: l.pedidoId || null, clienteId: l.clienteId, obs: l.obs })));
  }
  if (p === "/api/pendencias" && req.method === "GET") { // comandas/pedidos de DIAS ANTERIORES que ficaram em aberto (o caixa só lista o dia: sumiam da tela - pente fino 23/11)
    const hj = hoje(), out = db.pedidos.filter((x) => x.status === "aguardando" && x.dia < hj && (x.itens || []).length)
      .map((x) => ({ id: x.id, dia: x.dia, tipo: x.tipo || "totem", numero: x.numero, nome: x.nome || "", valor: cents(x.valor - pagsDe(x).reduce((s, g) => s + g.valor, 0)) }))
      .filter((x) => x.valor > 0).sort((a, b) => a.dia.localeCompare(b.dia));
    return json(res, 200, out);
  }
  // ---------- CUPOM FISCAL (NFC-e) - ver fiscal.js ----------
  if (p === "/api/fiscal" && req.method === "GET") return json(res, 200, fiscal.status());
  if (p === "/api/fiscal/certificado" && req.method === "POST") { // admin: escolhe o .pfx/.p12 e digita a senha (a senha não fica guardada)
    const b = await corpo(req, 300e3);
    try { return json(res, 200, { ok: true, ...fiscal.instalarCertificado(Buffer.from(String(b.pfx || ""), "base64"), String(b.senha || "")), status: fiscal.status() }); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }
  if (p === "/api/fiscal/ambiente" && req.method === "POST") { const b = await corpo(req); try { return json(res, 200, fiscal.mudarAmbiente(Number(b.ambiente))); } catch (e) { return json(res, 400, { erro: e.message }); } }
  if (p === "/api/fiscal/sefaz" && req.method === "POST") { try { return json(res, 200, await fiscal.statusSefaz()); } catch (e) { return json(res, 502, { erro: e.message }); } }
  if (p === "/api/fiscal/emitir" && req.method === "POST") { // { ids: [pedidos pagos], cpf, modo: "discriminado" | "simples" }
    const b = await corpo(req), ids = [...new Set((Array.isArray(b.ids) ? b.ids : [b.id]).map(String))].slice(0, 10), peds = ids.map((id) => db.pedidos.find((x) => x.id === id));
    if (!peds.length || peds.some((x) => !x)) return json(res, 404, { erro: "pedido não encontrado" });
    if (peds.some((x) => x.status !== "pago")) return json(res, 409, { erro: "o cupom fiscal sai só de pedido já pago (todo recebido)" });
    const ja = peds.find((x) => x.nfce && x.nfce.status === "autorizada"); if (ja) return json(res, 409, { erro: "esse pedido já tem cupom fiscal (nº " + ja.nfce.numero + ")", nfce: ja.nfce });
    if (b.cpf && !fiscal.cpfOk(b.cpf)) return json(res, 400, { erro: "CPF inválido" });
    try {
      const nf = await fiscal.emitir(peds, { cpf: b.cpf || "", modo: b.modo === "simples" ? "simples" : "discriminado" }, peds.flatMap(pagsDe));
      peds.forEach((x) => (x.nfce = { ...nf, pedidos: ids, modo: b.modo === "simples" ? "simples" : "discriminado" })); await gravar();
      return json(res, 200, peds[0].nfce);
    } catch (e) { console.error("cupom fiscal: " + e.message); return json(res, 502, { erro: e.message }); }
  }
  // notas do mês pra contadora: resumo, ZIP pra baixar e envio pelo WhatsApp (robô)
  if (p === "/api/fiscal/notas" && req.method === "GET") {
    try { const ns = fiscal.notasDoMes(String(url.searchParams.get("mes") || hoje().slice(0, 7))), aut = ns.filter((n) => !n.canc); return json(res, 200, { qtd: ns.length, autorizadas: aut.length, canceladas: ns.length - aut.length, total: cents(aut.reduce((s, n) => s + n.valor, 0)), contadora: fiscal.contadora() }); }
    catch (e) { return json(res, 400, { erro: e.message }); }
  }
  if (p === "/api/fiscal/notas-zip" && req.method === "GET") {
    const mes = String(url.searchParams.get("mes") || ""); let z; try { z = fiscal.zipDoMes(mes); } catch (e) { return json(res, 400, { erro: e.message }); }
    res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="Notas fiscais ${mes} - Da Lucia.zip"`, "Cache-Control": "no-store" }); return res.end(z.zip);
  }
  if (p === "/api/fiscal/contadora" && req.method === "POST") { // { mes, tel }: guarda o número da contadora e manda o ZIP do mês pelo WhatsApp
    const b = await corpo(req), mes = String(b.mes || ""), tel = String(b.tel || "").replace(/\D/g, "");
    if (tel.length < 10) return json(res, 400, { erro: "digite o WhatsApp da contadora com DDD" });
    let z; try { z = fiscal.zipDoMes(mes); } catch (e) { return json(res, 400, { erro: e.message }); }
    if (!z.qtd) return json(res, 400, { erro: "nenhuma nota emitida pelo caixa em " + mes.split("-").reverse().join("/") });
    fiscal.contadora(tel);
    const dirZ = path.join(DIR_DADOS, "nfce", "zips"); fs.mkdirSync(dirZ, { recursive: true });
    const arq = path.join(dirZ, `Notas fiscais ${mes} - Da Lucia.zip`); fs.writeFileSync(arq, z.zip);
    const [aa, mm] = mes.split("-"), texto = `🧾 *Notas fiscais (NFC-e) - Da Lúcia Cantina e Restaurante*\nCNPJ 20.128.902/0001-15 · ${mm}/${aa}\n\n${z.autorizadas} cupom(ns) autorizado(s) · R$ ${z.total.toFixed(2).replace(".", ",")}${z.canceladas ? `\n${z.canceladas} cancelado(s)` : ""}\n\nNo ZIP: os XML (autorizadas e cancelamentos) e o resumo em planilha 👇`;
    filaWhats.push({ id: "contadora-" + mes + "-" + Date.now(), tel: tel.startsWith("55") ? tel.slice(2) : tel, texto, arquivo: arq, quando: Date.now() }); filaWhats = filaWhats.slice(-200);
    await gravarArquivo(ARQ_WHATS, filaWhats); return json(res, 200, { ok: true, qtd: z.qtd, autorizadas: z.autorizadas, canceladas: z.canceladas, total: z.total });
  }
  if (p === "/api/fiscal/cancelar" && req.method === "POST") { // cancela o cupom na SEFAZ (até 30 min depois de emitido)
    const b = await corpo(req), ped = db.pedidos.find((x) => x.id === String(b.id || ""));
    if (!ped || !ped.nfce || ped.nfce.status !== "autorizada") return json(res, 404, { erro: "esse pedido não tem cupom fiscal ativo" });
    try {
      const c = await fiscal.cancelar(ped.nfce, b.motivo), ch = ped.nfce.chave;
      db.pedidos.forEach((x) => { if (x.nfce && x.nfce.chave === ch) x.nfce = { ...x.nfce, ...c, status: "cancelada" }; }); await gravar();
      return json(res, 200, ped.nfce);
    } catch (e) { return json(res, 502, { erro: e.message }); }
  }
  if (p === "/api/fechamento-zap" && req.method === "GET") { // texto do fechamento do dia que vai pro WhatsApp da dona (pra conferir)
    const d = String(url.searchParams.get("dia") || hoje()); if (!/^\d{4}-\d\d-\d\d$/.test(d)) return json(res, 400, { erro: "dia inválido" });
    return json(res, 200, { ...textoFechamento(d), tel: rz.tel, hora: rz.hora, ultimo: rz.ultimo });
  }
  if (p === "/api/clientes" && req.method === "GET") return json(res, 200, db.clientes);
  if (p === "/api/clientes" && req.method === "POST") {
    const b = await corpo(req); if (!String(b.nome || "").trim()) return json(res, 400, { erro: "nome" });
    const uc = String(b.uid || "").slice(0, 80); if (uc) { const ja = db.clientes.find((x) => x.uid === uc); if (ja) return json(res, 200, ja); } // clique duplo: não cadastra 2x
    const c = { id: uid("c"), uid: uc || undefined, nome: String(b.nome).trim(), empresa: String(b.empresa || "").trim(), modo: b.modo === "refeicao" ? "refeicao" : "valor", valorRefeicao: Number(b.valorRefeicao) || 0, telefone: String(b.telefone || "").trim(), endereco: String(b.endereco || "").trim().slice(0, 200) || undefined, pagamento: b.pagamento === "depois" ? "depois" : "antecipado", cobranca: ["fiado", "mensal"].includes(b.cobranca) ? b.cobranca : undefined, ativo: true }; // cobranca: fiado (avisa em 5 dias) ou mensal (fecha no fim do mês); vazio = o caixa decide (empresa/marmita = mensal)
    db.clientes.push(c); await gravar(); return json(res, 200, c);
  }
  const mc = p.match(/^\/api\/clientes\/([^/]+)$/);
  if (mc && req.method === "PUT") {
    const c = db.clientes.find((x) => x.id === mc[1]); if (!c) return json(res, 404, { erro: "nao achei" });
    const b = await corpo(req);
    ["nome", "empresa", "telefone"].forEach((k) => { if (b[k] !== undefined) c[k] = String(b[k]).trim(); });
    if (b.endereco !== undefined) c.endereco = String(b.endereco).trim().slice(0, 200); // endereço de entrega (o robô do WhatsApp usa pro cliente de marmita)
    if (b.modo) c.modo = b.modo === "refeicao" ? "refeicao" : "valor";
    if (b.valorRefeicao !== undefined) c.valorRefeicao = Number(b.valorRefeicao) || 0;
    if (b.pagamento) c.pagamento = b.pagamento === "depois" ? "depois" : "antecipado";
    if (b.cobranca !== undefined) { if (["fiado", "mensal"].includes(b.cobranca)) c.cobranca = b.cobranca; else delete c.cobranca; } // fiado x conta mensal (dona 23/11)
    if (b.ativo !== undefined) c.ativo = !!b.ativo;
    await gravar(); return json(res, 200, c);
  }
  const mj = p.match(/^\/api\/clientes\/([^/]+)\/juntar$/);
  if (mj && req.method === "POST") {                            // cadastro repetido: passa tudo do cliente pro outro e apaga o repetido
    const b = await corpo(req), de = db.clientes.find((x) => x.id === mj[1]), para = db.clientes.find((x) => x.id === String(b.para || ""));
    if (!de || !para || de.id === para.id) return json(res, 400, { erro: "escolha dois clientes diferentes" });
    const kDe = chaveDe(de.id), kPara = chaveDe(para.id); let nl = 0, np = 0;
    db.lancamentos.forEach((l) => { if (l.clienteId === de.id) { l.clienteId = para.id; nl++; } });
    db.pedidos.forEach((x) => { if (x.clienteId === de.id) { x.clienteId = para.id; np++; } (x.divisao || []).forEach((d) => { if (d.clienteId === de.id) d.clienteId = para.id; }); });
    if (kDe === "c:" + de.id) { db.pagamentos.forEach((x) => { if (x.chave === kDe) x.chave = kPara; }); Object.keys(db.enviados).forEach((k) => { if (k.endsWith("|" + kDe)) { db.enviados[k.slice(0, -kDe.length) + kPara] = db.enviados[k]; delete db.enviados[k]; } }); }
    db.clientes = db.clientes.filter((x) => x.id !== de.id);
    await gravar(); return json(res, 200, { ok: true, lancamentos: nl, pedidos: np });
  }
  if (p === "/api/contas" && req.method === "GET") {              // extrato do mês + saldo que veio dos meses anteriores
    const mes = url.searchParams.get("mes") || hoje().slice(0, 7), enviados = {}, anterior = {};
    Object.keys(db.enviados).forEach((k) => { if (k.startsWith(mes + "|")) enviados[k.slice(8)] = true; });
    db.lancamentos.forEach((l) => { if (l.dia.slice(0, 7) < mes) { const k = chaveDe(l.clienteId); anterior[k] = (anterior[k] || 0) + l.valor; } });
    db.pagamentos.forEach((x) => { if (x.mes < mes) anterior[x.chave] = (anterior[x.chave] || 0) - x.valor; });
    Object.keys(anterior).forEach((k) => (anterior[k] = Math.round(anterior[k] * 100) / 100));
    return json(res, 200, { lancamentos: db.lancamentos.filter((l) => l.dia.startsWith(mes)), pagamentos: db.pagamentos.filter((x) => x.mes === mes), enviados, anterior });
  }
  if (p === "/api/lancamentos" && req.method === "POST") {
    const b = await corpo(req), ul = String(b.uid || "").slice(0, 80);
    if (ul) { const ja = db.lancamentos.find((x) => x.uid === ul); if (ja) return json(res, 200, ja); } // clique duplo: não marca 2x
    const l = { id: uid("l"), uid: ul || undefined, clienteId: String(b.clienteId || ""), dia: String(b.dia || ""), qtd: Number(b.qtd) || 0, valor: cents(b.valor), obs: String(b.obs || "").slice(0, 120) };
    const cli = db.clientes.find((x) => x.id === l.clienteId && x.ativo !== false);
    if (!cli || !/^\d{4}-\d\d-\d\d$/.test(l.dia) || !(l.valor > 0 && l.valor <= 5000) || !(l.qtd >= 0 && l.qtd <= 99)) return json(res, 400, { erro: "dados inválidos (cliente, dia ou valor)" });
    db.lancamentos.push(l); await gravar(); return json(res, 200, l);
  }
  const mt = p.match(/^\/api\/lancamentos\/([^/]+)\/tirar$/);
  if (mt && req.method === "POST") {                            // tira UM item da conta (a pessoa cancelou ou não foi): sai da conta e do pedido
    const b = await corpo(req), iid = String(b.iid || ""), l = db.lancamentos.find((x) => x.id === mt[1]);
    if (!l) return json(res, 404, { erro: "esse lançamento já não está na conta" });
    const ped = l.pedidoId && db.pedidos.find((x) => x.id === l.pedidoId);
    if (!ped || !Array.isArray(l.itensIds)) return json(res, 409, { erro: "esse lançamento não tem itens separados: apague ele (✕) e marque de novo o valor certo" });
    if (!l.itensIds.includes(iid)) return json(res, 409, { erro: "esse item já não está nesse lançamento" });
    const c = ped.itens.find((x) => x.iid === iid);
    if (c && c.pago) return json(res, 409, { erro: "esse item já foi pago" });
    l.itensIds = l.itensIds.filter((x) => x !== iid);
    if (c) {
      ped.itens = ped.itens.filter((x) => x !== c);
      (ped.tirados = ped.tirados || []).push({ ...c, tiradoEm: Date.now(), quem: req.papel }); // fica registrado o que saiu
      if (ped.tipo === "balanca") recalcComanda(ped); else ped.valor = cents(ped.itens.reduce((t, x) => t + valorItem(x), 0));
    }
    const vivos = ped.itens.filter((x) => l.itensIds.includes(x.iid));
    if (vivos.length) l.valor = cents(vivos.reduce((t, x) => t + valorItem(x), 0));
    else db.lancamentos = db.lancamentos.filter((x) => x !== l); // tirou o último item: o lançamento some da conta
    if (!db.lancamentos.some((x) => x.pedidoId === ped.id) && ped.status === "conta") { // não sobrou nada desse pedido na conta
      if (!ped.itens.length) ped.status = "cancelado";
      else { ped.status = "aguardando"; ped.clienteId = null; delete ped.clienteIds; ped.pagamento = null; delete ped.contaAuto; fecharSePago(ped); }
    }
    await gravar(); return json(res, 200, { ok: true, lancamento: vivos.length ? l : null });
  }
  const ml = p.match(/^\/api\/lancamentos\/([^/]+)$/);
  if (ml && req.method === "DELETE") {
    const l = db.lancamentos.find((x) => x.id === ml[1]);
    db.lancamentos = db.lancamentos.filter((x) => x.id !== ml[1]);
    // apagou da conta o lançamento de um pedido marcado na conta e não sobrou nenhum: o pedido volta pro "em aberto" do caixa
    // (antes ficava "na conta" sem estar em conta nenhuma: sumia do caixa e a Gestão ainda contava como vendido na conta)
    const ped = l && l.pedidoId && db.pedidos.find((x) => x.id === l.pedidoId);
    if (ped && ped.status === "conta" && !db.lancamentos.some((x) => x.pedidoId === ped.id)) { ped.status = "aguardando"; ped.clienteId = null; delete ped.clienteIds; ped.pagamento = null; delete ped.contaAuto; desfazContaParcial(ped); }
    await gravar(); return json(res, 200, { ok: true });
  }
  if (p === "/api/pagamentos" && req.method === "POST") {
    const b = await corpo(req), up = String(b.uid || "").slice(0, 80);
    if (up) { const ja = db.pagamentos.find((x) => x.uid === up); if (ja) return json(res, 200, ja); } // clique duplo: não registra o pagamento 2x
    const x = { id: uid("p"), uid: up || undefined, chave: String(b.chave || ""), mes: String(b.mes || ""), valor: cents(b.valor), refeicoes: Number(b.refeicoes) || 0, forma: String(b.forma || ""), data: String(b.data || hoje()), obs: String(b.obs || "").slice(0, 200) };
    const existe = db.clientes.some((c) => (c.empresa ? "e:" + c.empresa : "c:" + c.id) === x.chave);
    if (!existe || !/^\d{4}-\d\d$/.test(x.mes) || !/^\d{4}-\d\d-\d\d$/.test(x.data) || !["dinheiro", "pix", "credito", "debito", "transferencia"].includes(x.forma) || !(x.valor > 0 && x.valor <= 100000)) return json(res, 400, { erro: "pagamento inválido" });
    db.pagamentos.push(x); await gravar(); return json(res, 200, x);
  }
  const mp = p.match(/^\/api\/pagamentos\/([^/]+)$/);
  if (mp && req.method === "DELETE") { db.pagamentos = db.pagamentos.filter((x) => x.id !== mp[1]); await gravar(); return json(res, 200, { ok: true }); }
  if (p === "/api/enviado" && req.method === "PUT") {
    const b = await corpo(req), k = b.mes + "|" + b.chave; if (b.enviado) db.enviados[k] = true; else delete db.enviados[k];
    await gravar(); return json(res, 200, { ok: true });
  }
  if (p === "/api/imprimir" && req.method === "POST") {           // manda os bytes ESC/POS direto pra impressora de rede (porta 9100)
    const b = await corpo(req, 200e3), dados = Buffer.from(String(b.dados || ""), "base64"); // o IP vem da configuração salva pelo admin, nunca do pedido
    const doCaixa = b.destino === "caixa"; let imp = {};
    if (doCaixa) { const pp = papelDe(req); if (!pp) return json(res, 401, { erro: "faça login" }); if (NIVEL[pp] < 2) return json(res, 403, { erro: "sem permissão para isso" }); imp = impCaixa; } // impressora do caixa: só quem entrou no caixa
    else { try { imp = JSON.parse((cfg.dados && cfg.dados.impCfg) || "{}"); } catch (e) {} }
    const ip = String(imp.ip || ""), porta = Number(imp.porta) || 9100;
    if (!ip) return json(res, 400, { erro: doCaixa ? "impressora do caixa não configurada (Caixa → 🖨 no topo → IP)" : "impressora não configurada (Admin → Impressão → IP)" });
    if (!IP_PRIVADO.test(ip)) return json(res, 400, { erro: "IP inválido (use o IP da impressora na sua rede)" });
    if (!dados.length) return json(res, 400, { erro: "nada pra imprimir" });
    if (dados.length > 120000 || dados[0] !== 0x1b || dados[1] !== 0x40) return json(res, 400, { erro: "conteúdo de impressão inválido" }); // comanda de verdade começa com ESC @ (com a logo em imagem fica maior)
    const ipc = req.socket.remoteAddress, agoraI = Date.now(); impressoes[ipc] = (impressoes[ipc] || []).filter((x) => agoraI - x < 60000);
    if (impressoes[ipc].length >= 30) return json(res, 429, { erro: "muitas impressões em pouco tempo" }); impressoes[ipc].push(agoraI);
    return new Promise((ok) => {
      let fim = false; const f = (code, o) => { if (!fim) { fim = true; ok(json(res, code, o)); } };
      const s = net.connect({ host: ip, port: porta, timeout: 5000 }, () => s.end(dados));
      s.on("close", () => f(200, { ok: true }));
      s.on("timeout", () => { s.destroy(); f(504, { erro: "timeout: a impressora não respondeu", ip, porta }); });
      s.on("error", (e) => f(502, { erro: "não consegui falar com a impressora (" + e.code + ")", ip, porta }));
    });
  }
  if (p === "/api/impressora-caixa" && req.method === "GET") return json(res, 200, impCaixa);
  if (p === "/api/impressora-caixa" && req.method === "PUT") {
    const b = await corpo(req), ip = String(b.ip || "").trim(), porta = Number(b.porta) || 9100, cols = Number(b.cols) || 48, avanco = Number(b.avanco);
    if (ip && !IP_PRIVADO.test(ip)) return json(res, 400, { erro: "IP inválido (use o IP da impressora na sua rede, ex.: 192.168.1.60)" });
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) return json(res, 400, { erro: "porta inválida" });
    if (!Number.isInteger(cols) || cols < 24 || cols > 64) return json(res, 400, { erro: "largura do papel inválida" });
    const txt = (v, n) => String(v || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n), lj = b.loja && typeof b.loja === "object" ? b.loja : (impCaixa.loja || {});
    const loja = { razao: txt(lj.razao, 60), cnpj: txt(lj.cnpj, 24), endereco: txt(lj.endereco, 80), cidade: txt(lj.cidade, 50), tel: txt(lj.tel, 40), extra: txt(lj.extra, 60) }; // dados do restaurante no comprovante
    impCaixa = { ip, porta, cols, avanco: Number.isInteger(avanco) && avanco >= 0 && avanco <= 12 ? avanco : 4, corte: b.corte !== false, loja };
    await gravarArquivo(ARQ_IMPCX, impCaixa); return json(res, 200, impCaixa);
  }
  if (p === "/api/login" && req.method === "POST") {
    const b = await corpo(req), ip = req.socket.remoteAddress, t = tentativas[ip] || { n: 0, ate: 0 };
    if (Date.now() < t.ate) return json(res, 429, { erro: "muitas tentativas, aguarde alguns minutos" });
    const role = NIVEL[b.role] ? b.role : "", pin = String(b.pin || ""); let papel = "";
    if (role && /^\d{4,8}$/.test(pin)) { if (confere(pin, seg.pins.admin)) papel = "admin"; else if (confere(pin, seg.pins[role])) papel = role; }
    if (!papel) { t.n++; if (t.n >= 5) { t.ate = Date.now() + 5 * 60000; t.n = 0; } tentativas[ip] = t; return json(res, 401, { erro: "senha incorreta" }); }
    delete tentativas[ip];
    const token = crypto.randomBytes(24).toString("hex"), agora = Date.now();
    Object.keys(sessoes).forEach((h) => { if (sessoes[h].exp < agora) delete sessoes[h]; });
    sessoes[sha(token)] = { role: papel, exp: agora + SESSAO_MS }; await gravarArquivo(ARQ_SES, sessoes);
    return json(res, 200, { token, role: papel });
  }
  if (p === "/api/senhas" && req.method === "GET") return json(res, 200, { padrao: seg.padrao });
  if (p === "/api/senhas" && req.method === "POST") {
    const b = await corpo(req), role = String(b.role || ""), pin = String(b.pin || "");
    if (!NIVEL[role] || !/^\d{4,8}$/.test(pin)) return json(res, 400, { erro: "use de 4 a 8 números" });
    if (Object.keys(NIVEL).some((r) => r !== role && confere(pin, seg.pins[r]))) return json(res, 400, { erro: "essa senha já é usada em outro nível" });
    seg.pins[role] = mkPin(pin); delete seg.padrao[role];
    const eu = sha(tokenDe(req) || ""); Object.keys(sessoes).forEach((h) => { if (sessoes[h].role === role && h !== eu) delete sessoes[h]; }); // quem entrou com a senha antiga sai
    await gravarArquivo(ARQ_SEG, seg); await gravarArquivo(ARQ_SES, sessoes); return json(res, 200, { ok: true, padrao: seg.padrao });
  }
  if (p === "/api/entregadores" && req.method === "GET") return json(res, 200, db.entregadores);
  if (p === "/api/entregadores" && req.method === "PUT") {      // nomes dos motoboys (os mesmos todo dia; o caixa edita)
    const b = await corpo(req);
    if (!Array.isArray(b.nomes)) return json(res, 400, { erro: "lista inválida" });
    db.entregadores = [...new Set(b.nomes.map((n) => String(n || "").trim().slice(0, 30)).filter(Boolean))].slice(0, 8);
    await gravar(); return json(res, 200, db.entregadores);
  }
  if (p === "/api/gaveta/motoboys" && req.method === "GET") { // o que foi pago aos motoboys (saiu da gaveta) num período
    const de = url.searchParams.get("de") || hoje(), ate = url.searchParams.get("ate") || de;
    const l = Object.keys(db.caixa).filter((d) => d >= de && d <= ate).flatMap((d) => (db.caixa[d].movimentos || []).filter((m) => m.categoria === "motoboy").map((m) => ({ dia: d, entregador: m.entregador, valor: m.valor, quando: m.quando, id: m.id, motivo: m.motivo })));
    return json(res, 200, l);
  }
  if (p === "/api/gaveta" && req.method === "GET") { // + o troco usado da última vez (pra abrir sozinha com ele)
    const d = url.searchParams.get("dia") || hoje(), ult = Object.keys(db.caixa).filter((x) => x < d && db.caixa[x].abertura).sort().pop();
    return json(res, 200, { ...gavetaDia(d), ultimoTroco: ult ? db.caixa[ult].abertura.valor : null });
  }
  if (p === "/api/gaveta" && req.method === "POST") {
    const b = await corpo(req), dia = hoje(), g = (db.caixa[dia] = db.caixa[dia] || { movimentos: [] }), valor = cents(b.valor);
    if (b.acao === "abrir") {
      if (g.abertura) return json(res, 409, { erro: "a gaveta de hoje já foi aberta" });
      if (!(valor >= 0 && valor <= 5000)) return json(res, 400, { erro: "troco inicial inválido" });
      g.abertura = { valor, quando: Date.now(), auto: b.auto === true || undefined };
    } else if (b.acao === "troco") { // corrigir o troco inicial (ex.: abriu sozinha com o valor da última vez)
      if (!g.abertura || g.fechamento) return json(res, 409, { erro: "a gaveta não está aberta" });
      if (!(valor >= 0 && valor <= 5000)) return json(res, 400, { erro: "troco inicial inválido" });
      g.abertura.anterior = g.abertura.valor; g.abertura.valor = valor; g.abertura.ajustado = Date.now(); delete g.abertura.auto;
    } else if (b.acao === "movimento") {
      const motivo = String(b.motivo || "").trim().slice(0, 120);
      if (!g.abertura || g.fechamento) return json(res, 409, { erro: "abra a gaveta (ou ela já foi fechada)" });
      if (!["sangria", "suprimento"].includes(b.tipo) || !(valor > 0 && valor <= 20000) || motivo.length < 3) return json(res, 400, { erro: "informe tipo, valor e motivo" });
      const um = String(b.uid || "").slice(0, 80); if (um && g.movimentos.some((m) => m.uid === um)) return json(res, 200, gavetaDia(dia)); // clique duplo: não tira 2x
      const boy = b.tipo === "sangria" ? String(b.entregador || "").trim().slice(0, 40) : ""; // pagamento do motoboy: sai da gaveta e aparece no fechamento
      g.movimentos.push({ id: uid("m"), uid: um || undefined, tipo: b.tipo, valor, motivo, quando: Date.now(), ...(boy ? { categoria: "motoboy", entregador: boy } : {}) });
    } else if (b.acao === "fechar") {
      const contado = cents(b.contado);
      if (!g.abertura || g.fechamento) return json(res, 409, { erro: "a gaveta não está aberta" });
      if (!(contado >= 0 && contado <= 100000)) return json(res, 400, { erro: "valor contado inválido" });
      const esperado = gavetaDia(dia).esperado; g.fechamento = { contado, esperado, diferenca: cents(contado - esperado), quando: Date.now() };
    } else if (b.acao === "apagarMov") { // retirada/reforço digitado errado: apaga (só com a gaveta aberta)
      if (!g.abertura || g.fechamento) return json(res, 409, { erro: "reabra a gaveta pra apagar um movimento" });
      const i = g.movimentos.findIndex((m) => m.id === String(b.id || "")); if (i < 0) return json(res, 404, { erro: "movimento não encontrado" });
      g.movimentos.splice(i, 1);
    } else if (b.acao === "reabrir") { delete g.fechamento; }
    else return json(res, 400, { erro: "ação inválida" });
    await gravar(); return json(res, 200, gavetaDia(dia));
  }
  if (p === "/api/saude") { // para conferir se está tudo de pé
    const dirB = path.join(DIR_DADOS, "backups"), bs = fs.existsSync(dirB) ? fs.readdirSync(dirB).filter((a) => a.startsWith("pedidos-")).sort() : [];
    return json(res, 200, { ok: true, senhasPadrao: Object.keys(seg.padrao).length > 0, agora: Date.now(), pedidosHoje: db.pedidos.filter((x) => x.dia === hoje()).length, clientes: db.clientes.length, ultimoBackup: bs.length ? bs[bs.length - 1] : null,
      delivery: { ligado: delEstado.ativo, ultimaBusca: delEstado.ultimo, erro: delEstado.erro, importados: delEstado.importados, cardapio: delEstado.cardapio || null } });
  }
  if (p === "/api/backup") { // baixa uma cópia completa dos dados
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="backup-totem-' + hoje() + '.json"' });
    return res.end(JSON.stringify({ geradoEm: Date.now(), dados: db, config: cfg }));
  }
  if (p === "/api/config" && req.method === "GET") {
    // ?leve=1: sem logo e fotos (a balança, o garçom e o caixa só querem saber das bebidas: ~395 KB virava ~20 KB a cada minuto)
    if (url.searchParams.get("so") === "t") return json(res, 200, { t: (cfg && cfg.t) || 0 }); // o totem só quer saber se tem versão nova
    if (url.searchParams.get("leve")) { const d = {}; Object.entries((cfg && cfg.dados) || {}).forEach(([k, v]) => { if (!/^(logo|foto:)/.test(k)) d[k] = v; }); return json(res, 200, { t: cfg.t, dados: d }); }
    return json(res, 200, cfg);
  }
  if (p === "/api/config" && req.method === "PUT") {
    const b = await corpo(req, 12e6);
    if (!b || !b.t || !b.dados || typeof b.dados !== "object") return json(res, 400, { erro: "configuração inválida" });
    ["pin", "cfgT", "pedidos", "fila", "contador", "carrinho"].forEach((k) => delete b.dados[k]); // senha e dados de pedido nunca vão pra cópia
    cfg = { t: Number(b.t), dados: b.dados }; await gravarArquivo(ARQ_CFG, cfg); setTimeout(enviarCardapio, 500); // mudou no totem: o site acompanha em segundos
    return json(res, 200, { ok: true });
  }
  if (p === "/api/balanca" && req.method === "POST") {           // tablet da balança lança o valor na comanda
    const b = await corpo(req), dia = hoje(), num = Number(b.comanda), valor = cents(b.valor), peso = Math.round(Number(b.peso) || 0), nomeB = String(b.nome || "").slice(0, 60), cliente = String(b.cliente || "").trim().slice(0, 40), uidl = String(b.uid || "").slice(0, 80);
    if (b.soNome) { // dar nome a uma comanda, mesmo sem nenhum prato lançado (abre a comanda se ainda não existir)
      if (!Number.isInteger(num) || num < 1 || num > 9999 || !cliente) return json(res, 400, { erro: "informe o número da comanda e o nome" });
      let c = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === dia && x.numero === num && x.status === "aguardando");
      if (!c) { c = { id: Date.now() + "-c" + num, tipo: "balanca", dia, numero: num, nome: "", quando: Date.now(), itens: [], unidades: 0, valor: 0, status: "aguardando", pagamento: null, reservada: true }; db.pedidos.push(c); }
      c.nome = cliente; await gravar(); return json(res, 200, c);
    }
    const mAberta = num > 10000 && num <= 19999 && db.pedidos.some((x) => x.tipo === "balanca" && x.dia === dia && x.numero === num && x.status === "aguardando");
    if (!Number.isInteger(num) || num < 1 || (num > 9999 && !mAberta) || !(valor > 0 && valor <= (nomeB ? 300 : 2000)) || !(peso >= 0 && peso <= 30000)) return json(res, 400, { erro: "comanda, valor ou peso inválido" });
    let ped = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === dia && x.numero === num && x.status === "aguardando");
    if (uidl) { // reenvio do mesmo lançamento (Wi-Fi caiu na resposta): não soma 2x, nem abre comanda nova se a 1ª já foi paga
      const ja = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === dia && x.numero === num && x.itens.some((c) => c.uid === uidl));
      if (ja) return json(res, 200, ja);
    }
    if (!ped) { ped = { id: Date.now() + "-c" + num, tipo: "balanca", dia, numero: num, nome: "", quando: Date.now(), itens: [], unidades: 0, valor: 0, status: "aguardando", pagamento: null }; db.pedidos.push(ped); }
    ped.itens.push(nomeB ? { iid: uid("i"), qtd: 1, nome: nomeB, preco: valor, tipo: b.tipo === "doce" ? "doce" : "bebida", grupos: [], obs: "", hora: Date.now(), uid: uidl || undefined }
      : { iid: uid("i"), qtd: 1, nome: "Prato por quilo" + (peso ? " " + peso + " g" : "") + " (R$ " + valor.toFixed(2).replace(".", ",") + ")", preco: valor, peso: peso || undefined, grupos: [], obs: "", hora: Date.now(), uid: uidl || undefined });
    recalcComanda(ped); if (cliente) ped.nome = cliente; // nome da pessoa na comanda
    await gravar(); return json(res, 200, ped);
  }
  const m = p.match(/^\/api\/pedidos\/([^/]+)$/);
  if (m && req.method === "PATCH") {                             // caixa muda o estado do pedido
    const ped = db.pedidos.find((x) => x.id === m[1]);
    if (!ped) return json(res, 404, { erro: "pedido não encontrado" });
    const u = await corpo(req);
    // pedido com cupom fiscal ativo: estornar/cancelar só depois de cancelar o cupom na SEFAZ (senão a venda some e a nota continua valendo)
    if ((u.estornarPagamento !== undefined || u.estornarTudo || u.status === "cancelado") && ped.nfce && ped.nfce.status === "autorizada") return json(res, 409, { erro: "esse pedido tem cupom fiscal (nº " + ped.nfce.numero + "): cancele o cupom antes (botão Cancelar cupom)" });
    if (u.virarComanda) { u.paraComanda = 10000 + Number(ped.numero); u.criar = true; } // marmitex do totem vira comanda "M" (número 10000+pedido: nunca bate com cartão físico)
    if (u.entregador !== undefined) {                            // qual motoboy levou essa entrega (fechamento por motoboy)
      if (req.papel === "balanca") return json(res, 403, { erro: "sem permissão" });
      if (ped.tipo !== "delivery") return json(res, 409, { erro: "só pedido do site tem motoboy" });
      const nome = String(u.entregador || "").trim().slice(0, 30);
      if (nome) ped.entregador = nome; else delete ped.entregador;
      await gravar(); return json(res, 200, ped);
    }
    if (req.papel === "balanca" && u.removerItem === undefined && u.nome === undefined && u.paraComanda === undefined) return json(res, 403, { erro: "a balança só pode desfazer lançamentos, dar nome e pôr pedido do totem na comanda" });
    if (u.paraComanda !== undefined) {                           // pedido do totem ("pagar no caixa") entra numa comanda aberta: paga tudo junto no final
      const num = Number(u.paraComanda);
      if (!Number.isInteger(num) || num < 1 || (num > 9999 && !(u.virarComanda && num === 10000 + Number(ped.numero)))) return json(res, 400, { erro: "número de comanda inválido" });
      if (ped.tipo || ped.status !== "aguardando") return json(res, 409, { erro: "só pedido do totem em aberto pode ir pra uma comanda" });
      if (pagsDe(ped).length || ped.itens.some((c) => c.pago)) return json(res, 409, { erro: "esse pedido já tem pagamento: estorne antes de pôr na comanda" });
      const d = ped.dia || hoje();
      let cmd = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === d && x.numero === num && x.status === "aguardando");
      if (!cmd && u.criar !== true) return json(res, 404, { erro: "a comanda " + num + " não está aberta" });
      if (!cmd) { cmd = { id: Date.now() + "-c" + num, tipo: "balanca", dia: d, numero: num, nome: "", quando: Date.now(), itens: [], unidades: 0, valor: 0, status: "aguardando", pagamento: null }; db.pedidos.push(cmd); }
      if (!cmd.nome && ped.nome) cmd.nome = ped.nome; if (num > 10000) cmd.marmitex = true;
      const ref = " (#" + ped.numero + (ped.nome ? " " + ped.nome : "") + ")";
      ped.itens.forEach((c) => cmd.itens.push({ iid: uid("i"), qtd: c.qtd, nome: c.nome + ref, preco: c.preco, grupos: c.grupos, obs: c.obs, tipo: c.tipo, hora: Date.now(), origem: "totem", pedidoId: ped.id }));
      recalcComanda(cmd); ped.status = "comanda"; ped.comanda = num; ped.comandaId = cmd.id; ped.movido = Date.now();
      await gravar(); return json(res, 200, cmd);
    }
    if (u.nome !== undefined) {                                  // nome da pessoa na comanda
      if (ped.tipo !== "balanca" || ped.status !== "aguardando") return json(res, 409, { erro: "só comanda aberta pode ter o nome mudado" });
      ped.nome = String(u.nome).trim().slice(0, 40); await gravar(); return json(res, 200, ped);
    }
    if (u.removerItem !== undefined) {                           // balança desfaz um lançamento errado
      // removerIid (código do item) vale mais que a posição: se a comanda mudou nesse meio-tempo, a posição pode apontar pro item errado
      if (u.removerIid) { const k = ped.itens.findIndex((c) => c.iid === String(u.removerIid)); if (k < 0) return json(res, 409, { erro: "esse lançamento já não está mais na comanda" }); u.removerItem = k; }
      const i = u.removerItem;
      if (ped.tipo !== "balanca" || ped.status !== "aguardando") return json(res, 409, { erro: "só dá pra desfazer lançamento de comanda aberta da balança" });
      if (!Number.isInteger(i) || i < 0 || i >= ped.itens.length) return json(res, 400, { erro: "lançamento inexistente" });
      if (ped.itens[i].pago) return json(res, 409, { erro: "esse item já foi pago" });
      const orig = ped.itens[i].pedidoId ? db.pedidos.find((x) => x.id === ped.itens[i].pedidoId) : null;
      if (orig && orig.status === "comanda" && orig.movido) { // pedido que foi POSTO na comanda depois: tirar devolve ele inteiro pro caixa
        const dele = ped.itens.filter((c) => c.pedidoId === orig.id);
        if (dele.some((c) => c.pago)) return json(res, 409, { erro: "parte desse pedido já foi paga na comanda" });
        ped.itens = ped.itens.filter((c) => c.pedidoId !== orig.id); recalcComanda(ped);
        orig.status = "aguardando"; delete orig.comanda; delete orig.comandaId; delete orig.movido;
      } else {
        const [tirado] = ped.itens.splice(i, 1); recalcComanda(ped);
        if (tirado && tirado.pedidoId) { const t = db.pedidos.find((x) => x.id === tirado.pedidoId); if (t && t.status === "comanda") t.status = "cancelado"; } // tirou a marmitex da comanda: cancela o pedido do totem
      }
      fecharSePago(ped); if (!ped.itens.length && !ped.reservada) ped.status = "cancelado";
      await gravar(); return json(res, 200, ped);
    }
    if (u.dividirItem !== undefined) {                           // ✂ divide o valor de um item em 2 partes (paga uma, a outra vai pra conta de alguém)
      if (ped.status !== "aguardando") return json(res, 409, { erro: "só dá pra dividir item de pedido em aberto" });
      const c = ped.itens.find((x) => x.iid === String((u.dividirItem || {}).iid || "")); if (!c) return json(res, 409, { erro: "esse item já não está no pedido" });
      if (c.pago) return json(res, 409, { erro: "esse item já foi pago" });
      const v = cents(Number(u.dividirItem.valor)), un = cents(c.preco);
      if (!(v > 0 && v < un)) return json(res, 400, { erro: "o valor tem que ser maior que zero e menor que " + brl2(un) });
      let alvo = c, i = ped.itens.indexOf(c);
      if ((c.qtd || 1) > 1) { c.qtd--; alvo = { ...JSON.parse(JSON.stringify(c)), iid: uid("i"), qtd: 1 }; ped.itens.splice(++i, 0, alvo); } // várias unidades: separa 1 e divide ela
      const resto = { ...JSON.parse(JSON.stringify(alvo)), iid: uid("i"), preco: cents(un - v), nome: String(alvo.nome).slice(0, 70) + " (resto)" };
      alvo.preco = v; ped.itens.splice(i + 1, 0, resto);
      if (ped.tipo === "balanca") recalcComanda(ped); else { ped.valor = cents(ped.itens.reduce((t, x) => t + valorItem(x), 0)); ped.unidades = ped.itens.reduce((t, x) => t + (x.qtd || 1), 0); }
      (ped.divisoes = ped.divisoes || []).push({ de: un, partes: [v, resto.preco], quando: Date.now(), quem: req.papel });
      await gravar(); return json(res, 200, ped);
    }
    if (u.acertar !== undefined) {                               // acertar só alguns itens, cada um com a sua forma de pagamento
      const r = acertar(ped, u.acertar, u.recebido, req.papel); if (!r.ok) return json(res, r.s, { erro: r.erro });
      await gravar(); return json(res, 200, ped);
    }
    if (u.acertarValores !== undefined) {                        // pagar o que está em aberto com 2 formas, por valor
      const av = u.acertarValores || {}, todas = Array.isArray(av.partes) ? av.partes : [], pc = todas.filter((x) => x && x.forma === "conta");
      let conta = null;
      if (pc.length) { // uma das partes vai pra conta de um cliente
        const cli = pc.length === 1 && db.clientes.find((x) => x.id === String(pc[0].clienteId || "") && x.ativo !== false);
        if (!cli) return json(res, 400, { erro: "escolha de quem é a conta" });
        conta = { cli, valor: cents(Number(pc[0].valor)) };
      }
      const r = acertarValores(ped, todas.filter((x) => !(x && x.forma === "conta")), av.recebido, req.papel, conta); if (!r.ok) return json(res, r.s, { erro: r.erro });
      await gravar(); return json(res, 200, ped);
    }
    if (u.estornarPagamento !== undefined) {                     // desfaz UM recebimento (os itens voltam a ficar em aberto)
      const g = (ped.pagamentos || []).find((x) => x.id === u.estornarPagamento), mot = String(u.motivo || "").trim();
      if (!g || g.estornado || ped.status === "cancelado") return json(res, 404, { erro: "recebimento não encontrado" });
      if (ped.status === "conta") return json(res, 409, { erro: "esse pedido está na conta: desfaça a conta antes de estornar um recebimento" });
      if (mot.length < 3) return json(res, 400, { erro: "informe o motivo do estorno" });
      const juntos = g.dividido ? ped.pagamentos.filter((x) => x.dividido === g.dividido && !x.estornado) : [g]; // pago em 2 formas: estorna as duas partes
      juntos.forEach((x) => { x.estornado = { motivo: mot.slice(0, 200), quando: Date.now() }; x.itens.forEach((iid) => { const c = ped.itens.find((i) => i.iid === iid); if (c) delete c.pago; }); });
      if (ped.status === "pago") { ped.status = "aguardando"; delete ped.pagoEm; ped.pagamento = null; }
      await gravar(); return json(res, 200, ped);
    }
    if (u.estornarTudo) {                                        // estorna TODOS os recebimentos: o pedido volta pro "em aberto" (não cancela)
      const mot = String(u.motivo || "").trim(), vivos = (ped.pagamentos || []).filter((x) => !x.estornado);
      if (ped.status === "cancelado" || ped.status === "conta") return json(res, 409, { erro: ped.status === "conta" ? "esse pedido está na conta: desfaça a conta antes de estornar" : "pedido cancelado" });
      if (!vivos.length && ped.status !== "pago") return json(res, 409, { erro: "esse pedido não tem pagamento pra estornar" });
      if (mot.length < 3) return json(res, 400, { erro: "informe o motivo do estorno" });
      const est = { motivo: mot.slice(0, 200), quando: Date.now() };
      vivos.forEach((x) => { x.estornado = est; });
      if (!(ped.pagamentos || []).length) ped.estorno = est; // pedido antigo, pago sem a lista de recebimentos
      ped.itens.forEach((c) => { delete c.pago; });
      ped.status = "aguardando"; delete ped.pagoEm; ped.pagamento = null;
      await gravar(); return json(res, 200, ped);
    }
    const novo = String(u.status || "");
    if (!novo) return json(res, 400, { erro: "nada a alterar" });
    if (novo === ped.status && novo !== "conta") return json(res, 409, { erro: "o pedido já está " + novo });
    if (novo !== ped.status && !(TRANS[ped.status] || []).includes(novo)) return json(res, 409, { erro: "não dá pra mudar de " + ped.status + " para " + novo });
    const tiraDaConta = () => { db.lancamentos = db.lancamentos.filter((l) => l.pedidoId !== ped.id); };
    const pagas = (ped.pagamentos || []).filter((g) => !g.estornado);
    if (novo === "conta") {                                      // marcar o pedido na conta de um cliente
      const abertos = ped.itens.filter((c) => !c.pago); let grupos = null; // grupos = { clienteId: [itens] } quando a comanda é dividida entre pessoas
      if (Array.isArray(u.divisao) && u.divisao.length) {
        grupos = {}; const vistos = new Set();
        for (const x of u.divisao) {
          const it = abertos.find((c) => c.iid === (x && x.iid)), cl = db.clientes.find((y) => y.id === (x && x.clienteId) && y.ativo !== false);
          if (!it || !cl || vistos.has(it.iid)) return json(res, 400, { erro: "divisão inválida (item ou cliente inexistente)" });
          vistos.add(it.iid); (grupos[cl.id] = grupos[cl.id] || []).push(it);
        }
        if (vistos.size !== abertos.length) return json(res, 400, { erro: "atribua todos os itens a um cliente" });
      }
      const cli = grupos ? db.clientes.find((x) => x.id === Object.keys(grupos)[0]) : db.clientes.find((x) => x.id === u.clienteId && x.ativo !== false);
      if (!cli) return json(res, 400, { erro: "cliente inexistente ou arquivado" });
      // marmita do robô que chegou em R$0 (o cliente ainda não tinha conta quando pediu): vale o valor da refeição de quem leva
      const donoDe = (c) => (grupos ? db.clientes.find((y) => (grupos[y.id] || []).includes(c)) : cli) || {};
      let mudouPreco = false;
      const digitado = Number(u.precoMarmita) > 0 && Number(u.precoMarmita) <= 1000 ? cents(Number(u.precoMarmita)) : 0; // cliente sem valor de refeição: o caixa digita
      abertos.forEach((c) => { const v = cents(Number(donoDe(c).valorRefeicao) || 0) || digitado; if (/^marmita$/i.test(c.nome) && !(c.preco > 0) && v > 0) { c.preco = v; mudouPreco = true; } });
      if (mudouPreco) ped.valor = cents(ped.itens.reduce((t, c) => t + valorItem(c), 0));
      const resto = cents(ped.itens.filter((c) => !c.pago).reduce((t, c) => t + valorItem(c), 0)), jaPago = cents(pagas.reduce((t, g) => t + g.valor, 0)); // recebimento parcial: só o que falta vai pra conta
      if (!(resto > 0)) return json(res, 409, { erro: "não sobrou nada em aberto pra marcar na conta" });
      ped.status = "conta"; ped.clienteId = cli.id; ped.clienteIds = grupos ? Object.keys(grupos) : [cli.id]; ped.pagamento = "conta"; tiraDaConta();
      const rotP = ped.tipo === "delivery" ? "Delivery D" + ped.numero : ped.tipo !== "balanca" ? "Pedido #" + ped.numero : ped.numero > 10000 ? "Marmitex M" + (ped.numero - 10000) : "Comanda " + ped.numero, pagoTxt = jaPago > 0 ? " (resto - já pago R$" + jaPago.toFixed(2).replace(".", ",") + ")" : "";
      if (grupos) Object.entries(grupos).forEach(([cid, its]) => db.lancamentos.push({ id: uid("l"), clienteId: cid, dia: ped.dia, qtd: 0, valor: cents(its.reduce((t, c) => t + valorItem(c), 0)), obs: rotP + (Object.keys(grupos).length > 1 ? " (dividida)" : "") + pagoTxt, pedidoId: ped.id, itensIds: its.map((c) => c.iid) })); // um lançamento por pessoa
      else db.lancamentos.push({ id: uid("l"), clienteId: cli.id, dia: ped.dia, qtd: 0, valor: resto, obs: rotP + pagoTxt, pedidoId: ped.id, itensIds: abertos.map((c) => c.iid) });
    } else if (novo === "pago") {                                // jeito simples: paga tudo que falta com uma forma só
      const forma = String(u.pagamento || "");
      if (!FORMAS_VALIDAS.includes(forma)) return json(res, 400, { erro: "forma de pagamento inválida" });
      const r = acertar(ped, ped.itens.filter((c) => !c.pago).map((c) => ({ iid: c.iid, forma })), u.recebido, req.papel); if (!r.ok) return json(res, r.s, { erro: r.erro });
    } else if (novo === "cancelado") {
      if (ped.status === "pago" || pagas.length) { const mot = String(u.motivo || "").trim(); if (mot.length < 3) return json(res, 400, { erro: "informe o motivo do estorno" }); ped.estorno = { motivo: mot.slice(0, 200), quando: Date.now() }; pagas.forEach((g) => { g.estornado = { motivo: mot.slice(0, 200), quando: Date.now() }; }); }
      ped.status = "cancelado"; tiraDaConta();
    } else if (novo === "aguardando") { ped.status = "aguardando"; ped.clienteId = null; delete ped.clienteIds; ped.pagamento = null; tiraDaConta(); desfazContaParcial(ped); }
    else return json(res, 400, { erro: "status inválido" });
    await gravar(); return json(res, 200, ped);
  }
  const alvo = p === "/" ? "/index.html" : p, nome = path.basename(alvo), ext = path.extname(alvo).toLowerCase(), arq = path.resolve(PUB, "." + alvo);
  const liberado = tipos[ext] && (ext !== ".json" || nome.startsWith("manifest")) && nome !== "server.js" && nome !== "testes.js" && nome !== "fiscal.js" && !nome.startsWith(".") && arq.startsWith(PUB + path.sep) && !arq.startsWith(DIR_DADOS + path.sep);
  if (!liberado) { res.writeHead(403); return res.end(); }
  fs.readFile(arq, (e, data) => {
    if (e) { res.writeHead(404); return res.end("Nao encontrado"); }
    const ext2 = path.extname(arq).toLowerCase(); // html/js/css: o tablet sempre confere se tem versão nova (antes o app guardava o arquivo velho e a mudança não aparecia)
    res.writeHead(200, { "Content-Type": tipos[ext2] || "application/octet-stream", ...([".html", ".js", ".css", ".json"].includes(ext2) ? { "Cache-Control": "no-cache" } : {}) }); res.end(data);
  });
}
http.createServer((req, res) => tratar(req, res).catch((e) => {
  if (!e.status) console.error(e);
  if (!res.headersSent) json(res, e.status || 500, { erro: e.status ? e.message : "erro interno" }); else res.end();
})).listen(PORTA, "0.0.0.0", () => {
  console.log("Servidor no ar! Abra no tablet/caixa (mesmo wifi):");
  if (Object.keys(seg.padrao).length) console.log("  ATENCAO: ainda usa senha padrao em: " + Object.keys(seg.padrao).join(", ") + ". Troque em Admin > Ajustes > Seguranca e uso.");
  Object.values(os.networkInterfaces()).flat().filter((i) => i.family === "IPv4" && !i.internal)
    .forEach((i) => console.log(`  Totem:   http://${i.address}:${PORTA}\n  Caixa:   http://${i.address}:${PORTA}/caixa.html\n  Balança: http://${i.address}:${PORTA}/balanca.html`));
});
