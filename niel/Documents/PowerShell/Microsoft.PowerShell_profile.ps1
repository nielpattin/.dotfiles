# $env:TERM = "xterm-256color"

# Starship
if (Get-Command starship -ErrorAction SilentlyContinue) {
    function Invoke-Starship-PreCommand {
        if (-not $env:WT_SESSION) {
            return
        }

        $loc = $executionContext.SessionState.Path.CurrentLocation
        $prompt = "$([char]27)]9;12$([char]7)"
        if ($loc.Provider.Name -eq "FileSystem") {
            $prompt += "$([char]27)]9;9;`"$($loc.ProviderPath)`"$([char]27)\"
        }

        $host.UI.Write($prompt)
    }

    Invoke-Expression (&starship init powershell)
}

# Zoxide
if (Get-Command zoxide -ErrorAction SilentlyContinue) {
    Invoke-Expression (& { (zoxide init powershell | Out-String) })
}

# Functions (moved outside wrapper for reliability)
function touch($file) { "" | Out-File $file -Encoding ASCII }

if (Test-Path Alias:ls) { Remove-Item Alias:ls -Force -ErrorAction SilentlyContinue }
function ls { eza -la --icons --git @args }
# Set-Alias -Name lsa -Value ls -Option AllScope

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

# Find which executable would run for a command (like 'which' in Unix)
function which($name) { & where.exe $name }

# PSReadLine
$PSReadLineOptions = @{
    EditMode = 'Windows'
    HistoryNoDuplicates = $true
    HistorySearchCursorMovesToEnd = $true
    HistorySaveStyle = 'SaveIncrementally'
    MaximumHistoryCount = 50000
    Colors = @{
        Command = '#87CEEB'; Parameter = '#98FB98'; Operator = '#FFB6C1'
        Variable = '#DDA0DD'; String = '#FFDAB9'; Number = '#B0E0E6'
        Type = '#F0E68C'; Comment = '#D3D3D3'; Keyword = '#8367c7'; Error = '#FF6347'
    }
    PredictionSource = 'History'
    PredictionViewStyle = 'InlineView'
    BellStyle = 'None'
}
if ([Environment]::UserInteractive -and -not [Console]::IsOutputRedirected) {
    Set-PSReadLineOption @PSReadLineOptions
    Set-PSReadLineKeyHandler -Key UpArrow -Function HistorySearchBackward
    Set-PSReadLineKeyHandler -Key DownArrow -Function HistorySearchForward
    Set-PSReadLineKeyHandler -Chord 'Ctrl+Spacebar' -Function SwitchPredictionView
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

# OpenCode Environment Variables
$env:OPENCODE_ENABLE_EXA = "1"
$env:OPENCODE_DISABLE_DEFAULT_PLUGINS = "1"

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

if (Get-Command mise -ErrorAction SilentlyContinue) {
    (& mise activate pwsh) | Out-String | Invoke-Expression
}
