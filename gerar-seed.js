// Gera o seed.sql a partir do seu dados.js (cardápio, marmitex, regras e bebidas).
// Uso (na pasta do projeto, onde está o dados.js):  node gerar-seed.js
// Resultado: seed.sql  -> cole no SQL Editor do Supabase depois do schema.sql
const fs = require("fs"), path = require("path"), vm = require("vm");

const arq = path.resolve(process.argv[2] || "dados.js");
const src = fs.readFileSync(arq, "utf8");
// dados.js declara tudo com const; um fecho no fim devolve o que precisamos
const { MARMITEX, CATEGORIAS, BEBIDAS } = vm.runInNewContext(src + "\n;({ MARMITEX, CATEGORIAS, BEBIDAS })");

const q = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const out = ["-- Gerado por gerar-seed.js a partir de " + path.basename(arq), "begin;"];

out.push("\n-- etapas");
CATEGORIAS.forEach((c, i) =>
  out.push(`insert into etapas (id, nome, pergunta, ordem) values (${q(c.id)}, ${q(c.nome)}, ${q(c.pergunta || "Escolha: " + c.nome)}, ${i})
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;`));

out.push("\n-- itens de cada etapa (entram DESLIGADOS: você liga o que tem no dia, igual à aba Hoje do totem)");
CATEGORIAS.forEach((c) => {
  const itens = [...new Set(c.itens)];
  if (!itens.length) return;
  out.push(`insert into itens (etapa_id, nome) values\n  ${itens.map((n) => `(${q(c.id)}, ${q(n)})`).join(",\n  ")}\n  on conflict (etapa_id, nome) do nothing;`);
});

out.push("\n-- produtos (marmitex)");
MARMITEX.forEach((m, i) =>
  out.push(`insert into produtos (id, nome, preco, foto, ordem) values (${q(m.id)}, ${q(m.nome)}, ${Number(m.preco)}, ${m.foto ? q(m.foto) : "null"}, ${i})
  on conflict (id) do update set nome = excluded.nome, preco = excluded.preco, foto = excluded.foto, ordem = excluded.ordem;`));

out.push("\n-- regras: quantos itens por etapa em cada produto (mesma conta do app.js: min = 1 quando max > 0)");
const regras = [];
MARMITEX.forEach((m) => CATEGORIAS.forEach((c) => {
  const max = (m.regras && m.regras[c.id]) || 0;
  regras.push(`(${q(m.id)}, ${q(c.id)}, ${max ? 1 : 0}, ${max})`);
}));
out.push(`insert into regras (produto_id, etapa_id, min, max) values\n  ${regras.join(",\n  ")}\n  on conflict (produto_id, etapa_id) do update set min = excluded.min, max = excluded.max;`);

out.push("\n-- bebidas");
out.push(`insert into bebidas (nome, preco) values\n  ${BEBIDAS.map((b) => `(${q(b.nome)}, ${Number(b.preco)})`).join(",\n  ")}\n  on conflict (nome) do update set preco = excluded.preco;`);

out.push("\ncommit;");
fs.writeFileSync("seed.sql", out.join("\n") + "\n");
const total = CATEGORIAS.reduce((s, c) => s + new Set(c.itens).size, 0);
console.log(`seed.sql gerado: ${CATEGORIAS.length} etapas, ${total} itens, ${MARMITEX.length} produtos, ${BEBIDAS.length} bebidas.`);
