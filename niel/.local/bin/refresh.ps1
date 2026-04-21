[CmdletBinding()]
param()

$environmentRegistryPath = 'HKCU:\Environment'

function Set-UserEnvironmentVariable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $propertyType = if ($Value -match '%[^%]+%') { 'ExpandString' } else { 'String' }
    New-ItemProperty -Path $environmentRegistryPath -Name $Name -Value $Value -PropertyType $propertyType -Force | Out-Null

    $processValue = [Environment]::ExpandEnvironmentVariables($Value)
    [Environment]::SetEnvironmentVariable($Name, $processValue, 'Process')
}

$existingUserPath = @(
    [Environment]::GetEnvironmentVariable('Path', 'User') -split ';' |
    Where-Object { $_ }
)

$wantedPathEntries = @(
    "$HOME\.local\bin",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links",
    "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin",
    "$env:APPDATA\npm",
    'C:\Program Files\Git\mingw64\bin',
    "$HOME\AppData\Local\pnpm",
    "$HOME\.dotnet\tools",
    "$HOME\go\bin"
)

$wantedVariables = [ordered]@{
    TMP  = '%USERPROFILE%\AppData\Local\Temp'
    TEMP = '%USERPROFILE%\AppData\Local\Temp'
}

$wantedExisting = @($wantedPathEntries | Where-Object { $_ -and (Test-Path $_) })
$userPath = @($wantedExisting + $existingUserPath | Select-Object -Unique)
$existingMachinePath = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';' |
    Where-Object { $_ }
)
$processPath = @($existingMachinePath + $userPath | Select-Object -Unique)

[Environment]::SetEnvironmentVariable('Path', ($userPath -join ';'), 'User')
[Environment]::SetEnvironmentVariable('Path', ($processPath -join ';'), 'Process')

Write-Host 'Set User PATH entries:'
foreach ($pathEntry in $userPath) {
    Write-Host "  - $pathEntry"
}

foreach ($entry in $wantedVariables.GetEnumerator()) {
    Set-UserEnvironmentVariable -Name $entry.Key -Value $entry.Value
    Write-Host "Set User variable: $($entry.Key)=$($entry.Value)"
}

Write-Host "`nDone. Updated user PATH and user environment variables."
Write-Host 'The current PowerShell process PATH was refreshed too. Open a new terminal for other apps and shells.'
