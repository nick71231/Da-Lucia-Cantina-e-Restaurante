// CUPOM FISCAL (NFC-e, modelo 65) direto na SEFAZ-SP, pelo caixa. Série própria (o ViaVale usa a série 1; aqui a 2).
// Só módulos do Node + o openssl do Git (só pra abrir o certificado A1 uma vez, quando a dona digita a senha).
// Configuração em dados/fiscal.json (CNPJ, CSC, dados do emitente, série, ambiente, numeração) e o certificado em
// dados/certificado.pem (chave + certificado; o .pfx original e a senha NÃO ficam guardados). Nada disso vai pro git.
// Estrutura da nota copiada de uma NFC-e do ViaVale já autorizada pra este CNPJ (Simples Nacional, SP, QR Code v2).
"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto"), https = require("https"), http = require("http"), { execFileSync } = require("child_process");

const NS = "http://www.portalfiscal.inf.br/nfe", DS = "http://www.w3.org/2000/09/xmldsig#";
const WS = { // SEFAZ-SP, NFC-e. 1 = produção (vale de verdade), 2 = homologação (teste, sem valor fiscal)
  1: { base: "https://nfce.fazenda.sp.gov.br/ws/", qr: "https://www.nfce.fazenda.sp.gov.br/qrcode", consulta: "https://www.nfce.fazenda.sp.gov.br/consulta" },
  2: { base: "https://homologacao.nfce.fazenda.sp.gov.br/ws/", qr: "https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode", consulta: "https://www.homologacao.nfce.fazenda.sp.gov.br/consulta" },
};
// SEFAZ_TESTE: só nos testes automáticos (testes.js), uma SEFAZ de mentira em http://localhost
if (process.env.SEFAZ_TESTE) for (const a of [1, 2]) WS[a] = { ...WS[a], base: process.env.SEFAZ_TESTE };
const HOMOLOG_XPROD = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

// ---------- produtos fiscais (o que vai na nota). Igual ao ViaVale, com o imposto do refrigerante e da água corrigido
// (pesquisa 24/11/2026: refrigerante e cerveja continuam na ST em SP; água saiu da ST em 01/07/2026 - Portaria SRE 9/2026).
// O contador pode mudar qualquer linha em dados/fiscal.json -> "tabela": { "refri_lata": { "CFOP": "..." } }
const CLASSES = {
  refeicao: { cProd: "REF", xProd: "REFEICAO", NCM: "21069090", CFOP: "5102", CSOSN: "102" },
  marmitex: { cProd: "MTX", xProd: "MARMITEX", NCM: "21069090", CEST: "1710100", CFOP: "5102", CSOSN: "102" },
  entrega: { cProd: "ENTREGA", xProd: "TAXA DE ENTREGA", NCM: "21069090", CEST: "1710100", CFOP: "5102", CSOSN: "102" },
  refri_lata: { cProd: "REFRILATA", xProd: "REFRIGERANTE EM LATA", NCM: "22021000", CEST: "0301002", CFOP: "5405", CSOSN: "500" },
  refri_600: { cProd: "REFRI600", xProd: "REFRIGERANTE 600ML", NCM: "22021000", CEST: "0301001", CFOP: "5405", CSOSN: "500" },
  refri_2l: { cProd: "REFRI2L", xProd: "REFRIGERANTE 2 LITROS", NCM: "22021000", CEST: "0301001", CFOP: "5405", CSOSN: "500" },
  refri: { cProd: "REFRI", xProd: "REFRIGERANTE", NCM: "22021000", CEST: "0301100", CFOP: "5405", CSOSN: "500" },
  agua: { cProd: "AGUA", xProd: "AGUA MINERAL", NCM: "22011000", CFOP: "5102", CSOSN: "102" },
  suco: { cProd: "SUCONATURAL", xProd: "SUCO NATURAL", NCM: "20098913", CFOP: "5102", CSOSN: "102" },
  bebida: { cProd: "BEBIDA", xProd: "BEBIDA NAO ALCOOLICA", NCM: "22029900", CFOP: "5102", CSOSN: "102" },
  cerveja: { cProd: "CERVEJA", xProd: "CERVEJA LONG NECK", NCM: "22030000", CEST: "0302101", CFOP: "5405", CSOSN: "500" },
  sorvete: { cProd: "SORVETE", xProd: "SORVETE", NCM: "21050010", CFOP: "5102", CSOSN: "102" },
  doce: { cProd: "DOCE", xProd: "SOBREMESA", NCM: "21069090", CFOP: "5102", CSOSN: "102" },
};
const semAc = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
// qual produto fiscal é cada item do pedido (pelo tipo e pelo nome)
function classe(c) {
  const n = semAc(c.nome).toLowerCase();
  if (c.tipo === "taxa") return "entrega";
  if (c.tipo === "doce") return /sorvet|picol|acai|casquinha|cascao|copinho|sundae|milk ?shake/.test(n) ? "sorvete" : "doce";
  const beb = c.tipo === "bebida" || /\b(coca|fanta|sprite|pepsi|guarana|refri|agua|suco|del valle|ice tea|h2oh|schweppes|tonica|limoneto|long neck|cerveja|gatorade)\b/.test(n);
  if (beb) {
    if (/long neck|cerveja|heineken|budweiser|brahma|skol|stella|corona|amstel|spaten|original/.test(n)) return "cerveja";
    if (/\bagua\b/.test(n) && !/tonica/.test(n)) return "agua";
    if (/\bsuco\b/.test(n) && !/del valle/.test(n)) return "suco";
    if (/del valle|ice tea|\bcha\b|gatorade|isoton|energ|nectar/.test(n)) return "bebida";
    if (/\blata\b/.test(n)) return "refri_lata";
    if (/600|\bpet\b/.test(n)) return "refri_600";
    if (/\b2 ?l\b|2 litros/.test(n)) return "refri_2l";
    return "refri";
  }
  if (/prato por quilo|\bkg\b|quilo|self/.test(n) || c.peso) return "refeicao";
  return "marmitex";
}

