// Monta uma cópia LIMPA do programa para entregar ou compartilhar: só o código, sem dados do restaurante.
// Uso:  node empacotar.js        (cria entrega/totem-da-lucia/)  — não apaga nem mexe em nada da sua instalação.
const fs = require("fs"), path = require("path");
const INCLUIR = ["index.html", "caixa.html", "balanca.html", "app.js", "dados.js", "server.js", "teclado.js", "style.css", "ui.css", "manifest.json", "manifest-caixa.json", "manifest-balanca.json",
  "iniciar-servidor.bat", "LEIA-ME.md", "package.json", "testes.js", "testes-telas.js", "restaurar.js", "empacotar.js", ".gitignore"];
const saida = path.join(__dirname, "entrega", "totem-da-lucia");
fs.rmSync(saida, { recursive: true, force: true }); // só a pasta gerada por este script
fs.mkdirSync(saida, { recursive: true });
let n = 0;
INCLUIR.forEach((a) => { const o = path.join(__dirname, a); if (fs.existsSync(o)) { fs.copyFileSync(o, path.join(saida, a)); n++; } });
const img = path.join(__dirname, "img");
if (fs.existsSync(img)) { fs.mkdirSync(path.join(saida, "img")); fs.readdirSync(img).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f)).forEach((f) => { fs.copyFileSync(path.join(img, f), path.join(saida, "img", f)); n++; }); }
const proibidos = ["dados", "logs", "node_modules", "pedidos.json", "config.json", "sessoes.json", "seguranca.json"];
const achou = fs.readdirSync(saida).filter((f) => proibidos.includes(f));
if (achou.length) { console.error("ERRO: a cópia ficou com dados do restaurante: " + achou.join(", ")); process.exit(1); }
console.log(`Pronto: ${n} arquivos copiados para ${saida}`);
console.log("Ficou de fora de propósito: dados/, backups, sessões, senhas, logs e node_modules.");
console.log("Para zipar no Windows (PowerShell):  Compress-Archive -Path entrega\\totem-da-lucia -DestinationPath entrega\\totem-da-lucia.zip");
