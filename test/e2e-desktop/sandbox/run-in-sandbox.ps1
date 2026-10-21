# Runs the Windows desktop e2e scenarios on a machine that is not yours: inside Windows Sandbox (scripts/sandbox-e2e.mjs maps the
# folders and runs this at logon).
#   -In        the staged folder: installer\Insilode-Setup-*.exe, node\node.exe, repo\ (test code and demo script)
#   -Out       where results.json, shots\ and the logs go
#   -Shutdown  power the sandbox off at the end (Windows Sandbox only; never on a runner)
# Writes <Out>\done.json last, so a launcher that waits for it knows everything else is in place.
param(
	[Parameter(Mandatory = $true)][string]$In,
	[Parameter(Mandatory = $true)][string]$Out,
	[string]$Label = 'windows',
	[string]$Only = '',
	[switch]$Shutdown
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$log = Join-Path $Out 'sandbox.log'
Start-Transcript -Path $log -Force | Out-Null
$exit = 1
try {
	# This is the one place that says the machine is disposable: run.mjs refuses to open windows without it.
	$env:INSILODE_E2E_ISOLATED = '1'

	$setup = Get-ChildItem -Path (Join-Path $In 'installer') -Filter 'Insilode-Setup-*.exe' | Select-Object -First 1
	if (-not $setup) { throw "No Insilode-Setup-*.exe in $In\installer" }
	$node = Join-Path $In 'node\node.exe'
	if (-not (Test-Path $node)) { throw "No node.exe in $In\node" }

	# The mapped folder is read-only and node resolves modules next to the script: run from a writable copy.
	$work = if ($env:RUNNER_TEMP) { Join-Path $env:RUNNER_TEMP 'insilode-e2e-repo' } else { 'C:\insilode-e2e\repo' }
	if (Test-Path $work) { Remove-Item -Recurse -Force $work }
	Copy-Item -Recurse -Force (Join-Path $In 'repo') $work

	$runArgs = @((Join-Path $work 'test\e2e-desktop\run.mjs'), '--label', $Label, '--out', $Out, '--installer', $setup.FullName)
	if ($Only) { $runArgs += @('--only', $Only) }
	Write-Host "node $($runArgs -join ' ')"
	& $node @runArgs
	$exit = $LASTEXITCODE
}
catch {
	Write-Host "FAILED: $($_.Exception.Message)"
	$exit = 1
}
finally {
	Stop-Transcript | Out-Null
	@{ exitCode = $exit; at = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Path (Join-Path $Out 'done.json') -Encoding utf8
	if ($Shutdown) { shutdown.exe /s /t 5 }
}
exit $exit
