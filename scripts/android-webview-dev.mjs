#!/usr/bin/env node
/**
 * Android AVD Auto Setup (macOS M1/M2 + Windows 10)
 * - Detects or installs SDK automatically
 * - Supports both arm64 (Apple Silicon) and x86_64 (Windows)
 * - Automatically creates and launches Galaxy device AVDs
 */

import inquirer from "inquirer";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { homedir, tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import https from "node:https";

/* ────────────────────────────────────────────────
   System Info
──────────────────────────────────────────────── */
const isWindows = platform() === "win32";
const isMac = platform() === "darwin";
const cpuArch = arch(); // "arm64" or "x64"
const HOME = homedir();
const TMP = tmpdir();

const DEFAULT_SDK_PATH = isWindows
  ? join(HOME, "AppData", "Local", "Android", "Sdk")
  : join(HOME, "Library", "Android", "sdk");

const SDK_VERSION = "12266719";
const SDK_URL = isWindows
  ? `https://dl.google.com/android/repository/commandlinetools-win-${SDK_VERSION}_latest.zip`
  : `https://dl.google.com/android/repository/commandlinetools-mac-${SDK_VERSION}_latest.zip`;

/* ────────────────────────────────────────────────
   Device Profiles
──────────────────────────────────────────────── */
const DEVICE_PRESETS = {
  "Galaxy Note10": {
    name: "Galaxy_Note10_API_30",
    api: "android-30",
    res: { w: 1080, h: 2280, d: 401 },
    ram: 8192,
  },
  "Galaxy Note20": {
    name: "Galaxy_Note20_API_30",
    api: "android-30",
    res: { w: 1080, h: 2400, d: 393 },
    ram: 8192,
  },
  "Galaxy S22": {
    name: "Galaxy_S22_API_30",
    api: "android-30",
    res: { w: 1080, h: 2340, d: 420 },
    ram: 8192,
  },
};

/* ────────────────────────────────────────────────
   Utilities
──────────────────────────────────────────────── */
function run(cmd, args = [], opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    p.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
  });
}

async function downloadFile(url, dest) {
  console.log(`[download] ${url}`);
  await new Promise((res, rej) => {
    const file = createWriteStream(dest);
    https
      .get(url, (r) => {
        if (r.statusCode !== 200) rej(new Error(`HTTP ${r.statusCode}`));
        r.pipe(file);
        file.on("finish", () => file.close(res));
      })
      .on("error", rej);
  });
}

function detectAndroidStudioSdk() {
  const studioPaths = [
    "/Applications/Android Studio.app/Contents",
    "C:\\Program Files\\Android\\Android Studio",
  ];
  for (const base of studioPaths) {
    try {
      const subdirs = readdirSync(base, { withFileTypes: true });
      for (const d of subdirs) {
        if (d.name.toLowerCase().includes("sdk")) {
          const sdkPath = join(base, d.name);
          console.log(`✅ Found Android Studio SDK at: ${sdkPath}`);
          return sdkPath;
        }
      }
    } catch (_) {}
  }
  return null;
}

/* ────────────────────────────────────────────────
   SDK Setup
──────────────────────────────────────────────── */
async function ensureSdk(androidHome) {
  const cmdlineDir = join(androidHome, "cmdline-tools", "latest");
  if (existsSync(cmdlineDir)) {
    console.log("✔ Command-line tools already exist.");
    return;
  }

  mkdirSync(join(androidHome, "cmdline-tools"), { recursive: true });
  const zip = join(TMP, "cmdtools.zip");
  await downloadFile(SDK_URL, zip);

  if (isWindows)
    await run("powershell", [
      "Expand-Archive",
      `-Path \"${zip}\"`,
      `-DestinationPath \"${join(androidHome, "cmdline-tools")}\"`,
      "-Force",
    ]);
  else
    await run("unzip", ["-o", zip, "-d", join(androidHome, "cmdline-tools")]);

  await run("mv", [
    join(androidHome, "cmdline-tools", "cmdline-tools"),
    cmdlineDir,
  ]);
  console.log("✔ Installed command-line tools.");
}

/* ────────────────────────────────────────────────
   System Image Installer
──────────────────────────────────────────────── */
async function installPlatformTools(androidHome, api) {
  const sdkm = isWindows
    ? join(androidHome, "cmdline-tools", "latest", "bin", "sdkmanager.bat")
    : join(androidHome, "cmdline-tools", "latest", "bin", "sdkmanager");

  const abi = isWindows || cpuArch === "x64" ? "x86_64" : "arm64-v8a";
  const sysImg = "google_apis";

  const systemImagePath = `system-images;${api};${sysImg};${abi}`;
  console.log(`📦 Installing ${systemImagePath}`);

  await run(
    sdkm,
    [
      `--sdk_root=${androidHome}`,
      "platform-tools",
      "emulator",
      `platforms;${api}`,
      systemImagePath,
    ],
    { shell: false }
  );

  return { sysImg, abi };
}

