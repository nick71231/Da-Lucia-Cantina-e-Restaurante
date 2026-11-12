# Totem Da Lúcia: guia de instalação e uso

## O que é cada coisa
| Tela | Endereço (troque pelo IP do computador) | Quem usa |
|---|---|---|
| Totem (cliente) | `http://192.168.1.14:3000` | tablet do cliente |
| Caixa | `http://192.168.1.14:3000/caixa.html` | quem recebe |
| Balança | `http://192.168.1.14:3000/balanca.html` | tablet da balança |

O **servidor** (`server.js`) roda no computador do restaurante, guarda tudo e entrega as telas. Os tablets só abrem o endereço.

## Instalar (uma vez)
1. Instale o **Node.js** (versão LTS) em nodejs.org.
2. Copie a pasta do projeto para o computador. Coloque as imagens em `img/`: `logo.png`, `logo-grande.png`, `marmitex1.jpg`, `marmitex2.jpg` e `icone.png` (512×512).
3. Dê dois cliques em **`servico.bat`** (ele pede permissão de administrador) e escolha **1 - Instalar**. Pronto:
   - o servidor liga **sozinho junto com o Windows**, mesmo sem ninguém fazer login, e roda **escondido** (sem janela pra fechar sem querer);
   - se cair, reinicia sozinho em 5 segundos (erros em `logs\erros.log`, partidas e paradas em `logs\servidor.log`);
   - o firewall é liberado na porta 3000 e o computador deixa de suspender quando está na tomada.
   Antes de instalar, feche qualquer outra janela que esteja rodando o servidor (inclusive o terminal do VS Code), senão a porta 3000 fica ocupada.
4. **IP fixo:** no roteador, reserve sempre o mesmo IP para esse computador (senão os endereços mudam).
5. Nos tablets: abra o endereço no Chrome ou Fully Kiosk e use "Adicionar à tela inicial".

### O `servico.bat` no dia a dia
| Opção | Quando usar |
|---|---|
| 2 - Reiniciar | Depois de atualizar o programa (trocar `server.js`, telas etc.) ou de mudar o `BACKUP_EXTRA`. |
| 3 - Ver se está funcionando | Mostra se o servidor responde, quantos pedidos tem hoje e o último backup. Também dá pra abrir `http://localhost:3000` no navegador. |
| 4 - Desinstalar | Para o servidor e tira ele da inicialização do Windows. |

Sem o serviço (pra testar ou mexer no código), dá pra usar o **`iniciar-servidor.bat`** ou `node server.js` numa janela, como antes. Não rode os dois juntos: só um pode usar a porta 3000.

## Senhas (login de verdade no servidor)
Há **3 níveis**, cada um com a sua senha: **balança** (só lança valores e desfaz), **caixa** (recebe, contas, gaveta, backup) e **admin** (tudo, inclusive configurações e senhas). O cliente no totem não precisa de senha.
- **Senhas padrão na primeira vez:** admin `12345`, caixa `2222`, balança `3333`. O servidor avisa na tela preta enquanto alguma ainda for a padrão.
- **Troque agora:** Admin do totem (segure a logo) → Ajustes → Segurança e uso → *Senhas do sistema*. Quem estava logado com a senha antiga é desconectado.
- Tablet da balança: pede a senha uma vez e lembra por 30 dias. Caixa: pede a cada vez que abre o navegador. Depois de 5 erros seguidos o login trava por 5 minutos.
- As senhas ficam **embaralhadas (hash)** em `dados/seguranca.json`. Ninguém consegue ler a senha, nem eu.

## Acertar a conta por item (e cada um com a sua forma de pagamento)
No caixa, **Receber** abre a lista dos itens do pedido ou da comanda (prato por quilo, bebidas, marmitex pedida no totem...):
1. Tire o ✔ dos itens que **não** vão ser acertados agora (eles continuam em aberto).
2. Em cada item marcado, escolha **Dinheiro, Pix ou Cartão**. Os botões do topo aplicam uma forma a todos os marcados.
3. Se tiver dinheiro, digite o valor recebido e veja o **troco**. O botão só libera quando está tudo certo.
- Pedido ou comanda **parcialmente paga** continua em *Em aberto*, mostrando o que já foi recebido e quanto falta (botão "Receber o resto"). Quando o último item é pago, ele passa pra *Pagos* (pagamento "misto", se usou mais de uma forma).
- **Errou?** Cada recebimento tem o botão **Estornar** (pede o motivo); só aqueles itens voltam a ficar em aberto. A gaveta e o fechamento descontam sozinhos.
- Item já pago não pode ser apagado pela balança, e pedido com recebimento parcial não vai pra conta de cliente (termine de acertar ou estorne antes).
- O **Fechamento** soma cada recebimento na sua forma de pagamento, e a **gaveta** conta só o dinheiro de verdade.

## Pedidos do site de delivery no caixa
Quando um pedido do site é **aceito** (vai pra "Preparando"), o servidor traz ele pro caixa em até 20 segundos, como **Delivery D123**, com endereço, telefone, forma de pagamento que o cliente escolheu e a **taxa de entrega como item**. Daí é igual aos outros: Receber (por item, cada um na sua forma), gaveta e fechamento. Se o pedido for cancelado no site e ninguém recebeu nada ainda, ele é cancelado no caixa sozinho.

**Ligar (uma vez):** crie o arquivo `dados\delivery.json` no Bloco de Notas com:
```
{ "url": "https://delivery-da-lucia.vercel.app", "token": "O MESMO PRINT_TOKEN da ponte de impressão" }
```
(o token é o mesmo do `configuracao.txt` da ponte; se na Vercel existir `CAIXA_TOKEN`, use esse). Depois: `servico.bat` → **2 - Reiniciar** e **3 - Ver se está funcionando** (mostra "Delivery: buscando pedidos").

