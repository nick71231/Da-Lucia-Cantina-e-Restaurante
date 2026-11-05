-- Gerado por gerar-seed.js a partir de dados.js
begin;

-- etapas
insert into etapas (id, nome, pergunta, ordem) values ('arroz', 'Arroz', 'Escolha o tipo de Arroz', 0)
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;
insert into etapas (id, nome, pergunta, ordem) values ('feijao', 'Feijão', 'Escolha o Feijão', 1)
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;
insert into etapas (id, nome, pergunta, ordem) values ('carne', 'Carne', 'Escolha a Carne', 2)
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;
insert into etapas (id, nome, pergunta, ordem) values ('massa', 'Massa', 'Escolha a Massa', 3)
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;
insert into etapas (id, nome, pergunta, ordem) values ('acomp', 'Acompanhamento', 'Escolha o Acompanhamento', 4)
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;
insert into etapas (id, nome, pergunta, ordem) values ('salada', 'Salada', 'Escolha a Salada', 5)
  on conflict (id) do update set nome = excluded.nome, pergunta = excluded.pergunta, ordem = excluded.ordem;

-- itens de cada etapa (entram DESLIGADOS: você liga o que tem no dia, igual à aba Hoje do totem)
insert into itens (etapa_id, nome) values
  ('arroz', 'Arroz Integral'),
  ('arroz', 'Sem Arroz'),
  ('arroz', 'Arroz à Grega'),
  ('arroz', 'Baião de Dois'),
  ('arroz', 'Arroz Branco'),
  ('arroz', 'Arroz de Forno')
  on conflict (etapa_id, nome) do nothing;
insert into itens (etapa_id, nome) values
  ('feijao', 'Feijão Branco'),
  ('feijao', 'Tutu de Feijão Fradinho'),
  ('feijao', 'Feijão Preto'),
  ('feijao', 'Feijão Tradicional'),
  ('feijao', 'Tutu de Feijão'),
  ('feijao', 'Sem Feijão'),
  ('feijao', 'Feijão Tropeiro')
  on conflict (etapa_id, nome) do nothing;
insert into itens (etapa_id, nome) values
  ('carne', 'Bisteca'),
  ('carne', 'Frango Refogado'),
  ('carne', 'Torresmo'),
  ('carne', 'Frango Caipira Refogado'),
  ('carne', 'Maminha Assada'),
  ('carne', 'Pernil Assado'),
  ('carne', 'Costelinha Suíne'),
  ('carne', 'Medalhão de Frango'),
  ('carne', 'Carne Seca'),
  ('carne', 'Cação Ensopado'),
  ('carne', 'Carne com Batata'),
  ('carne', 'Strogonoff de Frango'),
  ('carne', 'Coxa e Sobrecoxa Recheada com Farofa'),
  ('carne', 'Linguiça Calabresa Acebolada'),
  ('carne', 'Lombo Acebolado'),
  ('carne', 'Parmegiana de Frango'),
  ('carne', 'Bife de Lombo'),
  ('carne', 'Strogonoff de Carne'),
  ('carne', 'Filé de Frango Grelhado'),
  ('carne', 'Rocambole de Carne Moída'),
  ('carne', 'Bife à Milanesa'),
  ('carne', 'Filé de Tilápia'),
  ('carne', 'Almôndegas'),
  ('carne', 'Sem Carne'),
  ('carne', 'Linguiça Fina'),
  ('carne', 'Filé de Frango à Milanesa'),
  ('carne', 'Fricassê de Frango'),
  ('carne', 'Sobrecoxa Recheada'),
  ('carne', 'Frango Assado'),
  ('carne', 'Carne Moída Refogada'),
  ('carne', 'Costela com Mandioca'),
  ('carne', 'Posta de Tilápia'),
  ('carne', 'Bife de Fígado'),
  ('carne', 'Linguiça Toscana'),
  ('carne', 'Carne Moída com Chuchu'),
  ('carne', 'Linguiça Tropeiro'),
  ('carne', 'Sobrecoxa Assada'),
  ('carne', 'Cação Frito'),
  ('carne', 'Peito de Boi com Mandioca'),
  ('carne', 'Carne com Mandioca'),
  ('carne', 'Lombo Assado'),
  ('carne', 'Dobradinha'),
  ('carne', 'Polpetone de Queijo'),
  ('carne', 'Costela Bovina'),
  ('carne', 'Bife Acebolado'),
  ('carne', 'Frango Recheado'),
  ('carne', 'Pernil em Cubos'),
  ('carne', 'Bife a Rolê'),
  ('carne', 'Carne de Panela'),
  ('carne', 'Costela'),
  ('carne', 'Lagarto'),
  ('carne', 'Lombo em Cubos'),
  ('carne', 'Panceta de Porco'),
  ('carne', 'Rabada')
  on conflict (etapa_id, nome) do nothing;
