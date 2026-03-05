# ==============================================================================
# OPTIMIZED PowerShell Profile (Stable)
# ============================================================================== 

# ==============================================================================
# Environment Setup (instant)
# ==============================================================================
$env:TERM = "xterm-256color"

# ==============================================================================
# Starship
# ==============================================================================
if (Get-Command starship -ErrorAction SilentlyContinue) {
    Invoke-Expression (&starship init powershell)
}

# ==============================================================================
# Zoxide
# ==============================================================================
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}

# ==============================================================================
# Functions (moved outside wrapper for reliability)
# ==============================================================================
function touch($file) { "" | Out-File $file -Encoding ASCII }

if (Test-Path Alias:ls) { Remove-Item Alias:ls -Force -ErrorAction SilentlyContinue }
function ls { eza -la --icons --git @args }
# Set-Alias -Name lsa -Value ls -Option AllScope

function ff($name) {
    Get-ChildItem -recurse -filter "*${name}*" -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Output "$($_.FullName)"
    }
}

function so { . $PROFILE }

function dot {
    git --git-dir=$HOME\.dotfiles --work-tree=$HOME @Args
}

function dotfiles-ui {
    $env:GIT_DIR = "$HOME\.dotfiles"
    $env:GIT_WORK_TREE = "$HOME"
    try {
        & "$env:LOCALAPPDATA\Fork\current\Fork.exe" "$HOME"
    }
    finally {
        Remove-Item Env:GIT_DIR -ErrorAction SilentlyContinue
        Remove-Item Env:GIT_WORK_TREE -ErrorAction SilentlyContinue
    }
}

