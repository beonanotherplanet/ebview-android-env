#!/usr/bin/env node
/**
 * Android AVD Auto Setup (Windows 10 전용 + mac 호환)
 * - JAVA_HOME/`java` 미존재 환경에서도 자체 JDK(zip) 설치하여 강제 주입
 * - SDK cmdline-tools 구조 자동 교정
 * - sdkmanager/avdmanager/emulator/adb 전체 절대경로 사용 + env 강제 주입
 */

import inquirer from "inquirer";
import { spawn, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  createWriteStream,
  writeFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { homedir, tmpdir, platform, arch, release } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { createRequire } from "module";
const require = createRequire(import.meta.url);

/* ────────────────────────────────────────────────
   System Info
──────────────────────────────────────────────── */
const isWindows = platform() === "win32";
const isMac = platform() === "darwin";
const isArm64 = arch() === "arm64";
const HOME = homedir();
const TMP = tmpdir();

const DEFAULT_SDK_PATH = isWindows
  ? join(HOME, "AppData", "Local", "Android", "sdk")
  : join(HOME, "Library", "Android", "sdk");

const SDK_VERSION = "12266719";
const SDK_URL = isWindows
  ? `https://dl.google.com/android/repository/commandlinetools-win-${SDK_VERSION}_latest.zip`
  : `https://dl.google.com/android/repository/commandlinetools-mac-${SDK_VERSION}_latest.zip`;

/* ────────────────────────────────────────────────
   Device Profiles
──────────────────────────────────────────────── */
const DEVICE_PRESETS: Record<
  string,
  {
    name: string;
    api: string;
    res: { w: number; h: number; d: number };
    ram: number;
  }
> = {
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
function shQuote(p: string): string {
  return p.includes(" ") ? `"${p}"` : p;
}
function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}
function normalizeIniPath(p: string): string {
  return p.replace(/\\/g, "/");
}
function getNodeMajor(): number {
  return parseInt(process.versions.node.split(".")[0], 10);
}
function run(cmd: string, args: string[] = [], opts: any = {}): Promise<void> {
  return new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    p.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
  });
}
async function downloadFile(url: string, dest: string): Promise<void> {
  console.log(`[download] ${url}`);
  await new Promise<void>((res, rej) => {
    const file = createWriteStream(dest);
    function request(urlToFetch: string) {
      https
        .get(urlToFetch, (r) => {
          if (
            r.statusCode &&
            r.statusCode >= 300 &&
            r.statusCode < 400 &&
            r.headers.location
          ) {
            console.log(`↪ Redirecting to ${r.headers.location}`);
            r.resume();
            request(r.headers.location);
            return;
          }
          if (r.statusCode !== 200) {
            rej(new Error(`HTTP ${r.statusCode} for ${urlToFetch}`));
            return;
          }
          const total = parseInt(r.headers["content-length"] || "0", 10);
          let downloaded = 0,
            lastPercent = 0;
          r.on("data", (chunk) => {
            downloaded += chunk.length;
            if (total > 0) {
              const percent = Math.floor((downloaded / total) * 100);
              if (percent !== lastPercent && percent % 2 === 0) {
                process.stdout.write(`\r📦 Downloading... ${percent}%`);
                lastPercent = percent;
              }
            }
          });
          r.pipe(file);
          file.on("finish", () => {
            console.log("\n✅ Download complete!");
            file.close();
            res();
          });
        })
        .on("error", rej);
    }
    request(url);
  });
}
function detectAndroidStudioSdk(): string | null {
  const studioPaths = isWindows
    ? [
        "C:\\Program Files\\Android\\Android Studio",
        "C:\\Program Files\\Android\\Android Studio\\jbr",
      ]
    : ["/Applications/Android Studio.app/Contents"];
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
    } catch {
      /* ignore */
    }
  }
  return null;
}

