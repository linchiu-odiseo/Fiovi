# PostToolUse hook — registra cada invocación de Agent tool en docs/agent-activity.md
#
# Disparado por Claude Code via .claude/settings.json -> hooks.PostToolUse matcher=Agent.
# Recibe el payload del evento como JSON por stdin. Apendea una row al log,
# silenciosamente (exit 0 siempre) para no romper la harness si algo va mal.

$ErrorActionPreference = 'SilentlyContinue'

# ---------- Pricing (USD por 1M tokens, Claude 4 family, cierre Q1 2026) ----------
# Si Anthropic actualiza precios, editar esta tabla. Sin split input/output en el
# payload, estimamos 75% input + 25% output (ratio típico para trabajo de código).
$pricing = @{
  'opus-4-7'   = @{ input = 15.00; output = 75.00; cache_read = 1.50; cache_write = 18.75 }
  'opus-4-6'   = @{ input = 15.00; output = 75.00; cache_read = 1.50; cache_write = 18.75 }
  'sonnet-4-6' = @{ input =  3.00; output = 15.00; cache_read = 0.30; cache_write =  3.75 }
  'sonnet-4-5' = @{ input =  3.00; output = 15.00; cache_read = 0.30; cache_write =  3.75 }
  'haiku-4-5'  = @{ input =  1.00; output =  5.00; cache_read = 0.10; cache_write =  1.25 }
}
$defaultModel = 'opus-4-7'
$inputRatio = 0.75
$outputRatio = 0.25

# ---------- Read event payload from stdin ----------
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }
try {
  $evt = $raw | ConvertFrom-Json -ErrorAction Stop
} catch {
  exit 0
}

# Solo nos interesa la Agent tool
if ($evt.tool_name -ne 'Agent') { exit 0 }

# ---------- Paths ----------
$projectDir = $env:CLAUDE_PROJECT_DIR
if (-not $projectDir) { $projectDir = $evt.cwd }
if (-not $projectDir) { $projectDir = (Get-Location).Path }
$logPath = Join-Path $projectDir 'docs/agent-activity.md'

# ---------- Extract input ----------
$subagent = $evt.tool_input.subagent_type
if (-not $subagent) { $subagent = 'claude (default)' }
$desc = $evt.tool_input.description
if (-not $desc) { $desc = '(no description)' }
$desc = ($desc -replace '\|', '\|') -replace '`', "'"
if ($desc.Length -gt 70) { $desc = $desc.Substring(0, 67) + '...' }

$modelOverride = $evt.tool_input.model
$model = $defaultModel
if ($modelOverride) {
  $key = ($modelOverride -replace 'claude-', '') -replace '\[.*?\]', ''
  if ($pricing.ContainsKey($key)) { $model = $key }
}
$rates = $pricing[$model]

# ---------- Extract usage from tool_response ----------
# La forma exacta varía por versión de Claude Code. Probamos varias rutas y
# caemos a regex sobre el texto si nada estructurado existe.
$totalTokens = 0; $inputTokens = 0; $outputTokens = 0
$cacheRead = 0; $cacheWrite = 0
$toolUses = $null; $durationMs = $null

$usageObj = $null
if ($evt.tool_response.usage) {
  $usageObj = $evt.tool_response.usage
} elseif ($evt.tool_response.tool_use_result.usage) {
  $usageObj = $evt.tool_response.tool_use_result.usage
}

if ($usageObj) {
  if ($usageObj.input_tokens)  { $inputTokens  = [int]$usageObj.input_tokens }
  if ($usageObj.output_tokens) { $outputTokens = [int]$usageObj.output_tokens }
  if ($usageObj.cache_read_input_tokens)     { $cacheRead  = [int]$usageObj.cache_read_input_tokens }
  if ($usageObj.cache_creation_input_tokens) { $cacheWrite = [int]$usageObj.cache_creation_input_tokens }
  if ($usageObj.total_tokens)  { $totalTokens  = [int]$usageObj.total_tokens }
  if ($usageObj.tool_uses)     { $toolUses     = [int]$usageObj.tool_uses }
  if ($usageObj.duration_ms)   { $durationMs   = [int]$usageObj.duration_ms }
}

