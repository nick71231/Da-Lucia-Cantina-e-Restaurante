# Liga o servidor como tarefa do Windows: sobe sozinho quando o computador liga (mesmo sem ninguem fazer login),
# roda escondido e reinicia sozinho se cair. Use pelo servico.bat (ele pede permissao de administrador).
# Uso direto:  powershell -ExecutionPolicy Bypass -File servico.ps1 instalar|reiniciar|status|desinstalar
param([ValidateSet("instalar", "reiniciar", "status", "desinstalar")][string]$acao = "status")
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
  try { return Invoke-RestMethod -Uri "http://localhost:$PORTA/api/saude" -TimeoutSec 3 } catch { return $null }
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
