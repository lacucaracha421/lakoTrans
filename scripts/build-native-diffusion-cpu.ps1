param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$BuildDirectory,
  [string]$CMake = "cmake"
)
$ErrorActionPreference = "Stop"
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$revision = git -C $source rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -ne "b68d58624d227682eb4b95ef8bcf569cd1311eb5") {
  throw "Use stable-diffusion.cpp master-853-b68d586 with its pinned submodules"
}
if (git -C $source status --porcelain) { throw "Source must be clean" }
$submodules = git -C $source submodule status --recursive
if ($LASTEXITCODE -ne 0 -or ($submodules | Where-Object { $_ -match "^[+-U]" })) {
  throw "Initialize the exact pinned submodules before building"
}
& $CMake -S $source -B $BuildDirectory -G "Visual Studio 17 2022" -A x64 -DSD_BUILD_SHARED_LIBS=ON -DSD_BUILD_EXAMPLES=OFF -DSD_WEBP=OFF -DSD_WEBM=OFF -DGGML_NATIVE=OFF -DGGML_AVX2=ON -DGGML_AVX512=OFF -DGGML_AVX_VNNI=OFF
if ($LASTEXITCODE -ne 0) { throw "CMake configuration failed" }
& $CMake --build $BuildDirectory --config Release --target stable-diffusion --parallel 4
if ($LASTEXITCODE -ne 0) { throw "Native diffusion build failed" }
