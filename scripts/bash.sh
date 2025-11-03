#!/usr/bin/env bash

SDK_ROOT="${LOCALAPPDATA//\\}/Android/sdk"
CMDLINE_URL=""
AVD_NAME="custom_avd_1"
JDK_PATH=""
CHROME_PATH="/c/Program Files/Google/...chrome.exe"

RED='\e[31m'
GREEN='\e[32m'
YELLOW='\e[33m'
BLUE='\e[34m'
BOLD='\e[1m'
RESET='\e[0m'

info()  { echo -e "ℹ️  ${BOLD}${BLUE}[INFO]${RESET}  $1"; }
warn()  { echo -e "⚠️  ${BOLD}${YELLOW}[WARN]${RESET}  $1"; }
error() { echo -e "❌ ${BOLD}${RED}[ERROR]${RESET}  $1"; }
success(){ echo -e "✅ ${BOLD}${GREEN}[OK]${RESET}  $1"; }

if [[ "$OS" = "windows" ]]; then
  SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager.bat"
  AVDMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/avdmanager.bat"
  EMULATOR_BIN="$SDK_ROOT/emulator/emulater.exe"
  ADB_BIN="$SDK_ROOT/platform-tools/adb.exe"
else
  SDKMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager"
  AVDMANAGER="$SDK_ROOT/cmdline-tools/latest/bin/avdmanager"
  EMULATOR_BIN="$SDK_ROOT/emulator/emulater"
  ADB_BIN="$SDK_ROOT/platform-tools/adb"
fi

if ! command -v java >/dev/null 2>&1; then
echo "=== OpenJDK 17 Auto Installer ==="

# ----- Detect OS -----
OS="$(uname -s)"
echo "[INFO] Detected OS: $OS"

# ----- Detect architecture -----
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH_TAG="x64" ;;
  arm64|aarch64) ARCH_TAG="aarch64" ;;
  *) echo "[ERROR] Unsupported architecture: $ARCH"; exit 1 ;;
esac

# ----- Install based on platform -----
case "$OS" in
  Linux*)
    if command -v apt >/dev/null 2>&1; then
      echo "[INFO] Installing OpenJDK 17 using apt..."
      sudo apt update -y
      sudo apt install -y openjdk-17-jdk
    elif command -v dnf >/dev/null 2>&1; then
      echo "[INFO] Installing OpenJDK 17 using dnf..."
      sudo dnf install -y java-17-openjdk
    elif command -v yum >/dev/null 2>&1; then
      echo "[INFO] Installing OpenJDK 17 using yum..."
      sudo yum install -y java-17-openjdk
    else
      echo "[ERROR] No supported package manager found. Please install manually."
      exit 1
    fi
    ;;

  Darwin*)
    if command -v brew >/dev/null 2>&1; then
      echo "[INFO] Installing OpenJDK 17 using Homebrew..."
      brew install openjdk@17
      sudo ln -sfn "$(brew --prefix)/opt/openjdk@17/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk-17.jdk
    else
      echo "[ERROR] Homebrew not found. Please install it from https://brew.sh"
      exit 1
    fi
    ;;

  MINGW*|MSYS*|CYGWIN*)
    # ----- Windows (Git Bash or MSYS2) -----
    echo "[INFO] Installing OpenJDK 17 for Windows..."

    BASE_DIR="$HOME/AndroidEnv"
    JDK_DIR="$BASE_DIR/jdk-17"
    ZIP_PATH="$BASE_DIR/jdk.zip"
    URL="https://aka.ms/download-jdk/microsoft-jdk-17.0.11-windows-${ARCH_TAG}.zip"

    mkdir -p "$BASE_DIR"
    echo "[INFO] Downloading from $URL..."
    curl -L "$URL" -o "$ZIP_PATH"

    echo "[INFO] Extracting..."
    unzip -q "$ZIP_PATH" -d "$BASE_DIR"
    rm -f "$ZIP_PATH"

    # Auto-rename extracted folder (jdk-17.* → jdk-17)
    EXTRACTED_DIR=$(find "$BASE_DIR" -maxdepth 1 -type d -name "jdk-17*" | head -n 1)
    if [ "$EXTRACTED_DIR" != "$JDK_DIR" ]; then
      mv "$EXTRACTED_DIR" "$JDK_DIR"
    fi

    echo "[INFO] Setting JAVA_HOME and PATH..."
    export JAVA_HOME="$JDK_DIR"
    export PATH="$JAVA_HOME/bin:$PATH"

    # Optional: persist environment variables
    if [[ "$SHELL" == *"bash"* ]]; then
      PROFILE="$HOME/.bashrc"
    else
      PROFILE="$HOME/.profile"
    fi

    {
      echo ""
      echo "# OpenJDK 17"
      echo "export JAVA_HOME=\"$JAVA_HOME\""
      echo "export PATH=\"\$JAVA_HOME/bin:\$PATH\""
    } >> "$PROFILE"

    echo "[SUCCESS] JDK installed to $JAVA_HOME"
    echo "[INFO] Restart your terminal or run: source $PROFILE"
    ;;

  *)
    echo "[ERROR] Unsupported OS: $OS"
    exit 1
    ;;
