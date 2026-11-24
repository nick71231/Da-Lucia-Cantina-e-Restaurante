// Monta uma cópia LIMPA do programa para entregar ou compartilhar: só o código, sem dados do restaurante.
// Uso:  node empacotar.js        (cria entrega/totem-da-lucia/)  — não apaga nem mexe em nada da sua instalação.
const fs = require("fs"), path = require("path");
const INCLUIR = ["index.html", "caixa.html", "balanca.html", "garcom.html", "app.js", "dados.js", "server.js", "fiscal.js", "danfe-pdf.js", "teclado.js", "dialogo.js", "style.css", "ui.css", "caixa-tema.css", "balanca-tema.css", "balanca-serial.js", "garcom-tema.css", "caixa-tema.js", "manifest.json", "manifest-caixa.json", "manifest-balanca.json",
  "iniciar-servidor.bat", "servico.bat", "servico.ps1","LEIA-ME.md", "package.json", "testes.js", "testes-telas.js", "restaurar.js", "empacotar.js", ".gitignore"];
const saida = path.join(__dirname, "entrega", "totem-da-lucia");
fs.rmSync(saida, { recursive: true, force: true }); // só a pasta gerada por este script
fs.mkdirSync(saida, { recursive: true });
let n = 0;
INCLUIR.forEach((a) => { const o = path.join(__dirname, a); if (fs.existsSync(o)) { fs.copyFileSync(o, path.join(saida, a)); n++; } });
const copiaImagens = (orig, dest) => { // copia só imagens, mantendo as subpastas (ex.: fotos/bebidas/)
  fs.readdirSync(orig, { withFileTypes: true }).forEach((e) => {
    const o = path.join(orig, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) copiaImagens(o, d);
    else if (/\.(png|jpe?g|webp|svg|ttf|woff2)$/i.test(e.name)) { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(o, d); n++; }
  });
};
["img", "fotos"].forEach((pasta) => { const o = path.join(__dirname, pasta); if (fs.existsSync(o)) copiaImagens(o, path.join(saida, pasta)); });
const proibidos = ["dados", "logs", "node_modules", "pedidos.json", "config.json", "sessoes.json", "seguranca.json"];
const achou = fs.readdirSync(saida).filter((f) => proibidos.includes(f));
if (achou.length) { console.error("ERRO: a cópia ficou com dados do restaurante: " + achou.join(", ")); process.exit(1); }
console.log(`Pronto: ${n} arquivos copiados para ${saida}`);
console.log("Ficou de fora de propósito: dados/, backups, sessões, senhas, logs e node_modules.");
console.log("Para zipar no Windows (PowerShell):  Compress-Archive -Path entrega\\totem-da-lucia -DestinationPath entrega\\totem-da-lucia.zip");
