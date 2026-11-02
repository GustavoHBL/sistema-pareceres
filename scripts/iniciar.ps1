# Sistema de Pareceres - inicialização (chamado pelo "Iniciar Sistema.bat")
$Dir = Split-Path -Parent $PSScriptRoot
Set-Location $Dir
$Host.UI.RawUI.WindowTitle = "Sistema de Pareceres"

Write-Host ""
Write-Host "  SISTEMA DE PARECERES" -ForegroundColor White
Write-Host "  --------------------" -ForegroundColor DarkGray
Write-Host ""

# 1) Atualização automática (se houver internet)
try { & (Join-Path $PSScriptRoot "atualizar.ps1") -Dir $Dir } catch {
  Write-Host "Não foi possível verificar atualizações. Abrindo a versão instalada." -ForegroundColor Yellow
}
Write-Host ""

$exe = Join-Path $Dir "pocketbase.exe"
$url = "http://127.0.0.1:8090/"

# 2) Acesso administrativo com senha própria deste computador.
#    Roda na primeira instalação e também troca a senha antiga fixa ("Pareceres2026")
#    das instalações anteriores, porque ela ficou pública no GitHub.
if (-not (Test-Path (Join-Path $Dir "pb_data\admin.txt"))) {
  if (Test-Path (Join-Path $Dir "pb_data\data.db")) {
    Write-Host "Criando uma senha nova para o painel administrativo..." -ForegroundColor Cyan
  } else {
    Write-Host "Preparando o sistema pela primeira vez..." -ForegroundColor Cyan
  }
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789".ToCharArray()
  $senha = -join (1..16 | ForEach-Object { $chars | Get-Random })
  & $exe superuser upsert "admin@pareceres.local" $senha *> $null
  New-Item -ItemType Directory -Force -Path (Join-Path $Dir "pb_data") | Out-Null
  Set-Content -Path (Join-Path $Dir "pb_data\admin.txt") -Encoding UTF8 -Value @(
    "Painel administrativo: $($url)_/",
    "Usuario: admin@pareceres.local",
    "Senha: $senha"
  )
}

# 3) Liga o sistema (em segundo plano, sem janela)
if (-not (Get-Process -Name "pocketbase" -ErrorAction SilentlyContinue)) {
  Write-Host "Iniciando o sistema..." -ForegroundColor Cyan
  Start-Process -FilePath $exe -ArgumentList "serve", "--http=127.0.0.1:8090" -WorkingDirectory $Dir -WindowStyle Hidden
}

# 4) Espera responder (até ~15 s) e abre no navegador
$ok = $false
for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
  try {
    $r = [Net.HttpWebRequest]::Create($url + "api/health"); $r.Timeout = 1000
    $r.GetResponse().Close(); $ok = $true
  } catch { Start-Sleep -Milliseconds 500 }
}
Start-Process $url
if ($ok) {
  Write-Host "Sistema aberto no navegador. Esta janela fecha sozinha." -ForegroundColor Green
} else {
  Write-Host "O sistema está demorando para responder. Se a página não abrir, feche e clique em Iniciar Sistema de novo." -ForegroundColor Yellow
}
Start-Sleep -Seconds 4
