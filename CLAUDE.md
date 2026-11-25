# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Ordering/POS system for the "Da Lúcia" restaurant: a customer self-service totem, a cashier screen, a scale (balança) screen and a waiter (garçom) screen, all served by one Node server on the restaurant LAN. Code, comments, UI and identifiers are in Portuguese (pt-BR); keep that style. `LEIA-ME.md` is the end-user install/operation guide.

## Commands

- `npm start` / `node server.js`: start the server (port 3000, or env `PORTA`).
- Production: `servico.bat` (self-elevating menu over `servico.ps1 instalar|reiniciar|status|desinstalar`) registers a Windows Scheduled Task "Servidor Da Lucia" that runs `iniciar-servidor.bat` as SYSTEM at boot, hidden, with no 3-day time limit. The `.bat` loops forever restarting `node server.js` (stderr → `logs\erros.log`, start/stop lines → `logs\servidor.log`). It must not use `timeout` (fails without a console) and the `.bat` files must keep CRLF line endings. After changing server code on the production machine, restart via `servico.bat` → Reiniciar. A manually started server and the task both bind port 3000, so only one can run.
- `npm test`: runs `node testes.js` (API/rule tests) then `node testes-telas.js` (UI tests in jsdom). Run after any change.
  - `testes-telas.js` needs `npm install` once (jsdom); without it it exits with code 2 and a warning, never a fake pass.
  - There is no per-test filter; tests are a single sequential script using the `t(cond, name)` helper. To check one area, run the relevant file.
  - Tests spawn their own `server.js` on ports 3999/3998 with `DADOS_DIR` set to a temp folder and `BACKUP_EXTRA=""`, so they never touch real data in `dados/`.
- `node restaurar.js <backup.json> [config.json]`: restore a backup into `dados/` (server must be stopped; previous data saved to `dados/antes-da-restauracao-*`; passwords untouched).
- `node empacotar.js`: build a clean distributable in `entrega/totem-da-lucia/` from the explicit `INCLUIR` whitelist. **New top-level files that must ship have to be added to that list**; images under `img/` and `fotos/` are copied automatically.
- `node gerar-seed.js`: regenerate `seed.sql` (Supabase seed) from `dados.js`. Leftover from a Supabase plan; the running system does not use a database.

No build step, bundler, linter or framework: plain HTML/CSS/vanilla JS on the client, Node built-ins only on the server.

## Architecture

**Server (`server.js`)**: single file, raw `http` module, one `tratar(req, res)` function that matches routes with `if (p === "/api/..." && req.method === ...)` chains, then falls through to static file serving.
- Persistence is JSON files in `dados/` (or `DADOS_DIR`): `pedidos.json` holds the whole `db` object (`pedidos`, `clientes`, `lancamentos`, `pagamentos`, `caixa` (cash drawer per day), `enviados`), plus `config.json` (totem config copy), `seguranca.json` (scrypt-hashed PINs), `sessoes.json`, `impressora-caixa.json`. Everything is kept in memory and written via `gravarArquivo` (per-file queue, write to `.tmp` then rename). Always `await gravar()` before responding to a mutation.
- On startup, old data shapes are migrated in place (e.g. items gain `iid`/`grupos`, payments gain `chave`). Keep backward compatibility with existing data when changing schemas.
- Daily backups to `dados/backups/` (30 kept) and optionally `BACKUP_EXTRA`.
- Auth: 3 roles with levels `balanca(1) < caixa(2) < admin(3)`, Bearer tokens (sessions stored as sha256 of token). `nivelRota(method, path)` is the central permission matrix; public (level 0) routes are what the unauthenticated customer totem needs (`POST /api/pedidos`, `POST /api/imprimir`, `GET /api/config`, login, saude). New routes default to caixa level; update `nivelRota` deliberately.
- Server never trusts client totals: `limparPedido` validates/clamps items and recomputes `valor`. Money is rounded with `cents()`.
- Static serving blocks `dados/`, `.json` files other than `manifest*`, and `server.js`/`testes.js`.