/* PowerShell helpers */
function psq(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
async function runPSScript(
  scriptContent: string,
  opts: { env?: NodeJS.ProcessEnv } = {}
): Promise<void> {
  const psPath = join(TMP, `__tmp_${Date.now()}.ps1`);
  writeFileSync(psPath, scriptContent, "utf8");
  try {
    await run(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", psPath],
      opts
    );
  } finally {
    try {
      require("node:fs").unlinkSync(psPath);
    } catch {}
  }
}

/** 런타임 env 강제 주입 (JAVA_HOME/PATH, ANDROID_HOME/SDK_ROOT) */
function runtimeEnv(params: {
  androidHome: string;
  javaHome?: string;
}): NodeJS.ProcessEnv {
  const base = { ...process.env };
  base.ANDROID_HOME = params.androidHome;
  base.ANDROID_SDK_ROOT = params.androidHome;
  if (isWindows) {
    const jh = (params.javaHome ?? process.env.JAVA_HOME ?? "").trim();
    if (jh) {
      base.JAVA_HOME = jh;
      base.PATH = `${join(jh, "bin")};${base.PATH ?? ""}`;
    }
  }
  return base;
}

/* SDK tool resolver */
function findFileRecursive(
  root: string,
  target: string,
  maxDepth = 5
): string | null {
  function walk(dir: string, depth: number): string | null {
    if (depth > maxDepth) return null;
    let entries: any[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === target.toLowerCase()) return p;
      if (e.isDirectory()) {
        const r = walk(p, depth + 1);
        if (r) return r;
      }
    }
    return null;
  }
  return walk(root, 0);
}
function resolveSdkTool(
  androidHome: string,
  name: "sdkmanager" | "avdmanager" | "emulator" | "adb"
): string | null {
  const isBat = isWindows && (name === "sdkmanager" || name === "avdmanager");
  const isExe = isWindows && (name === "emulator" || name === "adb");
  const file = isBat ? `${name}.bat` : isExe ? `${name}.exe` : name;
  const candidates = [
    join(androidHome, "cmdline-tools", "latest", "bin", file),
    join(androidHome, "cmdline-tools", "bin", file),
    join(androidHome, "emulator", file),
    join(androidHome, "platform-tools", file),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return findFileRecursive(androidHome, file, 5);
}
function getSdkTools(androidHome: string) {
  const sdkm = resolveSdkTool(androidHome, "sdkmanager");
  const avdm = resolveSdkTool(androidHome, "avdmanager");
  const emulatorCmd = resolveSdkTool(androidHome, "emulator");
  const adb = resolveSdkTool(androidHome, "adb");
  return { sdkm, avdm, emulatorCmd, adb };
}

/* ────────────────────────────────────────────────
   JDK 17 확보 (가장 확실한 포터블 ZIP 설치 경로)
──────────────────────────────────────────────── */
const JDK_ZIP_URL =
  "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.zip";
const LOCAL_JDK_DIR = join(HOME, "AppData", "Local", "JDK", "temurin-17");
function tryDeriveJavaHomeFromWhere(): string | null {
  try {
    const out = execSync("where java", { stdio: ["ignore", "pipe", "pipe"] })
      .toString()
      .trim();
    const lines = out.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return null;
    // e.g. C:\Program Files\Eclipse Adoptium\jdk-17.x\bin\java.exe
    const javaExe = lines[0];
    if (javaExe.toLowerCase().endsWith("\\java.exe")) {
      return javaExe.replace(/\\bin\\java\.exe$/i, "");
    }
    return null;
  } catch {
    return null;
  }
}
function findWindowsJavaHome(): string | null {
  // 1) 환경변수
  if (
    process.env.JAVA_HOME &&
    existsSync(join(process.env.JAVA_HOME, "bin", "java.exe"))
  )
    return process.env.JAVA_HOME;
  // 2) where java
  const fromWhere = tryDeriveJavaHomeFromWhere();
  if (fromWhere && existsSync(join(fromWhere, "bin", "java.exe")))
    return fromWhere;
  // 3) 일반적인 설치 위치들
  const roots = [
    "C:\\Program Files\\Eclipse Adoptium",
    "C:\\Program Files\\Java",
    "C:\\Program Files\\Microsoft",
  ];
  for (const root of roots) {
    try {
      const items = readdirSync(root, { withFileTypes: true });
      for (const it of items) {
        if (!it.isDirectory()) continue;
        const name = it.name.toLowerCase();
        if (name.startsWith("jdk-17")) {
          const path = join(root, it.name);
          if (existsSync(join(path, "bin", "java.exe"))) return path;
        }
      }
    } catch {}
  }
  // 4) 우리 포터블 설치 위치
  if (existsSync(join(LOCAL_JDK_DIR, "bin", "java.exe"))) return LOCAL_JDK_DIR;
  return null;
}
async function ensureJava17OrLater(): Promise<string> {
  // 이미 사용 가능한 java가 있으면 그대로 사용
  try {
    const ver = execSync("java -version", {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    const m = ver.match(/version "(.*?)"/);
    if (m) {
      const major = parseInt(m[1].split(".")[0], 10);
      if (Number.isFinite(major) && major >= 17) {
        const guessed = findWindowsJavaHome() ?? "";
        if (guessed) {
          process.env.JAVA_HOME = guessed;
          process.env.PATH = `${join(guessed, "bin")};${
            process.env.PATH ?? ""
          }`;
        }
        console.log(`✔ Java ${m[1]} detected`);
        return guessed;
      }
    }
  } catch {
    /* no java */
  }

  if (!isWindows)
    throw new Error("Java JDK 17+ is required. Please install JDK 17+.");

  // 포터블 JDK(zip) 설치
  console.log("⬇️ Installing portable Temurin JDK 17 (zip) ...");
  ensureDir(LOCAL_JDK_DIR);
  const zipPath = join(TMP, "temurin17.zip");
  await downloadFile(JDK_ZIP_URL, zipPath);

  // 압축 해제 (폴더 안에 jdk-17... 루트가 들어있어서 contents를 목표 폴더로 이동)
  await run(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      `Remove-Item -Recurse -Force ${psq(
        LOCAL_JDK_DIR
      )} -ErrorAction SilentlyContinue;`,
      `New-Item -ItemType Directory -Force -Path ${psq(
        LOCAL_JDK_DIR
      )} | Out-Null;`,
      `Expand-Archive -Path ${psq(zipPath)} -DestinationPath ${psq(
        LOCAL_JDK_DIR
      )} -Force;`,
    ].join(" "),
    { shell: true }
  );

  // temurin-17\jdk-17.x.x+xx\* 구조 → 가장 상위 jdk-17.* 폴더를 JAVA_HOME 으로
  let javaHome = "";
  try {
    const entries = readdirSync(LOCAL_JDK_DIR, { withFileTypes: true });
    const jdkFolder = entries.find(
      (e) => e.isDirectory() && /^jdk-17/i.test(e.name)
    );
    if (jdkFolder) javaHome = join(LOCAL_JDK_DIR, jdkFolder.name);
  } catch {}
  if (!javaHome) {
    // 바로 bin이 있을 수도
    if (existsSync(join(LOCAL_JDK_DIR, "bin", "java.exe")))
      javaHome = LOCAL_JDK_DIR;
  }
  if (!javaHome || !existsSync(join(javaHome, "bin", "java.exe"))) {
    throw new Error("Portable JDK 설치 실패 (java.exe 미발견)");
  }

  process.env.JAVA_HOME = javaHome;
  process.env.PATH = `${join(javaHome, "bin")};${process.env.PATH ?? ""}`;
  console.log(`📦 JAVA_HOME set to: ${javaHome}`);
  return javaHome;
}

/* ────────────────────────────────────────────────
   SDK Setup (zip 구조 꼬임 자동 교정)
──────────────────────────────────────────────── */
async function ensureSdk(androidHome: string): Promise<void> {
  const toolsBase = join(androidHome, "cmdline-tools");
  const latestDir = join(toolsBase, "latest");
  const sdkBin = join(
    latestDir,
    "bin",
    isWindows ? "sdkmanager.bat" : "sdkmanager"
  );

  if (existsSync(sdkBin)) {
    console.log("✔ Command-line tools already exist.");
    return;
  }

  ensureDir(toolsBase);
  const zip = join(TMP, "cmdtools.zip");
  await downloadFile(SDK_URL, zip);

  if (isWindows) {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "Expand-Archive",
      `-Path ${shQuote(zip)}`,
      `-DestinationPath ${shQuote(toolsBase)}`,
      "-Force",
    ]);
    const inner = join(toolsBase, "cmdline-tools");
    ensureDir(latestDir);
    try {
      if (existsSync(join(inner, "bin"))) {
        renameSync(inner, latestDir);
      } else if (existsSync(join(inner, "cmdline-tools", "bin"))) {
        renameSync(join(inner, "cmdline-tools"), latestDir);
      }
    } catch {}
  } else {
    await run("unzip", ["-o", zip, "-d", toolsBase]);
    try {
      const inner = join(toolsBase, "cmdline-tools");
      if (existsSync(join(inner, "bin"))) renameSync(inner, latestDir);
      else if (existsSync(join(inner, "cmdline-tools", "bin")))
        renameSync(join(inner, "cmdline-tools"), latestDir);
    } catch {}
  }

  const sdkPath = resolveSdkTool(androidHome, "sdkmanager");
  if (!sdkPath)
    throw new Error(
      `cmdline-tools 설치 후에도 sdkmanager를 찾지 못했습니다. (path: ${toolsBase})`
    );
  console.log("✔ Installed command-line tools.");
}