## Nome na comanda
Na balança, o campo **👤 Nome do cliente** grava o nome na comanda junto com o lançamento. Em cada comanda aberta, o botão **✎ nome** corrige. Se a pessoa pedir uma marmitex no totem pra comanda dela, a comanda ganha o nome dela automaticamente. O caixa mostra o nome no cartão (e dá pra buscar por ele).

## Rotina do dia
**Abrir:** servidor ligado → Admin do totem (segure a logo e digite a senha) → aba **Hoje**: escolha o cardápio salvo ou ligue os itens do dia → no caixa, aba **💵 Gaveta**: informe o troco inicial.
**Durante:** o caixa apita quando chega pedido; receba, marque na conta ou cancele.
**Fechar:** no caixa, aba **💵 Gaveta**: informe o dinheiro contado e confira a diferença → aba **Fechamento**: exporte o CSV e baixe o backup.

## Impressora
Admin → **Impressão**. Se a impressora tem cabo de rede ou wifi, use **"Impressora de rede, pelo servidor"** com o IP dela (porta 9100). Se for USB ou Bluetooth, use o app **RawBT** (no Fully Kiosk, ligue "Open URL Schemes in other apps").

## Backups
- O servidor guarda uma cópia por dia em `dados/backups/` (últimos 30 dias).
- **Cópia automática em outro lugar:** no `iniciar-servidor.bat`, tire o `REM` da linha `set BACKUP_EXTRA=` e ponha uma pasta de outro disco, pendrive ou da nuvem (Google Drive/OneDrive). Todo dia o servidor copia pra lá também. Se o computador quebrar, é o seu seguro.
- No caixa → Fechamento → **Baixar backup completo**.
- **Restaurar:** pare o servidor (`servico.bat` → 4 - Desinstalar, ou `Ctrl + C` na janela) e rode `node restaurar.js caminho\do\backup.json` (serve o "backup completo" baixado no caixa ou um arquivo de `dados/backups/`). Antes de trocar, ele guarda o que existia em `dados/antes-da-restauracao-...`. As senhas não são mexidas. Depois, ligue de novo (`servico.bat` → 1 - Instalar). **Teste uma restauração uma vez**, numa pasta separada, antes de precisar de verdade (`set DADOS_DIR=C:\teste` e depois `node server.js`).

## Entregar ou compartilhar o programa (sem dados do restaurante)
**Nunca zipe a pasta inteira de uma instalação que já está em uso**: ela tem pedidos, clientes, backups, sessões e senhas. Rode `node empacotar.js`: ele monta `entrega\totem-da-lucia\` só com o código (sem `dados/`, backups, sessões, logs e `node_modules`) e confere sozinho se nada vazou. Ele não apaga nem mexe na sua instalação.
Se a sua pasta ainda tem `pedidos.json` e `config.json` soltos (de antes de existir a pasta `dados/`), eles já foram copiados pra `dados/` na primeira vez. Depois de conferir que `dados/` está certo, guarde os antigos num pendrive. **Não apague sem ter backup.**

## Problemas comuns
| Sintoma | O que fazer |
|---|---|
| Tablet não abre o endereço | Mesmo wifi? Servidor ligado? Firewall liberado? IP mudou? |
| Caixa mostra "SEM CONEXÃO" | O servidor caiu ou o wifi falhou. Os pedidos do totem ficam guardados e são reenviados sozinhos. |
| Comanda não imprime | Admin → Impressão → "Imprimir teste". Confira IP, porta e papel. |
| Esqueci a senha | Pare o servidor, apague `dados/seguranca.json` e `dados/sessoes.json` e ligue de novo: voltam as senhas padrão (troque em seguida). |
| Valores estranhos depois de mexer | Rode `node testes.js` (não mexe nos dados reais). |

## Testes automáticos
- `node testes.js`: sobe servidores de teste **isolados** (porta e pasta só deles, sem encostar nos seus dados nem no `BACKUP_EXTRA`) e confere **89 regras**: pagamento, estorno, comanda, contas, gaveta, login, matriz de permissões de cada perfil, limites da impressão, sessão vencida, reinício do servidor e restauração de backup numa instalação separada.
- `node testes-telas.js`: abre o totem, o caixa e a balança num navegador simulado, clica nas abas e confere o que aparece (27 conferências, incluindo receber por item e dar nome à comanda). Precisa rodar `npm install` uma vez.
- `npm test` roda os dois. **Se o `npm install` não foi feito, o teste de telas FALHA com aviso** (ele nunca finge que passou). Rode depois de qualquer alteração.

## Impressão pela rede: o que está protegido
O totem do cliente não tem senha, então a rota de impressão é pública, mas limitada: o **IP da impressora vem da configuração do admin** (ninguém escolhe pra onde imprimir), só aceita conteúdo de comanda (precisa começar com o código de reset da impressora e ter até 20 KB) e no máximo 30 impressões por minuto por aparelho. Quem estiver no wifi ainda consegue gastar papel dentro desse limite, então **mantenha o wifi com senha forte**.

## Limites conhecidos
- O sistema usa **HTTP** (sem criptografia) dentro do wifi do restaurante. Mantenha esse wifi com senha forte e **não exponha o servidor na internet**.
- O servidor guarda tudo em arquivo (`dados/`). Isso aguenta bem um restaurante pequeno; se crescer muito, migrar para um banco de dados.