// ---------- utilidades ----------
const c2 = (n) => Math.round(Number(n) * 100) / 100, f2 = (n) => c2(n).toFixed(2), f4 = (n) => Number(n).toFixed(4), f10 = (n) => Number(n).toFixed(10);
const esc = (s) => String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const txtNota = (s, n) => esc(semAc(s).toUpperCase().slice(0, n));
const tag = (xml, t) => { const m = String(xml || "").match(new RegExp("<(?:\\w+:)?" + t + "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?" + t + ">")); return m ? m[1] : null; };
const agoraSP = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 19) + "-03:00"; // Brasil sem horário de verão
const cpfOk = (v) => { const s = String(v || "").replace(/\D/g, ""); if (s.length !== 11 || /^(\d)\1+$/.test(s)) return false; for (const t of [9, 10]) { let soma = 0; for (let i = 0; i < t; i++) soma += Number(s[i]) * (t + 1 - i); const d = ((soma * 10) % 11) % 10; if (d !== Number(s[t])) return false; } return true; };
const dv11 = (s) => { let soma = 0, p = 2; for (let i = s.length - 1; i >= 0; i--) { soma += Number(s[i]) * p; p = p === 9 ? 2 : p + 1; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
const TPAG = { dinheiro: "01", credito: "03", debito: "04", refeicao: "11", pix: "17", cartao: "99" };

module.exports = function criarFiscal({ DIR_DADOS }) {
  const ARQ = path.join(DIR_DADOS, "fiscal.json"), PEM = path.join(DIR_DADOS, "certificado.pem"), PASTA = path.join(DIR_DADOS, "nfce");
  const ler = () => { try { return JSON.parse(fs.readFileSync(ARQ, "utf8")); } catch (e) { return null; } };
  const salvar = (cfg) => { fs.writeFileSync(ARQ + ".tmp", JSON.stringify(cfg, null, 1)); fs.renameSync(ARQ + ".tmp", ARQ); };
  let certCache = null;
  function cert() {
    if (certCache) return certCache;
    let pem; try { pem = fs.readFileSync(PEM, "utf8"); } catch (e) { return null; }
    const k = pem.match(/-----BEGIN (?:RSA |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |ENCRYPTED )?PRIVATE KEY-----/), c = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
    if (!k || !c) return null;
    const x = new crypto.X509Certificate(c[0]);
    certCache = { key: k[0], certPem: c[0], b64: c[0].replace(/-----[^-]+-----|\s/g, ""), nome: (x.subject.match(/CN=([^\n]+)/) || [])[1] || x.subject, validade: new Date(x.validTo).getTime() };
    return certCache;
  }
  // ---------- certificado: a dona escolhe o .pfx/.p12 e digita a senha; vira PEM aqui (a senha não fica guardada) ----------
  // OpenSSL: primeiro o "ucrt64" do Git, que traz o módulo "legacy" (24/11: o certificado A1 da loja usa criptografia antiga
  // RC2-40; o openssl do usr/bin não acha o legacy.dll rodando como SYSTEM e a senha certa dava "senha errada")
  function opensslCandidatos() {
    return [process.env.OPENSSL, "C:\\Program Files\\Git\\ucrt64\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files (x86)\\Git\\usr\\bin\\openssl.exe"].filter((p) => p && fs.existsSync(p));
  }
  function instalarCertificado(pfx, senha) {
    const cfg = ler(); if (!cfg) throw new Error("falta a configuração fiscal (dados/fiscal.json)");
    const tmp = path.join(DIR_DADOS, "cert-" + Date.now() + ".p12"); fs.writeFileSync(tmp, pfx);
    let out = "", erros = [];
    try {
      const bins = opensslCandidatos(); if (!bins.length) throw new Error("não achei o OpenSSL (vem junto com o Git) pra abrir o certificado");
      for (const bin of bins) {
        const mods = path.join(path.dirname(path.dirname(bin)), "lib", "ossl-modules"), env = { ...process.env, SENHA_PFX: String(senha || ""), ...(fs.existsSync(mods) ? { OPENSSL_MODULES: mods } : {}) };
        for (const extra of [[], ["-legacy"]]) {
          try { out = execFileSync(bin, ["pkcs12", "-in", tmp, "-nodes", "-passin", "env:SENHA_PFX", ...extra], { env, stdio: ["ignore", "pipe", "pipe"], timeout: 20000 }).toString(); if (/PRIVATE KEY/.test(out)) break; }
          catch (e) { out = ""; erros.push(String(e.stderr || e.message).split(/\r?\n/).find((l) => l.trim()) || e.message); }
        }
        if (/PRIVATE KEY/.test(out)) break;
      }
    } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
    if (!/PRIVATE KEY/.test(out)) {
      console.error("certificado: não abriu -> " + erros.join(" | "));
      if (erros.some((x) => /mac verify|invalid password|bad decrypt/i.test(x))) throw new Error("senha errada (confira maiúsculas e minúsculas)");
      throw new Error("não consegui abrir o certificado: " + (erros[erros.length - 1] || "arquivo inválido") + ". Confira se é o arquivo .pfx/.p12 do certificado A1");
    }
    const key = (out.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA )?PRIVATE KEY-----/) || [])[0];
    const certs = out.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
    const ko = crypto.createPrivateKey(key), meu = certs.map((c) => new crypto.X509Certificate(c)).find((x) => x.checkPrivateKey(ko));
    if (!meu) throw new Error("o certificado não combina com a chave");
    if (!meu.subject.replace(/\D/g, "").includes(cfg.cnpj)) throw new Error("esse certificado não é do CNPJ " + cfg.cnpj);
    if (new Date(meu.validTo).getTime() < Date.now()) throw new Error("esse certificado venceu em " + new Date(meu.validTo).toLocaleDateString("pt-BR"));
    fs.writeFileSync(PEM, key + "\n" + meu.toString()); certCache = null;
    return { nome: cert().nome, validade: cert().validade };
  }
  // ---------- assinatura XML (enveloped, C14N, RSA-SHA1 - padrão da NF-e). O XML é montado já canônico (sem espaços, sem <a/>) ----------
  function assinar(el, id) {
    const C = cert(); if (!C) throw new Error("certificado não instalado");
    const canon = el.replace(/^<(\w+)/, `<$1 xmlns="${NS}"`); // C14N do elemento: herda o xmlns do pai, que vem antes dos atributos
    const dig = crypto.createHash("sha1").update(canon, "utf8").digest("base64");
    const si = `<SignedInfo xmlns="${DS}"><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></CanonicalizationMethod><SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"></SignatureMethod><Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"></Transform><Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"></Transform></Transforms><DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"></DigestMethod><DigestValue>${dig}</DigestValue></Reference></SignedInfo>`;
    const sv = crypto.sign("RSA-SHA1", Buffer.from(si, "utf8"), C.key).toString("base64");
    return `<Signature xmlns="${DS}">${si.replace(` xmlns="${DS}"`, "")}<SignatureValue>${sv}</SignatureValue><KeyInfo><X509Data><X509Certificate>${C.b64}</X509Certificate></X509Data></KeyInfo></Signature>`;
  }
  // ---------- conversa com a SEFAZ (SOAP 1.2, certificado do cliente no TLS) ----------
  function soap(amb, servico, acao, corpo) {
    const C = cert(); if (!C) return Promise.reject(new Error("certificado não instalado"));
    const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    const u = new URL(WS[amb].base + servico + ".asmx");
    return new Promise((ok, falha) => {
      const rq = (u.protocol === "http:" ? http : https).request({ hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: "POST", key: C.key, cert: C.certPem, rejectUnauthorized: false, timeout: 30000, // a SEFAZ usa a cadeia ICP-Brasil, que não vem no Node
        headers: { "Content-Type": `application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}/${acao}"`, "Content-Length": Buffer.byteLength(env) } }, (rs) => {
        let b = ""; rs.setEncoding("utf8"); rs.on("data", (d) => (b += d)); rs.on("end", () => (rs.statusCode >= 500 && !/cStat/.test(b) ? falha(new Error("a SEFAZ respondeu " + rs.statusCode)) : ok(b)));
      });
      rq.on("timeout", () => rq.destroy(Object.assign(new Error("a SEFAZ não respondeu (tempo esgotado)"), { semResposta: true })));
      rq.on("error", (e) => falha(e.semResposta ? e : Object.assign(new Error("sem conexão com a SEFAZ (" + (e.code || e.message) + ")"), { semResposta: true })));
      rq.end(env);
    });
  }
  async function statusSefaz() {
    const cfg = ler(), amb = cfg.ambiente === 1 ? 1 : 2;
    const r = await soap(amb, "NFeStatusServico4", "nfeStatusServicoNF", `<consStatServ xmlns="${NS}" versao="4.00"><tpAmb>${amb}</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ>`);
    return { amb, cStat: tag(r, "cStat"), xMotivo: tag(r, "xMotivo"), ok: tag(r, "cStat") === "107" };
  }
  // ---------- monta a NFC-e ----------
  // ped(s): pedidos já PAGOS; modo "discriminado" (cada item) ou "simples" (1 linha REFEICAO com o total); cpf opcional
  function montar(peds, { cpf, modo }, pags, cfg, amb, serie, nNF) {
    const tab = (k) => ({ ...CLASSES[k], ...((cfg.tabela || {})[k] || {}) }), E = cfg.emit;
    let linhas;
    const itens = peds.flatMap((p) => p.itens || []).filter((c) => c.preco * (c.qtd || 1) > 0);
    const total = c2(itens.reduce((s, c) => s + c.preco * (c.qtd || 1), 0));
    if (!(total > 0)) throw new Error("pedido sem valor");
    if (modo === "simples") linhas = [{ k: "refeicao", qtd: 1, un: total, v: total }];
    else linhas = itens.map((c) => ({ k: classe(c), qtd: c.qtd || 1, un: c2(c.preco), v: c2(c.preco * (c.qtd || 1)) }));
    const cNF = String(crypto.randomInt(10000000, 99999999)), aamm = agoraSP().slice(2, 4) + agoraSP().slice(5, 7);
    const base = "35" + aamm + cfg.cnpj + "65" + String(serie).padStart(3, "0") + String(nNF).padStart(9, "0") + "1" + cNF, chave = base + dv11(base);
    let vTotTrib = 0, vIBS = 0, vCBS = 0;
    const dets = linhas.map((l, i) => {
      const t = tab(l.k), st = t.CSOSN === "500", trib = c2(l.v * 0.12), ibs = c2(l.v * 0.001), cbs = c2(l.v * 0.009); vTotTrib += trib; vIBS += ibs; vCBS += cbs;
      const xProd = amb === 2 && i === 0 ? HOMOLOG_XPROD : txtNota(t.xProd, 120);
      return `<det nItem="${i + 1}"><prod><cProd>${esc(t.cProd)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${xProd}</xProd><NCM>${t.NCM}</NCM>${t.CEST ? `<CEST>${t.CEST}</CEST>` : ""}<CFOP>${t.CFOP}</CFOP><uCom>UN</uCom><qCom>${f4(l.qtd)}</qCom><vUnCom>${f10(l.un)}</vUnCom><vProd>${f2(l.v)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>${f4(l.qtd)}</qTrib><vUnTrib>${f10(l.un)}</vUnTrib><indTot>1</indTot></prod>`
        + `<imposto><vTotTrib>${f2(trib)}</vTotTrib><ICMS>${st ? `<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN><vBCSTRet>0.00</vBCSTRet><pST>0.0000</pST><vICMSSubstituto>0.00</vICMSSubstituto><vICMSSTRet>0.00</vICMSSTRet></ICMSSN500>` : `<ICMSSN102><orig>0</orig><CSOSN>${t.CSOSN}</CSOSN></ICMSSN102>`}</ICMS>`
        + `<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>`
        + `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${f2(l.v)}</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>${f2(ibs)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${f2(ibs)}</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>${f2(cbs)}</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>`;
    }).join("");
    vTotTrib = c2(vTotTrib); vIBS = c2(vIBS); vCBS = c2(vCBS);
    // pagamento: soma por forma; dinheiro com troco = valor entregue + vTroco (soma dos vPag - vTroco = total da nota)
    const porF = {}; let troco = 0;
    for (const g of pags) { const f = TPAG[g.forma] ? g.forma : "cartao"; porF[f] = c2((porF[f] || 0) + g.valor); if (g.forma === "dinheiro" && g.troco > 0) troco = c2(troco + g.troco); }
    const somaPag = c2(Object.values(porF).reduce((s, v) => s + v, 0));
    if (Math.abs(somaPag - total) > 0.009) { // pagou diferente do total dos itens (ex.: parte foi pra conta): a nota sai com o que foi recebido
      throw new Error("o que foi recebido (R$ " + f2(somaPag) + ") não bate com o total do pedido (R$ " + f2(total) + ")");
    }
    if (troco && porF.dinheiro) porF.dinheiro = c2(porF.dinheiro + troco);
    const pag = Object.entries(porF).map(([f, v]) => `<detPag><tPag>${TPAG[f]}</tPag>${f === "cartao" ? "<xPag>Cartao</xPag>" : ""}<vPag>${f2(v)}</vPag>${["credito", "debito", "pix"].includes(f) ? "<card><tpIntegra>2</tpIntegra></card>" : ""}</detPag>`).join("") + (troco ? `<vTroco>${f2(troco)}</vTroco>` : "");
    const entregaDom = peds.some((p) => p.tipo === "delivery" && p.entrega !== "retirada");
    const cpfL = cpf && cpfOk(cpf) ? String(cpf).replace(/\D/g, "") : "";
    const inf = `<infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>35</cUF><cNF>${cNF}</cNF><natOp>Venda</natOp><mod>65</mod><serie>${serie}</serie><nNF>${nNF}</nNF><dhEmi>${agoraSP()}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${E.cMun}</cMunFG><tpImp>4</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${amb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>${entregaDom ? 4 : 1}</indPres>${entregaDom ? "<indIntermed>0</indIntermed>" : ""}<procEmi>0</procEmi><verProc>DaLucia 1.0</verProc></ide>`
      + `<emit><CNPJ>${cfg.cnpj}</CNPJ><xNome>${esc(E.xNome)}</xNome>${E.xFant ? `<xFant>${esc(E.xFant)}</xFant>` : ""}<enderEmit><xLgr>${esc(E.xLgr)}</xLgr><nro>${esc(E.nro)}</nro><xBairro>${esc(E.xBairro)}</xBairro><cMun>${E.cMun}</cMun><xMun>${esc(E.xMun)}</xMun><UF>${E.UF}</UF><CEP>${E.CEP}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>${E.fone ? `<fone>${E.fone}</fone>` : ""}</enderEmit><IE>${E.IE}</IE><CRT>${E.CRT || 1}</CRT></emit>`
      + (cpfL ? `<dest><CPF>${cpfL}</CPF><indIEDest>9</indIEDest></dest>` : "")
      + dets
      + `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${f2(total)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${f2(total)}</vNF><vTotTrib>${f2(vTotTrib)}</vTotTrib></ICMSTot>`
      + `<IBSCBSTot><vBCIBSCBS>${f2(total)}</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${f2(vIBS)}</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${f2(vIBS)}</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>${f2(vCBS)}</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot></total>`
      + `<transp><modFrete>9</modFrete></transp><pag>${pag}</pag>`
      + `<infAdic><infAdFisco>Documento emitido por ME ou EPP optante pelo simples nacional. nao gera permissao de credito fiscal IPI, ISS E ICMS.</infAdFisco><infCpl>Trib aprox R$ ${f2(c2(vTotTrib / 2))} Fed, R$ ${f2(vTotTrib - c2(vTotTrib / 2))} Est Fonte IBPT</infCpl></infAdic></infNFe>`;
    const hash = crypto.createHash("sha1").update(`${chave}|2|${amb}|${Number(cfg.cscId)}${cfg.csc}`).digest("hex").toUpperCase();
    const qr = `${WS[amb].qr}?p=${chave}|2|${amb}|${Number(cfg.cscId)}|${hash}`;
    const nfe = `<NFe xmlns="${NS}">${inf}<infNFeSupl><qrCode>${qr}</qrCode><urlChave>${WS[amb].consulta}</urlChave></infNFeSupl>${assinar(inf, "NFe" + chave)}</NFe>`;
    return { nfe, chave, qr, total, vTotTrib, linhas: linhas.map((l) => ({ ...l, xProd: tab(l.k).xProd, cProd: tab(l.k).cProd })), pagL: Object.entries(porF).map(([f, v]) => ({ forma: f, valor: v })), troco, cpf: cpfL };
  }
  // ---------- emitir (uma de cada vez: a numeração não pode repetir) ----------
  let fila = Promise.resolve();
  function emitir(peds, opts, pags) { const r = fila.then(() => emitir0(peds, opts, pags)); fila = r.catch(() => {}); return r; }
  async function emitir0(peds, opts, pags) {
    const cfg = ler(); if (!cfg || !cfg.csc) throw new Error("cupom fiscal não configurado");
    if (!cert()) throw new Error("falta instalar o certificado (Caixa → 🧾 Nota fiscal → senha do certificado)");
    const amb = cfg.ambiente === 1 ? 1 : 2, serie = Number(cfg.serie) || 2; cfg.numeros = cfg.numeros || {};
    for (let tent = 0; tent < 3; tent++) {
      const nNF = Number(cfg.numeros[amb]) || 1, m = montar(peds, opts, pags, cfg, amb, serie, nNF);
      cfg.numeros[amb] = nNF + 1; salvar(cfg); // reserva o número antes de mandar (nunca dois cupons com o mesmo número)
      let r;
      try { r = await soap(amb, "NFeAutorizacao4", "nfeAutorizacaoLote", `<enviNFe xmlns="${NS}" versao="4.00"><idLote>${String(Date.now()).slice(-15)}</idLote><indSinc>1</indSinc>${m.nfe}</enviNFe>`); }
      catch (e) {
        if (!e.semResposta) throw e;
        const c = await consultar(amb, m.chave).catch(() => null); // não sabe se chegou: pergunta pela chave
        if (c && c.cStat === "100") return guardar(m, c.prot, amb, serie, nNF, c.protXml);
        throw new Error(e.message + ". O cupom nº " + nNF + " não foi autorizado; tente de novo.");
      }
      const prot = tag(r, "protNFe"), cs = tag(prot || "", "cStat") || tag(r, "cStat"), mot = tag(prot || "", "xMotivo") || tag(r, "xMotivo");
      if (cs === "100" || cs === "150") return guardar(m, { nProt: tag(prot, "nProt"), dhRecbto: tag(prot, "dhRecbto") }, amb, serie, nNF, "<protNFe versao=\"4.00\">" + prot + "</protNFe>");
      if (cs === "539" || cs === "204") continue; // número já usado (ex.: emitido em outro lugar): vai pro próximo
      if (!["217"].includes(cs)) { const atual = ler(); if (atual && Number(atual.numeros[amb]) === nNF + 1) { atual.numeros[amb] = nNF; salvar(atual); } } // rejeitado: o número não foi usado, fica pro próximo cupom
      throw new Error("SEFAZ recusou o cupom: " + (cs || "?") + " - " + (mot || "sem motivo"));
    }
    throw new Error("a SEFAZ recusou 3 números seguidos (já usados)");
  }
  async function consultar(amb, chave) {
    const r = await soap(amb, "NFeConsultaProtocolo4", "nfeConsultaNF", `<consSitNFe xmlns="${NS}" versao="4.00"><tpAmb>${amb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`);
    const prot = tag(r, "protNFe");
    return { cStat: prot ? tag(prot, "cStat") : tag(r, "cStat"), prot: prot ? { nProt: tag(prot, "nProt"), dhRecbto: tag(prot, "dhRecbto") } : null, protXml: prot ? "<protNFe versao=\"4.00\">" + prot + "</protNFe>" : "" };
  }
  function guardar(m, prot, amb, serie, nNF, protXml) {
    const dir = path.join(PASTA, amb === 1 ? "producao" : "homologacao", new Date().toLocaleDateString("en-CA").slice(0, 7)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, m.chave + "-procNFe.xml"), `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NS}">${m.nfe}${protXml || ""}</nfeProc>`);
    return { amb, serie, numero: nNF, chave: m.chave, prot: prot && prot.nProt, dhAut: prot && prot.dhRecbto, quando: Date.now(), valor: m.total, cpf: m.cpf || undefined, qr: m.qr, urlChave: WS[amb].consulta, vTotTrib: m.vTotTrib, linhas: m.linhas, pagL: m.pagL, troco: m.troco, status: "autorizada" };
  }
  // ---------- cancelar (até 30 min depois, motivo com 15+ letras) ----------
  async function cancelar(nf, motivo) {
    const cfg = ler(), amb = nf.amb, just = String(motivo || "").trim();
    if (just.length < 15) throw new Error("o motivo precisa ter pelo menos 15 letras");
    const id = "ID110111" + nf.chave + "01";
    const inf = `<infEvento Id="${id}"><cOrgao>35</cOrgao><tpAmb>${amb}</tpAmb><CNPJ>${cfg.cnpj}</CNPJ><chNFe>${nf.chave}</chNFe><dhEvento>${agoraSP()}</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${nf.prot}</nProt><xJust>${esc(semAc(just)).slice(0, 255)}</xJust></detEvento></infEvento>`;
    const r = await soap(amb, "NFeRecepcaoEvento4", "nfeRecepcaoEvento", `<envEvento xmlns="${NS}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote><evento xmlns="${NS}" versao="1.00">${inf}${assinar(inf, id)}</evento></envEvento>`);
    const ret = tag(r, "retEvento") || r, cs = tag(ret, "cStat"), mot = tag(ret, "xMotivo");
    if (cs !== "135" && cs !== "155") throw new Error("SEFAZ não cancelou: " + (cs || "?") + " - " + (mot || ""));
    const dir = path.join(PASTA, amb === 1 ? "producao" : "homologacao", new Date().toLocaleDateString("en-CA").slice(0, 7)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, nf.chave + "-cancelamento.xml"), r);
    return { cancProt: tag(ret, "nProt"), canceladaEm: Date.now(), motivoCanc: just };
  }
  function status() {
    const cfg = ler(), C = cert();
    const e = (cfg && cfg.emit) || {};
    return { emit: { xNome: e.xNome, CNPJ: e.CNPJ, xLgr: e.xLgr, nro: e.nro, xBairro: e.xBairro, xMun: e.xMun, UF: e.UF }, configurado: !!(cfg && cfg.csc && cfg.emit), certificado: C ? { nome: C.nome, validade: C.validade } : null, ambiente: cfg && cfg.ambiente === 1 ? 1 : 2, serie: cfg ? Number(cfg.serie) || 2 : 2, proximo: cfg ? (cfg.numeros || {})[cfg.ambiente === 1 ? 1 : 2] || 1 : 1, cscId: cfg && cfg.cscId };
  }
  function mudarAmbiente(a) { const cfg = ler(); if (!cfg) throw new Error("sem configuração"); cfg.ambiente = a === 1 ? 1 : 2; salvar(cfg); return status(); }
  return { status, instalarCertificado, statusSefaz, emitir, cancelar, mudarAmbiente, classe, cpfOk, _montar: montar, _assinar: assinar };
};
module.exports.classe = classe; module.exports.cpfOk = cpfOk; module.exports.CLASSES = CLASSES;
