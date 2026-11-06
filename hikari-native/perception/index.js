import { spawn } from 'node:child_process'

import { appendWindowLog, provideWindowLog } from './window-log.js'

/**
 * Hikari Native v0 — Desktop Perception.
 *
 * Observes the real Windows foreground window and emits one event whenever
 * the (process, title) pair changes. This plugin reports what the operating
 * system says; it does not interpret meaning and it does not wake agents.
 *
 * It also keeps a short in-memory buffer of those observations (see
 * ./window-log.js) and exposes it read-only as `hikariWindowLog`, so that a
 * later wake (the 30-minute heartbeat) can be told what the foreground was
 * doing in the meantime. The buffer never touches disk.
 */
export const name = 'hikari-perception'
export const inject = []

const MIN_INTERVAL_MS = 500
const MAX_INTERVAL_MS = 10000
const DEFAULT_INTERVAL_MS = 1200

function clampInterval(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_INTERVAL_MS
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(value)))
}

function buildScript(intervalMs) {
  return `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HikariForeground {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

while ($true) {
  $hwnd = [HikariForeground]::GetForegroundWindow()
  if ($hwnd -ne [IntPtr]::Zero) {
    $buffer = New-Object System.Text.StringBuilder 512
    [void][HikariForeground]::GetWindowText($hwnd, $buffer, 512)
    [uint32]$targetProcess = 0
    [void][HikariForeground]::GetWindowThreadProcessId($hwnd, [ref]$targetProcess)
    $processName = ''
    try { $processName = (Get-Process -Id $targetProcess -ErrorAction Stop).ProcessName } catch { }
    $line = @{ hwnd = $hwnd.ToInt64(); pid = [int]$targetProcess; process = $processName; title = $buffer.ToString() } | ConvertTo-Json -Compress
    [Console]::WriteLine($line)
  }
  Start-Sleep -Milliseconds ${intervalMs}
}
`.trim()
}

export function apply(ctx, config) {
  const intervalMs = clampInterval(config?.intervalMs)
  let lastSignature
  let buffer = ''
  let stopping = false
  let child

  const windowLog = []
  provideWindowLog(ctx, windowLog)

  const observe = (snapshot) => {
    if (typeof snapshot.title !== 'string' || snapshot.title.length === 0) return
    const signature = `${snapshot.process}\u0000${snapshot.title}`
    if (signature === lastSignature) return
    lastSignature = signature
    const at = Date.now()
    appendWindowLog(windowLog, { at, process: snapshot.process, title: snapshot.title })
    ctx.emit('hikari/perception/window', {
      hwnd: snapshot.hwnd,
      pid: snapshot.pid,
      process: snapshot.process,
      title: snapshot.title,
      at,
    })
  }

  ctx.effect(() => {
    child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-Command', buildScript(intervalMs),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line.length > 0) {
          try {
            observe(JSON.parse(line))
          } catch {
            // Ignore malformed or partial JSON lines.
          }
        }
        newline = buffer.indexOf('\n')
      }
    })

    child.on('error', (error) => {
      ctx.logger.warn(`hikari perception could not start powershell: ${error.message}`)
    })
    child.on('exit', (code, signal) => {
      if (!stopping) ctx.logger.warn(`hikari perception exited (code=${code}, signal=${signal})`)
    })

    return () => {
      stopping = true
      if (child !== undefined) {
        try {
          child.kill()
        } catch {
          // The process is already gone.
        }
      }
    }
  }, 'hikari.perception.foreground-window')

  ctx.logger.info(`hikari perception observing the foreground window every ${intervalMs}ms`)
}
