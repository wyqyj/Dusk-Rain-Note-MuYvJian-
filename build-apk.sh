# =============================================================
# 暮雨笺 Android 一键构建脚本（工作区本地使用）
#
# 用法（Git Bash / MSYS2）：
#   bash build-apk.sh            # 构建 debug APK
#   bash build-apk.sh release    # 构建 release APK（需先配置签名，见下方 SIGNING 段）
#
# 流程：环境检查 → vite build（web 资源）→ cap sync → gradle 打包 → 拷贝 APK
# 工具链位于 D:/muyujian-tooling/（独立于项目工作区）
# =============================================================
set -e

# 脚本自定位：克隆到任意位置均可运行（不再依赖硬编码工作区路径）
PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLING="D:/muyujian-tooling"
MODE="${1:-debug}"

echo "==> [1/5] 加载本地工具链环境"
# shellcheck disable=SC1090
source "$TOOLING/env.sh"
# env.sh 已默认导出 JAVA_HOME=JDK 21（Capacitor 8 模块要求 source/target 21）
echo "    JAVA_HOME=$JAVA_HOME"

echo "==> [2/5] 构建 web 资源（vite build → dist/）"
cd "$PROJECT"
npx vite build

echo "==> [3/5] 同步 web 资源到 Android 工程（cap sync android）"
npx cap sync android

echo "==> [4/5] Gradle 打包（$MODE）"
cd "$PROJECT/android"
if [ "$MODE" = "release" ]; then
  ./gradlew.bat assembleRelease --no-daemon
  APK_FILE="app/build/outputs/apk/release/app-release.apk"
  OUT_NAME="暮雨笺-3.0.6-release.apk"
else
  ./gradlew.bat assembleDebug --no-daemon
  APK_FILE="app/build/outputs/apk/debug/app-debug.apk"
  OUT_NAME="暮雨笺-3.0.6-debug.apk"
fi

echo "==> [5/5] 拷贝 APK 到 dist-apk/"
mkdir -p "$PROJECT/dist-apk"
cp "$APK_FILE" "$PROJECT/dist-apk/$OUT_NAME"
echo ""
echo "构建完成：$PROJECT/dist-apk/$OUT_NAME"
ls -la "$PROJECT/dist-apk/"

# -------------------------------------------------------------
# release 签名说明（如需分发安装包）：
#   1. 生成 keystore：keytool -genkey -v -keystore muyujian-release.keystore \
#        -alias muyujian -keyalg RSA -keysize 2048 -validity 10000
#   2. 在 android/app/build.gradle 的 signingConfigs 中引用，并在 buildTypes.release 中启用
# -------------------------------------------------------------