function Get-PubIP { (Invoke-WebRequest http://ifconfig.me/ip).Content }

function admin {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$args)
    if ($args.Count -gt 0) {
        $argList = $args -join ' '
        Start-Process wt -Verb RunAs -ArgumentList "pwsh.exe", "-NoExit", "-Command", $argList
    } else {
        Start-Process wt -Verb RunAs
    }
}
Set-Alias -Name su -Value admin

function uptime {
    try {
        $dateFormat = [System.Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.ShortDatePattern
        $timeFormat = [System.Globalization.CultureInfo]::CurrentCulture.DateTimeFormat.LongTimePattern
        if ($PSVersionTable.PSVersion.Major -eq 5) {
            $lastBoot = (Get-WmiObject win32_operatingsystem).LastBootUpTime
            $bootTime = [System.Management.ManagementDateTimeConverter]::ToDateTime($lastBoot)
            $lastBoot = $bootTime.ToString("$dateFormat $timeFormat")
        } else {
            $lastBoot = (Get-Uptime -Since).ToString("$dateFormat $timeFormat")
            $bootTime = [System.DateTime]::ParseExact($lastBoot, "$dateFormat $timeFormat", [System.Globalization.CultureInfo]::InvariantCulture)
        }
        $formattedBootTime = $bootTime.ToString("dddd, MMMM dd, yyyy HH:mm:ss", [System.Globalization.CultureInfo]::InvariantCulture) + " [$lastBoot]"
        Write-Host "System started on: $formattedBootTime" -ForegroundColor DarkGray
        $uptime = (Get-Date) - $bootTime
        Write-Host ("Uptime: {0} days, {1} hours, {2} minutes, {3} seconds" -f $uptime.Days, $uptime.Hours, $uptime.Minutes, $uptime.Seconds) -ForegroundColor Blue
    } catch {
        Write-Error "An error occurred while retrieving system uptime."
    }
}

function mkcd { param($dir) mkdir $dir -Force; Set-Location $dir }

function trash($path) {
    $fullPath = (Resolve-Path -Path $path).Path
    if (Test-Path $fullPath) {
        $item = Get-Item $fullPath
        $parentPath = if ($item.PSIsContainer) { $item.Parent.FullName } else { $item.DirectoryName }
        $shell = New-Object -ComObject 'Shell.Application'
        $shellItem = $shell.NameSpace($parentPath).ParseName($item.Name)
        if ($shellItem) {
            $shellItem.InvokeVerb('delete')
            Write-Host "Item '$fullPath' has been moved to the Recycle Bin."
        } else {
            Write-Host "Error: Could not find the item '$fullPath' to trash."
        }
    } else {
        Write-Host "Error: Item '$fullPath' does not exist."
    }
}

function which($name) { & where.exe $name }

# ==============================================================================
# PSReadLine (fast)
# ==============================================================================
$PSReadLineOptions = @{
    EditMode = 'Windows'
    HistoryNoDuplicates = $true
    HistorySearchCursorMovesToEnd = $true
    Colors = @{
        Command = '#87CEEB'; Parameter = '#98FB98'; Operator = '#FFB6C1'
        Variable = '#DDA0DD'; String = '#FFDAB9'; Number = '#B0E0E6'
        Type = '#F0E68C'; Comment = '#D3D3D3'; Keyword = '#8367c7'; Error = '#FF6347'
    }
    PredictionSource = 'History'
    PredictionViewStyle = 'ListView'
    BellStyle = 'None'
}
if ([Environment]::UserInteractive -and -not [Console]::IsOutputRedirected) {
    Set-PSReadLineOption @PSReadLineOptions
    Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    # Custom Tab handler: Complete + convert backslashes to forward slashes immediately
    Set-PSReadLineKeyHandler -Key Tab -ScriptBlock {
        # Use Complete (non-menu) for simpler flow, then replace slashes
        [Microsoft.PowerShell.PSConsoleReadLine]::Complete()

        # Get the line after completion and fix slashes
        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

        if ($line -match '\\') {
            $fixedLine = $line -replace '\\', '/'
            [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $line.Length, $fixedLine)
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($cursor)
        }
    }
    # Shift+Tab for previous completion with forward slashes
    Set-PSReadLineKeyHandler -Key Shift+Tab -ScriptBlock {
        [Microsoft.PowerShell.PSConsoleReadLine]::Complete()

        $line = $null
        $cursor = $null
        [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)

        if ($line -match '\\') {
            $fixedLine = $line -replace '\\', '/'
            [Microsoft.PowerShell.PSConsoleReadLine]::Replace(0, $line.Length, $fixedLine)
            [Microsoft.PowerShell.PSConsoleReadLine]::SetCursorPosition($cursor)
        }
    }
    Set-PSReadLineKeyHandler -Chord 'Ctrl+d' -Function DeleteChar
}
Set-PSReadLineOption -AddToHistoryHandler {
    param($line)
    $sensitive = @('password', 'secret', 'token', 'apikey', 'connectionstring')
    $hasSensitive = $sensitive | Where-Object { $line -match $_ }
    return ($null -eq $hasSensitive)
}

# ==============================================================================
# Global Secret Environment Variables
# ==============================================================================
$secretsFile = "$HOME/Documents/PowerShell/secrets.ps1"
if (Test-Path $secretsFile) {
    . $secretsFile
}

# ==============================================================================
# OpenCode Environment Variables
# ==============================================================================
$env:OPENCODE_ENABLE_EXA = "1"
$env:OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"
$env:OPENCODE_EXPERIMENTAL_MARKDOWN = "1"
# $env:OPENCODE_EXPERIMENTAL_DYNAMIC_MODELS = "1"
# $env:OPENCODE_GIT_BASH_PATH = "C:\Program Files\Git\bin\bash.exe" # No need cuz opencode auto detects git bash
# $env:OPENCODE_DISABLE_FILETIME_CHECK = "1"
# $env:OPENCODE_MODELS_URL= "http://localhost:8989"

#oc = open code binary
# Set-Alias -Name oc -Value ocb
Set-Alias -Name oc -Value opencode.cmd

# po = local pi build (repo dist)
function p {
    & node "$HOME/repo/pi-mono/packages/coding-agent/dist/cli.js" @args
}

# ocb = local build binary
function ocb {
    & "$HOME/repo/anomalyco/opencode/packages/opencode/dist/opencode-windows-x64/bin/opencode.exe" @args
}

# oc-dev = dev mode (bun dev)
function oc-dev {
    $original_dir = Get-Location
    Push-Location "$HOME/repo/anomalyco/opencode/packages/opencode"
    try {
        if ($args.Count -eq 0) {
            bun dev $original_dir
        }
        else {
            bun dev @args
        }
    }
    finally {
        Pop-Location
    }
}

function bash {
     & "C:\Program Files\Git\bin\bash.exe" @args
}

# Proxy Utilities
# function Set-OcProxy {
#     $env:HTTPS_PROXY = "http://localhost:8080"
#     $env:HTTP_PROXY = "http://localhost:8080"
#     $env:NO_PROXY = "localhost,127.0.0.1"
#     $env:NODE_EXTRA_CA_CERTS = "$HOME\.mitmproxy\mitmproxy-ca-cert.pem"
#     Write-Host "OpenCode Proxy Enabled (localhost:8080)" -ForegroundColor Green
# }

# function Reset-OcProxy {
#     $env:HTTPS_PROXY = $null
#     $env:HTTP_PROXY = $null
#     $env:NO_PROXY = $null
#     $env:NODE_EXTRA_CA_CERTS = $null
#     Write-Host "OpenCode Proxy Disabled" -ForegroundColor Yellow
# }

# Prefer mise-managed tools over standalone pnpm-home binaries
# $pnpmHome = Join-Path $HOME "AppData\Local\pnpm"
# $env:PATH = (($env:PATH -split ';') | Where-Object { $_ -and $_ -ne $pnpmHome } | Select-Object -Unique) -join ';'

(&mise activate pwsh) | Out-String | Invoke-Expression