/* ────────────────────────────────────────────────
   Licenses / Installs (항상 env 강제 주입)
──────────────────────────────────────────────── */
async function acceptLicenses(
  androidHome: string,
  sdkm: string,
  javaHome: string
): Promise<void> {
  console.log("📝 Accepting SDK licenses...");
  if (isWindows) {
    const psLines = [
      "$ErrorActionPreference = 'Stop'",
      `$sdk  = ${psq(sdkm)}`,
      `$root = ${psq(androidHome)}`,
      `$env:ANDROID_HOME = ${psq(androidHome)}`,
      `$env:ANDROID_SDK_ROOT = ${psq(androidHome)}`,
      `$env:JAVA_HOME = ${psq(javaHome)}`,
      `$env:PATH = (${psq(join(javaHome, "bin"))} + ';' + $env:PATH)`,
      'if (!(Test-Path $sdk)) { throw "sdkmanager not found: $sdk" }',
      "try { Unblock-File -Path $sdk } catch {}",
      "& $sdk --sdk_root=$root --version | Out-Host",
      "$yes = @(); 1..50 | % { $yes += 'y' }",
      '$yes -join "`n" | & $sdk --sdk_root=$root --licenses | Out-Host',
    ].join("\r\n");
    await runPSScript(psLines, { env: runtimeEnv({ androidHome, javaHome }) });
  } else {
    await run("bash", [
      "-lc",
      `yes | ${shQuote(sdkm)} --sdk_root=${shQuote(androidHome)} --licenses`,
    ]);
  }
}

