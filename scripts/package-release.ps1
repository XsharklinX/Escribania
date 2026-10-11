# Reúne en una carpeta todo lo que se distribuye de una versión para Windows:
#   release\v<versión>\
#     Escribania-<versión>-Setup.exe       instalador (por usuario, sin pedir administrador)
#     Escribania-<versión>-Portable.zip    portable (Escribania.exe + archivo "portable")
#     SHA256SUMS.txt                       huellas para comprobar las descargas
# Uso: npm run build:release   (compila con "tauri build" y después empaqueta)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$exe = Join-Path $root 'src-tauri\target\release\Escribania.exe'
$nsisDir = Join-Path $root 'src-tauri\target\release\bundle\nsis'
if (-not (Test-Path $exe)) { throw "No existe $exe. Compila primero: npm run tauri build" }
$setup = Get-ChildItem $nsisDir -Filter "*_${version}_x64-setup.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $setup) { throw "No se encuentra el instalador de la versión $version en $nsisDir" }

$out = Join-Path $root "release\v$version"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null

Copy-Item $setup.FullName (Join-Path $out "Escribania-$version-Setup.exe")

# Portable: carpeta temporal -> zip
$name = "Escribania-$version-Portable"
$stage = Join-Path ([IO.Path]::GetTempPath()) "$name-$PID\Escribania"
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $exe (Join-Path $stage 'Escribania.exe')
Copy-Item (Join-Path $root 'LICENSE') (Join-Path $stage 'LICENSE.txt')
# El marcador "portable" activa el modo portable: ajustes y copias en .\Datos
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $stage 'portable'), @"
Este archivo activa el modo portable de Escribanía.
Mientras esté junto a Escribania.exe, los ajustes, las copias de seguridad y los
proyectos nuevos se guardan en la carpeta Datos, al lado del programa.
Bórralo si prefieres que Escribanía guarde sus datos en este equipo.
"@, $utf8)
Compress-Archive -Path $stage -DestinationPath (Join-Path $out "$name.zip")
Remove-Item (Split-Path $stage -Parent) -Recurse -Force

$sums = Get-ChildItem $out -File | Where-Object Name -ne 'SHA256SUMS.txt' | ForEach-Object {
  '{0}  {1}' -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower(), $_.Name
}
Set-Content -Path (Join-Path $out 'SHA256SUMS.txt') -Value $sums -Encoding ASCII

Write-Host ""
Write-Host "Versión $version lista en: $out"
Get-ChildItem $out | ForEach-Object { Write-Host ("  {0,-40} {1,8:N1} MB" -f $_.Name, ($_.Length / 1MB)) }
