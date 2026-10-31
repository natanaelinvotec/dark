# Desliga o painel e o worker ligados pelo iniciar.bat.
Set-Location (Split-Path $PSScriptRoot -Parent)
$pids = Join-Path (Get-Location) "dados\processos.txt"
if (-not (Test-Path $pids)) {
    Write-Host "Nada ligado pelo iniciar.bat." -ForegroundColor Yellow
    exit 0
}
foreach ($id in ((Get-Content $pids) -split " " | Where-Object { $_ })) {
    # /T derruba também o Python que o uv abriu
    taskkill /PID $id /T /F 2>$null | Out-Null
}
Remove-Item $pids
Write-Host "Painel e worker desligados." -ForegroundColor Green
