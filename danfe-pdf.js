// Gera o PDF do cupom fiscal (DANFE NFC-e), igual ao impresso na bobina de 80 mm, um cupom por página.
// Uso: node danfe-pdf.js <saida.pdf> <chave1> [chave2 ...]     (ou "avulsos" no lugar das chaves = dados/nfce/avulsos.json)
// Usa o Chrome sem janela pra imprimir em PDF e a biblioteca qrcode-generator (cdnjs) pro QR Code.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const DADOS = process.env.DADOS_DIR || path.join(__dirname, "dados");
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (v) => Number(v || 0).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const dt = (ms) => { const d = new Date(ms); return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) + " " + d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" }); };
const PG = { dinheiro: "Dinheiro", credito: "Cartão de Crédito", debito: "Cartão de Débito", refeicao: "Vale Refeição", pix: "PIX", cartao: "Cartão" };

function cupomHtml(nf, E, logo) {
  const cnpj = String(E.CNPJ || "").replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  const cpf = nf.cpf ? String(nf.cpf).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4") : "";
  return `<section class="cupom">
  <header>${logo ? `<img src="${logo}" alt="">` : ""}<div><b>${esc(E.xNome)}</b><span>CNPJ ${cnpj}${E.IE ? " · IE " + esc(E.IE) : ""}</span><span>${esc(E.xLgr)}, ${esc(E.nro)} - ${esc(E.xBairro)}</span><span>${esc(E.xMun)} - ${esc(E.UF)}</span></div></header>
  <h1>Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</h1>
  ${nf.amb === 2 ? `<p class="aviso">EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL</p>` : ""}${nf.status === "cancelada" ? `<p class="aviso">CUPOM CANCELADO</p>` : ""}
  <table><thead><tr><th>Código</th><th>Descrição</th><th class="n">Qtd</th><th class="n">Vl. unit.</th><th class="n">Vl. total</th></tr></thead>
  <tbody>${(nf.linhas || []).map((l) => `<tr><td>${esc(l.cProd)}</td><td>${esc(l.xProd)}</td><td class="n">${String(l.qtd).replace(".", ",")} UN</td><td class="n">${brl(l.un)}</td><td class="n">${brl(l.v)}</td></tr>`).join("")}</tbody></table>
  <div class="tot"><span>Qtd. total de itens</span><b>${(nf.linhas || []).length}</b></div>
  <div class="tot grande"><span>VALOR TOTAL R$</span><b>${brl(nf.valor)}</b></div>
  <div class="tot cab"><span>FORMA DE PAGAMENTO</span><b>VALOR PAGO R$</b></div>
  ${(nf.pagL || []).map((p) => `<div class="tot"><span>${esc(PG[p.forma] || p.forma)}</span><b>${brl(p.valor)}</b></div>`).join("")}
  ${nf.troco > 0 ? `<div class="tot"><span>Troco R$</span><b>${brl(nf.troco)}</b></div>` : ""}
  ${nf.obs ? `<p class="obs">${esc(nf.obs)}</p>` : ""}
  <div class="bloco"><b>Consulte pela Chave de Acesso em</b><span>${esc(nf.urlChave)}</span><span class="chave">${String(nf.chave).replace(/(\d{4})(?=\d)/g, "$1 ")}</span></div>
  <div class="bloco"><b>${cpf ? "CONSUMIDOR – CPF: " + cpf : "CONSUMIDOR NÃO IDENTIFICADO"}</b></div>
  <div class="bloco"><b>NFC-e nº ${String(nf.numero).padStart(9, "0")} &nbsp; Série ${String(nf.serie).padStart(3, "0")} &nbsp; ${dt(nf.quando)}</b><span>Protocolo de autorização: ${esc(nf.prot)}</span><span>Data de autorização: ${dt(nf.dhAut ? Date.parse(nf.dhAut) : nf.quando)}</span></div>
  <div class="qr" data-qr="${esc(nf.qr)}"></div>
  <p class="trib">Tributos Totais Incidentes (Lei Federal 12.741/2012): R$ ${brl(nf.vTotTrib)}</p>
</section>`;
}
function gerar(nfs, saida) {
  const cfg = JSON.parse(fs.readFileSync(path.join(DADOS, "fiscal.json"), "utf8")), E = cfg.emit || {};
  let logo = ""; try { const c = JSON.parse(fs.readFileSync(path.join(DADOS, "config.json"), "utf8")); logo = JSON.parse(c.dados.logoPequena || c.dados.logoGrande || '""'); } catch (e) {}
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cupons fiscais</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js"></script>
<style>@page { size: 80mm 190mm; margin: 4mm; } * { box-sizing: border-box; } body { margin: 0; width: 72mm; font: 9.5px/1.35 Arial, Helvetica, sans-serif; color: #000; }
.cupom { page-break-after: always; } .cupom:last-child { page-break-after: auto; }
header { display: flex; gap: 6px; align-items: center; border-bottom: 1px dashed #000; padding-bottom: 5px; } header img { width: 52px; height: 52px; object-fit: contain; }
header b { display: block; font-size: 10px; } header span { display: block; font-size: 8.5px; }
h1 { font-size: 9.5px; text-align: center; margin: 6px 0; } .aviso { text-align: center; font-weight: 700; border: 1px solid #000; padding: 3px; margin: 4px 0; }
table { width: 100%; border-collapse: collapse; font-size: 8.5px; margin: 4px 0; } th { text-align: left; border-bottom: 1px solid #000; } td, th { padding: 2px 1px; } .n { text-align: right; white-space: nowrap; }
.tot { display: flex; justify-content: space-between; padding: 1px 0; } .tot.grande { font-size: 11px; font-weight: 700; border-top: 1px dashed #000; margin-top: 3px; padding-top: 3px; } .tot.cab { font-weight: 700; margin-top: 3px; }
.obs { text-align: center; font-weight: 700; border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin: 6px 0; }
.bloco { text-align: center; border-top: 1px dashed #000; padding: 4px 0; } .bloco b, .bloco span { display: block; } .chave { font-size: 8.5px; letter-spacing: .3px; word-break: break-all; }
.qr { display: flex; justify-content: center; margin: 4px 0; } .qr svg { width: 34mm; height: 34mm; } .trib { text-align: center; font-size: 8px; margin: 2px 0 0; }</style></head>
<body>${nfs.map((nf) => cupomHtml(nf, E, logo)).join("")}
<script>document.querySelectorAll(".qr").forEach(function (el) { var q = qrcode(0, "M"); q.addData(el.dataset.qr); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 3, margin: 0, scalable: true }); }); document.title = "pronto";</script></body></html>`;
  const tmp = path.join(os.tmpdir(), "danfe-" + Date.now() + ".html"); fs.writeFileSync(tmp, html);
  const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((x) => fs.existsSync(x));
  if (!chrome) throw new Error("não achei o Chrome/Edge pra gerar o PDF");
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--virtual-time-budget=8000", "--print-to-pdf=" + path.resolve(saida), "file:///" + tmp.replace(/\\/g, "/")], { stdio: "ignore", timeout: 60000 });
  if (process.env.DANFE_HTML) fs.copyFileSync(tmp, process.env.DANFE_HTML); // pra conferir o visual
  try { fs.unlinkSync(tmp); } catch (e) {}
  return saida;
}
if (require.main === module) {
  const [saida, ...ch] = process.argv.slice(2);
  if (!saida) { console.log("uso: node danfe-pdf.js saida.pdf <chaves...|avulsos>"); process.exit(1); }
  const av = (() => { try { return JSON.parse(fs.readFileSync(path.join(DADOS, "nfce", "avulsos.json"), "utf8")); } catch (e) { return []; } })();
  const nfs = ch[0] === "avulsos" ? av.filter((x) => x.status === "autorizada").sort((a, b) => String(a.referente).localeCompare(String(b.referente))) : ch.map((k) => av.find((x) => x.chave === k)).filter(Boolean);
  gerar(nfs, saida); console.log("PDF:", saida, "-", nfs.length, "cupom(ns)");
}
module.exports = { gerar };
