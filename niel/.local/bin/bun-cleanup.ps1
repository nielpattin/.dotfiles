#Requires -Version 5.1
<#
.SYNOPSIS
    Cleans up orphaned bun global binaries and clears the bun cache.

.DESCRIPTION
    bun uninstall -g does not remove binaries from ~/.bun/bin (oven-sh/bun#11970).
    This script reads the global package.json to find installed packages, then
    removes any binaries in ~/.bun/bin that don't belong to an installed package.
    Also clears the bun package cache.
#>

$ErrorActionPreference = "Stop"

$bunBinDir = Join-Path $HOME ".bun\bin"
$globalDir = Join-Path $HOME ".bun\install\global"
$globalNodeModules = Join-Path $globalDir "node_modules"
$globalNodeModulesBinDir = Join-Path $globalNodeModules ".bin"
$globalPkgJson = Join-Path $globalDir "package.json"

if (-not (Test-Path $bunBinDir)) {
    Write-Host "No ~/.bun/bin found. Nothing to clean." -ForegroundColor Yellow
    exit 0
}

if (-not (Test-Path $globalPkgJson)) {
    Write-Host "No global package.json found. Nothing to clean." -ForegroundColor Yellow
    exit 0
}

# Read top-level dependencies from the global package.json
$globalPkg = Get-Content $globalPkgJson -Raw | ConvertFrom-Json
$topLevelDeps = @()
if ($globalPkg.dependencies) {
    $topLevelDeps = @($globalPkg.dependencies.PSObject.Properties.Name)
}

# For each top-level package, find its bin entries
$ownedBinaries = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)
$packageBins = @{}

foreach ($pkgName in $topLevelDeps) {
    $pkgJson = Join-Path $globalNodeModules "$pkgName\package.json"
    if (-not (Test-Path $pkgJson)) {
        Write-Host "  Warning: $pkgName has no package.json in node_modules" -ForegroundColor DarkYellow
        continue
    }

    try {
        $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
    } catch {
        Write-Host "  Warning: failed to parse $pkgJson" -ForegroundColor DarkYellow
        continue
    }

    $bins = @()
    if ($pkg.bin -is [string]) {
        $bins = @($pkg.name)
        [void]$ownedBinaries.Add($pkg.name)
    } elseif ($pkg.bin -is [PSCustomObject]) {
        $bins = @($pkg.bin.PSObject.Properties.Name)
        foreach ($key in $bins) {
            [void]$ownedBinaries.Add($key)
        }
    }

    if ($bins.Count -gt 0) {
        $packageBins[$pkgName] = $bins
    }
}

function Get-BinaryStem([System.IO.FileInfo]$file) {
    if ($file.Name -match '^(.+)\.(exe|bunx|cmd|ps1)$') {
        return $Matches[1]
    }
    return $file.BaseName
}

function Find-OrphanedPublicBinaries([string]$dir) {
    if (-not (Test-Path $dir)) { return @() }

    $result = @()
    foreach ($file in @(Get-ChildItem -Path $dir -File)) {
        $stem = Get-BinaryStem $file
        if (-not $ownedBinaries.Contains($stem)) {
            $result += $file
        }
    }
    return $result
}

function Find-MatchingInternalBinaries([string]$dir, [System.Collections.Generic.HashSet[string]]$stems) {
    if (-not (Test-Path $dir)) { return @() }

    $result = @()
    foreach ($file in @(Get-ChildItem -Path $dir -File)) {
        $stem = Get-BinaryStem $file
        if ($stems.Contains($stem)) {
            $result += $file
        }
    }
    return $result
}

# Find orphaned public binaries in ~/.bun/bin. Then remove matching internal shims in
# node_modules/.bin for the same stems only. Do not independently classify internal
# .bin entries because that directory contains dependency shims with non-obvious owners.
$publicOrphans = @(Find-OrphanedPublicBinaries $bunBinDir)
$publicOrphanStems = [System.Collections.Generic.HashSet[string]]::new(
    [StringComparer]::OrdinalIgnoreCase
)
foreach ($file in $publicOrphans) {
    [void]$publicOrphanStems.Add((Get-BinaryStem $file))
}

$orphaned = @()
$orphaned += $publicOrphans
$orphaned += Find-MatchingInternalBinaries $globalNodeModulesBinDir $publicOrphanStems

# Report installed packages that own binaries in ~/.bun/bin
Write-Host ""
Write-Host "Global packages that own ~/.bun/bin binaries:" -ForegroundColor Cyan
if ($packageBins.Count -eq 0) {
    Write-Host "  (none)"
} else {
    foreach ($pkgName in ($packageBins.Keys | Sort-Object)) {
        $bins = $packageBins[$pkgName] -join ", "
        Write-Host "  $pkgName  ->  $bins"
    }
}

# Report orphans
Write-Host ""
if ($orphaned.Count -eq 0) {
    Write-Host "No orphaned binaries in Bun global bin dirs" -ForegroundColor Green
} else {
    Write-Host "Orphaned binaries:" -ForegroundColor Yellow
    foreach ($file in $orphaned) {
        Write-Host "  $($file.FullName)" -ForegroundColor Red
    }

    Write-Host ""
    $confirm = Read-Host "Remove $($orphaned.Count) orphaned file(s)? (Y/n)"
    if ($confirm -ne 'n' -and $confirm -ne 'N') {
        foreach ($file in $orphaned) {
            try {
                Remove-Item $file.FullName -Force -ErrorAction Stop
                Write-Host "  Removed: $($file.Name)" -ForegroundColor DarkRed
            } catch {
                Write-Host "  Skipped (in use): $($file.Name)" -ForegroundColor DarkYellow
            }
        }
    } else {
        Write-Host "Skipped removal." -ForegroundColor Yellow
    }
}

# Clear bun cache
Write-Host ""
Write-Host "Clearing bun cache..." -ForegroundColor Cyan
Push-Location $globalDir
try {
    bun pm cache rm
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Done." -ForegroundColor Green
    } else {
        Write-Host "Cache clear failed with exit code $LASTEXITCODE." -ForegroundColor Red
    }
} finally {
    Pop-Location
}