insert into itens (etapa_id, nome) values
  ('massa', 'Macarrão Alho e Óleo'),
  ('massa', 'Batata Gratinada'),
  ('massa', 'Escondidinho de Carne Moída'),
  ('massa', 'Yakisoba'),
  ('massa', 'Couve-Flor Gratinada'),
  ('massa', 'Escondidinho de Frango Desfiado'),
  ('massa', 'Chuchu Gratinado'),
  ('massa', 'Canelone ao Molho Branco'),
  ('massa', 'Lasanha de Queijo'),
  ('massa', 'Nhoque ao Molho Sugo'),
  ('massa', 'Batata Assada'),
  ('massa', 'Escondidinho de Carne Desfiada'),
  ('massa', 'Macarrão à Bolonhesa'),
  ('massa', 'Purê de Batata'),
  ('massa', 'Macarronada'),
  ('massa', 'Canelone de Frango ao Molho Branco'),
  ('massa', 'Creme de Milho'),
  ('massa', 'Sem Massa'),
  ('massa', 'Canelone de Queijo'),
  ('massa', 'Canelone de Frango com Catupiry'),
  ('massa', 'Tomate Recheado'),
  ('massa', 'Polenta'),
  ('massa', 'Batata Dorê'),
  ('massa', 'Panqueca de Presunto e Queijo'),
  ('massa', 'Macarrão ao Molho Branco'),
  ('massa', 'Panqueca de Carne Moída'),
  ('massa', 'Escondidinho de Mandioca com Carne Seca'),
  ('massa', 'Escondidinho de Carne Seca'),
  ('massa', 'Escondidinho de Calabresa'),
  ('massa', 'Parmegiana de Berinjela'),
  ('massa', 'Panqueca de Frango'),
  ('massa', 'Lasanha ao Molho Branco')
  on conflict (etapa_id, nome) do nothing;
insert into itens (etapa_id, nome) values
  ('acomp', 'Bolinha de Queijo'),
  ('acomp', 'Mandioca Frita'),
  ('acomp', 'Pastel de 4 Queijos'),
  ('acomp', 'Pastel de Carne com Queijo'),
  ('acomp', 'Pastel de Queijo'),
  ('acomp', 'Batata Frita'),
  ('acomp', 'Bolinho de Calabresa'),
  ('acomp', 'Pastel de Pizza'),
  ('acomp', 'Farofa'),
  ('acomp', 'Farofa de Couve'),
  ('acomp', 'Bolinho de Arroz'),
  ('acomp', 'Salgadinho'),
  ('acomp', 'Abóbora Cabotiá com Carne Seca'),
  ('acomp', 'Vagem com Ovos'),
  ('acomp', 'Pastel de Frango'),
  ('acomp', 'Kibe'),
  ('acomp', 'Pastel de Carne Desfiada'),
  ('acomp', 'Pastel de Carne'),
  ('acomp', 'Farofa de Cenoura'),
  ('acomp', 'Croquete de Carne'),
  ('acomp', 'Pirão de Peixe'),
  ('acomp', 'Couve Refogada'),
  ('acomp', 'Pastel de Frango com Catupiry'),
  ('acomp', 'Abobrinha Refogada'),
  ('acomp', 'Sem Acompanhamento'),
  ('acomp', 'Croquete de Frango'),
  ('acomp', 'Coxinha de Frango'),
  ('acomp', 'Farofa de Ovos Cozidos'),
  ('acomp', 'Repolho Refogado'),
  ('acomp', 'Batata Ruffles'),
  ('acomp', 'Anel de Cebola'),
  ('acomp', 'Berinjela Empanada'),
  ('acomp', 'Omelete'),
  ('acomp', 'Bolinho de Bacalhau'),
  ('acomp', 'Abóbora Cabotiá'),
  ('acomp', 'Bolinho de Batata com Calabresa')
  on conflict (etapa_id, nome) do nothing;
