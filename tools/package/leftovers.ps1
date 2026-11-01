# Lists every process that started after $env:SINCE (an ISO time) with its parent and
# command line, and stops the ones the smoke test left behind: those whose chain of parents
# leads to the step's shell or breaks off at a process that has exited, such as a
# self-relaunched uninstaller. Such a process could keep the step's output open. Processes
# that services started meanwhile are listed only.
$since = [DateTime]::Parse($env:SINCE).ToUniversalTime()
$all = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($p in $all) { $byId[[int]$p.ProcessId] = $p }
# This script, the step's shell and the runner above them stay.
$keep = @{}
$id = $PID
while ($byId.ContainsKey($id) -and -not $keep.ContainsKey($id)) {
  $keep[$id] = $true
  $id = [int]$byId[$id].ParentProcessId
}
function Test-Leftover($process) {
  $seen = @{}
  $current = $process
  while ($true) {
    $parent = [int]$current.ParentProcessId
    if ($keep.ContainsKey($parent) -or -not $byId.ContainsKey($parent)) { return $true }
    if ($seen.ContainsKey($parent)) { return $false }
    $seen[$parent] = $true
    $current = $byId[$parent]
    if (-not $current.CreationDate -or $current.CreationDate.ToUniversalTime() -lt $since) { return $false }
  }
}
$started = @($all | Where-Object {
    $_.CreationDate -and $_.CreationDate.ToUniversalTime() -ge $since -and -not $keep.ContainsKey([int]$_.ProcessId)
  } | Sort-Object CreationDate)
$leftovers = @($started | Where-Object { Test-Leftover $_ })
"Processes started since $since (pid, parent, start, name, command line):"
foreach ($p in $started) {
  $mark = if ($leftovers -contains $p) { 'stop' } else { '    ' }
  '{0} {1,6} {2,6} {3:HH:mm:ss} {4} {5}' -f $mark, $p.ProcessId, $p.ParentProcessId, $p.CreationDate, $p.Name, $p.CommandLine
}
foreach ($p in $leftovers) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