async function ensureEmulatorInstalled(
  androidHome: string,
  javaHome: string
): Promise<void> {
  const { sdkm } = getSdkTools(androidHome);
  if (!sdkm) throw new Error("sdkmanager not found. cmdline-tools 설치 확인.");
  if (isWindows) {
    const ps = [
      "$ErrorActionPreference = 'Stop'",
      `$sdk  = ${psq(sdkm)}`,
      `$root = ${psq(androidHome)}`,
      `$env:ANDROID_HOME = ${psq(androidHome)}`,
      `$env:ANDROID_SDK_ROOT = ${psq(androidHome)}`,
      `$env:JAVA_HOME = ${psq(javaHome)}`,
      `$env:PATH = (${psq(join(javaHome, "bin"))} + ';' + $env:PATH)`,
      "try { Unblock-File -Path $sdk } catch {}",
      `& $sdk --sdk_root=$root "emulator" "platform-tools" | Out-Host`,
    ].join("\r\n");
    await runPSScript(ps, { env: runtimeEnv({ androidHome, javaHome }) });
  } else {
    await run(sdkm, [
      `--sdk_root=${androidHome}`,
      "emulator",
      "platform-tools",
    ]);
  }
}

async function installPlatformTools(
  androidHome: string,
  api: string,
  javaHome: string
) {
  const { sdkm } = getSdkTools(androidHome);
  if (!sdkm) throw new Error("sdkmanager not found after installation.");

  const abi = isWindows || !isArm64 ? "x86_64" : "arm64-v8a";
  const sysImg = "google_apis";
  const systemImagePath = `system-images;${api};${sysImg};${abi}`;

  console.log(`📦 Installing packages:
 - platform-tools
 - emulator
 - platforms;${api}
 - ${systemImagePath}
 - extras;intel;Hardware_Accelerated_Execution_Manager (best-effort)
 - extras;google;gdk (best-effort)
`);

  if (isWindows) {
    const psInstall = (pkgs: string[]) =>
      [
        "$ErrorActionPreference = 'Stop'",
        `$sdk  = ${psq(sdkm)}`,
        `$root = ${psq(androidHome)}`,
        `$env:ANDROID_HOME = ${psq(androidHome)}`,
        `$env:ANDROID_SDK_ROOT = ${psq(androidHome)}`,
        `$env:JAVA_HOME = ${psq(javaHome)}`,
        `$env:PATH = (${psq(join(javaHome, "bin"))} + ';' + $env:PATH)`,
        'if (!(Test-Path $sdk)) { throw "sdkmanager not found: $sdk" }',
        "try { Unblock-File -Path $sdk } catch {}",
        `& $sdk --sdk_root=$root ${pkgs
          .map((p) => `"${p}"`)
          .join(" ")} | Out-Host`,
      ].join("\r\n");

    await runPSScript(
      psInstall([
        "platform-tools",
        "emulator",
        `platforms;${api}`,
        systemImagePath,
      ]),
      { env: runtimeEnv({ androidHome, javaHome }) }
    );
    try {
      await runPSScript(psInstall(["extras;google;gdk"]), {
        env: runtimeEnv({ androidHome, javaHome }),
      });
    } catch {}
    try {
      await runPSScript(
        psInstall(["extras;intel;Hardware_Accelerated_Execution_Manager"]),
        { env: runtimeEnv({ androidHome, javaHome }) }
      );
    } catch {}
  } else {
    await run(shQuote(sdkm), [
      `--sdk_root=${shQuote(androidHome)}`,
      "platform-tools",
      "emulator",
      `platforms;${api}`,
      systemImagePath,
    ]);
    try {
      await run(shQuote(sdkm), [
        `--sdk_root=${shQuote(androidHome)}`,
        "extras;google;gdk",
      ]);
    } catch {}
    try {
      await run(shQuote(sdkm), [
        `--sdk_root=${shQuote(androidHome)}`,
        "extras;intel;Hardware_Accelerated_Execution_Manager",
      ]);
    } catch {}
  }

  return { sysImg, abi };
}