# Fallback regex sobre el texto crudo de tool_response
if ($totalTokens -eq 0 -or -not $toolUses -or -not $durationMs) {
  $respText = $evt.tool_response | Out-String
  if ($totalTokens -eq 0) {
    $m = [regex]::Match($respText, 'total_tokens["\s:]+(\d+)')
    if ($m.Success) { $totalTokens = [int]$m.Groups[1].Value }
  }
  if (-not $toolUses) {
    $m = [regex]::Match($respText, 'tool_uses["\s:]+(\d+)')
    if ($m.Success) { $toolUses = [int]$m.Groups[1].Value }
  }
  if (-not $durationMs) {
    $m = [regex]::Match($respText, 'duration_ms["\s:]+(\d+)')
    if ($m.Success) { $durationMs = [int]$m.Groups[1].Value }
  }
  if ($inputTokens -eq 0) {
    $m = [regex]::Match($respText, 'input_tokens["\s:]+(\d+)')
    if ($m.Success) { $inputTokens = [int]$m.Groups[1].Value }
  }
  if ($outputTokens -eq 0) {
    $m = [regex]::Match($respText, 'output_tokens["\s:]+(\d+)')
    if ($m.Success) { $outputTokens = [int]$m.Groups[1].Value }
  }
}

# Si no tenemos split, estimar desde total
$estimated = $false
if ($totalTokens -gt 0 -and $inputTokens -eq 0 -and $outputTokens -eq 0) {
  $inputTokens  = [int]($totalTokens * $inputRatio)
  $outputTokens = [int]($totalTokens * $outputRatio)
  $estimated = $true
}
if ($totalTokens -eq 0 -and ($inputTokens + $outputTokens) -gt 0) {
  $totalTokens = $inputTokens + $outputTokens + $cacheRead + $cacheWrite
}

# ---------- Compute cost ----------
$cost = ($inputTokens  * $rates.input  / 1000000.0) +
        ($outputTokens * $rates.output / 1000000.0) +
        ($cacheRead    * $rates.cache_read  / 1000000.0) +
        ($cacheWrite   * $rates.cache_write / 1000000.0)

# ---------- Format row ----------
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$tokensCell = if ($totalTokens -gt 0) { '{0:N0}' -f $totalTokens } else { '--' }
$toolsCell  = if ($toolUses)   { '{0:N0}' -f $toolUses }      else { '--' }
$durCell    = if ($durationMs) { '{0:N1}s' -f ($durationMs / 1000.0) } else { '--' }
$costCell   = if ($cost -gt 0) { '$' + ('{0:N4}' -f $cost) }  else { '--' }
$estFlag    = if ($estimated)  { ' *est' } else { '' }

$row = "| $ts | $subagent | $desc | $model | $tokensCell$estFlag | $toolsCell | $durCell | $costCell |"

# ---------- Ensure log file exists with header ----------
if (-not (Test-Path $logPath)) {
  $logDir = Split-Path $logPath -Parent
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $header = @"
# Agent activity log — Fiovi

Auto-generado por ``.claude/hooks/log-agent-usage.ps1`` en cada PostToolUse del tool ``Agent``.
**Tokens reportados son del subagente**, no del orchestrator. Para el total de la sesión y costo combinado, usa ``/cost`` en Claude Code.

**Pricing fuente:** Anthropic Claude 4 family al cierre Q1 2026.
- Opus 4.x: input \$15/M, output \$75/M, cache read \$1.50/M, cache write \$18.75/M
- Sonnet 4.x: input \$3/M, output \$15/M
- Haiku 4.x: input \$1/M, output \$5/M

**Estimación cuando falta split:** si el payload trae solo ``total_tokens``, se estima 75% input + 25% output (ratio típico de trabajo de código). Filas estimadas marcadas con ``*est`` junto al número de tokens. Para precisión exacta, revisa ``/cost``.

| Timestamp | Subagent | Descripción | Modelo | Tokens | Tools | Duración | Costo USD |
|---|---|---|---|---|---|---|---|
"@
  Set-Content -Path $logPath -Value $header -Encoding UTF8
}

# ---------- Append ----------
Add-Content -Path $logPath -Value $row -Encoding UTF8

exit 0
