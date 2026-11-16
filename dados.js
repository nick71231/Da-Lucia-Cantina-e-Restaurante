// ===== AJUSTE AQUI =====
const PIN_ADMIN = "12345"; // só vale ao abrir a página SEM servidor (teste local). Com o servidor, as senhas ficam nele (Admin → Ajustes → Segurança e uso)
const IMPRESSAO = "rawbt"; // "rawbt" = térmica no Android (app RawBT) | "navegador" = janela de impressão
const LARGURA = 32; // colunas da térmica: 32 = papel 58mm, 48 = papel 80mm

// quantas opções o cliente escolhe em cada etapa (id da categoria: quantidade)
const MARMITEX = [
  { id: "m22", nome: "Marmitex de R$22,00", preco: 22, foto: "img/marmitex1.jpg",
    regras: { arroz: 1, feijao: 1, carne: 1, massa: 1, acomp: 1, salada: 1 } },
  { id: "m24", nome: "Marmitex de R$24,00", preco: 24, foto: "img/marmitex2.jpg",
    regras: { arroz: 1, feijao: 1, carne: 2, massa: 1, acomp: 1, salada: 1 } },
];

// fotos opcionais dos itens: "Nome do item": "img/arquivo.jpg"
const FOTOS = { /* "Arroz Branco": "img/arroz-branco.jpg" */ };

// as etapas aparecem nessa ordem
const CATEGORIAS = [
  { id: "arroz", nome: "Arroz", pergunta: "Escolha o tipo de Arroz",
    itens: [
      "Arroz Integral", "Sem Arroz", "Arroz à Grega", "Baião de Dois", "Arroz Branco", "Arroz de Forno"] },
  { id: "feijao", nome: "Feijão", pergunta: "Escolha o Feijão",
    itens: [
      "Feijão Branco", "Tutu de Feijão Fradinho", "Feijão Preto", "Feijão Tradicional", "Tutu de Feijão",
      "Sem Feijão", "Feijão Tropeiro"] },
  { id: "carne", nome: "Carne", pergunta: "Escolha a Carne",
    itens: [
      "Bisteca", "Frango Refogado", "Torresmo", "Frango Caipira Refogado", "Maminha Assada",
      "Pernil Assado", "Costelinha Suíne", "Medalhão de Frango", "Carne Seca", "Cação Ensopado",
      "Carne com Batata", "Strogonoff de Frango", "Coxa e Sobrecoxa Recheada com Farofa",
      "Linguiça Calabresa Acebolada", "Lombo Acebolado", "Parmegiana de Frango", "Bife de Lombo",
      "Strogonoff de Carne", "Filé de Frango Grelhado", "Rocambole de Carne Moída", "Bife à Milanesa",
      "Filé de Tilápia", "Almôndegas", "Sem Carne", "Linguiça Fina", "Filé de Frango à Milanesa",
      "Fricassê de Frango", "Sobrecoxa Recheada", "Frango Assado", "Carne Moída Refogada",
      "Costela com Mandioca", "Posta de Tilápia", "Bife de Fígado", "Linguiça Toscana",
      "Carne Moída com Chuchu", "Linguiça Tropeiro", "Sobrecoxa Assada", "Cação Frito",
      "Peito de Boi com Mandioca", "Carne com Mandioca", "Lombo Assado", "Dobradinha",
      "Polpetone de Queijo", "Costela Bovina", "Bife Acebolado", "Frango Recheado", "Pernil em Cubos",
      "Bife a Rolê", "Carne de Panela", "Costela", "Lagarto", "Lombo em Cubos", "Panceta de Porco",
      "Rabada"] },
  { id: "massa", nome: "Massa", pergunta: "Escolha a Massa",
    itens: [
      "Macarrão Alho e Óleo", "Batata Gratinada", "Escondidinho de Carne Moída", "Yakisoba",
      "Couve-Flor Gratinada", "Escondidinho de Frango Desfiado", "Chuchu Gratinado",
      "Canelone ao Molho Branco", "Lasanha de Queijo", "Nhoque ao Molho Sugo", "Batata Assada",
      "Escondidinho de Carne Desfiada", "Macarrão à Bolonhesa", "Purê de Batata", "Macarronada",
      "Canelone de Frango ao Molho Branco", "Creme de Milho", "Sem Massa", "Canelone de Queijo",
      "Canelone de Frango com Catupiry", "Tomate Recheado", "Polenta", "Batata Dorê",
      "Panqueca de Presunto e Queijo", "Macarrão ao Molho Branco", "Panqueca de Carne Moída",
      "Escondidinho de Mandioca com Carne Seca", "Escondidinho de Carne Seca",
      "Escondidinho de Calabresa", "Parmegiana de Berinjela", "Panqueca de Frango",
      "Lasanha ao Molho Branco"] },
  { id: "acomp", nome: "Acompanhamento", pergunta: "Escolha o Acompanhamento",
    itens: ["Bolinha de Queijo", "Mandioca Frita", "Pastel de 4 Queijos", "Pastel de Carne com Queijo",
      "Pastel de Queijo", "Batata Frita", "Bolinho de Calabresa", "Pastel de Pizza", "Farofa",
      "Farofa de Couve", "Bolinho de Arroz", "Salgadinho", "Abóbora Cabotiá com Carne Seca",
      "Vagem com Ovos", "Pastel de Frango", "Kibe", "Pastel de Carne Desfiada", "Pastel de Carne",
      "Farofa de Cenoura", "Croquete de Carne", "Pirão de Peixe", "Couve Refogada",
      "Pastel de Frango com Catupiry", "Abobrinha Refogada", "Sem Acompanhamento",
      "Croquete de Frango", "Coxinha de Frango", "Farofa de Ovos Cozidos", "Repolho Refogado",
      "Batata Ruffles", "Anel de Cebola", "Berinjela Empanada", "Omelete", "Bolinho de Bacalhau",
      "Abóbora Cabotiá", "Bolinho de Batata com Calabresa"] },
  { id: "salada", nome: "Salada", pergunta: "Escolha a Salada",
    itens: [
      "Salada Primavera", "Salada Mista", "Salada de Macarrão com Presunto e Queijo",
      "Salada de Feijão Fradinho", "Salada de Batata com Frango Desfiado", "Salada de Repolho",
      "Salada de Batata com Bacalhau", "Beterraba Ralada", "Salada de Batata com Bacon",
      "Maionese de Batata com Frango Desfiado", "Tomate com Queijo", "Salada de Couve",
      "Maionese de Maçã Agridoce", "Batata em Conserva", "Couve de Bruxelas", "Alface", "Salpicão",
      "Salada de Pepino", "Sem Salada", "Rúcula e Agrião", "Repolho com Maçã", "Tomate com Pepino",
      "Macarronese", "Abobrinha", "Cenoura Ralada", "Maionese com Frango", "Maionese", "Tomate",
      "Beterraba", "Tabule", "Grão de Bico", "Caponata de Berinjela", "Chuchu", "Vinagrete", "Jiló",
      "Quiabo", "Rúcula"] },
];

