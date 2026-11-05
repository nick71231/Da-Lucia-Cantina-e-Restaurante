// Restaura um backup (pedidos, clientes, contas, gaveta) para a pasta dados/.
// Uso:   node restaurar.js backup.json [config.json]        (PARE o servidor antes!)
// Aceita o "backup completo" baixado no caixa OU um arquivo diário de dados/backups/.
// Antes de trocar, guarda uma cópia do que existia em dados/antes-da-restauracao-<data>/.
const fs = require("fs"), path = require("path");

function restaurar(arquivo, dirDados, arquivoConfig) {
  const bruto = JSON.parse(fs.readFileSync(arquivo, "utf8"));
  const db = bruto && bruto.dados && Array.isArray(bruto.dados.pedidos) ? bruto.dados : bruto;
  let cfg = bruto && bruto.config && bruto.config.dados ? bruto.config : null;
  if (arquivoConfig) cfg = JSON.parse(fs.readFileSync(arquivoConfig, "utf8"));
  if (!db || !Array.isArray(db.pedidos)) throw new Error("esse arquivo não parece um backup do totem");
  ["clientes", "lancamentos", "pagamentos"].forEach((k) => { if (db[k] !== undefined && !Array.isArray(db[k])) throw new Error("backup com formato inválido em " + k); });
  fs.mkdirSync(dirDados, { recursive: true });
  const guarda = path.join(dirDados, "antes-da-restauracao-" + new Date().toISOString().replace(/[:.]/g, "-"));
  let copiou = false;
  ["pedidos.json", "config.json"].forEach((a) => { const o = path.join(dirDados, a); if (fs.existsSync(o)) { fs.mkdirSync(guarda, { recursive: true }); fs.copyFileSync(o, path.join(guarda, a)); copiou = true; } });
  fs.writeFileSync(path.join(dirDados, "pedidos.json"), JSON.stringify(db));
  if (cfg && cfg.dados) fs.writeFileSync(path.join(dirDados, "config.json"), JSON.stringify(cfg));
  return { pedidos: db.pedidos.length, clientes: (db.clientes || []).length, lancamentos: (db.lancamentos || []).length, guardadoEm: copiou ? guarda : null };
}
module.exports = { restaurar };

if (require.main === module) {
  const [arq, cfgArq] = process.argv.slice(2);
  if (!arq) { console.log("Uso: node restaurar.js backup.json [config.json]\n(pare o servidor antes!)"); process.exit(1); }
  try {
    const r = restaurar(arq, process.env.DADOS_DIR ? path.resolve(process.env.DADOS_DIR) : path.join(__dirname, "dados"), cfgArq);
    console.log(`Pronto! Restaurados ${r.pedidos} pedidos, ${r.clientes} clientes e ${r.lancamentos} lançamentos.`);
    if (r.guardadoEm) console.log("A versão que existia antes ficou guardada em: " + r.guardadoEm);
    console.log("Agora ligue o servidor de novo. As senhas não são mexidas.");
  } catch (e) { console.error("Não restaurei nada: " + e.message); process.exit(1); }
}