/* ────────────────────────────────────────────────
   AVD Creation
──────────────────────────────────────────────── */
async function createAvd(androidHome, preset, sysImg, abi) {
  const { name, api, res, ram } = preset;
  const avdDir = join(HOME, ".android", "avd", `${name}.avd`);
  if (existsSync(avdDir)) {
    console.log("✔ AVD already exists.");
    return;
  }

  const avdm = isWindows
    ? join(androidHome, "cmdline-tools", "latest", "bin", "avdmanager.bat")
    : join(androidHome, "cmdline-tools", "latest", "bin", "avdmanager");

  await run(avdm, [
    "create",
    "avd",
    "-n",
    name,
    "-k",
    `system-images;${api};${sysImg};${abi}`,
    "--device",
    "pixel_5",
    "--force",
  ]);

  const config = `
AvdId=${name}
PlayStore.enabled=true
abi.type=${abi}
avd.ini.displayname=${name}
hw.cpu.arch=${abi.includes("arm") ? "arm64" : "x86_64"}
hw.cpu.model=qemu64
hw.lcd.density=${res.d}
hw.lcd.width=${res.w}
hw.lcd.height=${res.h}
hw.ramSize=${ram}
hw.cpu.ncore=8
hw.gpu.enabled=yes
hw.gpu.mode=host
skin.name=${res.w}x${res.h}
image.sysdir.1=${androidHome}/system-images/${api}/${sysImg}/${abi}/
tag.display=${sysImg}
  `.trim();

  writeFileSync(join(avdDir, "config.ini"), config);
  console.log(`✔ Created AVD for ${name}`);
}

/* ────────────────────────────────────────────────
   Emulator Launcher
──────────────────────────────────────────────── */
async function launchEmulator(androidHome, avdName) {
  console.log(`🚀 Launching emulator: ${avdName}...`);
  const emulatorCmd = isWindows
    ? join(androidHome, "emulator", "emulator.exe")
    : join(androidHome, "emulator", "emulator");

  if (!existsSync(emulatorCmd))
    throw new Error(`Emulator not found at: ${emulatorCmd}`);

  const baseArgs = ["-avd", avdName, "-netdelay", "none", "-netspeed", "full"];
  const accelArgs = isMac
    ? ["-feature", "HVF", "-accel", "auto", "-gpu", "host"] // ✅ 변경됨
    : ["-accel", "on", "-gpu", "host"];

  const proc = spawn(emulatorCmd, [...baseArgs, ...accelArgs], {
    stdio: "inherit",
    detached: true,
  });

  proc.on("error", (err) => console.error("✖ Emulator failed:", err.message));
  console.log("✔ Emulator process started. Booting may take ~30s.");
}

/* ────────────────────────────────────────────────
   Main Flow
──────────────────────────────────────────────── */
async function main() {
  console.log("\x1b[33m=== Android SDK Auto Detection ===\x1b[0m\n");

  const detected = detectAndroidStudioSdk();
  const ANDROID_HOME =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    detected ||
    DEFAULT_SDK_PATH;

  console.log(`📦 Using Android SDK path: ${ANDROID_HOME}`);
  await ensureSdk(ANDROID_HOME);

  const { device } = await inquirer.prompt([
    {
      type: "list",
      name: "device",
      message: "Choose device to emulate:",
      choices: Object.keys(DEVICE_PRESETS),
    },
  ]);

  const preset = DEVICE_PRESETS[device];
  const { sysImg, abi } = await installPlatformTools(ANDROID_HOME, preset.api);
  await createAvd(ANDROID_HOME, preset, sysImg, abi);
  await launchEmulator(ANDROID_HOME, preset.name);

  console.log("\n✅ Setup complete and emulator launched!");

  console.log("\n🧠 Checking Vite dev server (http://localhost:5173) ...");

  // 1️⃣ Vite dev 서버 실행 (또는 감지)
  try {
    const res = await fetch("http://localhost:5173");
    if (res.ok) console.log("✅ Vite dev server already running.");
  } catch {
    console.log("⚙️ Starting Vite dev server...");
    spawn("npm", ["run", "dev"], {
      cwd: join(process.cwd(), "webview"),
      stdio: "inherit",
      shell: true,
      detached: true,
    });
    console.log("⏳ Waiting for Vite server to start...");
    await new Promise((res) => setTimeout(res, 5000));
  }

  // 2️⃣ Android 앱 빌드 및 설치
  console.log("\n🔧 Building Android app...");
  const gradlew = isWindows ? "gradlew.bat" : "./gradlew";
  await run(gradlew, ["assembleDebug"], {
    cwd: join(process.cwd(), "android"),
  });

  console.log("📱 Installing app on emulator...");
  await run(gradlew, ["installDebug"], { cwd: join(process.cwd(), "android") });

  // 3️⃣ 앱 자동 실행
  console.log("\n🚀 Launching WebView app...");
  await run("adb", [
    "shell",
    "am",
    "start",
    "-n",
    "com.ebview.android/.MainActivity",
  ]);

  console.log(
    "\n🎉 All steps completed! WebView should now show your Vite app."
  );
}

main().catch((e) => {
  console.error("✖ ERROR:", e.message);
  process.exit(1);
});
