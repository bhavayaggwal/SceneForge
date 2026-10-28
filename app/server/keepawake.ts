// Keeps the computer from sleeping while long work runs (indexing, reconstruction): a sleeping PC
// suspended a scan mid-request in testing. On Windows this is SetThreadExecutionState, the per-process
// request a video player makes; it changes no settings and ends when the helper process exits.
import { spawn, type ChildProcess } from 'node:child_process';

// The flags go through ToUInt32: in Windows PowerShell the literal 0x80000001 is a negative Int32,
// which fails to convert to uint and silently made no request (the PC slept mid-scan in testing).
const PS = `
$ErrorActionPreference = 'Stop'
Add-Type -Namespace SF -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$flags = [Convert]::ToUInt32('80000001', 16)  # ES_CONTINUOUS | ES_SYSTEM_REQUIRED
if ([SF.Power]::SetThreadExecutionState($flags) -eq 0) { exit 1 }
[Console]::Out.WriteLine('awake'); [Console]::Out.Flush()
while ($true) { Start-Sleep -Seconds 30 }
`;

let child: ChildProcess | null = null;
let awake = false;
let until = 0;
let timer: NodeJS.Timeout | null = null;

function stop() {
  child?.kill();
  child = null;
  if (timer) clearInterval(timer);
  timer = null;
}

/** Keep the machine awake for at least `ms` more. Calls extend the window. */
export function holdAwake(ms: number) {
  if (process.platform !== 'win32') return;
  until = Math.max(until, Date.now() + ms);
  if (!child) {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    child.stdout!.once('data', () => (awake = true));
    child.on('exit', (code) => {
      if (code && !awake) console.warn('Could not keep the computer awake; a long scan may stop if it sleeps.');
      child = null;
      awake = false;
    });
    timer = setInterval(() => Date.now() > until && stop(), 5000);
  }
}

/** True once the OS has accepted the request (for tests and the health endpoint). */
export const isHoldingAwake = () => awake;

process.on('exit', stop);
