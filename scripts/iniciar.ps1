# Liga o painel e o worker em segundo plano e abre o painel no navegador.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$logs = Join-Path (Get-Location) "dados\logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$pids = Join-Path (Get-Location) "dados\processos.txt"

# abre o endereço online (Cloudflare) se houver; senão o local
$endereco = "http://127.0.0.1:8787"
if (Test-Path ".env") {
    $linha = Select-String -Path ".env" -Pattern '^\s*ESTUDIO_ENDERECO\s*=\s*"?(https://[^"\s]+)' | Select-Object -First 1
    if ($linha) { $endereco = $linha.Matches[0].Groups[1].Value }
}

function Vivo($id) {
    # confere o nome também: depois de reiniciar, o Windows pode reusar o número do processo
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    return [bool]($p -and $p.ProcessName -in @("uv", "python"))
}

if (Test-Path $pids) {
    $antigos = @((Get-Content $pids) -split " " | Where-Object { $_ })
    if ($antigos.Count -ge 1 -and (Vivo $antigos[0])) {
        Write-Host "Já está rodando. Abrindo o painel." -ForegroundColor Yellow
        Start-Process $endereco
        exit 0
    }
    foreach ($id in $antigos) { taskkill /PID $id /T /F 2>$null | Out-Null }
    Remove-Item $pids
}

$env:PYTHONUTF8 = "1"  # registros com acento e símbolos sem erro de codificação
$painel = Start-Process uv -ArgumentList "run", "estudio", "painel" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$logs\painel.log" -RedirectStandardError "$logs\painel-erros.log"
$worker = Start-Process uv -ArgumentList "run", "estudio", "worker" -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput "$logs\worker.log" -RedirectStandardError "$logs\worker-erros.log"
Set-Content $pids "$($painel.Id) $($worker.Id)"

Start-Sleep -Seconds 5
if ($painel.HasExited) {
    taskkill /PID $worker.Id /T /F 2>$null | Out-Null
    Remove-Item $pids
    Write-Host "O painel não subiu. Veja dados\logs\painel-erros.log ou rode o instalar.bat de novo." -ForegroundColor Red
    exit 1
}
if ($worker.HasExited) {
    Write-Host "O worker parou (veja dados\logs\worker-erros.log). Faltam chaves no .env? O painel segue ligado." -ForegroundColor Yellow
}
Start-Process $endereco
Write-Host "Painel e worker rodando em $endereco. Para desligar: parar.bat. Registros em dados\logs." -ForegroundColor Green