/* ────────────────────────────────────────────────
   AVD Creation
──────────────────────────────────────────────── */
async function createAvd(
  androidHome: string,
  preset: (typeof DEVICE_PRESETS)[keyof typeof DEVICE_PRESETS],
  sysImg: string,
  abi: string
) {
  const { name, api, res, ram } = preset;
  const avdDir = join(HOME, ".android", "avd", `${name}.avd`);
  const { avdm } = getSdkTools(androidHome);
  if (!avdm) throw new Error("avdmanager not found after installation.");

  if (existsSync(avdDir)) {
    console.log("✔ AVD already exists.");
  } else {
    console.log("🧩 Creating AVD (best-effort device profile)...");
    let created = false;
    try {
      await run(
        shQuote(avdm),
        [
          "create",
          "avd",
          "-n",
          shQuote(name),
          "-k",
          shQuote(`system-images;${api};${sysImg};${abi}`),
          "--device",
          "pixel_5",
          "--force",
        ],
        { env: runtimeEnv({ androidHome }) }
      );
      created = true;
    } catch {
      console.log("ℹ️ 'pixel_5' profile missing. Retrying without --device...");
      await run(
        shQuote(avdm),
        [
          "create",
          "avd",
          "-n",
          shQuote(name),
          "-k",
          shQuote(`system-images;${api};${sysImg};${abi}`),
          "--force",
        ],
        { env: runtimeEnv({ androidHome }) }
      );
      created = true;
    }
    if (!created) throw new Error("Failed to create AVD");
  }

  ensureDir(avdDir);
  const ini = [
    `AvdId=${name}`,
    `PlayStore.enabled=true`,
    `abi.type=${abi}`,
    `avd.ini.displayname=${name}`,
    `hw.cpu.arch=${abi.includes("arm") ? "arm64" : "x86_64"}`,
    `hw.cpu.model=qemu64`,
    `hw.lcd.density=${res.d}`,
    `hw.lcd.width=${res.w}`,
    `hw.lcd.height=${res.h}`,
    `hw.ramSize=${ram}`,
    `hw.cpu.ncore=8`,
    `hw.gpu.enabled=yes`,
    `hw.gpu.mode=host`,
    `skin.name=${res.w}x${res.h}`,
    `image.sysdir.1=${normalizeIniPath(
      join(androidHome, "system-images", api, sysImg, abi)
    )}/`,
    `tag.display=${sysImg}`,
  ].join("\n");
  writeFileSync(join(avdDir, "config.ini"), ini, "utf8");
  console.log(`✔ Created/updated AVD config for ${name}`);
}