esac
fi

# ----- Verify -----
echo
info "Checking java version..."
java -version || warn "Java command not found in PATH."

echo
info "OpenJDK 17 installation completed successfully."


if [[ -x "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager.bat" || -x "$SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" ]]; then
  info "Android SDK가 이미 설치되어 있습니다."
else
  info "Android SDK 설치 중..."
  rm -rf "$SDK_ROOT/cmdline-tools"
  mkdir -p "$SDK_ROOT/cmdline-tools"
  cd "$SDK_ROOT"
  curl -L -o cmdline-tools.zip "$CMDLINE_URL"
  unzip -q cmdline-tools.zip -d comline-tools
  mv cmdline-tools/cmdline-tools cmdline-tools/latest
  rm cmdline-tools.zip
fi

export ANDROID_HOME="$SDK_ROOT"
export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools:$PATH"

mkdir -p "$HOME/.android"
touch "$HOME/.android/repositories.cfg"

if [[ -d "$ANDROID_HOME/cmdline-tools/cmdline-tools" ]]; then
  mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"
fi

SDKMANAGER="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"

$SDKMANAGER --sdk_root="$SDK_ROOT" --licenses || true
$SDKMANAGER --no_https "platform-tools" "emulator"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "어떤 기종을 선택하시겠습니까?"
echo "1) 갤럭시 노트 20"
echo "2) 갤럭시 s22"
echo "3) 갤럭시 노트 10"
read -p "번호를 입력하세요(기본값 1): " hw_choice

case $hw_choice in
  1)
    DEVICE="note20"
    IMG="system-images;android-31;google_apis_playstore;x86_64"
    AVD_NAME="Note 20"
    ;;
  2)
    DEVICE="s22"
    IMG="system-images;android-31;google_apis_playstore;x86_64"
    AVD_NAME="s22"
    ;;
  3)
    DEVICE="note10"
    IMG="system-images;android-31;google_apis_playstore;x86_64"
    AVD_NAME="Note 10"
    ;;
  *)
   error "Invalid selection"
   exit 1
   ;;
esac

PROFILE_PATH="./emulator/hardware_profiles/${DEVICE}.ini"

chmod 644 "$PROFILE_PATH"

$SDKMANAGER --no-https "$IMG"

if "$EMULATOR_BIN" -list-avds | grep -q "^${AVD_NAME}$"; then
  info "이미 AVD 생성되어 있음"
else
  info "avd 생성 중..."
  "$AVDMANAGER" create avd \
   -n "$AVD_NAME" \
   -k "$IMG" \
   --device "pixel"

   AVD_PATH="$HOME/.android/avd/${AVD_NAME}.avd/config.ini"

   cat "$PROFILE_PATH" >> "$AVD_PATH"
fi

"$EMULATOR_BIN" -avd "$AVD_NAME" -gpu off -no-metrics -netdelay none -netspeed full &