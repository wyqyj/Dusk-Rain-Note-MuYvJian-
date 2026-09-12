param([string]$Out = "$env:TEMP\myj_shot.png", [int[]]$Click)

$src = @'
using System;
using System.Runtime.InteropServices;
public class WinShot {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f, int dx, int dy, int d, IntPtr e);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
Add-Type -TypeDefinition $src -ReferencedAssemblies System.Drawing

$p = Get-Process electron | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -eq '暮雨笺' } | Select-Object -First 1
if (-not $p) { Write-Error 'no electron window'; exit 1 }
$h = $p.MainWindowHandle
$r = New-Object WinShot+RECT
[WinShot]::GetWindowRect($h, [ref]$r) | Out-Null
[WinShot]::SetForegroundWindow($h) | Out-Null

if ($Click) {
  [WinShot]::SetCursorPos($r.Left + $Click[0], $r.Top + $Click[1]) | Out-Null
  Start-Sleep -Milliseconds 150
  [WinShot]::mouse_event(0x2, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 60
  [WinShot]::mouse_event(0x4, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 800
}

$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$bmp.Save($Out)
Write-Output $Out
