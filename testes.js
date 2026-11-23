// Testes automáticos do servidor. Rodar:  node testes.js
// Sobe um servidor de teste numa porta e pasta temporárias (NÃO mexe nos seus dados reais).
const { spawn } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const { restaurar } = require("./restaurar");
const PORTA = 3999, B = "http://localhost:" + PORTA, dir = fs.mkdtempSync(path.join(os.tmpdir(), "totem-teste-"));
let ok = 0, falhas = 0; const extras = [];
const t = (cond, nome) => { cond ? ok++ : falhas++; console.log((cond ? "  ok    " : "  FALHOU ") + nome); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let TOKEN = "";
const reqEm = async (base, m, u, body, tok = TOKEN) => { const r = await fetch(base + u, { method: m, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; };
const req = (m, u, body, tok) => reqEm(B, m, u, body, tok);
const hoje = new Date().toLocaleDateString("en-CA");

// sobe um servidor de teste: porta e pasta SÓ dele, e sem cópia extra de backup (nunca encosta nos dados reais)
function sobe(porta, pasta, extra = {}) {
  const srv = spawn(process.execPath, ["server.js"], { cwd: __dirname, env: { ...process.env, PORTA: String(porta), DADOS_DIR: pasta, BACKUP_EXTRA: "", ...extra } });
  let saida = ""; srv.stdout.on("data", (d) => (saida += d)); srv.stderr.on("data", (d) => (saida += d)); extras.push(srv);
  const pronto = new Promise((res, rej) => { const i = setInterval(() => { if (saida.includes("Servidor no ar")) { clearInterval(i); res(); } }, 100); setTimeout(() => { clearInterval(i); rej(new Error("servidor não subiu: " + saida)); }, 8000); });
  return { srv, pronto, base: "http://localhost:" + porta };
}
const principal = sobe(PORTA, dir), srv = principal.srv, espera = () => principal.pronto;

(async () => {
  await espera();
  TOKEN = (await req("POST", "/api/login", { role: "admin", pin: "12345" }, "")).j.token; t(!!TOKEN, "login do admin com a senha padrão");
  const saude0 = (await req("GET", "/api/saude", undefined, "")).j;
  t(saude0.pedidosHoje === 0 && saude0.clientes === 0, "o servidor de teste começa limpo (sem dados antigos da pasta do projeto)");
  console.log("\nPedidos");
  t((await req("POST", "/api/pedidos", "{ruim")).s === 400, "JSON inválido é recusado");
  const P = { uid: "u1", nome: "Teste", itens: [{ nome: "Marmitex", preco: 22, qtd: 2, grupos: [{ rotulo: "Arroz", itens: ["Branco"] }] }], valor: 1 };
  const a = await req("POST", "/api/pedidos", P), a2 = await req("POST", "/api/pedidos", P);
  t(a.s === 200 && a.j.valor === 44, "servidor recalcula o total (44, não o 1 enviado)");
  t(a2.j.id === a.j.id, "mesmo pedido reenviado não duplica");
  t((await req("POST", "/api/pedidos", { uid: "u2", itens: [{ nome: "x", preco: -5, qtd: 1 }] })).s === 400, "preço negativo é recusado");
  t((await req("PATCH", "/api/pedidos/" + a.j.id, { status: "pago", pagamento: "dinheiro" })).s === 400, "dinheiro sem valor recebido é recusado");
  t((await req("PATCH", "/api/pedidos/" + a.j.id, { status: "pago", pagamento: "dinheiro", recebido: 40 })).s === 400, "valor recebido menor que o total é recusado");
  const pg = await req("PATCH", "/api/pedidos/" + a.j.id, { status: "pago", pagamento: "dinheiro", recebido: 50 });
  t(pg.s === 200 && pg.j.troco === 6, "pagamento em dinheiro calcula o troco (6)");
  t((await req("PATCH", "/api/pedidos/" + a.j.id, { status: "pago", pagamento: "pix" })).s === 409, "pedido pago não paga de novo");
  t((await req("PATCH", "/api/pedidos/" + a.j.id, { status: "cancelado" })).s === 400, "estorno exige motivo");
  t((await req("PATCH", "/api/pedidos/" + a.j.id, { status: "cancelado", motivo: "cliente desistiu" })).s === 200, "estorno com motivo funciona");
  // estornar (sem cancelar): o pedido pago volta pro "em aberto" e dá pra receber de novo
  const e1 = await req("POST", "/api/pedidos", { uid: "u-est", nome: "Estorno", itens: [{ nome: "Marmitex", preco: 22, qtd: 1 }] });
  await req("PATCH", "/api/pedidos/" + e1.j.id, { status: "pago", pagamento: "pix" });
  t((await req("PATCH", "/api/pedidos/" + e1.j.id, { estornarTudo: true })).s === 400, "estornar tudo exige motivo");
  const e2 = await req("PATCH", "/api/pedidos/" + e1.j.id, { estornarTudo: true, motivo: "passou no pix errado" });
  t(e2.s === 200 && e2.j.status === "aguardando" && !e2.j.pagamento && e2.j.itens.every((c) => !c.pago) && e2.j.pagamentos.every((g) => g.estornado), "estornar: pedido pago volta pra em aberto (não cancela)");
  t((await req("PATCH", "/api/pedidos/" + e1.j.id, { estornarTudo: true, motivo: "de novo" })).s === 409, "pedido em aberto sem pagamento: não estorna de novo");
  const e3 = await req("PATCH", "/api/pedidos/" + e1.j.id, { status: "pago", pagamento: "cartao" });
  t(e3.s === 200 && e3.j.status === "pago" && e3.j.pagamento === "cartao", "depois do estorno, recebe de novo na forma certa");

  console.log("\nBalança e comanda");
  const b1 = await req("POST", "/api/balanca", { comanda: 23, valor: 22.6, uid: "p1" });
  await req("POST", "/api/balanca", { comanda: 23, valor: 22.6, uid: "p1" });
  t(b1.s === 200 && (await req("GET", "/api/pedidos?dia=" + hoje)).j.find((p) => p.tipo === "balanca").valor === 22.6, "lançamento repetido (mesmo uid) não soma duas vezes");
  t((await req("POST", "/api/balanca", { comanda: 5, valor: -3 })).s === 400, "valor negativo na balança é recusado");
  const bebida = await req("POST", "/api/balanca", { comanda: 23, valor: 6, nome: "Coca-Cola Lata", uid: "b1" });
  t(bebida.j.valor === 28.6, "bebida soma na comanda (28,60)");
  const tot = await req("POST", "/api/pedidos", { uid: "u3", nome: "Ana", comanda: 23, itens: [{ nome: "Marmitex", preco: 22, qtd: 1 }] });
  t(tot.j.status === "comanda", "pedido do totem entra na comanda");
  const cmd = (await req("GET", "/api/pedidos?dia=" + hoje)).j.find((p) => p.tipo === "balanca");
  t(cmd.valor === 50.6 && cmd.itens.length === 3, "comanda soma prato + bebida + marmitex (50,60)");
  { // balança leve: só baixa de novo quando algo mudou (204 = nada mudou)
    const pb = (v) => fetch(B + "/api/pedidos?dia=" + hoje + "&para=balanca" + (v ? "&v=" + encodeURIComponent(v) : ""), { headers: { Authorization: "Bearer " + TOKEN } });
    const r1 = await pb(), v1 = r1.headers.get("X-Versao"), l1 = await r1.json();
    const r2 = await pb(v1);
    await req("POST", "/api/balanca", { comanda: 77, valor: 10, uid: "pv1" });
    const r3 = await pb(v1), l3 = await r3.json();
    t(r1.status === 200 && l1.some((p) => p.id === cmd.id && p.itens.length === 3) && r2.status === 204 && r3.status === 200 && r3.headers.get("X-Versao") !== v1 && l3.some((p) => p.numero === 77),
      "balança só baixa a lista de novo quando algo mudou (204 sem mudança)");
    const c77 = l3.find((p) => p.numero === 77); await req("PATCH", "/api/pedidos/" + c77.id, { removerItem: 0, removerIid: c77.itens[0].iid });
  }
  t((await req("PATCH", "/api/pedidos/" + cmd.id, { removerItem: -1 })).s === 400, "remover posição inválida é recusado");
  await req("PATCH", "/api/pedidos/" + cmd.id, { removerItem: 2 });
  t((await req("GET", "/api/pedidos?dia=" + hoje)).j.find((p) => p.id === tot.j.id).status === "cancelado", "tirar a marmitex da comanda cancela o pedido do totem");
  t((await req("POST", "/api/pedidos", { uid: "u4", comanda: 99999, itens: [{ nome: "x", preco: 1, qtd: 1 }] })).s === 400, "comanda inválida é recusada");

  console.log("\nClientes, contas e empresas");
  const cli = await req("POST", "/api/clientes", { nome: "Elza", modo: "refeicao", valorRefeicao: 24 });
  const cli2 = await req("POST", "/api/clientes", { nome: "João", empresa: "Acme" });
  { // endereço de entrega no cadastro (o robô do WhatsApp usa na marmita)
    const cm = await req("POST", "/api/clientes", { nome: "TESTE MARMITA", endereco: "  Rua das Flores, 25, Centro  " });
    t(cm.j.endereco === "Rua das Flores, 25, Centro", "cliente novo guarda o endereço");
    const up = await req("PUT", "/api/clientes/" + cm.j.id, { endereco: "Rua B, 9, Vila Nova, apto 3" });
    t(up.s === 200 && (await req("GET", "/api/clientes")).j.find((c) => c.id === cm.j.id).endereco === "Rua B, 9, Vila Nova, apto 3", "editar o cliente troca o endereço");
    await req("PUT", "/api/clientes/" + cm.j.id, { ativo: false });
  }
  t((await req("POST", "/api/lancamentos", { clienteId: cli.j.id, dia: hoje, qtd: 2, valor: 48 })).s === 200, "lançamento válido");
  t((await req("POST", "/api/lancamentos", { clienteId: "inexistente", dia: hoje, valor: 10 })).s === 400, "lançamento p/ cliente inexistente é recusado");
  { // dados do restaurante no comprovante (ficam junto da impressora do caixa)
    const lj = { razao: "Lucia ME", cnpj: "12.345.678/0001-90", endereco: "Rua A, 10 - Centro", cidade: "Cachoeira Paulista - SP", tel: "(12) 9999-0000", extra: "@dalucia" };
    const pu = await req("PUT", "/api/impressora-caixa", { ip: "", porta: 9100, cols: 48, avanco: 4, corte: true, loja: lj });
    t(pu.s === 200 && JSON.stringify((await req("GET", "/api/impressora-caixa")).j.loja) === JSON.stringify(lj), "dados do restaurante (CNPJ, endereço) salvos pro comprovante");
    await req("PUT", "/api/impressora-caixa", { ip: "", porta: 9100, cols: 48 });
    t((await req("GET", "/api/impressora-caixa")).j.loja.cnpj === lj.cnpj, "salvar a impressora sem os dados não apaga o CNPJ");
  }
  t((await req("POST", "/api/pagamentos", { chave: "c:" + cli.j.id, mes: hoje.slice(0, 7), valor: 100, forma: "pix", data: hoje })).s === 200, "pagamento antecipado");
  t((await req("POST", "/api/pagamentos", { chave: "c:fantasma", mes: hoje.slice(0, 7), valor: 5, forma: "pix" })).s === 400, "pagamento p/ conta inexistente é recusado");
  const ped = await req("POST", "/api/pedidos", { uid: "u5", itens: [{ nome: "Marmitex", preco: 24, qtd: 1 }] });
  t((await req("PATCH", "/api/pedidos/" + ped.j.id, { status: "conta", clienteId: cli2.j.id })).j.status === "conta", "marcar pedido na conta de um cliente");
  const ct = (await req("GET", "/api/contas?mes=" + hoje.slice(0, 7))).j;
  t(ct.lancamentos.length === 2, "contas do mês mostram os 2 lançamentos");
  { // tirar UM item da conta (a pessoa cancelou ou não foi)
    const pt = await req("POST", "/api/pedidos", { uid: "u5t", itens: [{ nome: "Marmitex", preco: 24, qtd: 1 }, { nome: "Coca Lata", preco: 6, qtd: 2 }] });
    await req("PATCH", "/api/pedidos/" + pt.j.id, { status: "conta", clienteId: cli2.j.id });
    const lt = () => req("GET", "/api/contas?mes=" + hoje.slice(0, 7)).then((r) => r.j.lancamentos.find((l) => l.pedidoId === pt.j.id));
    const pedT = async () => (await req("GET", "/api/pedidos?dia=" + hoje)).j.find((x) => x.id === pt.j.id);
    const l0 = await lt(), [iA, iB] = (await pedT()).itens.map((c) => c.iid);
    t(l0 && l0.valor === 36, "pedido de R$36 foi pra conta");
    const r1 = await req("POST", "/api/lancamentos/" + l0.id + "/tirar", { iid: iB });
    const l1 = await lt(), p1 = await pedT();
    t(r1.s === 200 && l1 && l1.valor === 24 && p1.valor === 24 && p1.itens.length === 1 && p1.status === "conta", "tirar a Coca da conta: conta e pedido ficam R$24");
    t((await req("POST", "/api/lancamentos/" + l0.id + "/tirar", { iid: iB })).s === 409, "tirar de novo o mesmo item é recusado");
    t((await req("POST", "/api/lancamentos/" + l0.id + "/tirar", { iid: iA })).s === 200 && !(await lt()) && (await pedT()).status === "cancelado", "tirou o último item: some da conta e o pedido fica cancelado");
    t((await reqEm(B, "POST", "/api/lancamentos/" + l0.id + "/tirar", { iid: iA }, "")).s === 401, "tirar item da conta precisa de login");
  }

  console.log("\nGaveta de dinheiro");
  t((await req("POST", "/api/gaveta", { acao: "movimento", tipo: "sangria", valor: 10, motivo: "gás" })).s === 409, "movimento sem abrir a gaveta é recusado");
  await req("POST", "/api/gaveta", { acao: "abrir", valor: 100 });
  await req("POST", "/api/gaveta", { acao: "movimento", tipo: "sangria", valor: 30, motivo: "pagamento do gás" });
  const g = (await req("GET", "/api/gaveta")).j;
  t(g.esperado === 70, "esperado = troco 100 - sangria 30 (as vendas em dinheiro foram estornadas) = 70");
  const f = (await req("POST", "/api/gaveta", { acao: "fechar", contado: 65 })).j;
  t(f.fechamento && f.fechamento.diferenca === -5, "fechamento aponta a diferença (faltou 5)");

  console.log("\nSegurança e arquivos");
  await req("PUT", "/api/config", { t: 1, dados: { pin: '"999"', cores: "{}" } });
  t(!JSON.stringify((await req("GET", "/api/config")).j).includes("999"), "a senha nunca é guardada na cópia das configurações");
  for (const [u, esperado] of [["/server.js", 403], ["/dados/pedidos.json", 403], ["/testes.js", 200], ["/app.js", 200], ["/../x", 403]]) {
    const r = await fetch(B + u); if (u === "/testes.js") { t(r.status === 403 || r.status === 200, "arquivo " + u + " responde"); continue; }
    t(r.status === esperado, u + " -> " + esperado);
  }
  t((await req("GET", "/api/saude")).j.ok === true, "endpoint de saúde responde");

  console.log("\nLogin e permissões");
  t((await req("GET", "/api/pedidos?dia=" + hoje, undefined, "")).s === 401, "sem login não vê os pedidos (401)");
  t((await req("POST", "/api/login", { role: "caixa", pin: "0000" }, "")).s === 401, "senha errada é recusada");
  const lb = (await req("POST", "/api/login", { role: "balanca", pin: "3333" }, "")).j, lc = (await req("POST", "/api/login", { role: "caixa", pin: "2222" }, "")).j;
  t(lb.token && lb.role === "balanca" && lc.role === "caixa", "login da balança e do caixa");
  const todos = (await req("GET", "/api/pedidos?dia=" + hoje, undefined, lb.token));
  t(todos.s === 200, "balança consegue ver as comandas");
  t((await req("GET", "/api/clientes", undefined, lb.token)).s === 403, "balança NÃO acessa clientes (403)");
  t((await req("PATCH", "/api/pedidos/" + todos.j[0].id, { status: "cancelado", motivo: "teste" }, lb.token)).s === 403, "balança NÃO muda o status de pedidos");
  t((await req("PUT", "/api/config", { t: 2, dados: {} }, lc.token)).s === 403, "caixa NÃO altera configurações");
  t((await req("POST", "/api/pedidos", { uid: "pub1", itens: [{ nome: "x", preco: 1, qtd: 1 }] }, "")).s === 200, "o totem do cliente cria pedido sem login");
  t((await req("POST", "/api/imprimir", { dados: "AA==" }, "")).s === 400, "impressão sem impressora configurada avisa (400)");
  t((await req("POST", "/api/senhas", { role: "caixa", pin: "12345" })).s === 400, "não deixa repetir a senha de outro nível");
  t((await req("POST", "/api/senhas", { role: "caixa", pin: "4444" })).s === 200, "admin troca a senha do caixa");
  t((await req("GET", "/api/gaveta", undefined, lc.token)).s === 401, "quem estava logado com a senha antiga é desconectado");
  t((await req("POST", "/api/login", { role: "caixa", pin: "2222" }, "")).s === 401, "senha antiga não funciona mais");
  t((await req("POST", "/api/login", { role: "caixa", pin: "4444" }, "")).s === 200, "senha nova funciona");

  console.log("\nMatriz de permissões (quem pode o quê)");
  const tk = { nenhum: "",  balanca: (await req("POST", "/api/login", { role: "balanca", pin: "3333" }, "")).j.token, caixa: (await req("POST", "/api/login", { role: "caixa", pin: "4444" }, "")).j.token, admin: TOKEN };
  const nivelDe = { nenhum: 0, balanca: 1, caixa: 2, admin: 3 };
  t(!!tk.balanca && !!tk.caixa, "os logins da balança e do caixa (senha nova) funcionaram"); Object.keys(tk).forEach((k) => { if (tk[k] === undefined) tk[k] = "invalido"; });
  const rotas = [["GET", "/api/pedidos?dia=" + hoje, 1], ["POST", "/api/balanca", 1, {}], ["GET", "/api/clientes", 2], ["POST", "/api/lancamentos", 2, {}], ["POST", "/api/pagamentos", 2, {}],
    ["GET", "/api/gaveta", 2], ["POST", "/api/gaveta", 2, {}], ["GET", "/api/contas", 2], ["GET", "/api/backup", 2], ["GET", "/api/senhas", 3], ["PUT", "/api/config", 3, {}]];
  for (const papel of Object.keys(nivelDe)) {
    const erros = [];
    for (const [m, u, min, corpo] of rotas) { const r = await req(m, u, corpo, tk[papel]), bloqueado = r.s === 401 || r.s === 403, deveria = nivelDe[papel] >= min; if (deveria === bloqueado) erros.push(m + " " + u.split("?")[0] + " -> " + r.s); }
    t(erros.length === 0, "perfil '" + papel + "': só acessa o que pode (" + rotas.length + " rotas conferidas)" + (erros.length ? ": " + erros.join("; ") : ""));
  }
  t((await req("POST", "/api/pedidos", { uid: "pub2", itens: [{ nome: "x", preco: 1, qtd: 1 }] }, "")).s === 200 && (await req("GET", "/api/config", undefined, "")).s === 200 && (await req("GET", "/api/saude", undefined, "")).s === 200, "público (totem do cliente): só cria pedido, lê o cardápio e a saúde");

  console.log("\nAcerto por item (cada um com a sua forma de pagamento)");
  const tkB = tk.balanca;
  const op = (await req("POST", "/api/pedidos", { uid: "ac1", nome: "Carla", itens: [{ nome: "Marmitex A", preco: 10, qtd: 1 }, { nome: "Marmitex B", preco: 20, qtd: 1 }, { nome: "Refri", preco: 5, qtd: 2 }] }, "")).j;
  const [iA, iB, iC] = op.itens.map((c) => c.iid), vend0 = (await req("GET", "/api/gaveta")).j.vendasDinheiro;
  t(op.valor === 40 && !!iA && !!iB && !!iC, "pedido de 3 itens (R$ 40,00) com identificador em cada item");
  t((await req("PATCH", "/api/pedidos/" + op.id, { acertar: [] })).s === 400, "acerto sem itens é recusado");
  t((await req("PATCH", "/api/pedidos/" + op.id, { acertar: [{ iid: "fantasma", forma: "pix" }] })).s === 400, "item que não existe é recusado");
  t((await req("PATCH", "/api/pedidos/" + op.id, { acertar: [{ iid: iA, forma: "fiado" }] })).s === 400, "forma de pagamento inválida é recusada");
  t((await req("PATCH", "/api/pedidos/" + op.id, { acertar: [{ iid: iA, forma: "dinheiro" }], recebido: 5 })).s === 400, "dinheiro menor que o item é recusado");
  const p1 = await req("PATCH", "/api/pedidos/" + op.id, { acertar: [{ iid: iA, forma: "dinheiro" }, { iid: iB, forma: "pix" }], recebido: 20 });
  t(p1.s === 200 && p1.j.status === "aguardando" && p1.j.pagamentos.length === 2 && p1.j.troco === 10, "paga A em dinheiro (troco 10) e B no pix; o resto fica em aberto");
  t((await req("GET", "/api/gaveta")).j.vendasDinheiro === vend0 + 10, "na gaveta entra só o dinheiro do item A (10), não o pix");
  t((await req("PATCH", "/api/pedidos/" + op.id, { acertar: [{ iid: iA, forma: "pix" }] })).s === 409, "item já pago não paga de novo");
  t((await req("PATCH", "/api/pedidos/" + op.id, { status: "conta", clienteId: "x" })).s === 400, "pedido com recebimento parcial pode ir pra conta, mas o cliente tem que existir");
  t((await req("PATCH", "/api/pedidos/" + op.id, { status: "cancelado" })).s === 400, "cancelar pedido com recebimento exige motivo");
  const p2 = await req("PATCH", "/api/pedidos/" + op.id, { acertar: [{ iid: iC, forma: "cartao" }] });
  t(p2.j.status === "pago" && p2.j.pagamento === "misto", "pagando o último item o pedido fecha como pagamento misto");
  const gB = p2.j.pagamentos.find((g) => g.forma === "pix");
  t((await req("PATCH", "/api/pedidos/" + op.id, { estornarPagamento: gB.id })).s === 400, "estornar um recebimento exige motivo");
  const p3 = await req("PATCH", "/api/pedidos/" + op.id, { estornarPagamento: gB.id, motivo: "pix não caiu" });
  t(p3.j.status === "aguardando" && !p3.j.itens.find((c) => c.iid === iB).pago && !!p3.j.itens.find((c) => c.iid === iA).pago, "estorno desfaz só o pix: o item B volta a ficar em aberto");
  await req("PATCH", "/api/pedidos/" + op.id, { status: "cancelado", motivo: "cliente foi embora" });
  t((await req("GET", "/api/gaveta")).j.vendasDinheiro === vend0, "pedido cancelado devolve o dinheiro (gaveta volta ao valor anterior)");
  t((await req("PATCH", "/api/pedidos/" + op.id, { status: "pago", pagamento: "pix" })).s === 409, "pedido cancelado não pode ser pago");

  console.log("\nNome na comanda e itens pagos");
  const c77 = (await req("POST", "/api/balanca", { comanda: 77, valor: 30, uid: "n1", cliente: "Marcos" }, tkB)).j;
  t(c77.nome === "Marcos", "a balança grava o nome da pessoa na comanda");
  t((await req("PATCH", "/api/pedidos/" + c77.id, { nome: "Marcos Silva" }, tkB)).j.nome === "Marcos Silva", "a balança pode corrigir o nome");
  const c77b = (await req("POST", "/api/balanca", { comanda: 77, valor: 6, nome: "Coca-Cola Lata", uid: "n2" }, tkB)).j;
  await req("PATCH", "/api/pedidos/" + c77.id, { acertar: [{ iid: c77b.itens[1].iid, forma: "pix" }] });
  t((await req("PATCH", "/api/pedidos/" + c77.id, { removerItem: 1 }, tkB)).s === 409, "item já pago não pode ser apagado pela balança");
  const tirou = await req("PATCH", "/api/pedidos/" + c77.id, { removerItem: 0 }, tkB);
  t(tirou.s === 200 && tirou.j.status === "pago", "tirar o último item em aberto fecha a comanda (o resto já estava pago)");
  t((await req("PATCH", "/api/pedidos/" + op.id, { nome: "x" }, tkB)).s === 409, "só comanda da balança aceita mudar o nome");
  await req("POST", "/api/pedidos", { uid: "n3", nome: "Beatriz", comanda: 88, itens: [{ nome: "Marmitex", preco: 22, qtd: 1 }] }, "");
  t((await req("GET", "/api/pedidos?dia=" + hoje, undefined, tkB)).j.find((p) => p.tipo === "balanca" && p.numero === 88).nome === "Beatriz", "pedido do totem na comanda dá à comanda o nome de quem pediu");

  console.log("\nImpressão pública com limites");
  await req("PUT", "/api/config", { t: 5, dados: { impCfg: JSON.stringify({ ip: "192.168.255.254", porta: 9100 }) } });
  t((await req("POST", "/api/imprimir", { dados: Buffer.from("texto qualquer").toString("base64") }, "")).s === 400, "conteúdo que não é comanda (sem ESC @) é recusado");
  t((await req("POST", "/api/imprimir", { dados: Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.alloc(130000, 65)]).toString("base64") }, "")).s === 400, "conteúdo grande demais é recusado (mais de 120 KB)");
  const ticket = Buffer.concat([Buffer.from([0x1b, 0x40]), Buffer.from("TESTE\n")]).toString("base64");
  const rajada = await Promise.all(Array.from({ length: 34 }, () => req("POST", "/api/imprimir", { dados: ticket }, "")));
  t(rajada.some((r) => r.s === 429), "rajada de impressões é freada (429)");

  console.log("\nSessão: expiração e reinício do servidor");
  const dirE = fs.mkdtempSync(path.join(os.tmpdir(), "totem-sessao-")), curta = sobe(3997, dirE, { SESSAO_MS: "1200" }); await curta.pronto;
  const tkE = (await reqEm(curta.base, "POST", "/api/login", { role: "balanca", pin: "3333" }, "")).j.token;
  t((await reqEm(curta.base, "GET", "/api/pedidos?dia=" + hoje, undefined, tkE)).s === 200, "sessão nova funciona"); await dorme(1700);
  t((await reqEm(curta.base, "GET", "/api/pedidos?dia=" + hoje, undefined, tkE)).s === 401, "sessão vencida volta a pedir login (401)"); curta.srv.kill();
  const dirR = fs.mkdtempSync(path.join(os.tmpdir(), "totem-reinicio-")); let sv = sobe(3996, dirR); await sv.pronto;
  const tkR = (await reqEm(sv.base, "POST", "/api/login", { role: "balanca", pin: "3333" }, "")).j.token; sv.srv.kill(); await dorme(600);
  sv = sobe(3996, dirR); await sv.pronto;
  t((await reqEm(sv.base, "GET", "/api/pedidos?dia=" + hoje, undefined, tkR)).s === 200, "reiniciar o servidor NÃO derruba o login da balança"); sv.srv.kill();

  console.log("\nBackup e restauração (em uma instalação separada)");
  const bk = await req("GET", "/api/backup", undefined, tk.caixa), arq = path.join(dir, "backup-teste.json"); fs.writeFileSync(arq, JSON.stringify(bk.j));
  const antes = (await req("GET", "/api/pedidos?dia=" + hoje, undefined, tk.admin)).j, dirN = fs.mkdtempSync(path.join(os.tmpdir(), "totem-restaura-"));
  const rest = restaurar(arq, dirN); t(rest.pedidos === bk.j.dados.pedidos.length && rest.clientes >= 2, "restaurar.js lê o backup completo (" + rest.pedidos + " pedidos, " + rest.clientes + " clientes)");
  const novo = sobe(3995, dirN); await novo.pronto; const lg = (await reqEm(novo.base, "POST", "/api/login", { role: "admin", pin: "12345" }, "")).j.token;
  const depois = (await reqEm(novo.base, "GET", "/api/pedidos?dia=" + hoje, undefined, lg)).j;
  const soma = (a) => Math.round(a.reduce((s, p) => s + p.valor, 0) * 100) / 100;
  t(depois.length === antes.length && soma(depois) === soma(antes), "na instalação nova os pedidos e o total batem (" + depois.length + " pedidos)");
  t((await reqEm(novo.base, "GET", "/api/clientes", undefined, lg)).j.length === bk.j.dados.clientes.length && (await reqEm(novo.base, "GET", "/api/gaveta", undefined, lg)).j.fechamento !== undefined, "clientes e gaveta também voltaram"); novo.srv.kill();
  t(restaurar(arq, dirN).guardadoEm !== null, "ao restaurar sobre dados existentes, a versão anterior fica guardada");
  let recusou = false; try { fs.writeFileSync(arq + ".ruim", "{\"qualquer\":1}"); restaurar(arq + ".ruim", dirN); } catch (e) { recusou = true; }
  t(recusou, "arquivo que não é backup é recusado");

  console.log("\nPedidos do site de delivery (com um site de mentira)");
  let marcados = [], extraSite = [], cancelarNoSite = false, cardSite = null, whatsSite = [], gestaoSite = {};
  const PS = { token: "11111111-2222-3333-4444-555555555555", numero: 57, dia: hoje, criado_em: new Date().toISOString(), nome: "Rita", telefone: "12999998888", tipo_entrega: "entrega",
    endereco: { rua: "Rua A", numero: "10", bairro: "Centro" }, forma_pagamento: "pix", troco_para: null, obs: "portão azul", status: "preparando", subtotal: 54.5, taxa_entrega: 7, total: 61.5,
    itens: [{ nome: "Marmitex", preco: 24, qtd: 2, grupos: [{ rotulo: "Carne", itens: ["Frango"] }] }, { tipo: "bebida", nome: "Suco", preco: 6.5, qtd: 1 }] };
  const PS2 = { ...PS, token: "22222222-2222-3333-4444-555555555555", numero: 58, forma_pagamento: "dinheiro", troco_para: 100 }, PS3 = { ...PS, token: "33333333-2222-3333-4444-555555555555", numero: 59, forma_pagamento: "cartao_entrega" };
  const site = require("http").createServer((rq, rs) => { let b = ""; rq.on("data", (c) => (b += c)); rq.on("end", () => {
    const j = JSON.parse(b || "{}"), out = (o, s = 200) => { rs.writeHead(s, { "Content-Type": "application/json" }); rs.end(JSON.stringify(o)); };
    if (rq.headers["x-caixa-token"] !== "tk-teste") return out({ erro: "token inválido" }, 401);
    if (j.acao === "novos") return out({ pedidos: [PS, PS2, PS3, ...extraSite].filter((x) => !marcados.includes(x.token)), loja: { cidade_entrega: "Cachoeira Paulista, SP", tempo_entrega_min: 45 } });
    if (j.acao === "importado") { marcados.push(j.token); return out({ ok: true }); }
    if (j.acao === "cardapio") { cardSite = j.cardapio; return out({ ok: true }); }
    if (j.acao === "whats") { whatsSite.push(j); return out({ ok: true }); }
    if (j.acao === "gestao") { (j.resumos || []).forEach((r) => (gestaoSite[r.dia] = r)); return out({ ok: true }); }
    if (j.acao === "situacao") return out({ pedidos: j.tokens.map((x) => ({ token: x, status: cancelarNoSite ? "cancelado" : "preparando" })) });
    out({ erro: "?" }, 400);
  }); }).listen(3994);
  const dirD = fs.mkdtempSync(path.join(os.tmpdir(), "totem-delivery-")), arqWE = path.join(dirD, "enviados-robo.json");
  fs.writeFileSync(path.join(dirD, "config.json"), JSON.stringify({ t: 1, dados: { indisponiveis: JSON.stringify(["bebida:Sprite Lata", "arroz:Arroz Integral", "produto:m24"]), removidos: JSON.stringify(["bebida:H2OH!"]),
    bebidasExtras: JSON.stringify([{ nome: "Suco Pequeno", preco: 6 }]), etapasExtras: JSON.stringify([{ id: "e1", nome: "Salada Separada - R$1,00", itens: ["Alface"] }]),
    marmitexCfg: JSON.stringify({ m22: { preco: 23, regras: { e1: { min: 0, max: 1 } } } }) } }));
  const sd = sobe(3993, dirD, { DELIVERY_URL: "http://localhost:3994/", DELIVERY_TOKEN: "tk-teste", DELIVERY_INTERVALO_MS: "700", GESTAO_INTERVALO_MS: "800", WHATS_ENVIADOS: arqWE });
  await sd.pronto; await dorme(2600);
  const tkD = (await reqEm(sd.base, "POST", "/api/login", { role: "caixa", pin: "2222" }, "")).j.token, delDe = async () => (await reqEm(sd.base, "GET", "/api/pedidos?dia=" + hoje, undefined, tkD)).j.filter((p) => p.tipo === "delivery");
  const lD0 = await delDe(), lD = lD0, d57 = lD.find((x) => x.numero === 57), d58 = lD.find((x) => x.numero === 58), d59 = lD.find((x) => x.numero === 59);
  t(lD.length === 3 && !!d57 && d57.valor === 61.5 && d57.status === "pago" && d57.pagamento === "pix", "pedido do site chega no caixa já recebido, na forma escolhida pelo cliente (Pix, 61,50)");
  t(!!d58 && d58.status === "pago" && d58.pagamento === "dinheiro" && d58.recebido === 100 && d58.troco === 38.5, "dinheiro chega recebido com o troco calculado (troco p/ 100 → 38,50)");
  t(!!d59 && d59.status === "pago" && d59.pagamento === "cartao" && d59.itens.every((c) => c.pago), "cartão na entrega chega recebido como cartão");
  t(!!d57 && d57.itens.some((c) => c.nome === "Taxa de entrega" && c.preco === 7) && d57.endereco.bairro === "Centro" && d57.pagPrevisto === "pix", "a taxa de entrega vira item, e o endereço e a forma de pagamento vêm junto");
  t(marcados.length === 3, "o site é avisado de que os pedidos foram pro caixa");
  const fw = (() => { try { return JSON.parse(fs.readFileSync(path.join(dirD, "whats-fila.json"), "utf8")); } catch (e) { return []; } })(), w58 = fw.find((x) => /Pedido nº 58\*/.test(x.texto));
  t(fw.length === 3 && fw.every((x) => x.tel === "12999998888") && !!w58 && /troco para R\$ 100,00/.test(w58.texto) && /Produto: MARMITEX\nQuantidade: 2\nValor: R\$ 48,00\n  CARNE\n    1 FRANGO\nObservação: /.test(w58.texto) && /Produto: SUCO\nQuantidade: 1\nValor: R\$ 6,50/.test(w58.texto)
    && /🛵 Delivery \(taxa de: R\$ 7,00\)/.test(w58.texto) && /🏠 Rua A, Nº 10, Centro, Cachoeira Paulista\n/.test(w58.texto) && /Previsão de Entrega: entre \d\d:\d\d e \d\d:\d\d/.test(w58.texto)
    && /Total: R\$ 61,50/.test(w58.texto) && !/Taxa de entrega/.test(w58.texto), "cada pedido do site entra na fila do robô de WhatsApp com a confirmação certa (formato com itens, endereço com cidade e previsão)");
  if (w58) console.log("\n   ----- mensagem de exemplo -----\n" + w58.texto.replace(/^/gm, "   ") + "\n   -------------------------------\n");
  for (let i = 0; i < 30 && !cardSite; i++) await dorme(200); // o cardápio sai uns 3 s depois de ligar
  const cs = cardSite || { etapas: [], produtos: [], bebidas: [] }, cE1 = cs.etapas.find((e) => e.id === "e1"), cArroz = cs.etapas.find((e) => e.id === "arroz"), c22 = cs.produtos.find((x) => x.id === "m22");
  t(!!cE1 && cE1.adicional === 1 && !!cArroz && cArroz.itens.find((i) => i.nome === "Arroz Integral").disponivel === false && cArroz.itens.find((i) => i.nome === "Arroz Branco").disponivel === true
    && !!c22 && c22.preco === 23 && c22.regras.e1.max === 1 && c22.regras.arroz.max === 1 && cs.produtos.find((x) => x.id === "m24").disponivel === false
    && cs.bebidas.find((b) => b.nome === "Sprite Lata").disponivel === false && !cs.bebidas.some((b) => b.nome === "H2OH!") && cs.bebidas.some((b) => b.nome === "Suco Pequeno"), "o cardápio do totem vai pro site (o que tem hoje, preços, regras, adicional e bebidas)");
  fs.writeFileSync(arqWE, JSON.stringify({ [d57.id]: { ok: true, quando: Date.now() }, [d58.id]: { ok: false, erro: "número sem WhatsApp", quando: Date.now() }, [d59.id]: { ok: false, erro: "Timeout", quando: Date.now() } }));
  await dorme(1600);
  const lW = await delDe();
  t(lW.find((x) => x.numero === 58).whats === "sem" && lW.find((x) => x.numero === 57).whats === "ok" && !lW.find((x) => x.numero === 59).whats
    && whatsSite.some((x) => x.token === PS2.token && x.ok === false) && whatsSite.some((x) => x.token === PS.token && x.ok === true) && !whatsSite.some((x) => x.token === PS3.token), "número sem WhatsApp fica marcado no caixa e no site (erro do robô não marca nada)");
  marcados = []; await dorme(1500); // o aviso "se perdeu": o site manda de novo
  t((await delDe()).length === 3, "pedido reenviado pelo site não duplica no caixa (nem paga de novo)");
  t((await reqEm(sd.base, "POST", "/api/pedidos", { uid: "d-tot", itens: [{ nome: "X", preco: 10, qtd: 1 }] }, "")).j.numero === 1, "pedido do totem continua começando no #1 (delivery tem numeração própria)");
  // marmita do robô que chega em R$0 porque o cliente ainda não tinha conta: marcar na conta depois vale o valor da refeição dele
  extraSite.push({ ...PS, token: "44444444-2222-3333-4444-555555555555", numero: 60, nome: "Dani - MARMITA", telefone: "12988887777", tipo_entrega: "retirada", endereco: null,
    forma_pagamento: "conta", subtotal: 0, taxa_entrega: 0, total: 0, itens: [{ nome: "Marmita", preco: 0, qtd: 1, grupos: [{ rotulo: "Carne", itens: ["Bife"] }] }] });
  await dorme(1600);
  const d60 = (await delDe()).find((x) => x.numero === 60);
  t(!!d60 && d60.status === "aguardando" && d60.valor === 0, "marmita do robô sem conta do cliente fica em aberto com R$ 0");
  const cDani = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "DANI MARMITA", modo: "refeicao", valorRefeicao: 50 }, tkD)).j;
  const m60 = d60 ? await reqEm(sd.base, "PATCH", "/api/pedidos/" + d60.id, { status: "conta", clienteId: cDani.id }, tkD) : { s: 0, j: {} };
  t(m60.s === 200 && m60.j.status === "conta" && m60.j.valor === 50, "marcar essa marmita na conta vale o valor da refeição do cliente (R$ 50), em vez de travar no R$ 0");
  extraSite.push({ ...PS, token: "55555555-2222-3333-4444-555555555555", numero: 61, nome: "Lu - MARMITA", telefone: "12977776666", tipo_entrega: "retirada", endereco: null,
    forma_pagamento: "conta", subtotal: 0, taxa_entrega: 0, total: 0, itens: [{ nome: "Marmita", preco: 0, qtd: 1, grupos: [] }] });
  await dorme(1600);
  const d61 = (await delDe()).find((x) => x.numero === 61), cLu = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "LU MARMITA" }, tkD)).j;
  const m61a = d61 ? await reqEm(sd.base, "PATCH", "/api/pedidos/" + d61.id, { status: "conta", clienteId: cLu.id }, tkD) : { s: 0 };
  const m61 = d61 ? await reqEm(sd.base, "PATCH", "/api/pedidos/" + d61.id, { status: "conta", clienteId: cLu.id, precoMarmita: 45 }, tkD) : { s: 0, j: {} };
  t(m61a.s === 409 && m61.s === 200 && m61.j.valor === 45, "cliente sem valor de refeição: a marmita vai pra conta com o valor que o caixa digitou");
  { // pedido "na conta" do robô: marca sozinho pelo telefone cadastrado ou pelo nome (empresa) que deu no pedido
    const der = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "DER", empresa: "DER" }, tkD)).j, gi = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "GILDA", telefone: "(12) 98111-2233" }, tkD)).j;
    const it = [{ nome: "Marmitex - R$22,00", preco: 22, qtd: 1, grupos: [] }];
    extraSite.push({ ...PS, token: "66666666-2222-3333-4444-555555555555", numero: 62, nome: "DER - Ronaldo", telefone: "12900001111", tipo_entrega: "retirada", endereco: null, forma_pagamento: "conta", subtotal: 22, taxa_entrega: 0, total: 22, itens: it },
      { ...PS, token: "77777777-2222-3333-4444-555555555555", numero: 63, nome: "Gil", telefone: "5512981112233", tipo_entrega: "retirada", endereco: null, forma_pagamento: "conta", subtotal: 22, taxa_entrega: 0, total: 22, itens: it },
      { ...PS, token: "88888888-2222-3333-4444-555555555555", numero: 64, nome: "Fulano Novo", telefone: "12900002222", tipo_entrega: "retirada", endereco: null, forma_pagamento: "conta", subtotal: 22, taxa_entrega: 0, total: 22, itens: it });
    await dorme(1600);
    const ds = await delDe(), ct = (await reqEm(sd.base, "GET", "/api/contas", undefined, tkD)).j, d62 = ds.find((x) => x.numero === 62), d63 = ds.find((x) => x.numero === 63), d64 = ds.find((x) => x.numero === 64);
    t(d62 && d62.status === "conta" && ct.lancamentos.some((l) => l.clienteId === der.id && l.pedidoId === d62.id && l.valor === 22), "na conta pelo nome: 'DER - Ronaldo' vai sozinho pra conta da DER");
    t(d63 && d63.status === "conta" && d63.clienteId === gi.id, "na conta pelo telefone cadastrado (outro nome no pedido)");
    t(d64 && d64.status === "aguardando", "na conta sem achar o cliente: fica em aberto pro caixa");
  }
  { // clique duplo (mesmo código uid 2x ao mesmo tempo): pagamento, marcar na conta, retirada e cliente novo ficam 1 vez só
    const dd = (u, b) => Promise.all([reqEm(sd.base, "POST", u, b, tkD), reqEm(sd.base, "POST", u, b, tkD)]);
    const cdu = (await dd("/api/clientes", { nome: "CLIQUE DUPLO", uid: "cd1" }))[0].j, mesT = new Date().toLocaleDateString("en-CA").slice(0, 7);
    await dd("/api/pagamentos", { chave: "c:" + cdu.id, mes: mesT, valor: 50, forma: "pix", data: hoje, uid: "pgd1" });
    await dd("/api/lancamentos", { clienteId: cdu.id, dia: hoje, valor: 22, uid: "lcd1" });
    const ct = (await reqEm(sd.base, "GET", "/api/contas?mes=" + mesT, undefined, tkD)).j, cl = (await reqEm(sd.base, "GET", "/api/clientes", undefined, tkD)).j;
    t(cl.filter((c) => c.nome === "CLIQUE DUPLO").length === 1 && ct.pagamentos.filter((p) => p.chave === "c:" + cdu.id).length === 1 && ct.lancamentos.filter((l) => l.clienteId === cdu.id).length === 1, "clique duplo: cliente, pagamento e lançamento ficam 1 vez só");
  }
  { // gaveta: retirada digitada errada pode ser apagada (só com a gaveta aberta)
    await reqEm(sd.base, "POST", "/api/gaveta", { acao: "abrir", valor: 50 }, tkD);
    const g1 = (await reqEm(sd.base, "POST", "/api/gaveta", { acao: "movimento", tipo: "sangria", valor: 999, motivo: "errado" }, tkD)).j, m = g1.movimentos.find((x) => x.motivo === "errado");
    const g2 = (await reqEm(sd.base, "POST", "/api/gaveta", { acao: "apagarMov", id: m.id }, tkD)).j;
    t(g1.sangrias - g2.sangrias === 999 && !g2.movimentos.some((x) => x.id === m.id), "gaveta: dá pra apagar uma retirada digitada errada");
  }
  { // apagar lançamento pelo código (iid): se a comanda mudou, não apaga o item errado
    const c1 = (await reqEm(sd.base, "POST", "/api/balanca", { comanda: 777, valor: 10, uid: "rm1" }, tkD)).j;
    await reqEm(sd.base, "POST", "/api/balanca", { comanda: 777, valor: 20, uid: "rm2" }, tkD);
    const alvo = c1.itens[0].iid; await reqEm(sd.base, "PATCH", "/api/pedidos/" + c1.id, { removerItem: 0 }, tkD); // alguém tirou o 1º antes
    const r = await reqEm(sd.base, "PATCH", "/api/pedidos/" + c1.id, { removerItem: 0, removerIid: alvo }, tkD); // posição 0 agora é o de R$20
    t(r.s === 409, "tirar pelo código: item que já saiu não leva outro no lugar (antes apagava o de R$ 20)");
  }
  { // Gestão: pedido marcado na conta não conta 2x (pedido + lançamento dele)
    const c2 = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "CONTA DUPLA" }, tkD)).j, cm = (await reqEm(sd.base, "POST", "/api/balanca", { comanda: 778, valor: 33, uid: "nc1" }, tkD)).j;
    await dorme(1200); const antes = (gestaoSite[hoje] || {}).naConta || 0;
    await reqEm(sd.base, "PATCH", "/api/pedidos/" + cm.id, { status: "conta", clienteId: c2.id }, tkD); await dorme(1500);
    const depois = (gestaoSite[hoje] || {}).naConta || 0;
    t(Math.abs(depois - antes - 33) < 0.01, "Gestão: comanda de R$ 33 marcada na conta soma R$ 33 no 'vendido na conta' (antes somava 66): " + antes + " -> " + depois);
  }
  { // juntar cadastro repetido: lançamentos passam pro outro e o repetido some
    const a1 = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "LUIS ALMOCO", empresa: "OBRA X" }, tkD)).j, a2 = (await reqEm(sd.base, "POST", "/api/clientes", { nome: "ALMOCO", empresa: "OBRA X" }, tkD)).j;
    await reqEm(sd.base, "POST", "/api/lancamentos", { clienteId: a1.id, dia: "2026-01-05", valor: 30 }, tkD);
    const jn = await reqEm(sd.base, "POST", "/api/clientes/" + a1.id + "/juntar", { para: a2.id }, tkD), cl = (await reqEm(sd.base, "GET", "/api/clientes", undefined, tkD)).j, ct = (await reqEm(sd.base, "GET", "/api/contas?mes=2026-01", undefined, tkD)).j;
    t(jn.s === 200 && jn.j.lancamentos === 1 && !cl.some((c) => c.id === a1.id) && ct.lancamentos.some((l) => l.clienteId === a2.id && l.valor === 30), "juntar cliente repetido: o lançamento passa pro outro e o repetido some");
  }
  cancelarNoSite = true; await dorme(1600);
  t((await delDe()).filter((x) => x.numero < 60).every((x) => x.status === "cancelado"), "cancelado no site depois de chegar pago: cancela no caixa e sai das vendas");
  { const ds = await delDe(), ct = (await reqEm(sd.base, "GET", "/api/contas", undefined, tkD)).j, d62 = ds.find((x) => x.numero === 62);
    t(d62 && d62.status === "cancelado" && !ct.lancamentos.some((l) => l.pedidoId === d62.id), "cancelado no site depois de ir sozinho pra conta: sai da conta do cliente (não fica cobrado)"); }
  const sa = (await reqEm(sd.base, "GET", "/api/saude", undefined, "")).j;
  t(!!sa.delivery && sa.delivery.ligado && !sa.delivery.erro && !JSON.stringify(sa).includes("tk-teste"), "a saúde do servidor mostra a busca do delivery (sem mostrar a senha)");
  sd.srv.kill(); site.close();
  { // pedidos.json estragado (luz caiu no meio da gravação): liga com o backup mais novo, não liga vazio
    const dE = fs.mkdtempSync(path.join(os.tmpdir(), "totem-estragado-")); fs.mkdirSync(path.join(dE, "backups"));
    fs.writeFileSync(path.join(dE, "pedidos.json"), '{"pedidos":[{"id":"x"'); // cortado no meio
    fs.writeFileSync(path.join(dE, "backups", "pedidos-2026-01-01.json"), JSON.stringify({ pedidos: [], clientes: [{ id: "c1", nome: "VEIO DO BACKUP", ativo: true }] }));
    const se = sobe(3991, dE); await se.pronto; const sa2 = (await reqEm(se.base, "GET", "/api/saude", undefined, "")).j;
    t(sa2.clientes === 1 && fs.readdirSync(dE).some((a) => a.startsWith("pedidos.json.estragado-")), "pedidos.json estragado: liga com o backup (antes ligava vazio e apagava tudo na próxima gravação)");
    se.srv.kill(); }

  console.log("\nProteção contra adivinhar senha");
  for (let i = 0; i < 5; i++) await req("POST", "/api/login", { role: "balanca", pin: "9999" }, "");
  t((await req("POST", "/api/login", { role: "balanca", pin: "3333" }, "")).s === 429, "depois de 5 erros o login trava por alguns minutos");

  console.log("\n" + (falhas ? "FALHARAM " + falhas + " teste(s)" : "TUDO CERTO") + " (" + ok + " ok)\n"); extras.forEach((x) => x.kill()); fs.rmSync(dir, { recursive: true, force: true }); process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error("Erro no teste:", e.message); extras.forEach((x) => x.kill()); process.exit(1); });
