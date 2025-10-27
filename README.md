# EBView Android Dev Automation

This workspace provides a minimal Android WebView container and a Node.js automation script so that a Vite-based React project can open directly inside an Android emulator with a single `npm` command.

## Prerequisites

- Node.js 18 or newer
- Android SDK with platform tools and an emulator image
- An Android Virtual Device (AVD) name exported through `ANDROID_AVD` (defaults to `Pixel_5_API_34`)
- Environment variable `ANDROID_HOME` or `ANDROID_SDK_ROOT` pointing to the Android SDK location
- `adb`, `emulator`, and `gradle` (or the Gradle wrapper JAR) available under the SDK

> The automation will fall back to the globally installed `gradle` command if the wrapper JAR is absent.

> **Tip:** If you want to use the Gradle wrapper instead of a system-wide Gradle installation, run `gradle wrapper` inside the `android/` directory after cloning this repo. The wrapper artifacts are intentionally omitted so that you can generate them with your preferred Gradle version.

## Usage

```bash
npm install
npm run android:webview
```

The script performs the following steps:

1. Launches the Vite dev server on `0.0.0.0:5173` (you can override the target URL with `VITE_DEV_SERVER_URL`).
2. Starts the configured Android emulator if it is not already running and waits for it to boot.
3. Builds and installs the Android WebView shell app that loads the dev server (`installDebug`).
4. Launches the app. Because WebView debugging is enabled, you can open `chrome://inspect` in Chrome to attach dev tools.

The emulator process is left running so that subsequent executions are faster. Stop the dev server with `Ctrl+C` when you are done.

### Environment variables

- `ANDROID_AVD`: Name of the AVD to launch. Defaults to `Pixel_5_API_34`.
- `VITE_DEV_SERVER_URL`: Override the WebView URL (defaults to `http://10.0.2.2:5173`).
- `ANDROID_EMULATOR`: Override the emulator binary path.
- `ANDROID_ADB`: Override the ADB binary path.

### Vite dev server options

If you prefer to run the dev server manually, start it before invoking the script and export `SKIP_VITE_SERVER=1`. When this variable is set, the automation will skip spawning `npx vite` and only manage the Android side.

```bash
SKIP_VITE_SERVER=1 npm run android:webview
```

Ensure the dev server is reachable from the emulator (`0.0.0.0:5173` binding).
