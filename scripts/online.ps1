# Coloca o painel online com Cloudflare Tunnel (o PC liga para a Cloudflare; nenhuma porta
# fica aberta no roteador). A proteção de login (Cloudflare Access) é configurada no site
# da Cloudflare: este script não abre o painel sem ela, só instala o túnel.
$ErrorActionPreference = "Stop"

# o serviço do Windows precisa de administrador: reabre pedindo permissão
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
    exit 0
}
Set-Location (Split-Path $PSScriptRoot -Parent)

function Passo($texto) { Write-Host "`n==> $texto" -ForegroundColor Cyan }
function Tem($comando) { [bool](Get-Command $comando -ErrorAction SilentlyContinue) }
function Parar($texto) { Write-Host $texto -ForegroundColor Red; exit 1 }

Write-Host "Antes de continuar, você precisa já ter feito no site da Cloudflare (nesta ordem):" -ForegroundColor Yellow
Write-Host "  1. Domínio adicionado à Cloudflare"
Write-Host "  2. Zero Trust > Access controls > Applications: endereço do painel liberado só para o seu e-mail"
Write-Host "  3. Networking > Tunnels: túnel criado (a tela mostra o token que este script pede)"
Write-Host "  O caminho do túnel (Published application -> http://127.0.0.1:8787) você cria depois deste script."
Write-Host "  (passo a passo no README, seção 'Acesso online')"
if ((Read-Host "Já fez os 3 passos? (s/n)") -notmatch "^[sS]") { Parar "Faça os passos e rode o online.bat de novo." }

Passo "1/3 Programa cloudflared"
if (-not (Tem "cloudflared")) {
    Write-Host "Se o winget perguntar se você concorda com os termos, leia e responda Y (sim) e Enter."
    winget install --id Cloudflare.cloudflared -e
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
                [Environment]::GetEnvironmentVariable("Path", "User")
}
if (-not (Tem "cloudflared")) { Parar "Feche esta janela e abra o online.bat de novo (o Windows precisa recarregar o PATH)." }

Passo "2/3 Túnel como serviço do Windows (liga sozinho com o PC)"
if (Get-Service -Name cloudflared -ErrorAction SilentlyContinue) {
    Write-Host "O serviço do túnel já está instalado." -ForegroundColor Green
} else {
    Write-Host "No site da Cloudflare, na tela do túnel, copie só o token (o texto longo depois de 'service install')."
    $seguro = Read-Host "Cole o token aqui (não aparece na tela)" -AsSecureString
    $token = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))
    $token = $token.Trim()
    if ($token -notmatch "^[A-Za-z0-9+/=_\-\.]{80,}$") { Parar "Isso não parece um token de túnel. Copie de novo e rode o online.bat." }
    cloudflared service install $token
    $token = $null
    if ($LASTEXITCODE -ne 0) { Parar "A instalação do túnel falhou. Mande o print desta janela para o Claude." }
    Write-Host "Túnel instalado." -ForegroundColor Green
}

Passo "3/3 Painel em modo online (cookie só por https)"
uv run estudio configurar --online
if ($LASTEXITCODE -ne 0) { Parar "Não consegui gravar no .env. Rode o online.bat de novo." }

Write-Host "`nFalta 1 passo no site: no túnel, aba Routes > Add route > Published application," -ForegroundColor Yellow
Write-Host "com o seu endereço e o Service URL http://127.0.0.1:8787 (ligue 'Protect with Access')."
Write-Host "`nDepois desligue e ligue o painel (parar.bat e iniciar.bat) e abra o seu endereço." -ForegroundColor Green
Write-Host "Primeiro vem o login da Cloudflare (código no seu e-mail), depois a senha do painel."
