# Liga o servidor como tarefa do Windows: sobe sozinho quando o computador liga (mesmo sem ninguem fazer login),
# roda escondido e reinicia sozinho se cair. Use pelo servico.bat (ele pede permissao de administrador).
# Uso direto:  powershell -ExecutionPolicy Bypass -File servico.ps1 instalar|reiniciar|status|desinstalar
param([ValidateSet("instalar", "reiniciar", "status", "desinstalar", "ip", "ip-curto")][string]$acao = "status")
$ErrorActionPreference = "Stop"
$NOME = "Servidor Da Lucia"
$PORTA = 3000
$PASTA = $PSScriptRoot
$BAT = Join-Path $PASTA "iniciar-servidor.bat"

function EhAdmin {
  $eu = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  return $eu.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function PrecisaAdmin { if (-not (EhAdmin)) { throw "Precisa rodar como administrador (use o servico.bat)." } }
function Tarefa { Get-ScheduledTask -TaskName $NOME -ErrorAction SilentlyContinue }
function DonoDaPorta { # processo que esta usando a porta do servidor (ou nada)
  $c = Get-NetTCPConnection -LocalPort $PORTA -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue }
  return $null
}
function Saude { # o servidor responde?
  # 127.0.0.1 e nao "localhost": em rede com IPv6 o Windows tenta ::1 primeiro e perde ~2,5 s (o servidor so escuta IPv4)
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$PORTA/api/saude" -TimeoutSec 6 } catch { return $null }
}
function MeusIPs { # IPv4 da rede atual (wifi/cabo). Prioriza a placa que tem gateway (a que esta de fato conectada no roteador)
  $comGw = Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" }
  $lista = foreach ($c in $comGw) { foreach ($a in $c.IPv4Address) { [pscustomobject]@{ IP = $a.IPAddress; Rede = $c.InterfaceAlias } } }
  if (-not $lista) { # sem gateway: mostra qualquer IPv4 valido (menos loopback e 169.254 = sem rede)
    $lista = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254.*" } |
      ForEach-Object { [pscustomobject]@{ IP = $_.IPAddress; Rede = $_.InterfaceAlias } }
  }
  return @($lista)
}
function NomeWifi { # nome da rede wifi conectada (ou vazio)
  try { $l = netsh wlan show interfaces 2>$null | Where-Object { $_ -match "^\s*SSID\s*:" } | Select-Object -First 1; if ($l) { return ($l -split ":", 2)[1].Trim() } } catch {}
  return ""
}
function EsperaSubir {
  for ($i = 0; $i -lt 20; $i++) { $s = Saude; if ($s) { return $s }; Start-Sleep -Milliseconds 750 }
  return $null
}
function Parar { # para o loop do .bat e o node que ele abriu
  if (Tarefa) { Stop-ScheduledTask -TaskName $NOME -ErrorAction SilentlyContinue }
  $p = DonoDaPorta
  if ($p -and $p.ProcessName -eq "node") { Stop-Process -Id $p.Id -Force; Start-Sleep -Seconds 1 }
}
function Iniciar {
  Start-ScheduledTask -TaskName $NOME
  $s = EsperaSubir
  if ($s) { Write-Host "Servidor no ar: http://localhost:$PORTA" -ForegroundColor Green }
  else { Write-Host "O servidor nao respondeu. Veja logs\erros.log e logs\servidor.log." -ForegroundColor Red }
}

