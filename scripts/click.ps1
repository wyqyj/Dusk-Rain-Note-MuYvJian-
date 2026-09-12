# 模拟鼠标点击屏幕物理像素坐标（供 UI 自动化验证用）
# 用法: pwsh -File scripts/click.ps1 -X 618 -Y 550
param([int]$X, [int]$Y)
Add-Type @"
using System.Runtime.InteropServices;
public static class MouseHelper {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, int extra);
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(150);
    mouse_event(0x02, 0, 0, 0, 0);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x04, 0, 0, 0, 0);
  }
}
"@
[MouseHelper]::Click($X, $Y)
"clicked ($X,$Y)"
