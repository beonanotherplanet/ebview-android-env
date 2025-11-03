#!/usr/bin/env bash

# =========================
# Android Emulator Auto Setup (Windows Git Bash용)
# =========================

SDK_ROOT="$LOCALAPPDATA/Android/Sdk"
CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-win-9477386_latest.zip"
AVD_NAME="custom_avd_1"
CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe"

# ---------- 색상 ----------
RED='\e[31m'; GREEN='\e[32m'; YELLOW='\e[33m'; BLUE='\e[34m'; BOLD='\e[1m'; RESET='\e[0m'
info()    { echo -e "ℹ️  ${BOLD}${BLUE}[INFO]${RESET}  $1"; }
warn()    { echo -e "⚠️  ${BOLD}${YELLOW}[WARN]${RESET}  $1"; }
error()   { echo -e "❌ ${BOLD}${RED}[ERROR]${RESET}  $1"; }
success() { echo -e "✅ ${BOLD}${GREEN}[OK]${RESET}  $1"; }

# ---------- OS 감지 ----------
OS="$(uname -s)"
case "$OS" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  Linux*) PLATFORM="linux" ;;
  Darwin*) PLATFORM="mac" ;;
  *) error "Unsupported OS: $OS"; exit 1 ;;
esac

# ---------- SDK 경로 ----------
if [[ "$PLATFORM" = "windows" ]]; then
  SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager.bat"
  AVDMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/avdmanager.bat"
  EMULATOR_BIN="$SDK_ROOT/emulator/emulator.exe"
  ADB_BIN="$SDK_ROOT/platform-tools/adb.exe"
else
  SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
  AVDMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/avdmanager"
  EMULATOR_BIN="$SDK_ROOT/emulator/emulator"
  ADB_BIN="$SDK_ROOT/platform-tools/adb"
fi

# ---------- JAVA 설치 ----------
if ! command -v java >/dev/null 2>&1; then
  info "JDK 17 not found. Installing..."
  BASE_DIR="$HOME/AndroidEnv"
  mkdir -p "$BASE_DIR"
  ZIP_PATH="$BASE_DIR/jdk.zip"
  URL="https://aka.ms/download-jdk/microsoft-jdk-17.0.11-windows-x64.zip"
  curl -L "$URL" -o "$ZIP_PATH"
  unzip -q "$ZIP_PATH" -d "$BASE_DIR"
  rm -f "$ZIP_PATH"
  JDK_DIR=$(find "$BASE_DIR" -maxdepth 1 -type d -name "jdk-17*" | head -n 1)
  export JAVA_HOME="$JDK_DIR"
  export PATH="$JAVA_HOME/bin:$PATH"
  success "JDK installed: $JAVA_HOME"
fi

# ---------- SDK 설치 ----------
if [[ ! -x "$SDKMANAGER" ]]; then
  info "Installing Android SDK commandline-tools..."
  mkdir -p "$SDK_ROOT/cmdline-tools"
  cd "$SDK_ROOT"
  curl -L -o cmdline-tools.zip "$CMDLINE_URL"
  unzip -q cmdline-tools.zip -d cmdline-tools
  mv cmdline-tools/cmdline-tools cmdline-tools/latest
  rm cmdline-tools.zip
fi

export ANDROID_HOME="$SDK_ROOT"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

mkdir -p "$HOME/.android"
touch "$HOME/.android/repositories.cfg"

# ---------- SDK 컴포넌트 설치 ----------
yes | "$SDKMANAGER" --sdk_root="$SDK_ROOT" --licenses || true
"$SDKMANAGER" --no_https "platform-tools" "emulator"

# ---------- 기기 선택 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "어떤 기종을 선택하시겠습니까?"
echo "1) 갤럭시 노트 20"
echo "2) 갤럭시 S22"
echo "3) 갤럭시 노트 10"
read -p "번호를 입력하세요 (기본값 1): " hw_choice

case "$hw_choice" in
  1|"") DEVICE="note20"; IMG="system-images;android-31;google_apis_playstore;x86_64"; AVD_NAME="Note20" ;;
  2) DEVICE="s22"; IMG="system-images;android-31;google_apis_playstore;x86_64"; AVD_NAME="S22" ;;
  3) DEVICE="note10"; IMG="system-images;android-31;google_apis_playstore;x86_64"; AVD_NAME="Note10" ;;
  *) error "Invalid selection"; exit 1 ;;
esac

PROFILE_PATH="$SCRIPT_DIR/emulator/hardware_profiles/${DEVICE}.ini"
if [[ ! -f "$PROFILE_PATH" ]]; then
  error "Profile not found: $PROFILE_PATH"
  exit 1
fi

"$SDKMANAGER" --no_https "$IMG"

# ---------- AVD 생성 ----------
if "$EMULATOR_BIN" -list-avds | grep -q "^${AVD_NAME}$"; then
  info "이미 AVD가 존재합니다."
else
  info "AVD 생성 중..."
  "$AVDMANAGER" create avd -n "$AVD_NAME" -k "$IMG" --device "pixel"
  AVD_PATH="$HOME/.android/avd/${AVD_NAME}.avd/config.ini"
  cat "$PROFILE_PATH" >> "$AVD_PATH"
fi

# ---------- 에뮬레이터 실행 ----------
"$EMULATOR_BIN" -avd "$AVD_NAME" -gpu off -no-metrics -netdelay none -netspeed full &
success "에뮬레이터 실행 중..."