try {
switch ($acao) {
  "instalar" {
    PrecisaAdmin
    if (-not (Test-Path $BAT)) { throw "Nao achei $BAT" }
    # a tarefa roda como SYSTEM: o node precisa estar no PATH do sistema (o instalador do Node.js faz isso)
    $noPath = [Environment]::GetEnvironmentVariable("Path", "Machine") -split ";" | Where-Object { $_ -and (Test-Path (Join-Path $_ "node.exe")) }
    if (-not $noPath) { throw "O Node.js nao esta instalado para o computador todo. Instale a versao LTS de nodejs.org e rode de novo." }
    if (Tarefa) { Write-Host "Ja estava instalado: atualizando..."; Parar; Unregister-ScheduledTask -TaskName $NOME -Confirm:$false }
    $p = DonoDaPorta
    if ($p) { throw "A porta $PORTA ja esta em uso por '$($p.ProcessName)' (PID $($p.Id)). Feche a janela do servidor (ou o terminal do VS Code que esta rodando o node server.js) e rode de novo." }

    $acaoT = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$BAT`"" -WorkingDirectory $PASTA
    $gatilho = New-ScheduledTaskTrigger -AtStartup
    $quem = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    # sem limite de tempo (o padrao do Windows para a tarefa depois de 3 dias), roda na bateria e tenta de novo se falhar
    $cfg = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
      -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    Register-ScheduledTask -TaskName $NOME -Action $acaoT -Trigger $gatilho -Principal $quem -Settings $cfg `
      -Description "Servidor do totem, caixa e balanca (pasta $PASTA). Gerenciar pelo servico.bat." | Out-Null
    Write-Host "Tarefa '$NOME' criada: liga junto com o Windows."

    if (-not (Get-NetFirewallRule -DisplayName "Totem Da Lucia" -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName "Totem Da Lucia" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PORTA | Out-Null
      Write-Host "Firewall liberado na porta $PORTA."
    }
    # o computador nao pode dormir com o servidor ligado (na tomada)
    powercfg /change standby-timeout-ac 0 | Out-Null
    powercfg /change hibernate-timeout-ac 0 | Out-Null
    Write-Host "Suspensao desligada (na tomada)."
    Iniciar
  }
  "reiniciar" {
    PrecisaAdmin
    if (-not (Tarefa)) { throw "O servico nao esta instalado. Escolha 'Instalar' primeiro." }
    Parar; Iniciar
  }
  "desinstalar" {
    PrecisaAdmin
    if (-not (Tarefa)) { Write-Host "O servico nao estava instalado."; break }
    Parar
    Unregister-ScheduledTask -TaskName $NOME -Confirm:$false
    Write-Host "Servico removido. O servidor nao liga mais sozinho (use o iniciar-servidor.bat se precisar)."
  }
  "ip-curto" { # uma linha, para o topo do menu
    $ips = @(MeusIPs)
    if ($ips.Count) { Write-Host (" IP atual: " + (($ips | ForEach-Object { "http://$($_.IP):$PORTA" }) -join "   ")) -ForegroundColor Green }
    else { Write-Host " IP atual: sem rede (conecte no wifi)" -ForegroundColor Yellow }
  }
  "ip" {
    $ips = @(MeusIPs)
    if (-not $ips.Count) { Write-Host "Este computador nao esta conectado em nenhuma rede. Conecte no wifi e tente de novo." -ForegroundColor Yellow; break }
    $w = NomeWifi
    if ($w) { Write-Host "Rede wifi: $w" }
    foreach ($i in $ips) {
      Write-Host ""
      Write-Host ("IP: " + $i.IP + "   (" + $i.Rede + ")") -ForegroundColor Green
      Write-Host "  Totem:   http://$($i.IP):$PORTA"
      Write-Host "  Caixa:   http://$($i.IP):$PORTA/caixa.html"
      Write-Host "  Balanca: http://$($i.IP):$PORTA/balanca.html"
      Write-Host "  Garcom:  http://$($i.IP):$PORTA/garcom.html"
    }
    Write-Host ""
    Write-Host "Os tablets precisam estar na MESMA rede wifi. Se o IP mudou, abra esses enderecos de novo neles."
    if (-not (Saude)) { Write-Host "Atencao: o servidor NAO esta respondendo agora (use a opcao 2 - Reiniciar)." -ForegroundColor Red }
  }
  "status" {
    $t = Tarefa
    if ($t) { Write-Host "Servico instalado (tarefa: $($t.State))." } else { Write-Host "Servico NAO instalado." -ForegroundColor Yellow }
    $s = Saude
    if ($s) {
      Write-Host "Servidor respondendo em http://localhost:$PORTA" -ForegroundColor Green
      Write-Host ("Pedidos hoje: " + $s.pedidosHoje + "   Ultimo backup: " + $s.ultimoBackup)
      $d = $s.delivery
      if ($d -and $d.ligado) {
        if ($d.erro) { Write-Host ("Delivery: ERRO ao buscar pedidos do site: " + $d.erro) -ForegroundColor Red }
        else { Write-Host ("Delivery: buscando pedidos do site (" + $d.importados + " trazidos desde que o servidor ligou)") -ForegroundColor Green }
      } else { Write-Host "Delivery: desligado (sem dados\delivery.json)" }
      if ($s.senhasPadrao) { Write-Host "ATENCAO: ainda tem senha padrao. Troque em Admin > Ajustes > Seguranca e uso." -ForegroundColor Yellow }
    } else { Write-Host "Servidor NAO esta respondendo." -ForegroundColor Red }
  }
}
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
