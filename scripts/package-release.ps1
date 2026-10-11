# Reúne en una carpeta todo lo que se publica de una versión para Windows:
#   release\v<versión>\
#     Escribania-<versión>-Setup.exe       instalador propio (por usuario, sin administrador)
#     Escribania-<versión>-Portable.zip    portable (Escribania.exe + archivo "portable")
#     Escribania-<versión>-x64.exe         el programa solo: lo descarga el actualizador
#     Escribania-<versión>-x64.exe.sig     su firma ed25519
#     latest.json                          lo que lee el actualizador (versión, notas, firma)
#     SHA256SUMS.txt                       huellas para comprobar las descargas
# Uso: npm run build:release   (compila con "tauri build" y después empaqueta)
# Sube todos los archivos a una release de GitHub con la etiqueta v<versión>.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$exe = Join-Path $root 'src-tauri\target\release\Escribania.exe'
if (-not (Test-Path $exe)) { throw "No existe $exe. Compila primero: npm run tauri build" }
$repo = (Get-Content (Join-Path $root 'src-tauri\actualizaciones.json') -Raw -Encoding UTF8 | ConvertFrom-Json).repo
if (-not $repo) { Write-Warning 'src-tauri\actualizaciones.json no tiene "repo": las copias instaladas no podrán buscar esta versión.' }

# 1. Instalador propio (lleva dentro el Escribania.exe recién compilado).
Push-Location (Join-Path $root 'installer')
cargo build --release --features custom-protocol
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Falló la compilación del instalador' }
Pop-Location
$setup = Join-Path $root 'installer\target\release\escribania-setup.exe'

# 2. Herramienta de firma.
Push-Location (Join-Path $root 'tools\firma')
cargo build --release
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'Falló la compilación de la herramienta de firma' }
Pop-Location
$firma = Join-Path $root 'tools\firma\target\release\firma.exe'

$out = Join-Path $root "release\v$version"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item $setup (Join-Path $out "Escribania-$version-Setup.exe")
$bare = Join-Path $out "Escribania-$version-x64.exe"
Copy-Item $exe $bare
& $firma firmar $bare
if ($LASTEXITCODE -ne 0) { throw 'No se pudo firmar (¿falta la clave? firma clave)' }
& $firma comprobar $bare
if ($LASTEXITCODE -ne 0) { throw 'La firma no coincide con src-tauri\firma.pub' }

# 3. Portable: carpeta temporal -> zip
$name = "Escribania-$version-Portable"
$stage = Join-Path ([IO.Path]::GetTempPath()) "$name-$PID\Escribania"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $exe (Join-Path $stage 'Escribania.exe')
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE.txt')
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $stage 'portable'), @"
Este archivo activa el modo portable de Escribanía.
Mientras esté junto a Escribania.exe, los ajustes, las copias de seguridad y el
cuaderno se guardan en la carpeta Datos, al lado del programa.
Bórralo si prefieres que Escribanía guarde sus datos en este equipo.
"@, $utf8)
Compress-Archive -Path $stage -DestinationPath (Join-Path $out "$name.zip")
Remove-Item (Split-Path $stage -Parent) -Recurse -Force

# 4. latest.json: notas de notas\<versión>.json si existen.
$notesFile = Join-Path $root "notas\$version.json"
$notes = if (Test-Path $notesFile) { Get-Content $notesFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { Write-Warning "Sin notas: crea notas\$version.json"; @{} }
$hash = (Get-FileHash $bare -Algorithm SHA256).Hash.ToLower()
$latest = [ordered]@{
  version = $version
  date = (Get-Date -Format 'yyyy-MM-dd')
  notes = $notes
  platforms = [ordered]@{
    'windows-x86_64' = [ordered]@{
      url = "https://github.com/$repo/releases/download/v$version/Escribania-$version-x64.exe"
      size = (Get-Item $bare).Length
      sha256 = $hash
      signature = (Get-Content "$bare.sig" -Raw).Trim()
    }
  }
}
[IO.File]::WriteAllText((Join-Path $out 'latest.json'), ($latest | ConvertTo-Json -Depth 6), $utf8)

$sums = Get-ChildItem $out -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' -and $_.Name -ne 'latest.json' } | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Value $sums -Encoding ASCII

Write-Host ""
Write-Host "Versión $version lista en: $out"
Get-ChildItem $out | ForEach-Object { Write-Host ("  {0,-40} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
Write-Host ""
Write-Host "Publica: gh release create v$version release\v$version\* --title `"Escribanía $version`""
