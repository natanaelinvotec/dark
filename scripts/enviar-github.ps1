# Manda o código deste PC para o GitHub (natanaelinvotec/dark).
# "Continue": o git escreve progresso no stderr; o resultado é conferido por $LASTEXITCODE
$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)
function Parar($texto) { Write-Host $texto -ForegroundColor Red; exit 1 }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Parar "O Git não está instalado: winget install Git.Git" }

$pendentes = git status --short
if ($pendentes) {
    Write-Host "Alterações ainda não salvas no Git:" -ForegroundColor Yellow
    $pendentes | ForEach-Object { Write-Host "  $_" }
    if ((Read-Host "Salvar e enviar junto? (s/n)") -match "^[sS]") {
        git add -A
        git commit -m "atualização do estúdio"
        if ($LASTEXITCODE -ne 0) { Parar "O commit falhou. Mande o print para o Claude." }
    }
}

Write-Host "Se abrir uma janela do GitHub, escolha 'Sign in with your browser' e autorize." -ForegroundColor Cyan
git fetch origin
if ($LASTEXITCODE -ne 0) { Parar "Não consegui falar com o GitHub. Confira a internet e o login." }

# o primeiro envio pela web criou outro histórico: na primeira vez, o do PC substitui o de lá
git merge-base HEAD origin/main *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Primeira vez: trocando o upload feito pelo site pela versão completa deste PC."
    git push -u --force-with-lease origin main
} else {
    git push -u origin main
}
if ($LASTEXITCODE -ne 0) { Parar "O envio falhou. Mande o print desta janela para o Claude." }
Write-Host "`nPronto: https://github.com/natanaelinvotec/dark" -ForegroundColor Green