insert into itens (etapa_id, nome) values
  ('salada', 'Salada Primavera'),
  ('salada', 'Salada Mista'),
  ('salada', 'Salada de Macarrão com Presunto e Queijo'),
  ('salada', 'Salada de Feijão Fradinho'),
  ('salada', 'Salada de Batata com Frango Desfiado'),
  ('salada', 'Salada de Repolho'),
  ('salada', 'Salada de Batata com Bacalhau'),
  ('salada', 'Beterraba Ralada'),
  ('salada', 'Salada de Batata com Bacon'),
  ('salada', 'Maionese de Batata com Frango Desfiado'),
  ('salada', 'Tomate com Queijo'),
  ('salada', 'Salada de Couve'),
  ('salada', 'Maionese de Maçã Agridoce'),
  ('salada', 'Batata em Conserva'),
  ('salada', 'Couve de Bruxelas'),
  ('salada', 'Alface'),
  ('salada', 'Salpicão'),
  ('salada', 'Salada de Pepino'),
  ('salada', 'Sem Salada'),
  ('salada', 'Rúcula e Agrião'),
  ('salada', 'Repolho com Maçã'),
  ('salada', 'Tomate com Pepino'),
  ('salada', 'Macarronese'),
  ('salada', 'Abobrinha'),
  ('salada', 'Cenoura Ralada'),
  ('salada', 'Maionese com Frango'),
  ('salada', 'Maionese'),
  ('salada', 'Tomate'),
  ('salada', 'Beterraba'),
  ('salada', 'Tabule'),
  ('salada', 'Grão de Bico'),
  ('salada', 'Caponata de Berinjela'),
  ('salada', 'Chuchu'),
  ('salada', 'Vinagrete'),
  ('salada', 'Jiló'),
  ('salada', 'Quiabo'),
  ('salada', 'Rúcula')
  on conflict (etapa_id, nome) do nothing;

-- produtos (marmitex)
insert into produtos (id, nome, preco, foto, ordem) values ('m22', 'Marmitex de R$22,00', 22, 'img/marmitex1.jpg', 0)
  on conflict (id) do update set nome = excluded.nome, preco = excluded.preco, foto = excluded.foto, ordem = excluded.ordem;
insert into produtos (id, nome, preco, foto, ordem) values ('m24', 'Marmitex de R$24,00', 24, 'img/marmitex2.jpg', 1)
  on conflict (id) do update set nome = excluded.nome, preco = excluded.preco, foto = excluded.foto, ordem = excluded.ordem;

-- regras: quantos itens por etapa em cada produto (mesma conta do app.js: min = 1 quando max > 0)
insert into regras (produto_id, etapa_id, min, max) values
  ('m22', 'arroz', 1, 1),
  ('m22', 'feijao', 1, 1),
  ('m22', 'carne', 1, 1),
  ('m22', 'massa', 1, 1),
  ('m22', 'acomp', 1, 1),
  ('m22', 'salada', 1, 1),
  ('m24', 'arroz', 1, 1),
  ('m24', 'feijao', 1, 1),
  ('m24', 'carne', 1, 2),
  ('m24', 'massa', 1, 1),
  ('m24', 'acomp', 1, 1),
  ('m24', 'salada', 1, 1)
  on conflict (produto_id, etapa_id) do update set min = excluded.min, max = excluded.max;

-- bebidas
insert into bebidas (nome, preco) values
  ('H2OH!', 10),
  ('Suco Grande', 12),
  ('Água Sem Gás', 3),
  ('Água Tônica', 6.5),
  ('Long Neck', 12),
  ('Água Com Gás', 3.5),
  ('Coca-Cola Lata', 6),
  ('Coca-Cola Zero Lata', 6),
  ('Coca-Cola 600ml', 10),
  ('Coca-Cola 600ml Zero', 10),
  ('Fanta Laranja Lata', 6),
  ('Fanta Uva Lata', 6),
  ('Fanta Maracujá Lata', 6),
  ('Sprite Lata', 6),
  ('Sprite Zero Lata', 6),
  ('Del Valle Uva', 6.5),
  ('Del Valle Pêssego', 6.5),
  ('Del Valle Manga', 6.5),
  ('Del Valle Maracujá', 6.5),
  ('Del Valle Goiaba (Sem Açúcar)', 6.5),
  ('Pepsi Lata', 6),
  ('Pepsi Black Lata', 6),
  ('Pepsi Twist Lata', 6),
  ('Guaraná Antártica Lata', 6),
  ('Guaraná Antártica Lata Zero', 6),
  ('Guaraná Antártica 600ml Zero', 10),
  ('Guaraná Antártica 600ml', 10)
  on conflict (nome) do update set preco = excluded.preco;

commit;