/* ────────────────────────────────────────────────
   Emulator Launcher
──────────────────────────────────────────────── */
async function launchEmulator(
  androidHome: string,
  avdName: string,
  javaHome: string
) {
  console.log(`🚀 Launching emulator: ${avdName}...`);
  let { emulatorCmd } = getSdkTools(androidHome);

  if (!emulatorCmd) {
    console.log("ℹ️ Emulator binary not found. Installing emulator package...");
    await ensureEmulatorInstalled(androidHome, javaHome);
    ({ emulatorCmd } = getSdkTools(androidHome));
  }
  if (!emulatorCmd) throw new Error("emulator not found after installation");

  if (isWindows) {
    const ps = [
      "$ErrorActionPreference = 'Stop'",
      `$emu = ${psq(emulatorCmd)}`,
      "try { Unblock-File -Path $emu } catch {}",
    ].join("\r\n");
    await runPSScript(ps, { env: runtimeEnv({ androidHome, javaHome }) });
  }

  const baseArgs = ["-avd", avdName, "-netdelay", "none", "-netspeed", "full"];
  const accelArgs = isMac
    ? ["-feature", "HVF", "-accel", "auto", "-gpu", "host"]
    : ["-accel", "on", "-gpu", "host"];

  const proc = spawn(shQuote(emulatorCmd), [...baseArgs, ...accelArgs], {
    stdio: "inherit",
    detached: true,
    shell: true,
    env: runtimeEnv({ androidHome, javaHome }),
  });
  proc.on("error", (err) => console.error("✖ Emulator failed:", err.message));
  console.log("✔ Emulator process started. Booting may take ~30s.");
}

/* ────────────────────────────────────────────────
   Vite Dev Server
──────────────────────────────────────────────── */
async function ensureViteDevServer() {
  console.log("\n🧠 Checking Vite dev server (http://localhost:5173) ...");
  const nodeMajor = getNodeMajor();
  const canFetch = typeof fetch === "function";
  if (!canFetch && nodeMajor < 18) {
    console.log("ℹ️ Node 18+ 권장. 현재 환경에선 바로 실행 시도.");
  }
  let ok = false;
  if (canFetch) {
    try {
      const r = await fetch("http://localhost:5173");
      if (r.ok) ok = true;
    } catch {}
  }
  if (!ok) {
    console.log("⚙️ Starting Vite dev server...");
    spawn("npm", ["run", "dev"], {
      cwd: join(process.cwd(), "webview"),
      stdio: "inherit",
      shell: true,
      detached: true,
    });
    console.log("⏳ Waiting for Vite server to start...");
    await new Promise((res) => setTimeout(res, 7000));
  } else {
    console.log("✅ Vite dev server already running.");
  }
}