**Order model**: a `pedido` is either a totem order or a `tipo: "balanca"` comanda (tab; numbers > 10000 are totem marmitex shown as `M<n>`). Status transitions are restricted by `TRANS` (`aguardando → pago|conta|cancelado`, etc.). Payment is per item: `acertar()` takes `[{iid, forma}]`, creates one `pagamentos` entry per payment method, marks items `pago`, and `fecharSePago` closes the order (`pagamento: "misto"` if several methods). Refunds (`estornado`) reopen just those items. `pagsDe()` is the canonical way to get valid receipts (handles legacy single-payment orders). "Conta" = charge to a client account; the account key is `e:<empresa>` if the client belongs to a company, else `c:<clientId>` (`chaveDe`).

**Delivery import**: the separate delivery site (`../DELIVERY`, Vercel + Supabase) is pulled every 20s by `sincronizarDelivery()` in `server.js` when `dados/delivery.json` (`{url, token}`) or env `DELIVERY_URL`/`DELIVERY_TOKEN` exist. It calls the site's `POST /api/caixa` (`novos` / `importado` / `situacao`, header `x-caixa-token`) and stores orders as `tipo: "delivery"` (dedup by `uid: "site:<token>"`, delivery fee as a `tipo: "taxa"` item, site-side cancel → local cancel if unpaid). Totem order numbering only counts orders without `tipo`. Tests use a mock site on port 3994.

**Clients (browser pages)**: each page is self-contained with its inline `<script>` and talks to the server with `fetch`:
- `index.html` + `app.js`: customer totem and its hidden admin (hold the logo + admin PIN). Renders everything from template strings into `#principal`; state in module-level `let`s and `localStorage`.
- `caixa.html`, `balanca.html`, `garcom.html`: cashier, scale and waiter screens (large single-file pages).
- `dados.js`: default menu data (`MARMITEX`, `CATEGORIAS`, `BEBIDAS`) and constants (`IMPRESSAO`, `LARGURA` columns for the thermal printer), loaded by all pages. Admin edits override it via `localStorage`.
- `teclado.js`: on-screen keyboard for touch devices (`?teclado=sempre|nunca|auto`).
- `style.css` (totem), `ui.css` (shared newer UI).

**Config sync**: the totem's admin settings live in the tablet's `localStorage`. `app.js` `snapshot()`/`enviarConfig()` PUTs them to `/api/config` with a timestamp `t` (admin token required); `puxarConfig()` polls every 60s and applies a newer server copy only while the totem is idle (`tela === "descanso"`). Keys in `SEM_SYNC` are per-device and never synced; `cfgSujo` marks unsent local changes.

**Fiscal (`fiscal.js`)**: emits directly to SEFAZ-SP with the A1 certificate in `dados/certificado.pem`; config, series and numbering in `dados/fiscal.json`. NFC-e (model 65, consumer receipt, series 2 since 25/11, restarted at nº 11; series 50 was used 24-25/11) per paid order, saved under `dados/nfce/<producao|homologacao>/AAAA-MM`. NF-e (model 55, for companies, own series `nfe.serie` = 2 per the accountant on 25/11, ViaVale uses series 1) from the caixa 📄 screen, saved under `dados/nfe/` with index `notas.json` and known recipients `empresas.json`; recipient city → IBGE code via `municipios-sp.js`. "Cupom do dia" (`cupomDia` in fiscal.json, admin toggle): at `hora` (15h) `cupomDoDia()` in server.js emits one NFC-e PER ORDER (discriminated items) for orders paid only by crédito/débito/Pix that have no receipt yet, stored in `p.nfce` with `auto: true`. `/api/fiscal/lista` lists every note of a month (caixa + ViaVale XMLs read from `C:\SistemaNuvem\Documentos`). Tests use a fake SEFAZ (`SEFAZ_TESTE`) on port 3990; NFC-e homologation rejects this CNPJ (245) but NF-e homologation works.

**Printing**: ESC/POS thermal printing either through RawBT on Android or via `POST /api/imprimir`, where the server sends raw bytes over TCP (port 9100) to the printer IP from the admin config (not from the request), rate-limited and size-limited.

## Things to keep in mind

- `dados/`, `pedidos.json`, `config.json`, `logs/`, `entrega/` hold real restaurant data and must not be shipped or committed (they are in `.gitignore`).
- The system is HTTP-only on the LAN by design; don't add features that assume internet exposure.
- Default PINs (admin `12345`, caixa `2222`, balança `3333`) are what the tests log in with.
