# 找到可见的 Windows 原生对话框（#32770），置前并发送按键（默认发送 Enter 触发默认按钮）
param([string]$Keys = '{ENTER}')
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class WinDlg {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  delegate bool EnumCb(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumCb cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  public static List<IntPtr> FindDialogs() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var cls = new StringBuilder(256); GetClassNameW(h, cls, 256);
      var ttl = new StringBuilder(256); GetWindowTextW(h, ttl, 256);
      if (cls.ToString() == "#32770" && ttl.Length > 0) list.Add(h);
      return true;
    }, IntPtr.Zero);
    return list;
  }
  public static bool Focus(IntPtr h) { return SetForegroundWindow(h); }
}
"@
$dialogs = [WinDlg]::FindDialogs()
"found: $($dialogs.Count)"
foreach ($d in $dialogs) {
  [WinDlg]::Focus($d) | Out-Null
  Start-Sleep -Milliseconds 500
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds 500
}