/* ────────────────────────────────────────────────
   Main
──────────────────────────────────────────────── */
async function main() {
  console.log("\x1b[33m=== Android SDK Auto Setup ===\x1b[0m\n");
  if (isWindows) console.log(`ℹ️ Windows ${release()}`);

  // 1) 자바 확보 (포터블 zip 설치로 JAVA_HOME 보장)
  const JAVA_HOME_RUNTIME = await ensureJava17OrLater();
  console.log(
    `🔎 JAVA_HOME (runtime): ${
      JAVA_HOME_RUNTIME || "(empty; PATH java used if available)"
    }`
  );

  // 2) ANDROID_HOME 결정
  const detected = detectAndroidStudioSdk();
  const ANDROID_HOME =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    detected ||
    DEFAULT_SDK_PATH;
  ensureDir(ANDROID_HOME);
  console.log(`📦 Using Android SDK path: ${ANDROID_HOME}`);

  // 3) cmdline-tools 설치/정규화
  await ensureSdk(ANDROID_HOME);

  // 4) 라이선스 동의
  const { sdkm } = getSdkTools(ANDROID_HOME);
  if (!sdkm) throw new Error("sdkmanager not found");
  await acceptLicenses(
    ANDROID_HOME,
    sdkm,
    JAVA_HOME_RUNTIME || process.env.JAVA_HOME || ""
  );

  // 5) 시스템 이미지 설치
  const { device } = await inquirer.prompt([
    {
      type: "list",
      name: "device",
      message: "Choose device to emulate:",
      choices: Object.keys(DEVICE_PRESETS),
    },
  ]);
  const preset = DEVICE_PRESETS[device];
  const { sysImg, abi } = await installPlatformTools(
    ANDROID_HOME,
    preset.api,
    JAVA_HOME_RUNTIME || process.env.JAVA_HOME || ""
  );

  // 6) AVD 생성 + 에뮬레이터 기동
  await createAvd(ANDROID_HOME, preset, sysImg, abi);
  await launchEmulator(
    ANDROID_HOME,
    preset.name,
    JAVA_HOME_RUNTIME || process.env.JAVA_HOME || ""
  );

  console.log("\n✅ Setup complete and emulator launched!");

  // 7) Vite dev server
  await ensureViteDevServer();

  // 8) APK 설치/실행
  const apkPath = join(process.cwd(), "app-debug.apk");
  if (!existsSync(apkPath)) {
    console.error(`❌ APK not found at ${apkPath}`);
    process.exit(1);
  }
  const { adb } = getSdkTools(ANDROID_HOME);
  if (!adb) throw new Error("adb not found after installation.");

  console.log("📱 Installing APK...");
  await run(shQuote(adb), ["install", "-r", shQuote(apkPath)], {
    env: runtimeEnv({ androidHome: ANDROID_HOME, javaHome: JAVA_HOME_RUNTIME }),
  });

  console.log("\n🚀 Launching WebView app...");
  await run(
    shQuote(adb),
    ["shell", "am", "start", "-n", "com.ebview.android/.MainActivity"],
    {
      env: runtimeEnv({
        androidHome: ANDROID_HOME,
        javaHome: JAVA_HOME_RUNTIME,
      }),
    }
  );

  // 9) Chrome DevTools
  console.log("\n🌐 Setting up Chrome remote debugging...");
  try {
    await run(
      shQuote(adb),
      ["forward", "tcp:9222", "localabstract:chrome_devtools_remote"],
      {
        env: runtimeEnv({
          androidHome: ANDROID_HOME,
          javaHome: JAVA_HOME_RUNTIME,
        }),
      }
    );
    await run(shQuote(adb), ["reverse", "tcp:5173", "tcp:5173"], {
      env: runtimeEnv({
        androidHome: ANDROID_HOME,
        javaHome: JAVA_HOME_RUNTIME,
      }),
    });

    console.log("🧭 Opening Chrome debugger...");
    if (isWindows) {
      try {
        spawn("cmd", ["/c", "start", "chrome", "chrome://inspect/#devices"], {
          detached: true,
          windowsHide: true,
          shell: true,
        });
      } catch {}
      console.log("ℹ️ 자동 실행 실패 시 chrome://inspect/#devices 수동 오픈");
    } else if (isMac) {
      try {
        spawn("open", ["-a", "Google Chrome", "chrome://inspect/#devices"], {
          detached: true,
          shell: true,
        });
      } catch {}
      console.log("ℹ️ 자동 실행 실패 시 chrome://inspect/#devices 수동 오픈");
    }
    console.log("✅ Chrome DevTools ready. You can now inspect your WebView.");
  } catch (err: any) {
    console.error("⚠️ Failed to open Chrome DevTools:", err?.message ?? err);
    console.log(
      "ℹ️ chrome://inspect/#devices 를 수동으로 열고, ADB 포워딩을 확인하세요."
    );
  }

  console.log(
    "\n🎉 All steps completed! WebView should now show your Vite app."
  );
}

main().catch((e) => {
  console.error("✖ ERROR:", e.message);
  process.exit(1);
});
