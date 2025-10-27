import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const androidDir = path.join(repoRoot, "android");

const DEFAULT_DEV_URL = "http://10.0.2.2:5173";
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? DEFAULT_DEV_URL;
const skipViteServer = process.env.SKIP_VITE_SERVER === '1';
const avdName = process.env.ANDROID_AVD ?? "Pixel_5_API_34";

const ANDROID_HOME = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!ANDROID_HOME) {
  console.error("✖ ANDROID_HOME or ANDROID_SDK_ROOT must be set before running this script.");
  process.exitCode = 1;
  process.exit();
}

const adbCmd = process.env.ANDROID_ADB ?? path.join(ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const emulatorCmd = process.env.ANDROID_EMULATOR ?? path.join(ANDROID_HOME, "emulator", process.platform === "win32" ? "emulator.exe" : "emulator");

const gradleWrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
const gradleFallback = process.platform === "win32" ? "gradle.bat" : "gradle";

/**
 * Spawn a child process and wait for completion.
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

/**
 * Spawn a child process that should remain running (e.g. Vite dev server).
 */
function runPersistent(command, args, options = {}) {
  const proc = spawn(command, args, {
    stdio: "inherit",
    ...options,
  });

  proc.on("error", (error) => {
    console.error(`✖ Failed to start ${command}:`, error);
    process.exitCode = 1;
    process.exit();
  });

  return proc;
}

async function waitForHttp(url, attempts = 60, intervalMs = 1000) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), intervalMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // ignore and retry
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for HTTP server at ${url}`);
}

async function adb(args, options = {}) {
  await run(adbCmd, args, options);
}

async function adbQuery(args) {
  const output = await new Promise((resolve, reject) => {
    const proc = spawn(adbCmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `adb exited with code ${code}`));
      }
    });
  });
  return output;
}

async function isEmulatorRunning() {
  const devices = await adbQuery(["devices"]);
  return devices.split("\n").slice(1).some((line) => line.startsWith("emulator-"));
}

function waitForBoot() {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const boot = await adbQuery(["shell", "getprop", "sys.boot_completed"]);
        if (boot === "1") {
          clearInterval(interval);
          resolve();
        }
      } catch (error) {
        // ignore until adb is ready
      }
    }, 2000);

    setTimeout(() => {
      clearInterval(interval);
      reject(new Error("Timed out waiting for emulator to boot"));
    }, 5 * 60 * 1000);
  });
}

async function resolveGradleCommand() {
  try {
    await fs.access(path.join(androidDir, gradleWrapper.replace(/^\.\//, "")));
    return gradleWrapper;
  } catch {
    console.warn("⚠️ Gradle wrapper not found. Falling back to system 'gradle'.");
    return gradleFallback;
  }
}

let devServer;
let emulator;

async function cleanup() {
  if (devServer && !devServer.killed) {
    devServer.kill("SIGINT");
  }
  if (emulator && !emulator.killed) {
    emulator.kill("SIGINT");
  }
}

async function main() {
  const gradleCommand = await resolveGradleCommand();

  if (!skipViteServer) {
    console.log("▶ Starting Vite dev server on 0.0.0.0:5173...");
    devServer = runPersistent("npx", ["vite", "--host", "0.0.0.0", "--port", "5173"], {
      cwd: repoRoot,
      env: { ...process.env, BROWSER: "none" },
    });
  } else {
    console.log("ℹ️ SKIP_VITE_SERVER=1 detected. Expecting an already running dev server.");
  }

  process.on("SIGINT", async () => {
    await cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });

  console.log(`▶ Waiting for dev server at ${devServerUrl}...`);
  await waitForHttp(devServerUrl);
  console.log("✔ Dev server is ready");

  const emulatorWasRunning = await isEmulatorRunning();
  if (!emulatorWasRunning) {
    console.log(`▶ Starting Android emulator '${avdName}'...`);
    emulator = runPersistent(emulatorCmd, ["-avd", avdName, "-netdelay", "none", "-netspeed", "full"], {
      env: process.env,
    });
  } else {
    console.log("ℹ️ Emulator already running, skipping start");
  }

  console.log("▶ Waiting for emulator to be ready (this can take a minute)...");
  await adb(["wait-for-device"]);
  await waitForBoot();
  console.log("✔ Emulator boot complete");

  console.log("▶ Building and installing WebView Android app...");
  await run(gradleCommand, ["installDebug"], { cwd: androidDir, env: process.env });

  console.log("▶ Launching WebView app...");
  await adb([
    "shell",
    "am",
    "start",
    "-n",
    "com.ebview.android/.MainActivity",
    "-a",
    "android.intent.action.MAIN",
    "-c",
    "android.intent.category.LAUNCHER",
  ]);

  console.log("✔ Android WebView ready. Open Chrome on your desktop and navigate to chrome://inspect to debug the WebView.");
  console.log("ℹ️ Press Ctrl+C to stop the dev server (the emulator will continue running).");
}

main().catch(async (error) => {
  console.error("✖", error.message);
  await cleanup();
  process.exitCode = 1;
  process.exit(1);
});
