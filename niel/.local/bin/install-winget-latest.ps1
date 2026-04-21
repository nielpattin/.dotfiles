[CmdletBinding()]
param(
    [switch]$StableOnly
)

$repoApiUrl = 'https://api.github.com/repos/microsoft/winget-cli/releases?per_page=20'
$packageName = 'Microsoft.DesktopAppInstaller'
$tempFile = Join-Path $env:TEMP 'winget-latest.msixbundle'

function Get-ReleaseVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$TagName
    )

    if ($TagName -match '^v(?<version>\d+(?:\.\d+)+)') {
        return [version]$matches.version
    }

    throw "Could not parse version from tag '$TagName'."
}

$response = Invoke-RestMethod -Uri $repoApiUrl
$releases = @($response | ForEach-Object { $_ })
if ($StableOnly) {
    $releases = @($releases | Where-Object { -not $_.prerelease })
}

$candidates = foreach ($release in $releases) {
    $releaseAssets = @($release.assets | ForEach-Object { $_ })
    $asset = $releaseAssets |
        Where-Object {
            [string]$_.name -like 'Microsoft.DesktopAppInstaller*.msixbundle'
        } |
        Select-Object -First 1

    if (-not $asset) {
        continue
    }

    [pscustomobject]@{
        TagName      = [string]$release.tag_name
        Version      = Get-ReleaseVersion -TagName ([string]$release.tag_name)
        IsPrerelease = [bool]$release.prerelease
        PublishedAt  = [datetime]([string]$release.published_at)
        DownloadUrl  = [string]$asset.browser_download_url
        AssetName    = [string]$asset.name
    }
}

if (-not $candidates) {
    throw 'No matching winget release asset was found on GitHub.'
}

$target = $candidates |
    Sort-Object -Property @(
        @{ Expression = 'Version'; Descending = $true },
        @{ Expression = { if ($_.IsPrerelease) { 0 } else { 1 } }; Descending = $true },
        @{ Expression = 'PublishedAt'; Descending = $true }
    ) |
    Select-Object -First 1

$installed = Get-AppxPackage -Name $packageName -ErrorAction SilentlyContinue | Select-Object -First 1
$installedVersion = if ($installed) { [version]$installed.Version } else { $null }

Write-Host "Selected release: $($target.TagName)"
Write-Host "Selected version: $($target.Version)"
Write-Host "Selected asset: $($target.AssetName)"
if ($installedVersion) {
    Write-Host "Installed version: $installedVersion"
}
else {
    Write-Host 'Installed version: not installed'
}

if ($installedVersion -and $installedVersion -ge $target.Version) {
    Write-Host 'Winget is already at this version or newer. Nothing to install.'
    return
}

try {
    Invoke-WebRequest -Uri $target.DownloadUrl -OutFile $tempFile
    Add-AppxPackage -Path $tempFile -ForceApplicationShutdown -ErrorAction Stop
    Write-Host 'Winget install completed.'
}
catch {
    Write-Error "Winget install failed: $($_.Exception.Message)"
    exit 1
}
finally {
    if (Test-Path $tempFile) {
        Remove-Item $tempFile -Force
    }
}