// bebidas oferecidas depois da marmitex (preços de exemplo, ajusta aqui ou pelo admin)
const BEBIDAS = [
  { nome: "H2OH!", preco: 10 },
  { nome: "Suco Grande", preco: 12 },
  { nome: "Água Sem Gás", preco: 3 },
  { nome: "Água Tônica", preco: 6.5 },
  { nome: "Long Neck", preco: 12 },
  { nome: "Água Com Gás", preco: 3.5 },
  { nome: "Coca-Cola Lata", preco: 6 },
  { nome: "Coca-Cola Zero Lata", preco: 6 },
  { nome: "Coca-Cola 600ml", preco: 10 },
  { nome: "Coca-Cola 600ml Zero", preco: 10 },
  { nome: "Fanta Laranja Lata", preco: 6 },
  { nome: "Fanta Uva Lata", preco: 6 },
  { nome: "Fanta Maracujá Lata", preco: 6 },
  { nome: "Sprite Lata", preco: 6 },
  { nome: "Sprite Zero Lata", preco: 6 },
  { nome: "Del Valle Uva", preco: 6.5 },
  { nome: "Del Valle Pêssego", preco: 6.5 },
  { nome: "Del Valle Manga", preco: 6.5 },
  { nome: "Del Valle Maracujá", preco: 6.5 },
  { nome: "Del Valle Goiaba (Sem Açúcar)", preco: 6.5 },
  { nome: "Pepsi Lata", preco: 6 },
  { nome: "Pepsi Black Lata", preco: 6 },
  { nome: "Pepsi Twist Lata", preco: 6 },
  { nome: "Guaraná Antártica Lata", preco: 6 },
  { nome: "Guaraná Antártica Lata Zero", preco: 6 },
  { nome: "Guaraná Antártica 600ml Zero", preco: 10 },
  { nome: "Guaraná Antártica 600ml", preco: 10 },
];

// Doces vendidos no totem (aparecem em "Doces" depois da 1ª marmitex). O admin do totem pode criar/esconder outros.
// (nome DOCES_TOTEM pra não bater com a lista DOCES do caixa.html, que também carrega este arquivo)
const DOCES_TOTEM = [
  { nome: "Pingo de Leite", preco: 1.5 },
  { nome: "Bala de Goma", preco: 3.5 },
  { nome: "Paçocão", preco: 3 },
  { nome: "Pé de Moça", preco: 3.5 },
  { nome: "Twix", preco: 5 },
];

// Sorvetes: lançados na comanda pela balança e pelo garçom, e vendidos no caixa (ajuste nomes e preços aqui)
const SORVETES = [
  { nome: "Sorvete Mega Clássico", preco: 17.9 }, { nome: "Sorvete Lacta", preco: 18.9 }, { nome: "Sorvete Mega", preco: 18.9 },
  { nome: "Sorvete Prestígio/Crocante", preco: 15.9 }, { nome: "Sorvete Super Preço", preco: 9.99 }, { nome: "Sorvete La Frutta", preco: 7.5 },
  { nome: "Sorvete Fini Dentadura", preco: 8.5 }, { nome: "Sorvete Fini Tube", preco: 5.9 }, { nome: "Sorvete Chambinho", preco: 8.5 },
  { nome: "Sorvete Batom", preco: 5.9 }, { nome: "Sorvete Oreo/KitKat Gold", preco: 8.5 },
];
