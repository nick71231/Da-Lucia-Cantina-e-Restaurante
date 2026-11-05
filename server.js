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
function acertar(ped, sel, recebido, papel) { // sel = [{ iid, forma }]: cada item escolhido com a sua forma de pagamento
  if (ped.status !== "aguardando") return { s: 409, erro: "o pedido não está em aberto" };
  if (!Array.isArray(sel) || !sel.length || sel.length > 80) return { s: 400, erro: "escolha pelo menos um item" };
  const grupos = {}, vistos = new Set();
  for (const x of sel) {
    const c = ped.itens.find((i) => i.iid === (x && x.iid));
    if (!c || vistos.has(c.iid)) return { s: 400, erro: "item inválido" };
    if (c.pago) return { s: 409, erro: "um dos itens já foi pago" };
    if (!["dinheiro", "pix", "cartao"].includes(x.forma)) return { s: 400, erro: "forma de pagamento inválida" };
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
const TRANS = { aguardando: ["pago", "conta", "cancelado"], conta: ["aguardando", "cancelado"], pago: ["cancelado"], cancelado: [] }; // mudanças de estado permitidas
let db = { pedidos: [] };
try { db = JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch (e) {}
db.pedidos = db.pedidos || []; db.caixa = db.caixa || {};
db.clientes = db.clientes || []; db.lancamentos = db.lancamentos || []; db.pagamentos = db.pagamentos || []; db.enviados = db.enviados || {};
db.pedidos.forEach((p) => (p.itens || []).forEach((c) => { c.grupos = c.grupos || []; })); // dados antigos: todo item tem "grupos"
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
db.pedidos.forEach((p) => (p.itens || []).forEach((c) => { c.iid = c.iid || uid("i"); })); // dados antigos: todo item tem identificador
// "conta" = a empresa (quando o cliente tem empresa, ela paga por todos) ou o próprio cliente
const chaveDe = (id) => { const c = db.clientes.find((x) => x.id === id); return c && c.empresa ? "e:" + c.empresa : "c:" + id; };
db.pagamentos.forEach((x) => { if (!x.chave && x.clienteId) x.chave = chaveDe(x.clienteId); });
Object.keys(db.enviados).forEach((k) => { const [m, id] = [k.slice(0, 7), k.slice(8)]; if (!/^[ce]:/.test(id)) { delete db.enviados[k]; db.enviados[m + "|" + chaveDe(id)] = true; } });
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
const gravar = () => gravarArquivo(ARQ, db);
// ---------- senhas e sessões (3 níveis: balança < caixa < admin) ----------
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
  if (p === "/api/config" || p === "/api/senhas") return 3;
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
      try { fs.mkdirSync(process.env.BACKUP_EXTRA, { recursive: true }); ["pedidos-", "config-"].forEach((pre) => fs.copyFileSync(path.join(dir, pre + dia + ".json"), path.join(process.env.BACKUP_EXTRA, pre + dia + ".json"))); }
      catch (e) { console.error("cópia extra do backup falhou:", e.message); }
    }
    ["pedidos-", "config-"].forEach((pre) => fs.readdirSync(dir).filter((a) => a.startsWith(pre)).sort().slice(0, -30).forEach((a) => fs.unlinkSync(path.join(dir, a))));
  } catch (e) { console.error("backup falhou:", e.message); }
}
const hoje = () => new Date().toLocaleDateString("en-CA");
const tipos = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png",
  ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml" };
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
    return { iid: uid("i"), key: String(c.key || "").slice(0, 400), tipo: c.tipo === "bebida" ? "bebida" : undefined, nome: String(c.nome || "").slice(0, 80), preco: cents(preco), qtd, obs: String(c.obs || "").slice(0, 120),
      grupos: (Array.isArray(c.grupos) ? c.grupos : []).slice(0, 15).map((g) => ({ rotulo: String(g.rotulo || "").slice(0, 40), itens: (Array.isArray(g.itens) ? g.itens : []).slice(0, 20).map((x) => String(x).slice(0, 80)) })) };
  });
  const valor = cents(itens.reduce((s, c) => s + c.preco * c.qtd, 0)); if (valor > 5000) throw erro400("valor muito alto");
  return { itens, valor, unidades: itens.reduce((s, c) => s + c.qtd, 0), nome: String(b.nome || "").slice(0, 40), dia: /^\d{4}-\d\d-\d\d$/.test(b.dia || "") ? b.dia : hoje(), quando: Number(b.quando) || Date.now() };
}
backup(); setInterval(backup, 6 * 3600 * 1000);

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
    const dia = url.searchParams.get("dia");
    return json(res, 200, dia ? db.pedidos.filter((x) => x.dia === dia) : db.pedidos);
  }
  if (p === "/api/pedidos" && req.method === "POST") {           // totem manda o pedido
    const b = await corpo(req), base = limparPedido(b), uidp = String(b.uid || "").slice(0, 80), com = b.comanda ? Number(b.comanda) : 0;
    if (com && (!Number.isInteger(com) || com < 1 || com > 9999)) return json(res, 400, { erro: "número de comanda inválido" });
    if (uidp) { const ja = db.pedidos.find((x) => x.uid === uidp); if (ja) return json(res, 200, ja); } // mesmo pedido reenviado: não duplica
    const numero = Math.max(0, ...db.pedidos.filter((x) => x.dia === base.dia && x.tipo !== "balanca").map((x) => x.numero)) + 1; // quem dá o número é o servidor
    const novo = { ...base, uid: uidp || undefined, numero, numeroLocal: Number(b.numero) || undefined, id: Date.now() + "-" + numero, status: com ? "comanda" : "aguardando", pagamento: null, comanda: com || undefined };
    if (com) { // entra na comanda aberta (se ainda não existir, abre uma); quem paga é o caixa, tudo junto
      let cmd = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === base.dia && x.numero === com && x.status === "aguardando");
      if (!cmd) { cmd = { id: Date.now() + "-c" + com, tipo: "balanca", dia: base.dia, numero: com, nome: "", quando: Date.now(), itens: [], unidades: 0, valor: 0, status: "aguardando", pagamento: null }; db.pedidos.push(cmd); }
      if (!cmd.nome && base.nome) cmd.nome = base.nome; // a comanda ganha o nome de quem pediu a marmitex
      base.itens.forEach((c) => cmd.itens.push({ iid: uid("i"), qtd: c.qtd, nome: c.nome + (base.nome ? " (" + base.nome + ")" : ""), preco: c.preco, grupos: c.grupos, obs: c.obs, tipo: c.tipo, hora: Date.now(), origem: "totem", pedidoId: novo.id }));
      recalcComanda(cmd); novo.comandaId = cmd.id;
    }
    db.pedidos.push(novo); await gravar(); return json(res, 200, novo);
  }
  if (p === "/api/clientes" && req.method === "GET") return json(res, 200, db.clientes);
  if (p === "/api/clientes" && req.method === "POST") {
    const b = await corpo(req); if (!String(b.nome || "").trim()) return json(res, 400, { erro: "nome" });
    const c = { id: uid("c"), nome: String(b.nome).trim(), empresa: String(b.empresa || "").trim(), modo: b.modo === "refeicao" ? "refeicao" : "valor", valorRefeicao: Number(b.valorRefeicao) || 0, telefone: String(b.telefone || "").trim(), pagamento: b.pagamento === "depois" ? "depois" : "antecipado", ativo: true };
    db.clientes.push(c); await gravar(); return json(res, 200, c);
  }
  const mc = p.match(/^\/api\/clientes\/([^/]+)$/);
  if (mc && req.method === "PUT") {
    const c = db.clientes.find((x) => x.id === mc[1]); if (!c) return json(res, 404, { erro: "nao achei" });
    const b = await corpo(req);
    ["nome", "empresa", "telefone"].forEach((k) => { if (b[k] !== undefined) c[k] = String(b[k]).trim(); });
    if (b.modo) c.modo = b.modo === "refeicao" ? "refeicao" : "valor";
    if (b.valorRefeicao !== undefined) c.valorRefeicao = Number(b.valorRefeicao) || 0;
    if (b.pagamento) c.pagamento = b.pagamento === "depois" ? "depois" : "antecipado";
    if (b.ativo !== undefined) c.ativo = !!b.ativo;
    await gravar(); return json(res, 200, c);
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
    const b = await corpo(req), l = { id: uid("l"), clienteId: String(b.clienteId || ""), dia: String(b.dia || ""), qtd: Number(b.qtd) || 0, valor: cents(b.valor), obs: String(b.obs || "").slice(0, 120) };
    const cli = db.clientes.find((x) => x.id === l.clienteId && x.ativo !== false);
    if (!cli || !/^\d{4}-\d\d-\d\d$/.test(l.dia) || !(l.valor > 0 && l.valor <= 5000) || !(l.qtd >= 0 && l.qtd <= 99)) return json(res, 400, { erro: "dados inválidos (cliente, dia ou valor)" });
    db.lancamentos.push(l); await gravar(); return json(res, 200, l);
  }
  const ml = p.match(/^\/api\/lancamentos\/([^/]+)$/);
  if (ml && req.method === "DELETE") { db.lancamentos = db.lancamentos.filter((x) => x.id !== ml[1]); await gravar(); return json(res, 200, { ok: true }); }
  if (p === "/api/pagamentos" && req.method === "POST") {
    const b = await corpo(req), x = { id: uid("p"), chave: String(b.chave || ""), mes: String(b.mes || ""), valor: cents(b.valor), refeicoes: Number(b.refeicoes) || 0, forma: String(b.forma || ""), data: String(b.data || hoje()), obs: String(b.obs || "").slice(0, 200) };
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
    const b = await corpo(req, 64e3), dados = Buffer.from(String(b.dados || ""), "base64"); // o IP vem da configuração salva pelo admin, nunca do pedido
    let imp = {}; try { imp = JSON.parse((cfg.dados && cfg.dados.impCfg) || "{}"); } catch (e) {}
    const ip = String(imp.ip || ""), porta = Number(imp.porta) || 9100;
    if (!ip) return json(res, 400, { erro: "impressora não configurada (Admin → Impressão → IP)" });
    if (!/^(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})$/.test(ip)) return json(res, 400, { erro: "IP inválido (use o IP da impressora na sua rede)" });
    if (!dados.length) return json(res, 400, { erro: "nada pra imprimir" });
    if (dados.length > 20000 || dados[0] !== 0x1b || dados[1] !== 0x40) return json(res, 400, { erro: "conteúdo de impressão inválido" }); // comanda de verdade começa com ESC @ e é pequena
    const ipc = req.socket.remoteAddress, agoraI = Date.now(); impressoes[ipc] = (impressoes[ipc] || []).filter((x) => agoraI - x < 60000);
    if (impressoes[ipc].length >= 30) return json(res, 429, { erro: "muitas impressões em pouco tempo" }); impressoes[ipc].push(agoraI);
    return new Promise((ok) => {
      let fim = false; const f = (code, o) => { if (!fim) { fim = true; ok(json(res, code, o)); } };
      const s = net.connect({ host: ip, port: porta, timeout: 5000 }, () => s.end(dados));
      s.on("close", () => f(200, { ok: true }));
      s.on("timeout", () => { s.destroy(); f(504, { erro: "a impressora não respondeu" }); });
      s.on("error", (e) => f(502, { erro: "não consegui falar com a impressora (" + e.code + ")" }));
    });
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
  if (p === "/api/gaveta" && req.method === "GET") return json(res, 200, gavetaDia(url.searchParams.get("dia") || hoje()));
  if (p === "/api/gaveta" && req.method === "POST") {
    const b = await corpo(req), dia = hoje(), g = (db.caixa[dia] = db.caixa[dia] || { movimentos: [] }), valor = cents(b.valor);
    if (b.acao === "abrir") {
      if (g.abertura) return json(res, 409, { erro: "a gaveta de hoje já foi aberta" });
      if (!(valor >= 0 && valor <= 5000)) return json(res, 400, { erro: "troco inicial inválido" });
      g.abertura = { valor, quando: Date.now() };
    } else if (b.acao === "movimento") {
      const motivo = String(b.motivo || "").trim().slice(0, 120);
      if (!g.abertura || g.fechamento) return json(res, 409, { erro: "abra a gaveta (ou ela já foi fechada)" });
      if (!["sangria", "suprimento"].includes(b.tipo) || !(valor > 0 && valor <= 20000) || motivo.length < 3) return json(res, 400, { erro: "informe tipo, valor e motivo" });
      g.movimentos.push({ id: uid("m"), tipo: b.tipo, valor, motivo, quando: Date.now() });
    } else if (b.acao === "fechar") {
      const contado = cents(b.contado);
      if (!g.abertura || g.fechamento) return json(res, 409, { erro: "a gaveta não está aberta" });
      if (!(contado >= 0 && contado <= 100000)) return json(res, 400, { erro: "valor contado inválido" });
      const esperado = gavetaDia(dia).esperado; g.fechamento = { contado, esperado, diferenca: cents(contado - esperado), quando: Date.now() };
    } else if (b.acao === "reabrir") { delete g.fechamento; }
    else return json(res, 400, { erro: "ação inválida" });
    await gravar(); return json(res, 200, gavetaDia(dia));
  }
  if (p === "/api/saude") { // para conferir se está tudo de pé
    const dirB = path.join(DIR_DADOS, "backups"), bs = fs.existsSync(dirB) ? fs.readdirSync(dirB).filter((a) => a.startsWith("pedidos-")).sort() : [];
    return json(res, 200, { ok: true, senhasPadrao: Object.keys(seg.padrao).length > 0, agora: Date.now(), pedidosHoje: db.pedidos.filter((x) => x.dia === hoje()).length, clientes: db.clientes.length, ultimoBackup: bs.length ? bs[bs.length - 1] : null });
  }
  if (p === "/api/backup") { // baixa uma cópia completa dos dados
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="backup-totem-' + hoje() + '.json"' });
    return res.end(JSON.stringify({ geradoEm: Date.now(), dados: db, config: cfg }));
  }
  if (p === "/api/config" && req.method === "GET") return json(res, 200, cfg);
  if (p === "/api/config" && req.method === "PUT") {
    const b = await corpo(req, 12e6);
    if (!b || !b.t || !b.dados || typeof b.dados !== "object") return json(res, 400, { erro: "configuração inválida" });
    ["pin", "cfgT", "pedidos", "fila", "contador", "carrinho"].forEach((k) => delete b.dados[k]); // senha e dados de pedido nunca vão pra cópia
    cfg = { t: Number(b.t), dados: b.dados }; await gravarArquivo(ARQ_CFG, cfg); return json(res, 200, { ok: true });
  }
  if (p === "/api/balanca" && req.method === "POST") {           // tablet da balança lança o valor na comanda
    const b = await corpo(req), dia = hoje(), num = Number(b.comanda), valor = cents(b.valor), peso = Math.round(Number(b.peso) || 0), nomeB = String(b.nome || "").slice(0, 60), cliente = String(b.cliente || "").trim().slice(0, 40), uidl = String(b.uid || "").slice(0, 80);
    if (!Number.isInteger(num) || num < 1 || num > 9999 || !(valor > 0 && valor <= (nomeB ? 300 : 2000)) || !(peso >= 0 && peso <= 30000)) return json(res, 400, { erro: "comanda, valor ou peso inválido" });
    let ped = db.pedidos.find((x) => x.tipo === "balanca" && x.dia === dia && x.numero === num && x.status === "aguardando");
    if (ped && uidl && ped.itens.some((c) => c.uid === uidl)) return json(res, 200, ped); // reenvio do mesmo lançamento: não soma duas vezes
    if (!ped) { ped = { id: Date.now() + "-c" + num, tipo: "balanca", dia, numero: num, nome: "", quando: Date.now(), itens: [], unidades: 0, valor: 0, status: "aguardando", pagamento: null }; db.pedidos.push(ped); }
    ped.itens.push(nomeB ? { iid: uid("i"), qtd: 1, nome: nomeB, preco: valor, tipo: "bebida", grupos: [], obs: "", hora: Date.now(), uid: uidl || undefined }
      : { iid: uid("i"), qtd: 1, nome: "Prato por quilo" + (peso ? " " + peso + " g" : "") + " (R$ " + valor.toFixed(2).replace(".", ",") + ")", preco: valor, peso: peso || undefined, grupos: [], obs: "", hora: Date.now(), uid: uidl || undefined });
    recalcComanda(ped); if (cliente) ped.nome = cliente; // nome da pessoa na comanda
    await gravar(); return json(res, 200, ped);
  }
  const m = p.match(/^\/api\/pedidos\/([^/]+)$/);
  if (m && req.method === "PATCH") {                             // caixa muda o estado do pedido
    const ped = db.pedidos.find((x) => x.id === m[1]);
    if (!ped) return json(res, 404, { erro: "pedido não encontrado" });
    const u = await corpo(req);
    if (req.papel === "balanca" && u.removerItem === undefined && u.nome === undefined) return json(res, 403, { erro: "a balança só pode desfazer lançamentos e dar nome à comanda" });
    if (u.nome !== undefined) {                                  // nome da pessoa na comanda
      if (ped.tipo !== "balanca" || ped.status !== "aguardando") return json(res, 409, { erro: "só comanda aberta pode ter o nome mudado" });
      ped.nome = String(u.nome).trim().slice(0, 40); await gravar(); return json(res, 200, ped);
    }
    if (u.removerItem !== undefined) {                           // balança desfaz um lançamento errado
      const i = u.removerItem;
      if (ped.tipo !== "balanca" || ped.status !== "aguardando") return json(res, 409, { erro: "só dá pra desfazer lançamento de comanda aberta da balança" });
      if (!Number.isInteger(i) || i < 0 || i >= ped.itens.length) return json(res, 400, { erro: "lançamento inexistente" });
      if (ped.itens[i].pago) return json(res, 409, { erro: "esse item já foi pago" });
      const [tirado] = ped.itens.splice(i, 1); recalcComanda(ped);
      if (tirado && tirado.pedidoId) { const t = db.pedidos.find((x) => x.id === tirado.pedidoId); if (t && t.status === "comanda") t.status = "cancelado"; } // tirou a marmitex da comanda: cancela o pedido do totem
      fecharSePago(ped); if (!ped.itens.length) ped.status = "cancelado";
      await gravar(); return json(res, 200, ped);
    }
    if (u.acertar !== undefined) {                               // acertar só alguns itens, cada um com a sua forma de pagamento
      const r = acertar(ped, u.acertar, u.recebido, req.papel); if (!r.ok) return json(res, r.s, { erro: r.erro });
      await gravar(); return json(res, 200, ped);
    }
    if (u.estornarPagamento !== undefined) {                     // desfaz UM recebimento (os itens voltam a ficar em aberto)
      const g = (ped.pagamentos || []).find((x) => x.id === u.estornarPagamento), mot = String(u.motivo || "").trim();
      if (!g || g.estornado || ped.status === "cancelado") return json(res, 404, { erro: "recebimento não encontrado" });
      if (mot.length < 3) return json(res, 400, { erro: "informe o motivo do estorno" });
      g.estornado = { motivo: mot.slice(0, 200), quando: Date.now() };
      g.itens.forEach((iid) => { const c = ped.itens.find((i) => i.iid === iid); if (c) delete c.pago; });
      if (ped.status === "pago") { ped.status = "aguardando"; delete ped.pagoEm; ped.pagamento = null; }
      await gravar(); return json(res, 200, ped);
    }
    const novo = String(u.status || "");
    if (!novo) return json(res, 400, { erro: "nada a alterar" });
    if (novo === ped.status && novo !== "conta") return json(res, 409, { erro: "o pedido já está " + novo });
    if (novo !== ped.status && !(TRANS[ped.status] || []).includes(novo)) return json(res, 409, { erro: "não dá pra mudar de " + ped.status + " para " + novo });
    const tiraDaConta = () => { db.lancamentos = db.lancamentos.filter((l) => l.pedidoId !== ped.id); };
    const pagas = (ped.pagamentos || []).filter((g) => !g.estornado);
    if (novo === "conta") {                                      // marcar o pedido na conta de um cliente
      if (pagas.length) return json(res, 409, { erro: "esse pedido já tem recebimento parcial: termine de acertar ou estorne" });
      const cli = db.clientes.find((x) => x.id === u.clienteId && x.ativo !== false);
      if (!cli) return json(res, 400, { erro: "cliente inexistente ou arquivado" });
      ped.status = "conta"; ped.clienteId = cli.id; ped.pagamento = "conta"; tiraDaConta();
      db.lancamentos.push({ id: uid("l"), clienteId: cli.id, dia: ped.dia, qtd: 0, valor: ped.valor, obs: (ped.tipo === "balanca" ? "Comanda " : "Pedido #") + ped.numero, pedidoId: ped.id });
    } else if (novo === "pago") {                                // jeito simples: paga tudo que falta com uma forma só
      const forma = String(u.pagamento || "");
      if (!["dinheiro", "pix", "cartao"].includes(forma)) return json(res, 400, { erro: "forma de pagamento inválida" });
      const r = acertar(ped, ped.itens.filter((c) => !c.pago).map((c) => ({ iid: c.iid, forma })), u.recebido, req.papel); if (!r.ok) return json(res, r.s, { erro: r.erro });
    } else if (novo === "cancelado") {
      if (ped.status === "pago" || pagas.length) { const mot = String(u.motivo || "").trim(); if (mot.length < 3) return json(res, 400, { erro: "informe o motivo do estorno" }); ped.estorno = { motivo: mot.slice(0, 200), quando: Date.now() }; pagas.forEach((g) => { g.estornado = { motivo: mot.slice(0, 200), quando: Date.now() }; }); }
      ped.status = "cancelado"; tiraDaConta();
    } else if (novo === "aguardando") { ped.status = "aguardando"; ped.clienteId = null; ped.pagamento = null; tiraDaConta(); }
    else return json(res, 400, { erro: "status inválido" });
    await gravar(); return json(res, 200, ped);
  }
  const alvo = p === "/" ? "/index.html" : p, nome = path.basename(alvo), ext = path.extname(alvo).toLowerCase(), arq = path.resolve(PUB, "." + alvo);
  const liberado = tipos[ext] && (ext !== ".json" || nome.startsWith("manifest")) && nome !== "server.js" && nome !== "testes.js" && !nome.startsWith(".") && arq.startsWith(PUB + path.sep) && !arq.startsWith(DIR_DADOS + path.sep);
  if (!liberado) { res.writeHead(403); return res.end(); }
  fs.readFile(arq, (e, data) => {
    if (e) { res.writeHead(404); return res.end("Nao encontrado"); }
    res.writeHead(200, { "Content-Type": tipos[path.extname(arq).toLowerCase()] || "application/octet-stream" }); res.end(data);
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
