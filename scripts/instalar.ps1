# Instala e configura o Estúdio de Canais neste PC (Windows 10/11).
# Pode rodar de novo quantas vezes quiser: o que já está pronto é pulado.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Tem($comando) { [bool](Get-Command $comando -ErrorAction SilentlyContinue) }
function RecarregarPath {
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}
function Parar($texto) { Write-Host $texto -ForegroundColor Red; exit 1 }

Passo "1/7 Programas: uv e FFmpeg"
if (-not (Tem "winget")) {
    Parar "O winget não existe neste Windows. Instale o 'Instalador de Aplicativo' pela Microsoft Store e rode de novo."
}
Write-Host "Se o winget perguntar se você concorda com os termos, leia e responda Y (sim) e Enter."
if (-not (Tem "uv"))     { winget install --id astral-sh.uv -e; RecarregarPath }
if (-not (Tem "ffmpeg")) { winget install --id Gyan.FFmpeg -e; RecarregarPath }
if (-not (Tem "uv")) {
    Parar "Feche esta janela e abra o instalar.bat de novo (o Windows precisa recarregar o PATH)."
}
Write-Host "uv e FFmpeg prontos." -ForegroundColor Green

Passo "2/7 Bibliotecas do projeto (uv sync, demora na primeira vez)"
uv sync --all-extras
if ($LASTEXITCODE -ne 0) { Parar "O uv sync falhou. Mande o print desta janela para o Claude." }

Passo "3/7 Configuração: senha do painel, pasta do Drive e chaves (ficam só no .env deste PC)"
uv run estudio configurar
if ($LASTEXITCODE -ne 0) { Parar "A configuração não terminou. Rode o instalar.bat de novo." }

Passo "4/7 Banco e pastas dos canais no Drive"
uv run estudio init
if ($LASTEXITCODE -ne 0) { Parar "Confira a pasta do Drive (ESTUDIO_DADOS no .env) e rode de novo." }

Passo "5/7 Testes automáticos"
uv run pytest -q
if ($LASTEXITCODE -eq 0) {
    Write-Host "Todos os testes passaram." -ForegroundColor Green
} else {
    Write-Host "Algum teste falhou. Mande o print desta janela para o Claude; o resto continua." -ForegroundColor Yellow
}

Passo "6/7 Acesso pelo celular (Tailscale, opcional)"
$resposta = Read-Host "Configurar o acesso pelo celular com a Tailscale agora? (s/n)"
if ($resposta -match "^[sS]") {
    if (-not (Tem "tailscale")) { winget install --id tailscale.tailscale -e; RecarregarPath }
    if (-not (Tem "tailscale")) {
        Write-Host "Abra o app da Tailscale, entre na sua conta e rode o instalar.bat de novo." -ForegroundColor Yellow
    } else {
        Write-Host "Entre na sua conta Tailscale (use a mesma conta no celular)."
        tailscale up
        # só a sua rede Tailscale enxerga; nada fica aberto na internet
        if ($LASTEXITCODE -eq 0) { tailscale serve --bg http://127.0.0.1:8787 }
        if ($LASTEXITCODE -eq 0) {
            tailscale serve status
            Write-Host "No celular: instale a Tailscale, entre na mesma conta e abra o endereço https acima." -ForegroundColor Green
        } else {
            Write-Host "A Tailscale não terminou. Se ela pedir para ativar HTTPS, aceite no site e rode de novo." -ForegroundColor Yellow
        }
    }
}

Passo "7/7 Abrir junto com o Windows (opcional)"
$resposta = Read-Host "Ligar o painel e o worker sozinhos quando o Windows iniciar? (s/n)"
if ($resposta -match "^[sS]") {
    $atalho = Join-Path ([Environment]::GetFolderPath("Startup")) "Estudio de Canais.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($atalho)
    $link.TargetPath = Join-Path (Get-Location) "iniciar.bat"
    $link.WorkingDirectory = (Get-Location).Path
    $link.WindowStyle = 7
    $link.Save()
    Write-Host "Pronto: o atalho está na pasta Inicializar do Windows." -ForegroundColor Green
}

Write-Host "`nTudo certo. Para usar agora, abra o iniciar.bat." -ForegroundColor Green
