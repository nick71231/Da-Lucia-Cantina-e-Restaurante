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
const WS55 = { 1: "https://nfe.fazenda.sp.gov.br/ws/", 2: "https://homologacao.nfe.fazenda.sp.gov.br/ws/" }; // NF-e (modelo 55, empresas): outro endereço da SEFAZ-SP
// SEFAZ_TESTE: só nos testes automáticos (testes.js), uma SEFAZ de mentira em http://localhost
if (process.env.SEFAZ_TESTE) for (const a of [1, 2]) { WS[a] = { ...WS[a], base: process.env.SEFAZ_TESTE }; WS55[a] = process.env.SEFAZ_TESTE; }
const HOMOLOG_XPROD = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL";

// ---------- produtos fiscais (o que vai na nota). Igual ao ViaVale, com o imposto do refrigerante e da água corrigido
// (pesquisa 24/11/2026: refrigerante e cerveja continuam na ST em SP; água saiu da ST em 01/07/2026 - Portaria SRE 9/2026).
// O contador pode mudar qualquer linha em dados/fiscal.json -> "tabela": { "refri_lata": { "CFOP": "..." } }
const CLASSES = {
  // contadora 24/11: refeição pronta/marmitex = 2106.90.90, CFOP 5101 (produção do próprio restaurante), CSOSN 102, SEM CEST (CEST é só pra item com ST)
  refeicao: { cProd: "REF", xProd: "REFEICAO", NCM: "21069090", CFOP: "5101", CSOSN: "102" },
  marmitex: { cProd: "MTX", xProd: "MARMITEX", NCM: "21069090", CFOP: "5101", CSOSN: "102" },
  entrega: { cProd: "ENTREGA", xProd: "TAXA DE ENTREGA", NCM: "21069090", CFOP: "5101", CSOSN: "102" },
  refri_lata: { cProd: "REFRILATA", xProd: "REFRIGERANTE EM LATA", NCM: "22021000", CEST: "0301002", CFOP: "5405", CSOSN: "500" },
  refri_600: { cProd: "REFRI600", xProd: "REFRIGERANTE 600ML", NCM: "22021000", CEST: "0301001", CFOP: "5405", CSOSN: "500" },
  refri_2l: { cProd: "REFRI2L", xProd: "REFRIGERANTE 2 LITROS", NCM: "22021000", CEST: "0301001", CFOP: "5405", CSOSN: "500" },
  refri: { cProd: "REFRI", xProd: "REFRIGERANTE", NCM: "22021000", CEST: "0301100", CFOP: "5405", CSOSN: "500" },
  agua: { cProd: "AGUA", xProd: "AGUA MINERAL", NCM: "22011000", CFOP: "5102", CSOSN: "102" },
  suco: { cProd: "SUCONATURAL", xProd: "SUCO NATURAL", NCM: "20098913", CFOP: "5102", CSOSN: "102" },
  bebida: { cProd: "BEBIDA", xProd: "BEBIDA NAO ALCOOLICA", NCM: "22029900", CFOP: "5102", CSOSN: "102" }, // Del Valle (néctar) - contadora 24/11
  cha: { cProd: "CHA", xProd: "CHA PRONTO (ICE TEA)", NCM: "22021000", CEST: "1711200", CFOP: "5102", CSOSN: "102" }, // Ice Tea - contadora 24/11
  cerveja: { cProd: "CERVEJA", xProd: "CERVEJA LONG NECK", NCM: "22030000", CEST: "0302101", CFOP: "5405", CSOSN: "500" },
  sorvete: { cProd: "SORVETE", xProd: "SORVETE", NCM: "21050010", CEST: "2300100", CFOP: "5102", CSOSN: "102" }, // contadora 24/11: saiu da ST em 01/07/2026
  doce: { cProd: "DOCE", xProd: "SOBREMESA", NCM: "21069090", CFOP: "5102", CSOSN: "102" },
  // café da manhã das empresas (NF-e). O ViaVale usava NCM 2101.12.00; aqui sem CEST e CFOP 5101 (feito no restaurante), como a refeição - conferir com a contadora
  cafe: { cProd: "CAFE", xProd: "CAFE DA MANHA", NCM: "21011200", CFOP: "5101", CSOSN: "102" },
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
    if (/ice tea|\bcha\b|\bmate\b/.test(n)) return "cha";
    if (/del valle|gatorade|isoton|energ|nectar/.test(n)) return "bebida";
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
const cnpjOk = (v) => { const s = String(v || "").replace(/\D/g, ""); if (s.length !== 14 || /^(\d)\1+$/.test(s)) return false; const dv = (n) => { let soma = 0, p = n - 7; for (let i = 0; i < n; i++) { soma += Number(s[i]) * p--; if (p < 2) p = 9; } const r = soma % 11; return r < 2 ? 0 : 11 - r; }; return dv(12) === Number(s[12]) && dv(13) === Number(s[13]); };
const dv11 = (s) => { let soma = 0, p = 2; for (let i = s.length - 1; i >= 0; i--) { soma += Number(s[i]) * p; p = p === 9 ? 2 : p + 1; } const r = soma % 11; return r < 2 ? 0 : 11 - r; };
const TPAG = { dinheiro: "01", credito: "03", debito: "04", loja: "05", refeicao: "11", pix: "17", cartao: "99" }; // loja = crédito loja (venda na conta/fiado, paga depois)

// ZIP simples (deflate, nomes em UTF-8), sem biblioteca: pras notas do mês da contadora
const zlib = require("zlib");
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipar(files) {
  const loc = [], cen = []; let off = 0; const d = new Date(), dosT = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosD = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const nome = Buffer.from(f.nome, "utf8"), comp = zlib.deflateRawSync(f.dados), crc = crc32(f.dados);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(dosT, 10); h.writeUInt16LE(dosD, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(f.dados.length, 22); h.writeUInt16LE(nome.length, 26); h.writeUInt16LE(0, 28);
    loc.push(h, nome, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(dosT, 12); c.writeUInt16LE(dosD, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.dados.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    cen.push(c, nome); off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...loc, cd, e]);
}
module.exports = function criarFiscal({ DIR_DADOS }) {
  const ARQ = path.join(DIR_DADOS, "fiscal.json"), PEM = path.join(DIR_DADOS, "certificado.pem"), PASTA = path.join(DIR_DADOS, "nfce"), PASTA_NFE = path.join(DIR_DADOS, "nfe");
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
  function soap(amb, servico, acao, corpo, mod) { // mod 55 = NF-e (outro endereço); senão NFC-e
    const C = cert(); if (!C) return Promise.reject(new Error("certificado não instalado"));
    const env = `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${servico}">${corpo}</nfeDadosMsg></soap12:Body></soap12:Envelope>`;
    const u = new URL((mod === 55 ? WS55[amb] : WS[amb].base) + servico + ".asmx");
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
  // ---------- pedaços iguais na NFC-e (cupom) e na NF-e (empresas) ----------
  function detsXml(linhas, tab, amb) { // linhas: [{ k, qtd, un, v, xProd? }] -> <det> de cada uma + tributos aproximados
    let vTotTrib = 0, vIBS = 0, vCBS = 0;
    const dets = linhas.map((l, i) => {
      const t = tab(l.k), st = t.CSOSN === "500", trib = c2(l.v * 0.12), ibs = c2(l.v * 0.001), cbs = c2(l.v * 0.009); vTotTrib += trib; vIBS += ibs; vCBS += cbs;
      const xProd = amb === 2 && i === 0 ? HOMOLOG_XPROD : txtNota(l.xProd || t.xProd, 120);
      return `<det nItem="${i + 1}"><prod><cProd>${esc(t.cProd)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${xProd}</xProd><NCM>${t.NCM}</NCM>${t.CEST ? `<CEST>${t.CEST}</CEST>` : ""}<CFOP>${t.CFOP}</CFOP><uCom>UN</uCom><qCom>${f4(l.qtd)}</qCom><vUnCom>${f10(l.un)}</vUnCom><vProd>${f2(l.v)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>${f4(l.qtd)}</qTrib><vUnTrib>${f10(l.un)}</vUnTrib><indTot>1</indTot></prod>`
        + `<imposto><vTotTrib>${f2(trib)}</vTotTrib><ICMS>${st ? `<ICMSSN500><orig>0</orig><CSOSN>500</CSOSN><vBCSTRet>0.00</vBCSTRet><pST>0.0000</pST><vICMSSubstituto>0.00</vICMSSubstituto><vICMSSTRet>0.00</vICMSSTRet></ICMSSN500>` : `<ICMSSN102><orig>0</orig><CSOSN>${t.CSOSN}</CSOSN></ICMSSN102>`}</ICMS>`
        + `<PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS>`
        + `<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>${f2(l.v)}</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>${f2(ibs)}</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${f2(ibs)}</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>${f2(cbs)}</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>`;
    }).join("");
    vTotTrib = c2(vTotTrib); vIBS = c2(vIBS); vCBS = c2(vCBS);
    return { dets, vTotTrib, vIBS, vCBS };
  }
  const emitXml = (cfg) => { const E = cfg.emit; return `<emit><CNPJ>${cfg.cnpj}</CNPJ><xNome>${esc(E.xNome)}</xNome>${E.xFant ? `<xFant>${esc(E.xFant)}</xFant>` : ""}<enderEmit><xLgr>${esc(E.xLgr)}</xLgr><nro>${esc(E.nro)}</nro><xBairro>${esc(E.xBairro)}</xBairro><cMun>${E.cMun}</cMun><xMun>${esc(E.xMun)}</xMun><UF>${E.UF}</UF><CEP>${E.CEP}</CEP><cPais>1058</cPais><xPais>BRASIL</xPais>${E.fone ? `<fone>${E.fone}</fone>` : ""}</enderEmit><IE>${E.IE}</IE><CRT>${E.CRT || 1}</CRT></emit>`; };
  const totalXml = (total, vTotTrib, vIBS, vCBS) => `<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${f2(total)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${f2(total)}</vNF><vTotTrib>${f2(vTotTrib)}</vTotTrib></ICMSTot>`
      + `<IBSCBSTot><vBCIBSCBS>${f2(total)}</vBCIBSCBS><gIBS><gIBSUF><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSUF>${f2(vIBS)}</vIBSUF></gIBSUF><gIBSMun><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>${f2(vIBS)}</vIBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gIBS><gCBS><vDif>0.00</vDif><vDevTrib>0.00</vDevTrib><vCBS>${f2(vCBS)}</vCBS><vCredPres>0.00</vCredPres><vCredPresCondSus>0.00</vCredPresCondSus></gCBS></IBSCBSTot></total>`;
  const infAdicXml = (obs, vTotTrib) => `<infAdic><infAdFisco>Documento emitido por ME ou EPP optante pelo simples nacional. nao gera permissao de credito fiscal IPI, ISS E ICMS.</infAdFisco><infCpl>${obs ? esc(semAc(obs)).slice(0, 300) + " | " : ""}Trib aprox R$ ${f2(c2(vTotTrib / 2))} Fed, R$ ${f2(vTotTrib - c2(vTotTrib / 2))} Est Fonte IBPT</infCpl></infAdic>`;;
  // ---------- monta a NFC-e ----------
  // ped(s): pedidos já PAGOS; modo "discriminado" (cada item) ou "simples" (1 linha REFEICAO com o total); cpf opcional
  function montar(peds, { cpf, modo, obs }, pags, cfg, amb, serie, nNF) { // obs: observação livre no cupom (ex.: "Cupom referente ao dia 09/11/2026")
    const tab = (k) => ({ ...CLASSES[k], ...((cfg.tabela || {})[k] || {}) }), E = cfg.emit;
    let linhas;
    const itens = peds.flatMap((p) => p.itens || []).filter((c) => c.preco * (c.qtd || 1) > 0);
    const total = c2(itens.reduce((s, c) => s + c.preco * (c.qtd || 1), 0));
    if (!(total > 0)) throw new Error("pedido sem valor");
    if (modo === "simples") linhas = [{ k: "refeicao", qtd: 1, un: total, v: total }];
    else linhas = itens.map((c) => ({ k: classe(c), qtd: c.qtd || 1, un: c2(c.preco), v: c2(c.preco * (c.qtd || 1)) }));
    const cNF = String(crypto.randomInt(10000000, 99999999)), aamm = agoraSP().slice(2, 4) + agoraSP().slice(5, 7);
    const base = "35" + aamm + cfg.cnpj + "65" + String(serie).padStart(3, "0") + String(nNF).padStart(9, "0") + "1" + cNF, chave = base + dv11(base);
    const { dets, vTotTrib, vIBS, vCBS } = detsXml(linhas, tab, amb);
    // pagamento: soma por forma; dinheiro com troco = valor entregue + vTroco (soma dos vPag - vTroco = total da nota)
    const porF = {}; let troco = 0;
    for (const g of pags) { const f = TPAG[g.forma] ? g.forma : "cartao"; porF[f] = c2((porF[f] || 0) + g.valor); if (g.forma === "dinheiro" && g.troco > 0) troco = c2(troco + g.troco); }
    const somaPag = c2(Object.values(porF).reduce((s, v) => s + v, 0));
    if (Math.abs(somaPag - total) > 0.009) { // pagou diferente do total dos itens (ex.: parte foi pra conta): a nota sai com o que foi recebido
      throw new Error("o que foi recebido (R$ " + f2(somaPag) + ") não bate com o total do pedido (R$ " + f2(total) + ")");
    }
    if (troco && porF.dinheiro) porF.dinheiro = c2(porF.dinheiro + troco);
    const pag = Object.entries(porF).map(([f, v]) => `<detPag><tPag>${TPAG[f]}</tPag>${f === "cartao" ? "<xPag>Cartao</xPag>" : ""}<vPag>${f2(v)}</vPag>${["credito", "debito", "pix"].includes(f) ? "<card><tpIntegra>2</tpIntegra></card>" : ""}</detPag>`).join("") + (troco ? `<vTroco>${f2(troco)}</vTroco>` : "");
    const cpfL = cpf && cpfOk(cpf) ? String(cpf).replace(/\D/g, "") : "";
    // entrega em casa (indPres 4) só com o CPF do cliente: sem CPF a SEFAZ recusa (787). Sem CPF sai como venda presencial (dona 25/11)
    const entregaDom = !!cpfL && peds.some((p) => p.tipo === "delivery" && p.entrega !== "retirada");
    const inf = `<infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>35</cUF><cNF>${cNF}</cNF><natOp>Venda</natOp><mod>65</mod><serie>${serie}</serie><nNF>${nNF}</nNF><dhEmi>${agoraSP()}</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${E.cMun}</cMunFG><tpImp>4</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${amb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>${entregaDom ? 4 : 1}</indPres>${entregaDom ? "<indIntermed>0</indIntermed>" : ""}<procEmi>0</procEmi><verProc>DaLucia 1.0</verProc></ide>`
      + emitXml(cfg)
      + (cpfL ? `<dest><CPF>${cpfL}</CPF><indIEDest>9</indIEDest></dest>` : "")
      + dets
      + totalXml(total, vTotTrib, vIBS, vCBS)
      + `<transp><modFrete>9</modFrete></transp><pag>${pag}</pag>`
      + infAdicXml(obs, vTotTrib) + "</infNFe>";
    const hash = crypto.createHash("sha1").update(`${chave}|2|${amb}|${Number(cfg.cscId)}${cfg.csc}`).digest("hex").toUpperCase();
    const qr = `${WS[amb].qr}?p=${chave}|2|${amb}|${Number(cfg.cscId)}|${hash}`;
    const nfe = `<NFe xmlns="${NS}">${inf}<infNFeSupl><qrCode>${qr}</qrCode><urlChave>${WS[amb].consulta}</urlChave></infNFeSupl>${assinar(inf, "NFe" + chave)}</NFe>`;
    return { nfe, chave, qr, total, vTotTrib, obs: obs || undefined, linhas: linhas.map((l) => ({ ...l, xProd: tab(l.k).xProd, cProd: tab(l.k).cProd })), pagL: Object.entries(porF).map(([f, v]) => ({ forma: f, valor: v })), troco, cpf: cpfL };
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
      console.error("cupom fiscal nº " + nNF + " série " + serie + ": " + (cs || "?") + " - " + (mot || "")); // fica no log (logs/erros.log) pra conferir depois
      if (cs === "539" || cs === "204") continue; // número já usado (ex.: emitido em outro lugar): vai pro próximo
      if (!["217"].includes(cs)) { const atual = ler(); if (atual && Number(atual.numeros[amb]) === nNF + 1) { atual.numeros[amb] = nNF; salvar(atual); } } // rejeitado: o número não foi usado, fica pro próximo cupom
      throw new Error("SEFAZ recusou o cupom: " + (cs || "?") + " - " + (mot || "sem motivo"));
    }
    throw new Error("a SEFAZ recusou 3 números seguidos (já usados)");
  }
  async function consultar(amb, chave) {
    const r = await soap(amb, "NFeConsultaProtocolo4", "nfeConsultaNF", `<consSitNFe xmlns="${NS}" versao="4.00"><tpAmb>${amb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chave}</chNFe></consSitNFe>`, String(chave).slice(20, 22) === "55" ? 55 : 65);
    const prot = tag(r, "protNFe");
    return { cStat: prot ? tag(prot, "cStat") : tag(r, "cStat"), prot: prot ? { nProt: tag(prot, "nProt"), dhRecbto: tag(prot, "dhRecbto") } : null, protXml: prot ? "<protNFe versao=\"4.00\">" + prot + "</protNFe>" : "" };
  }
  function guardar(m, prot, amb, serie, nNF, protXml) {
    const dir = path.join(PASTA, amb === 1 ? "producao" : "homologacao", new Date().toLocaleDateString("en-CA").slice(0, 7)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, m.chave + "-procNFe.xml"), `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NS}">${m.nfe}${protXml || ""}</nfeProc>`);
    return { amb, serie, numero: nNF, chave: m.chave, prot: prot && prot.nProt, dhAut: prot && prot.dhRecbto, quando: Date.now(), valor: m.total, cpf: m.cpf || undefined, qr: m.qr, urlChave: WS[amb].consulta, vTotTrib: m.vTotTrib, linhas: m.linhas, pagL: m.pagL, troco: m.troco, obs: m.obs, status: "autorizada" };
  }
  // ---------- cancelar (cupom NFC-e até 30 min depois; NF-e até 24 h), motivo com 15+ letras ----------
  async function cancelar(nf, motivo) {
    const cfg = ler(), amb = nf.amb, just = String(motivo || "").trim(), mod = String(nf.chave).slice(20, 22) === "55" ? 55 : 65;
    if (just.length < 15) throw new Error("o motivo precisa ter pelo menos 15 letras");
    const id = "ID110111" + nf.chave + "01";
    const inf = `<infEvento Id="${id}"><cOrgao>35</cOrgao><tpAmb>${amb}</tpAmb><CNPJ>${cfg.cnpj}</CNPJ><chNFe>${nf.chave}</chNFe><dhEvento>${agoraSP()}</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento><nProt>${nf.prot}</nProt><xJust>${esc(semAc(just)).slice(0, 255)}</xJust></detEvento></infEvento>`;
    const evento = `<evento xmlns="${NS}" versao="1.00">${inf}${assinar(inf, id)}</evento>`;
    const r = await soap(amb, "NFeRecepcaoEvento4", "nfeRecepcaoEvento", `<envEvento xmlns="${NS}" versao="1.00"><idLote>${String(Date.now()).slice(-15)}</idLote>${evento}</envEvento>`, mod);
    const ret = tag(r, "retEvento") || r, cs = tag(ret, "cStat"), mot = tag(ret, "xMotivo");
    if (cs !== "135" && cs !== "155") throw new Error("SEFAZ não cancelou: " + (cs || "?") + " - " + (mot || ""));
    // guarda no formato oficial (procEventoNFe = evento assinado + resposta da SEFAZ), na pasta do mês da nota (é o que a contadora importa)
    const dir = path.join(mod === 55 ? PASTA_NFE : PASTA, amb === 1 ? "producao" : "homologacao", new Date(nf.quando || Date.now()).toLocaleDateString("en-CA").slice(0, 7)); fs.mkdirSync(dir, { recursive: true });
    const retXml = (r.match(/<retEvento[\s\S]*?<\/retEvento>/) || [""])[0];
    fs.writeFileSync(path.join(dir, nf.chave + "-cancelamento.xml"), `<?xml version="1.0" encoding="UTF-8"?><procEventoNFe xmlns="${NS}" versao="1.00">${evento}${retXml}</procEventoNFe>`);
    return { cancProt: tag(ret, "nProt"), canceladaEm: Date.now(), motivoCanc: just };
  }
  // ======================= NF-e (modelo 55): nota pra EMPRESA (dona 25/11) =======================
  // Igual às NF-e que o ViaVale emitia pra este CNPJ (Caramuru, Pulse...): destinatário com endereço, itens com quantidade
  // (ex.: 397 MARMITEX x 22,00), sem QR Code. Série própria (dados/fiscal.json -> "nfe": { "serie": 50, "numeros": {...} });
  // o ViaVale usa a série 1. XML em dados/nfe/<producao|homologacao>/AAAA-MM e o índice em dados/nfe/notas.json.
  const ARQ_NFE = path.join(PASTA_NFE, "notas.json"), ARQ_EMP = path.join(PASTA_NFE, "empresas.json");
  const lerJ = (a, pad) => { try { return JSON.parse(fs.readFileSync(a, "utf8")); } catch (e) { return pad; } };
  const gravaJ = (a, v) => { fs.mkdirSync(path.dirname(a), { recursive: true }); fs.writeFileSync(a + ".tmp", JSON.stringify(v, null, 1)); fs.renameSync(a + ".tmp", a); };
  const TPAG_NFE = { dinheiro: "01", credito: "03", debito: "04", boleto: "15", deposito: "16", pix: "17", transferencia: "18", prazo: "90" }; // prazo = sem pagamento (a empresa paga depois)
  const nfeCfg = (cfg) => { cfg.nfe = cfg.nfe || {}; cfg.nfe.serie = Number(cfg.nfe.serie) || 50; cfg.nfe.numeros = cfg.nfe.numeros || {}; return cfg.nfe; };
  const MUN = (() => { try { return require("./municipios-sp"); } catch (e) { return {}; } })();
  const nomeMun = (s) => semAc(s).toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const desEsc = (v) => String(v || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  // confere e arruma o destinatário: { doc (CNPJ ou CPF), xNome, IE ("" = não contribuinte, "ISENTO"), xLgr, nro, xCpl, xBairro, xMun, cMun, UF, CEP, fone, email }
  function limparDest(d) {
    d = d || {}; const doc = String(d.doc || d.CNPJ || d.CPF || "").replace(/\D/g, ""), up = (x, n) => semAc(String(x || "")).toUpperCase().replace(/\s+/g, " ").trim().slice(0, n);
    if (doc.length === 14 ? !cnpjOk(doc) : doc.length === 11 ? !cpfOk(doc) : true) throw new Error("CNPJ (ou CPF) do destinatário inválido");
    const o = { doc, xNome: up(d.xNome, 60), IE: /isent/i.test(d.IE || "") ? "ISENTO" : String(d.IE || "").replace(/\D/g, "").slice(0, 14), xLgr: up(d.xLgr, 60), nro: up(d.nro, 60) || "SN", xCpl: up(d.xCpl, 60), xBairro: up(d.xBairro, 60), xMun: up(d.xMun, 60), UF: up(d.UF || "SP", 2), CEP: String(d.CEP || "").replace(/\D/g, "").slice(0, 8), fone: String(d.fone || "").replace(/\D/g, "").slice(0, 14), email: String(d.email || "").trim().slice(0, 60) };
    if (o.xNome.length < 2) throw new Error("falta o nome (razão social) do destinatário");
    if (!o.xLgr || !o.xBairro || !o.xMun) throw new Error("falta o endereço do destinatário (rua, bairro e cidade)");
    if (o.UF !== "SP") throw new Error("por enquanto só destinatário de SP (empresa de outro estado muda o imposto: fale com a contadora)");
    o.cMun = MUN[nomeMun(o.xMun)] || (/^35\d{5}$/.test(String(d.cMun || "")) ? String(d.cMun) : "");
    if (!o.cMun) throw new Error("não achei a cidade \"" + o.xMun + "\" em SP: confira o nome");
    if (doc.length === 11) o.IE = ""; // pessoa física: não contribuinte
    if (o.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) o.email = "";
    return o;
  }
  function montarNFe(d, cfg, amb, serie, nNF) { // d: { dest (já conferido), itens: [{ k, xProd?, qtd, un }], forma, obs }
    const tab = (k) => ({ ...CLASSES[k], ...((cfg.tabela || {})[k] || {}) }), D = d.dest;
    const linhas = (d.itens || []).map((c) => { const qtd = Math.round(Number(c.qtd) * 10000) / 10000, un = c2(c.un); return { k: CLASSES[c.k] ? c.k : "refeicao", xProd: c.xProd ? semAc(String(c.xProd)).toUpperCase().replace(/\s+/g, " ").trim().slice(0, 120) : "", qtd, un, v: c2(qtd * un) }; }).filter((l) => l.qtd > 0 && l.un > 0);
    if (!linhas.length) throw new Error("a nota precisa de pelo menos 1 item com quantidade e valor");
    if (linhas.length > 100) throw new Error("itens demais na nota");
    const total = c2(linhas.reduce((s, l) => s + l.v, 0)), forma = TPAG_NFE[d.forma] ? d.forma : "prazo";
    const agora = agoraSP(), cNF = String(crypto.randomInt(10000000, 99999999)), aamm = agora.slice(2, 4) + agora.slice(5, 7);
    const base = "35" + aamm + cfg.cnpj + "55" + String(serie).padStart(3, "0") + String(nNF).padStart(9, "0") + "1" + cNF, chave = base + dv11(base);
    const { dets, vTotTrib, vIBS, vCBS } = detsXml(linhas, tab, amb);
    const indIE = D.IE === "ISENTO" ? 2 : D.IE ? 1 : 9;
    const destNome = amb === 2 ? "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" : esc(D.xNome);
    const dest = `<dest>${D.doc.length === 14 ? `<CNPJ>${D.doc}</CNPJ>` : `<CPF>${D.doc}</CPF>`}<xNome>${destNome}</xNome><enderDest><xLgr>${esc(D.xLgr)}</xLgr><nro>${esc(D.nro)}</nro>${D.xCpl ? `<xCpl>${esc(D.xCpl)}</xCpl>` : ""}<xBairro>${esc(D.xBairro)}</xBairro><cMun>${D.cMun}</cMun><xMun>${esc(D.xMun)}</xMun><UF>${D.UF}</UF>${D.CEP.length === 8 ? `<CEP>${D.CEP}</CEP>` : ""}<cPais>1058</cPais><xPais>BRASIL</xPais>${D.fone.length >= 6 ? `<fone>${D.fone}</fone>` : ""}</enderDest><indIEDest>${indIE}</indIEDest>${indIE === 1 ? `<IE>${D.IE}</IE>` : ""}${D.email ? `<email>${esc(D.email)}</email>` : ""}</dest>`;
    const pag = `<detPag>${forma === "prazo" ? "<indPag>1</indPag>" : ""}<tPag>${TPAG_NFE[forma]}</tPag><vPag>${f2(forma === "prazo" ? 0 : total)}</vPag>${["credito", "debito", "pix"].includes(forma) ? "<card><tpIntegra>2</tpIntegra></card>" : ""}</detPag>`;
    // indFinal 1: a empresa consome as refeições (consumidor final); indPres 0 e o resto igual às NF-e do ViaVale já autorizadas
    const inf = `<infNFe Id="NFe${chave}" versao="4.00"><ide><cUF>35</cUF><cNF>${cNF}</cNF><natOp>Venda</natOp><mod>55</mod><serie>${serie}</serie><nNF>${nNF}</nNF><dhEmi>${agora}</dhEmi><dhSaiEnt>${agora}</dhSaiEnt><tpNF>1</tpNF><idDest>1</idDest><cMunFG>${cfg.emit.cMun}</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV><tpAmb>${amb}</tpAmb><finNFe>1</finNFe><indFinal>1</indFinal><indPres>0</indPres><procEmi>0</procEmi><verProc>DaLucia 1.0</verProc></ide>`
      + emitXml(cfg) + dest + dets + totalXml(total, vTotTrib, vIBS, vCBS)
      + `<transp><modFrete>9</modFrete></transp><pag>${pag}</pag>` + infAdicXml(d.obs, vTotTrib) + "</infNFe>";
    const nfe = `<NFe xmlns="${NS}">${inf}${assinar(inf, "NFe" + chave)}</NFe>`;
    return { nfe, chave, total, vTotTrib, forma, linhas: linhas.map((l) => ({ ...l, xProd: l.xProd || tab(l.k).xProd, cProd: tab(l.k).cProd })) };
  }
  function emitirNFe(d) { const r = fila.then(() => emitirNFe0(d)); fila = r.catch(() => {}); return r; } // mesma fila do cupom: uma nota de cada vez
  async function emitirNFe0(d) {
    const cfg = ler(); if (!cfg || !cfg.emit) throw new Error("nota fiscal não configurada");
    if (!cert()) throw new Error("falta instalar o certificado (Caixa → 🧾 → senha do certificado)");
    const dest = limparDest(d.dest), amb = cfg.ambiente === 1 ? 1 : 2, N = nfeCfg(cfg), serie = N.serie, obs = String(d.obs || "").trim().slice(0, 300);
    for (let tent = 0; tent < 3; tent++) {
      const nNF = Number(N.numeros[amb]) || 1, m = montarNFe({ ...d, dest, obs }, cfg, amb, serie, nNF);
      N.numeros[amb] = nNF + 1; salvar(cfg); // reserva o número antes de mandar
      let r;
      try { r = await soap(amb, "NFeAutorizacao4", "nfeAutorizacaoLote", `<enviNFe xmlns="${NS}" versao="4.00"><idLote>${String(Date.now()).slice(-15)}</idLote><indSinc>1</indSinc>${m.nfe}</enviNFe>`, 55); }
      catch (e) {
        if (!e.semResposta) throw e;
        const c = await consultar(amb, m.chave).catch(() => null);
        if (c && c.cStat === "100") return guardarNFe(m, c.prot, amb, serie, nNF, c.protXml, dest, obs);
        throw new Error(e.message + ". A NF-e nº " + nNF + " não foi autorizada; tente de novo.");
      }
      let prot = tag(r, "protNFe"), cs = tag(prot || "", "cStat") || tag(r, "cStat"), mot = tag(prot || "", "xMotivo") || tag(r, "xMotivo");
      if (cs === "103" && tag(r, "nRec")) { // a SEFAZ recebeu o lote mas processa depois: pergunta pelo recibo
        const nRec = tag(r, "nRec");
        for (let i = 0; i < 6 && ["103", "105"].includes(cs); i++) {
          await new Promise((ok) => setTimeout(ok, process.env.SEFAZ_TESTE ? 50 : 3000));
          const rr = await soap(amb, "NFeRetAutorizacao4", "nfeRetAutorizacaoLote", `<consReciNFe xmlns="${NS}" versao="4.00"><tpAmb>${amb}</tpAmb><nRec>${nRec}</nRec></consReciNFe>`, 55).catch(() => "");
          prot = tag(rr, "protNFe"); cs = tag(prot || "", "cStat") || tag(rr, "cStat") || "105"; mot = tag(prot || "", "xMotivo") || tag(rr, "xMotivo");
        }
      }
      if (cs === "100" || cs === "150") return guardarNFe(m, { nProt: tag(prot, "nProt"), dhRecbto: tag(prot, "dhRecbto") }, amb, serie, nNF, "<protNFe versao=\"4.00\">" + prot + "</protNFe>", dest, obs);
      console.error("NF-e nº " + nNF + " série " + serie + ": " + (cs || "?") + " - " + (mot || ""));
      if (cs === "539" || cs === "204") continue; // número já usado: vai pro próximo
      if (cs === "105" || cs === "103") throw new Error("a SEFAZ ainda está processando a NF-e nº " + nNF + ". Espere uns minutos e confira na lista de notas antes de emitir de novo.");
      if (cs !== "217") { const atual = ler(), A = atual && nfeCfg(atual); if (A && Number(A.numeros[amb]) === nNF + 1) { A.numeros[amb] = nNF; salvar(atual); } } // recusada: o número volta
      throw new Error("SEFAZ recusou a NF-e: " + (cs || "?") + " - " + (mot || "sem motivo"));
    }
    throw new Error("a SEFAZ recusou 3 números seguidos (já usados)");
  }
  function guardarNFe(m, prot, amb, serie, nNF, protXml, dest, obs) {
    const dir = path.join(PASTA_NFE, amb === 1 ? "producao" : "homologacao", new Date().toLocaleDateString("en-CA").slice(0, 7)); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, m.chave + "-procNFe.xml"), `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="4.00" xmlns="${NS}">${m.nfe}${protXml || ""}</nfeProc>`);
    const nf = { modelo: 55, amb, serie, numero: nNF, chave: m.chave, prot: prot && prot.nProt, dhAut: prot && prot.dhRecbto, quando: Date.now(), valor: m.total, vTotTrib: m.vTotTrib, forma: m.forma, linhas: m.linhas, dest: { doc: dest.doc, xNome: dest.xNome }, obs: obs || undefined, status: "autorizada" };
    const l = lerJ(ARQ_NFE, []); l.push(nf); gravaJ(ARQ_NFE, l);
    const emps = lerJ(ARQ_EMP, {}); emps[dest.doc] = { ...dest, usado: Date.now() }; gravaJ(ARQ_EMP, emps); // a próxima nota dessa empresa já vem preenchida
    return nf;
  }
  function marcarCanceladaNFe(chave, c) { const l = lerJ(ARQ_NFE, []), n = l.find((x) => x.chave === chave); if (n) { Object.assign(n, c, { status: "cancelada" }); gravaJ(ARQ_NFE, l); } return n; }
  // empresas conhecidas: as que já receberam nota daqui + as do ViaVale (endereço/IE da última nota)
  function empresas() {
    const out = {}, cfg = ler() || {}, base = path.join(process.env.VIAVALE_DOCS || "C:\\SistemaNuvem\\Documentos", String(cfg.cnpj || ""), "NFe");
    const anda = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { anda(p); continue; } if (!/\.xml$/i.test(f.name)) continue;
      let x; try { x = fs.readFileSync(p, "utf8"); } catch (e) { continue; } const de = tag(x, "dest"); if (!de || !/<mod>55</.test(x)) continue;
      const en = tag(de, "enderDest") || "", doc = tag(de, "CNPJ") || tag(de, "CPF"), dh = Date.parse(tag(x, "dhEmi")) || 0; if (!doc || (out[doc] && out[doc].usado > dh)) continue;
      out[doc] = { doc, xNome: desEsc(tag(de, "xNome")), IE: tag(de, "indIEDest") === "2" ? "ISENTO" : tag(de, "IE") || "", xLgr: desEsc(tag(en, "xLgr")), nro: desEsc(tag(en, "nro")), xCpl: desEsc(tag(en, "xCpl")), xBairro: desEsc(tag(en, "xBairro")), cMun: tag(en, "cMun"), xMun: desEsc(tag(en, "xMun")), UF: tag(en, "UF"), CEP: tag(en, "CEP") || "", fone: tag(en, "fone") || "", email: desEsc(tag(de, "email")), usado: dh, origem: "viavale" }; } };
    anda(base);
    for (const [doc, e] of Object.entries(lerJ(ARQ_EMP, {}))) if (!out[doc] || out[doc].usado <= e.usado) out[doc] = { ...e, origem: "caixa" };
    return Object.values(out).sort((a, b) => b.usado - a.usado);
  }
  // consulta cadastro na SEFAZ-SP pelo CNPJ (só empresa com inscrição estadual em SP): razão social, IE e endereço
  async function cadastro(doc) {
    const cnpj = String(doc || "").replace(/\D/g, ""); if (!cnpjOk(cnpj)) throw new Error("CNPJ inválido");
    const r = await soap(1, "CadConsultaCadastro4", "consultaCadastro", `<ConsCad xmlns="${NS}" versao="2.00"><infCons><xServ>CONS-CAD</xServ><UF>SP</UF><CNPJ>${cnpj}</CNPJ></infCons></ConsCad>`, 55);
    const cs = tag(r, "cStat"); if (cs === "259") return null; // não é contribuinte em SP (ex.: banco, sindicato): digita à mão
    if (cs !== "111" && cs !== "112") throw new Error("a SEFAZ não consultou: " + (cs || "?") + " - " + (tag(r, "xMotivo") || ""));
    const cads = (r.match(/<infCad>[\s\S]*?<\/infCad>/g) || []), c = cads.find((y) => tag(y, "cSit") === "1") || cads[0]; if (!c) return null;
    const en = tag(c, "ender") || "", xMun = desEsc(tag(en, "xMun"));
    return { doc: cnpj, xNome: desEsc(tag(c, "xNome")), IE: tag(c, "IE") || "", xLgr: desEsc(tag(en, "xLgr")), nro: desEsc(tag(en, "nro")), xCpl: desEsc(tag(en, "xCpl")), xBairro: desEsc(tag(en, "xBairro")), xMun, cMun: tag(en, "cMun") || MUN[nomeMun(xMun)] || "", UF: "SP", CEP: tag(en, "CEP") || "", ativa: tag(c, "cSit") === "1" };
  }
  // ---------- TODAS AS NOTAS DE UM MÊS (lista do caixa): cupons e NF-e daqui (produção e teste) + as do ViaVale ----------
  function lerNota(arq) { // resumo de um XML autorizado (serve pra NFC-e e NF-e, daqui ou do ViaVale)
    let x; try { x = fs.readFileSync(arq, "utf8"); } catch (e) { return null; }
    const ch = (x.match(/Id="NFe(\d{44})"/) || [])[1]; if (!ch) return null;
    const de = tag(x, "dest") || "", prot = tag(x, "protNFe") || "";
    return { chave: ch, modelo: ch.slice(20, 22), amb: Number(tag(x, "tpAmb")) || 1, serie: Number(tag(x, "serie")), numero: Number(tag(x, "nNF")), dhEmi: tag(x, "dhEmi"), valor: Number(tag(x, "vNF")) || 0,
      doc: tag(de, "CNPJ") || tag(de, "CPF") || "", nome: desEsc(tag(de, "xNome")), prot: tag(prot, "nProt") || "", autorizada: ["100", "150"].includes(tag(prot, "cStat")), arq };
  }
  function listarNotas(mes) {
    if (!/^\d{4}-\d\d$/.test(String(mes))) throw new Error("mês inválido");
    const out = [];
    for (const [raiz, amb] of [[PASTA, 1], [PASTA, 2], [PASTA_NFE, 1], [PASTA_NFE, 2]]) {
      const dir = path.join(raiz, amb === 1 ? "producao" : "homologacao", mes); if (!fs.existsSync(dir)) continue;
      for (const a of fs.readdirSync(dir).filter((y) => /-procNFe\.xml$/.test(y))) { const n = lerNota(path.join(dir, a)); if (!n) continue; n.cancelada = fs.existsSync(path.join(dir, n.chave + "-cancelamento.xml")); n.origem = "caixa"; out.push(n); }
    }
    for (const n of viavaleDoMes(mes).notas) out.push({ ...n, nome: desEsc(n.nomeDest), origem: "viavale", amb: 1 });
    return out.map((n) => ({ chave: n.chave, modelo: n.modelo, amb: n.amb, serie: n.serie, numero: n.numero, dhEmi: n.dhEmi, valor: n.valor, doc: n.doc, nome: n.nome || "", prot: n.prot, origem: n.origem,
      situacao: n.cancelada ? "cancelada" : n.autorizada === false ? "sem autorização" : "autorizada" })).sort((a, b) => String(b.dhEmi).localeCompare(String(a.dhEmi)));
  }
  function acharXml(chave) { // o XML autorizado de uma chave (daqui ou do ViaVale) e o do cancelamento, se tiver
    if (!/^\d{44}$/.test(String(chave))) return null;
    const mes = "20" + chave.slice(2, 4) + "-" + chave.slice(4, 6), raiz = chave.slice(20, 22) === "55" ? PASTA_NFE : PASTA;
    for (const amb of ["producao", "homologacao"]) {
      const meses = [mes, ...(fs.existsSync(path.join(raiz, amb)) ? fs.readdirSync(path.join(raiz, amb)).filter((m) => /^\d{4}-\d\d$/.test(m)) : [])];
      for (const m of meses) { const a = path.join(raiz, amb, m, chave + "-procNFe.xml"); if (fs.existsSync(a)) { const c = path.join(raiz, amb, m, chave + "-cancelamento.xml"); return { arq: a, canc: fs.existsSync(c) ? c : null, origem: "caixa" }; } }
    }
    const n = viavaleDoMes(mes).notas.find((y) => y.chave === chave); if (n) return { arq: n.arq, canc: null, origem: "viavale", cancelada: n.cancelada };
    return null;
  }
  // a nota inteira a partir do XML (pra reimprimir o cupom na bobina e montar a DANFE da NF-e), no mesmo formato que o caixa guarda
  const TPAG_INV = { "01": "dinheiro", "03": "credito", "04": "debito", "05": "loja", "11": "refeicao", "15": "boleto", "16": "deposito", "17": "pix", "18": "transferencia", "90": "prazo", "99": "cartao" };
  function notaCompleta(chave) {
    const A = acharXml(chave); if (!A) return null;
    const x = fs.readFileSync(A.arq, "utf8"), n = lerNota(A.arq); if (!n) return null;
    const de = tag(x, "dest") || "", en = tag(de, "enderDest") || "", prot = tag(x, "protNFe") || "", ide = tag(x, "ide") || "", tot = tag(x, "ICMSTot") || "";
    const linhas = (x.match(/<det nItem="\d+">[\s\S]*?<\/det>/g) || []).map((d) => ({ cProd: desEsc(tag(d, "cProd")), xProd: desEsc(tag(d, "xProd")), NCM: tag(d, "NCM"), CFOP: tag(d, "CFOP"), CSOSN: tag(d, "CSOSN"), qtd: Number(tag(d, "qCom")), un: c2(tag(d, "vUnCom")), v: Number(tag(d, "vProd")) }));
    const pagL = (x.match(/<detPag>[\s\S]*?<\/detPag>/g) || []).map((p) => ({ forma: TPAG_INV[tag(p, "tPag")] || "cartao", valor: Number(tag(p, "vPag")) }));
    const inf = desEsc(tag(x, "infCpl")), obs = inf.split(/\s*\|\s*Trib aprox/)[0].replace(/^Trib aprox.*$/, "").trim();
    let canc = {}; if (A.canc) { const c = fs.readFileSync(A.canc, "utf8"); canc = { cancProt: tag(tag(c, "retEvento") || c, "nProt"), motivoCanc: desEsc(tag(c, "xJust")) }; }
    const e = tag(x, "emit") || "", ee = tag(e, "enderEmit") || "", cancelada = !!(A.canc || A.cancelada);
    return { ...n, arq: undefined, origem: A.origem, situacao: cancelada ? "cancelada" : n.autorizada ? "autorizada" : "sem autorização", status: cancelada ? "cancelada" : "autorizada", ...canc,
      quando: Date.parse(n.dhEmi) || Date.now(), dhAut: tag(prot, "dhRecbto"), natOp: desEsc(tag(ide, "natOp")), dhSaiEnt: tag(ide, "dhSaiEnt"),
      linhas, pagL, troco: Number(tag(x, "vTroco")) || 0, vTotTrib: Number(tag(tot, "vTotTrib")) || 0, vProd: Number(tag(tot, "vProd")) || n.valor, qr: desEsc(tag(x, "qrCode")), urlChave: desEsc(tag(x, "urlChave")), obs, infCpl: inf, infAdFisco: desEsc(tag(x, "infAdFisco")),
      cpf: tag(de, "CPF") || undefined,
      dest: de ? { doc: n.doc, xNome: n.nome, IE: tag(de, "IE") || (tag(de, "indIEDest") === "2" ? "ISENTO" : ""), xLgr: desEsc(tag(en, "xLgr")), nro: desEsc(tag(en, "nro")), xCpl: desEsc(tag(en, "xCpl")), xBairro: desEsc(tag(en, "xBairro")), xMun: desEsc(tag(en, "xMun")), UF: tag(en, "UF"), CEP: tag(en, "CEP") || "", fone: tag(en, "fone") || "" } : null,
      emit: { CNPJ: tag(e, "CNPJ"), xNome: desEsc(tag(e, "xNome")), xFant: desEsc(tag(e, "xFant")), IE: tag(e, "IE"), xLgr: desEsc(tag(ee, "xLgr")), nro: tag(ee, "nro"), xBairro: desEsc(tag(ee, "xBairro")), xMun: desEsc(tag(ee, "xMun")), UF: tag(ee, "UF"), CEP: tag(ee, "CEP"), fone: tag(ee, "fone") || "" } };
  }
  function status() {
    const cfg = ler(), C = cert();
    const e = (cfg && cfg.emit) || {};
    return { emit: { xNome: e.xNome, CNPJ: e.CNPJ, xLgr: e.xLgr, nro: e.nro, xBairro: e.xBairro, xMun: e.xMun, UF: e.UF }, configurado: !!(cfg && cfg.csc && cfg.emit), certificado: C ? { nome: C.nome, validade: C.validade } : null, ambiente: cfg && cfg.ambiente === 1 ? 1 : 2, serie: cfg ? Number(cfg.serie) || 2 : 2, proximo: cfg ? (cfg.numeros || {})[cfg.ambiente === 1 ? 1 : 2] || 1 : 1, cscId: cfg && cfg.cscId,
      nfe: cfg ? (() => { const N = nfeCfg({ ...cfg, nfe: { ...(cfg.nfe || {}) } }); return { serie: N.serie, proximo: N.numeros[cfg.ambiente === 1 ? 1 : 2] || 1 }; })() : null, cupomDia: cupomDia(), produtos: Object.keys(CLASSES).map((k) => ({ k, xProd: CLASSES[k].xProd })) };
  }
  // cupom automático do dia (dona 25/11): às 15h, 1 cupom com as vendas pagas só em crédito/débito/Pix que não tiraram cupom na hora
  function cupomDia(novo) {
    const cfg = ler(); if (!cfg) return { ativo: false };
    const atual = { ativo: false, hora: 15, formas: ["credito", "debito", "pix", "cartao"], ...(cfg.cupomDia || {}) };
    if (novo) { if (novo.ativo !== undefined) { atual.ativo = !!novo.ativo; if (atual.ativo && !atual.desde) atual.desde = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); } if (novo.hora !== undefined && Number(novo.hora) >= 0 && Number(novo.hora) <= 23) atual.hora = Number(novo.hora); cfg.cupomDia = atual; salvar(cfg); }
    return atual;
  }
  function mudarAmbiente(a) { const cfg = ler(); if (!cfg) throw new Error("sem configuração"); cfg.ambiente = a === 1 ? 1 : 2; salvar(cfg); return status(); }
  // ---------- NOTAS DO MÊS PRA CONTADORA (dona 24/11): os XML de produção do mês (autorizados + cancelamentos) + resumo.csv, num ZIP ----------
  function notasDoMes(mes, raiz) { // raiz: PASTA (cupons) ou PASTA_NFE (NF-e)
    if (!/^\d{4}-\d\d$/.test(String(mes))) throw new Error("mês inválido");
    const dir = path.join(raiz || PASTA, "producao", mes), out = [];
    if (fs.existsSync(dir)) for (const a of fs.readdirSync(dir).filter((x) => /-procNFe\.xml$/.test(x))) {
      const x = fs.readFileSync(path.join(dir, a), "utf8"), chave = a.slice(0, 44), canc = path.join(dir, chave + "-cancelamento.xml");
      out.push({ arq: path.join(dir, a), canc: fs.existsSync(canc) ? canc : null, chave, numero: Number(tag(x, "nNF")), serie: Number(tag(x, "serie")), dhEmi: tag(x, "dhEmi"), valor: Number(tag(x, "vNF")) || 0, cpf: tag(tag(x, "dest") || "", "CPF") || tag(tag(x, "dest") || "", "CNPJ") || "", nomeDest: desEsc(tag(tag(x, "dest") || "", "xNome")), obs: (tag(x, "infCpl") || "").split(" | Trib aprox")[0].replace(/^Trib aprox.*$/, ""), prot: tag(tag(x, "protNFe") || "", "nProt") || "" });
    }
    return out.sort((a, b) => a.serie - b.serie || a.numero - b.numero);
  }
  function contadora(tel) { const cfg = ler() || {}; if (tel !== undefined) { cfg.contadora = { tel: String(tel).replace(/\D/g, "").slice(0, 13) }; salvar(cfg); } return (cfg.contadora || {}).tel || ""; }
  // notas do ViaVale (mesmo CNPJ, neste computador): NFC-e série 1, NF-e (empresas) e cancelamentos - a contadora confere tudo junto (dona 24/11)
  function viavaleDoMes(mes) {
    const cfg = ler() || {}, base = path.join(process.env.VIAVALE_DOCS || "C:\\SistemaNuvem\\Documentos", String(cfg.cnpj || "")), aamm = mes.replace("-", "");
    const notas = [], eventos = [], canc = new Set();
    const anda = (dir) => { if (!fs.existsSync(dir)) return; for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) { anda(p); continue; } if (!/\.xml$/i.test(f.name)) continue;
      let x; try { x = fs.readFileSync(p, "utf8"); } catch (e) { continue; }
      if (/<tpEvento>110111</.test(x)) { if (/<cStat>(135|155)</.test(x)) { canc.add(tag(x, "chNFe")); eventos.push({ arq: p }); } continue; } // cancelamento homologado
      const ch = (x.match(/Id="NFe(\d{44})"/) || [])[1]; if (!ch) continue;
      const dest = tag(x, "dest") || "", prot = tag(x, "protNFe") || "";
      notas.push({ arq: p, chave: ch, modelo: ch.slice(20, 22), serie: Number(tag(x, "serie")), numero: Number(tag(x, "nNF")), dhEmi: tag(x, "dhEmi"), valor: Number(tag(x, "vNF")) || 0, doc: tag(dest, "CNPJ") || tag(dest, "CPF") || "", nomeDest: tag(dest, "xNome") || "", prot: tag(prot, "nProt") || "", autorizada: tag(prot, "cStat") === "100" || tag(prot, "cStat") === "150" }); } };
    for (const tipo of ["NFCe", "NFe"]) anda(path.join(base, tipo, aamm));
    notas.forEach((n) => (n.cancelada = canc.has(n.chave)));
    return { notas: notas.sort((a, b) => a.modelo.localeCompare(b.modelo) || a.serie - b.serie || a.numero - b.numero), eventos };
  }
  function resumoDoMes(mes) {
    const nos = notasDoMes(mes), nfeCx = notasDoMes(mes, PASTA_NFE), vv = viavaleDoMes(mes), c2s = (v) => Math.round(v * 100) / 100, autN = nfeCx.filter((n) => !n.canc);
    const vale = (n) => n.autorizada && !n.cancelada, nfce = vv.notas.filter((n) => n.modelo === "65"), nfe = vv.notas.filter((n) => n.modelo === "55"), aut = nos.filter((n) => !n.canc);
    return { nos, nfe: nfeCx, vv, caixaNfe: { qtd: autN.length, canceladas: nfeCx.length - autN.length, total: c2s(autN.reduce((s, n) => s + n.valor, 0)) }, caixa: { qtd: aut.length, canceladas: nos.length - aut.length, total: c2s(aut.reduce((s, n) => s + n.valor, 0)) },
      viavaleNfce: { qtd: nfce.filter(vale).length, canceladas: nfce.filter((n) => n.cancelada).length, total: c2s(nfce.filter(vale).reduce((s, n) => s + n.valor, 0)) },
      viavaleNfe: { qtd: nfe.filter(vale).length, canceladas: nfe.filter((n) => n.cancelada).length, total: c2s(nfe.filter(vale).reduce((s, n) => s + n.valor, 0)) } };
  }
  function zipDoMes(mes) {
    const R = resumoDoMes(mes), br = (v) => Number(v).toFixed(2).replace(".", ","), dh = (v) => String(v || "").slice(0, 19).replace("T", " "), q = (v) => '"' + String(v || "").replace(/"/g, "'") + '"';
    const cab = ["Origem", "Modelo", "Série", "Número", "Emissão", "Valor (R$)", "Situação", "CPF/CNPJ", "Destinatário", "Chave de acesso", "Protocolo", "Observação"].join(";");
    const lin = [
      ...R.nos.map((n) => ["Caixa (Da Lúcia)", "NFC-e", n.serie, n.numero, dh(n.dhEmi), br(n.valor), n.canc ? "CANCELADA" : "AUTORIZADA", n.cpf, "", "'" + n.chave, "'" + n.prot, q(n.obs)].join(";")),
      ...R.nfe.map((n) => ["Caixa (Da Lúcia)", "NF-e", n.serie, n.numero, dh(n.dhEmi), br(n.valor), n.canc ? "CANCELADA" : "AUTORIZADA", n.cpf, q(n.nomeDest), "'" + n.chave, "'" + n.prot, q(n.obs)].join(";")),
      ...R.vv.notas.map((n) => ["ViaVale", n.modelo === "55" ? "NF-e" : "NFC-e", n.serie, n.numero, dh(n.dhEmi), br(n.valor), n.cancelada ? "CANCELADA" : n.autorizada ? "AUTORIZADA" : "SEM AUTORIZAÇÃO", n.doc, q(n.nomeDest), "'" + n.chave, "'" + n.prot, ""].join(";")),
    ];
    const tot = ["", "TOTAIS (autorizadas, sem as canceladas)", "", "", "", "", "", "", "", "", "", ""].join(";"), t = (nome, x) => [nome, "", "", x.qtd + " nota(s)", "", br(x.total), x.canceladas ? x.canceladas + " cancelada(s)" : "", "", "", "", "", ""].join(";");
    const csv = "\ufeff" + [cab, ...lin, "", tot, t("Caixa - NFC-e", R.caixa), t("Caixa - NF-e", R.caixaNfe), t("ViaVale - NFC-e", R.viavaleNfce), t("ViaVale - NF-e", R.viavaleNfe)].join("\r\n");
    const files = [{ nome: "resumo-" + mes + ".csv", dados: Buffer.from(csv, "utf8") },
      ...R.nos.flatMap((n) => [{ nome: "caixa-nfce/autorizadas/" + path.basename(n.arq), dados: fs.readFileSync(n.arq) }, ...(n.canc ? [{ nome: "caixa-nfce/cancelamentos/" + path.basename(n.canc), dados: fs.readFileSync(n.canc) }] : [])]),
      ...R.nfe.flatMap((n) => [{ nome: "caixa-nfe/autorizadas/" + path.basename(n.arq), dados: fs.readFileSync(n.arq) }, ...(n.canc ? [{ nome: "caixa-nfe/cancelamentos/" + path.basename(n.canc), dados: fs.readFileSync(n.canc) }] : [])]),
      ...R.vv.notas.map((n) => ({ nome: (n.modelo === "55" ? "viavale-nfe/" : "viavale-nfce/") + path.basename(n.arq), dados: fs.readFileSync(n.arq) })),
      ...R.vv.eventos.map((e) => ({ nome: "viavale-cancelamentos/" + path.basename(e.arq), dados: fs.readFileSync(e.arq) }))];
    return { zip: zipar(files), qtd: R.nos.length + R.nfe.length + R.vv.notas.length, caixa: R.caixa, caixaNfe: R.caixaNfe, viavaleNfce: R.viavaleNfce, viavaleNfe: R.viavaleNfe,
      autorizadas: R.caixa.qtd, canceladas: R.caixa.canceladas, total: R.caixa.total }; // (autorizadas/canceladas/total = do caixa, como antes)
  }
  return { cupomDia, status, instalarCertificado, statusSefaz, emitir, cancelar, emitirNFe, marcarCanceladaNFe, empresas, cadastro, listarNotas, notaCompleta, acharXml, cnpjOk, produtos: () => Object.keys(CLASSES).map((k) => ({ k, xProd: CLASSES[k].xProd })), mudarAmbiente, notasDoMes, resumoDoMes, zipDoMes, contadora, classe, cpfOk, _montar: montar, _assinar: assinar };
};
module.exports.classe = classe; module.exports.cpfOk = cpfOk; module.exports.CLASSES = CLASSES;
