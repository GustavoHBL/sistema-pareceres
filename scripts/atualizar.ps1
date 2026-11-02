# Sistema de Pareceres - verificação e instalação de atualizações
# Chamado pelo "Iniciar Sistema". Nunca impede o sistema de abrir:
# qualquer falha (sem internet, download incompleto...) mantém a versão atual.
param(
  [string]$Dir = (Split-Path -Parent $PSScriptRoot),
  [string]$ApiUrl = "https://api.github.com/repos/GustavoHBL/sistema-pareceres/releases/latest"
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Linha([string]$texto, [string]$cor = "Gray") { Write-Host $texto -ForegroundColor $cor }
function Versao([string]$s) {
  try { return [version](($s.Trim() -replace '^[vV]', '' -split '-')[0]) } catch { return [version]"0.0.0" }
}

$arqVersao = Join-Path $Dir "VERSAO.txt"
$local = "0.0.0"
if (Test-Path $arqVersao) { $local = (Get-Content $arqVersao -Raw).Trim() }

Linha "Verificando se tem atualização..." "Cyan"

# 1) Consulta a última versão publicada (espera no máximo ~5 segundos)
try {
  $req = [Net.HttpWebRequest]::Create($ApiUrl)
  $req.UserAgent = "SistemaPareceres"
  $req.Accept = "application/vnd.github+json"
  $req.Timeout = 5000
  $req.ReadWriteTimeout = 5000
  $resp = $req.GetResponse()
  $leitor = New-Object IO.StreamReader($resp.GetResponseStream())
  $json = $leitor.ReadToEnd()
  $resp.Close()
  $rel = $json | ConvertFrom-Json
} catch {
  $status = $null
  try { $status = [int]$_.Exception.InnerException.Response.StatusCode } catch {}
  if (-not $status) { try { $status = [int]$_.Exception.Response.StatusCode } catch {} }
  if ($status -eq 404) {
    Linha "Nenhuma versão publicada ainda. Abrindo a versão instalada ($local)." "Yellow"
  } elseif ($status) {
    Linha "Não foi possível verificar agora (código $status). Abrindo a versão instalada ($local)." "Yellow"
  } else {
    Linha "Sem conexão com a internet. Abrindo a versão instalada ($local)." "Yellow"
  }
  exit 0
}

$remota = ($rel.tag_name -replace '^[vV]', '').Trim()
if ((Versao $remota) -le (Versao $local)) {
  Linha "Última versão já instalada ($local)." "Green"
  exit 0
}

$asset = $rel.assets | Where-Object { $_.name -like "*.zip" } | Select-Object -First 1
if (-not $asset) {
  Linha "A versão $remota ainda não tem pacote para instalar. Abrindo a versão instalada ($local)." "Yellow"
  exit 0
}

# 2) Baixa e instala, mostrando o progresso
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("SistemaPareceres_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp "pacote.zip"
$script:ultimo = -1
function Progresso([int]$p) {
  if ($p -eq $script:ultimo) { return }
  $script:ultimo = $p
  Write-Host -NoNewline ("`rInstalando nova versão ($remota)... {0,3}%   " -f $p) -ForegroundColor Cyan
}

try {
  Progresso 0
  # 2a) download: 0% a 80%
  $r = [Net.HttpWebRequest]::Create($asset.browser_download_url)
  $r.UserAgent = "SistemaPareceres"
  $r.Timeout = 30000
  $r.ReadWriteTimeout = 60000
  $res = $r.GetResponse()
  $total = [double]$res.ContentLength
  if ($total -le 0) { $total = [double]$asset.size }
  $entrada = $res.GetResponseStream()
  $saida = [IO.File]::Create($zip)
  $buf = New-Object byte[] 65536
  $lido = 0
  try {
    while (($n = $entrada.Read($buf, 0, $buf.Length)) -gt 0) {
      $saida.Write($buf, 0, $n)
      $lido += $n
      Progresso ([math]::Min(80, [math]::Floor($lido * 80 / $total)))
    }
  } finally { $saida.Close(); $entrada.Close(); $res.Close() }
  if ($asset.size -and (Get-Item $zip).Length -ne [long]$asset.size) { throw "download incompleto" }

  # 2b) abre o pacote numa pasta temporária: 80% a 85%
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $ext = Join-Path $tmp "x"
  [IO.Compression.ZipFile]::ExtractToDirectory($zip, $ext)
  $raiz = $ext
  if (-not (Test-Path (Join-Path $raiz "pb_public"))) {
    $sub = @(Get-ChildItem $ext -Directory)
    if ($sub.Count -eq 1) { $raiz = $sub[0].FullName }
  }
  if (-not (Test-Path (Join-Path $raiz "pb_public"))) { throw "pacote inválido" }
  Progresso 85

  # 2c) para o sistema, se estiver aberto, e faz backup dos dados: 85% a 90%
  $exeAtual = Join-Path $Dir "pocketbase.exe"
  $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    $_.ProcessName -in @("pocketbase", "pocketbase.exe") -or ($_.Path -and $_.Path -eq $exeAtual)
  })
  if ($procs.Count) {
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    $procs | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
  }
  $dados = Join-Path $Dir "pb_data"
  if (Test-Path $dados) {
    $bk = Join-Path $Dir ("backups\antes-atualizacao_" + (Get-Date -Format "yyyy-MM-dd_HH-mm") + "_v" + $local)
    New-Item -ItemType Directory -Force -Path $bk | Out-Null
    Copy-Item $dados -Destination $bk -Recurse -Force
  }
  Progresso 90

  # 2d) guarda uma cópia do programa atual para poder desfazer se algo falhar
  $foraDoPrograma = '^(pb_data|backups)([\\/]|$)'
  $relDe = { param($base, $item) $item.FullName.Substring($base.Length).TrimStart('\', '/') }
  $anterior = Join-Path $tmp "anterior"
  $atuais = @(Get-ChildItem $Dir -Recurse -File | Where-Object { (& $relDe $Dir $_) -notmatch $foraDoPrograma })
  foreach ($f in $atuais) {
    $d = Join-Path $anterior (& $relDe $Dir $f)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $d) | Out-Null
    Copy-Item $f.FullName -Destination $d -Force
  }

  # 2e) copia os arquivos novos (nunca mexe em pb_data nem em backups): 90% a 100%
  $arquivos = @(Get-ChildItem $raiz -Recurse -File | Where-Object { (& $relDe $raiz $_) -notmatch $foraDoPrograma })
  $i = 0
  try {
    foreach ($f in $arquivos) {
      $destino = Join-Path $Dir (& $relDe $raiz $f)
      $pasta = Split-Path -Parent $destino
      if (-not (Test-Path $pasta)) { New-Item -ItemType Directory -Force -Path $pasta | Out-Null }
      Copy-Item $f.FullName -Destination $destino -Force
      $i++
      Progresso (90 + [math]::Floor($i * 10 / [math]::Max(1, $arquivos.Count)))
    }
  } catch {
    $erroCopia = $_.Exception.Message
    # desfaz: devolve os arquivos do programa como estavam antes
    foreach ($f in @(Get-ChildItem $anterior -Recurse -File)) {
      try { Copy-Item $f.FullName -Destination (Join-Path $Dir (& $relDe $anterior $f)) -Force } catch {}
    }
    throw ("um arquivo estava em uso e não pôde ser trocado; nada foi alterado - " + $erroCopia)
  }
  Set-Content -Path $arqVersao -Value $remota -Encoding ASCII
  Progresso 100
  Write-Host ""
  Linha "Instalação concluída! Versão $remota." "Green"
} catch {
  Write-Host ""
  Linha ("Não foi possível atualizar agora (" + $_.Exception.Message + ").") "Yellow"
  Linha "Abrindo a versão instalada ($local)." "Yellow"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
exit 0
