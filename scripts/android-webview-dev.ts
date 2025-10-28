#!/usr/bin/env node
/**
 * Android AVD Auto Setup (Windows 우선 + mac 호환)
 * - JAVA_HOME 없을 때 포터블 JDK(zip) 설치/주입
 * - SDK cmdline-tools 구조 자동 교정
 * - Windows 방화벽에 adb.exe 허용 규칙 자동 추가
 * - 에뮬레이터 부팅 완료까지 대기 (wait-for-device + sys.boot_completed)
 * - 이후 모든 adb 호출은 고정된 serial(-s) 사용
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
  ? join(HOME, "AppData", "Local", "Android", "Sdk")
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
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function runAndGetStdout(
  cmd: string,
  args: string[] = [],
  opts: any = {}
): Promise<string> {
  return new Promise<string>((res, rej) => {
    const p = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      ...opts,
    });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("exit", (code) =>
      code === 0
        ? res(out || err)
        : rej(new Error((out + err).trim() || `${cmd} exited ${code}`))
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

async function killStaleEmulators(): Promise<void> {
  const silence = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {}
  };
  if (isWindows) {
    await silence(() =>
      run("taskkill", ["/F", "/IM", "qemu-system-x86_64.exe"], { shell: true })
    );
    await silence(() =>
      run("taskkill", ["/F", "/IM", "qemu-system-aarch64.exe"], {
        shell: true,
      })
    );
    await silence(() =>
      run("taskkill", ["/F", "/IM", "emulator.exe"], { shell: true })
    );
    await silence(() =>
      run("taskkill", ["/F", "/IM", "adb.exe"], { shell: true })
    );
  } else {
    await silence(() => run("pkill", ["-f", "qemu-system-"], {}));
    await silence(() => run("pkill", ["-f", "/emulator$"], {}));
    await silence(() => run("pkill", ["-f", "/adb$"], {}));
  }
  await sleep(800);
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

/** 런타임 env 강제 주입 */
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
   JDK 17 (포터블 ZIP 설치)
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
    const javaExe = lines[0];
    if (javaExe.toLowerCase().endsWith("\\java.exe"))
      return javaExe.replace(/\\bin\\java\.exe$/i, "");
    return null;
  } catch {
    return null;
  }
}
function findWindowsJavaHome(): string | null {
  if (
    process.env.JAVA_HOME &&
    existsSync(join(process.env.JAVA_HOME, "bin", "java.exe"))
  )
    return process.env.JAVA_HOME;
  const fromWhere = tryDeriveJavaHomeFromWhere();
  if (fromWhere && existsSync(join(fromWhere, "bin", "java.exe")))
    return fromWhere;
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
  if (existsSync(join(LOCAL_JDK_DIR, "bin", "java.exe"))) return LOCAL_JDK_DIR;
  return null;
}
async function ensureJava17OrLater(): Promise<string> {
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
  } catch {}

  if (!isWindows)
    throw new Error("Java JDK 17+ is required. Please install JDK 17+.");

  console.log("⬇️ Installing portable Temurin JDK 17 (zip) ...");
  ensureDir(LOCAL_JDK_DIR);
  const zipPath = join(TMP, "temurin17.zip");
  await downloadFile(JDK_ZIP_URL, zipPath);

  const ps = [
    "$ErrorActionPreference = 'Stop'",
    `if (Test-Path ${psq(
      LOCAL_JDK_DIR
    )}) { try { Remove-Item -Recurse -Force ${psq(LOCAL_JDK_DIR)} } catch {} }`,
    `New-Item -ItemType Directory -Force -Path ${psq(
      LOCAL_JDK_DIR
    )} | Out-Null`,
    `Expand-Archive -Path ${psq(zipPath)} -DestinationPath ${psq(
      LOCAL_JDK_DIR
    )} -Force`,
  ].join("\r\n");
  await runPSScript(ps);

  let javaHome = "";
  try {
    const entries = readdirSync(LOCAL_JDK_DIR, { withFileTypes: true });
    const jdkFolder = entries.find(
      (e) => e.isDirectory() && /^jdk-17/i.test(e.name)
    );
    if (jdkFolder) javaHome = join(LOCAL_JDK_DIR, jdkFolder.name);
  } catch {}
  if (!javaHome) {
    if (existsSync(join(LOCAL_JDK_DIR, "bin", "java.exe")))
      javaHome = LOCAL_JDK_DIR;
  }
  if (!javaHome || !existsSync(join(javaHome, "bin", "java.exe")))
    throw new Error("Portable JDK 설치 실패 (java.exe 미발견)");

  process.env.JAVA_HOME = javaHome;
  process.env.PATH = `${join(javaHome, "bin")};${process.env.PATH ?? ""}`;
  console.log(`📦 JAVA_HOME set to: ${javaHome}`);
  return javaHome;
}

/* ────────────────────────────────────────────────
   SDK Setup
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
      "-Path",
      shQuote(zip),
      "-DestinationPath",
      shQuote(toolsBase),
      "-Force",
    ]);
    const inner = join(toolsBase, "cmdline-tools");
    ensureDir(latestDir);
    try {
      if (existsSync(join(inner, "bin"))) renameSync(inner, latestDir);
      else if (existsSync(join(inner, "cmdline-tools", "bin")))
        renameSync(join(inner, "cmdline-tools"), latestDir);
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
   Licenses / Installs
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
   Windows 방화벽: adb.exe 허용 규칙 추가
──────────────────────────────────────────────── */
async function ensureWindowsFirewallForAdb(adbPath: string) {
  if (!isWindows) return;
  const ruleNameIn = "ADB Inbound Allow";
  const ruleNameOut = "ADB Outbound Allow";
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `if (-not (Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object { $_.Program -ieq ${psq(
      adbPath
    )} })) {`,
    `  New-NetFirewallRule -DisplayName ${psq(
      ruleNameIn
    )} -Direction Inbound -Action Allow -Program ${psq(
      adbPath
    )} -Profile Any | Out-Null`,
    `  New-NetFirewallRule -DisplayName ${psq(
      ruleNameOut
    )} -Direction Outbound -Action Allow -Program ${psq(
      adbPath
    )} -Profile Any | Out-Null`,
    `}`,
  ].join("\r\n");
  try {
    await runPSScript(ps);
  } catch {}
}

/* ────────────────────────────────────────────────
   AVD Creation (안전 기본값)
──────────────────────────────────────────────── */
async function createAvd(
  androidHome: string,
  preset: (typeof DEVICE_PRESETS)[keyof typeof DEVICE_PRESETS],
  sysImg: string,
  abi: string
) {
  const { name, api, res } = preset;
  const avdDir = join(HOME, ".android", "avd", `${name}.avd`);
  const { avdm } = getSdkTools(androidHome);
  if (!avdm) throw new Error("avdmanager not found after installation.");

  // sysImg에 playstore가 포함되면 true, 아니면 false
  const hasPlayStore = /playstore/i.test(sysImg);
  const playStoreFlag = hasPlayStore ? "true" : "false";

  if (existsSync(avdDir)) {
    console.log("✔ AVD already exists.");
  } else {
    console.log("🧩 Creating AVD ...");
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
          "--force",
        ],
        { env: runtimeEnv({ androidHome }) }
      );
    } catch {
      // 일부 환경은 device 프로필 필요 → pixel_5로 재시도
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
    }
  }

  // 안전 기본값으로 config.ini 갱신
  ensureDir(avdDir);
  const ini = [
    `AvdId=${name}`,
    `PlayStore.enabled=${playStoreFlag}`,
    `abi.type=${abi}`,
    `avd.ini.displayname=${name}`,
    `hw.cpu.arch=${abi.includes("arm") ? "arm64" : "x86_64"}`,
    `hw.cpu.model=qemu64`,
    `hw.cpu.ncore=6`,
    `hw.lcd.density=${res.d}`,
    `hw.lcd.width=${res.w}`,
    `hw.lcd.height=${res.h}`,
    `hw.ramSize=4096`,
    `hw.gpu.enabled=yes`,
    `hw.gpu.mode=swiftshader_indirect`,
    `disk.dataPartition.size=8192M`,
    `skin.name=${res.w}x${res.h}`,
    `image.sysdir.1=${normalizeIniPath(
      join(androidHome, "system-images", api, sysImg, abi)
    )}/`,
    `tag.display=${sysImg}`,
    `snapshot.present=false`,
    `fastboot.chosenSnapshotFile=`,
  ].join("\n");
  writeFileSync(join(avdDir, "config.ini"), ini, "utf8");
  console.log(`✔ Created/updated AVD config for ${name} (safe defaults)`);
}

/* ────────────────────────────────────────────────
   Emulator Launcher + 포트/가속 자동 재시도
──────────────────────────────────────────────── */
async function launchEmulator(
  androidHome: string,
  avdName: string,
  javaHome: string
): Promise<number> {
  console.log(`🚀 Launching emulator (cold boot): ${avdName}...`);
  let { emulatorCmd } = getSdkTools(androidHome);

  if (!emulatorCmd) {
    console.log("ℹ️ Emulator binary not found. Installing emulator package...");
    await ensureEmulatorInstalled(androidHome, javaHome);
    ({ emulatorCmd } = getSdkTools(androidHome));
  }
  if (!emulatorCmd) throw new Error("emulator not found after installation");

  await killStaleEmulators();

  const candidatePorts = [5554, 5556, 5558];
  const baseArgs = (port: number) => [
    "-avd",
    avdName,
    "-port",
    String(port),
    "-no-snapshot",
    "-no-snapshot-save",
    "-no-boot-anim",
    "-netdelay",
    "none",
    "-netspeed",
    "full",
  ];
  const accelOn = isMac
    ? ["-feature", "HVF", "-accel", "auto", "-gpu", "host"]
    : ["-accel", "on", "-gpu", "host"];
  const accelOff = ["-accel", "off", "-gpu", "swiftshader_indirect"];

  // 조기 크래시 감지: 10초 내 종료되면 crashed 판정
  const spawnAndProbe = (args: string[]) =>
    new Promise<"alive" | "crashed">((resolve) => {
      const p = spawn(shQuote(emulatorCmd!), args, {
        stdio: "inherit",
        detached: true,
        shell: true,
        env: runtimeEnv({ androidHome, javaHome }),
      });
      let done = false;
      p.on("error", () => {
        if (!done) {
          done = true;
          resolve("crashed");
        }
      });
      p.on("exit", () => {
        if (!done) {
          done = true;
          resolve("crashed");
        }
      });
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve("alive");
        }
      }, 10_000);
    });

  for (const port of candidatePorts) {
    // 1차: 가속 ON
    console.log(`▶ trying port=${port} accel=on ...`);
    const r1 = await spawnAndProbe([...baseArgs(port), ...accelOn]);
    if (r1 === "alive" && (await waitEmulatorPortDetected(port, 20_000)))
      return port;

    await killStaleEmulators();

    // 2차: 가속 OFF
    console.log(`▶ retry port=${port} accel=off ...`);
    const r2 = await spawnAndProbe([...baseArgs(port), ...accelOff]);
    if (r2 === "alive" && (await waitEmulatorPortDetected(port, 25_000)))
      return port;

    await killStaleEmulators();
  }

  throw new Error("failed to launch emulator on any candidate port");
}

// 에뮬레이터 포트 감지: adb devices에 emulator-PORT 등장 여부
async function waitEmulatorPortDetected(
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const { adb } = getSdkTools(
    process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || DEFAULT_SDK_PATH
  );
  if (!adb) return false;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = await runAndGetStdout(shQuote(adb), ["devices"]);
      if (out.includes(`emulator-${port}`)) return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

/* ────────────────────────────────────────────────
   Vite Dev Server
──────────────────────────────────────────────── */
async function ensureViteDevServer() {
  console.log("\n🧠 Checking Vite dev server (http://localhost:5173) ...");
  const nodeMajor = getNodeMajor();
  const canFetch = typeof fetch === "function";
  if (!canFetch && nodeMajor < 18)
    console.log("ℹ️ Node 18+ 권장. 현재 환경에선 바로 실행 시도.");
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
    await sleep(7000);
  } else {
    console.log("✅ Vite dev server already running.");
  }
}

/* ────────────────────────────────────────────────
   ADB 준비/시리얼 획득
──────────────────────────────────────────────── */
async function ensureWindowsFirewallForAdb(adbPath: string) {
  if (!isWindows) return;
  const ruleNameIn = "ADB Inbound Allow";
  const ruleNameOut = "ADB Outbound Allow";
  const ps = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `if (-not (Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object { $_.Program -ieq ${psq(
      adbPath
    )} })) {`,
    `  New-NetFirewallRule -DisplayName ${psq(
      ruleNameIn
    )} -Direction Inbound -Action Allow -Program ${psq(
      adbPath
    )} -Profile Any | Out-Null`,
    `  New-NetFirewallRule -DisplayName ${psq(
      ruleNameOut
    )} -Direction Outbound -Action Allow -Program ${psq(
      adbPath
    )} -Profile Any | Out-Null`,
    `}`,
  ].join("\r\n");
  try {
    await runPSScript(ps);
  } catch {}
}

async function prepareAdbAndGetSerial(
  adbPath: string,
  androidHome: string,
  javaHome: string,
  portHint?: number
): Promise<string> {
  await ensureWindowsFirewallForAdb(adbPath);

  try {
    await run(shQuote(adbPath), ["kill-server"], {
      env: runtimeEnv({ androidHome, javaHome }),
    });
  } catch {}
  await run(shQuote(adbPath), ["start-server"], {
    env: runtimeEnv({ androidHome, javaHome }),
  });

  const deadline = Date.now() + 240_000; // 최대 4분 (콜드부트 고려)
  let lastLog = 0;
  while (Date.now() < deadline) {
    const out = await runAndGetStdout(shQuote(adbPath), ["devices"], {
      env: runtimeEnv({ androidHome, javaHome }),
    });
    const lines = out.split(/\r?\n/).map((s) => s.trim());
    const devs = lines
      .filter((l) => l && !l.toLowerCase().startsWith("list of devices"))
      .map((l) => l.split(/\s+/));

    let pick = devs.find(
      (cols) =>
        cols[0]?.startsWith(`emulator-${portHint ?? -1}`) &&
        (cols[1] === "device" || cols[1] === "offline")
    );
    if (!pick)
      pick = devs.find(
        (cols) =>
          cols[0]?.startsWith("emulator-") &&
          (cols[1] === "device" || cols[1] === "offline")
      );

    if (pick?.[0]) {
      const serial = pick[0];
      const bootDeadline = Date.now() + 240_000;
      while (Date.now() < bootDeadline) {
        try {
          const val = await runAndGetStdout(
            shQuote(adbPath),
            ["-s", serial, "shell", "getprop", "sys.boot_completed"],
            { env: runtimeEnv({ androidHome, javaHome }) }
          );
          if (val.trim() === "1") {
            await sleep(1500); // 런처 안정화
            return serial;
          }
        } catch {}
        if (Date.now() - lastLog > 5000) {
          console.log("⏳ waiting for sys.boot_completed=1 ...");
          lastLog = Date.now();
        }
        await sleep(1500);
      }
      throw new Error("timeout: sys.boot_completed never reached 1");
    }

    if (Date.now() - lastLog > 5000) {
      console.log("⏳ waiting for emulator to appear in `adb devices` ...");
      lastLog = Date.now();
    }
    await sleep(1500);
  }
  throw new Error("adb: no emulator device detected (timeout).");
}

/* ────────────────────────────────────────────────
   Main
──────────────────────────────────────────────── */
async function main() {
  console.log("\x1b[33m=== Android SDK Auto Setup ===\x1b[0m\n");
  if (isWindows) console.log(`ℹ️ Windows ${release()}`);

  // 1) 자바 확보
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

  // 3) cmdline-tools 설치
  await ensureSdk(ANDROID_HOME);

  // 4) 라이선스
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

  // 6) AVD 생성 + 에뮬레이터 기동(포트 반환)
  await createAvd(ANDROID_HOME, preset, sysImg, abi);
  const chosenPort = await launchEmulator(
    ANDROID_HOME,
    preset.name,
    JAVA_HOME_RUNTIME || process.env.JAVA_HOME || ""
  );

  console.log("\n✅ Emulator launched, waiting for ADB device...");

  // 7) ADB 디바이스 등장/부팅까지 대기 + 시리얼 획득
  const { adb } = getSdkTools(ANDROID_HOME);
  if (!adb) throw new Error("adb not found after installation.");
  const serial = await prepareAdbAndGetSerial(
    adb!,
    ANDROID_HOME,
    JAVA_HOME_RUNTIME || process.env.JAVA_HOME || "",
    chosenPort
  );
  console.log(`✔ Emulator ready: ${serial}`);

  // 8) Vite dev server
  await ensureViteDevServer();

  // 9) APK 설치/실행
  const apkPath = join(process.cwd(), "app-debug.apk");
  if (!existsSync(apkPath)) {
    console.error(`❌ APK not found at ${apkPath}`);
    process.exit(1);
  }

  console.log("📱 Installing APK...");
  await run(shQuote(adb!), ["-s", serial, "install", "-r", shQuote(apkPath)], {
    env: runtimeEnv({ androidHome: ANDROID_HOME, javaHome: JAVA_HOME_RUNTIME }),
  });

  console.log("\n🚀 Launching WebView app...");
  await run(
    shQuote(adb!),
    [
      "-s",
      serial,
      "shell",
      "am",
      "start",
      "-n",
      "com.ebview.android/.MainActivity",
    ],
    {
      env: runtimeEnv({
        androidHome: ANDROID_HOME,
        javaHome: JAVA_HOME_RUNTIME,
      }),
    }
  );

  // 10) Chrome DevTools
  console.log("\n🌐 Setting up Chrome remote debugging...");
  try {
    await run(
      shQuote(adb!),
      [
        "-s",
        serial,
        "forward",
        "tcp:9222",
        "localabstract:chrome_devtools_remote",
      ],
      {
        env: runtimeEnv({
          androidHome: ANDROID_HOME,
          javaHome: JAVA_HOME_RUNTIME,
        }),
      }
    );
    await run(
      shQuote(adb!),
      ["-s", serial, "reverse", "tcp:5173", "tcp:5173"],
      {
        env: runtimeEnv({
          androidHome: ANDROID_HOME,
          javaHome: JAVA_HOME_RUNTIME,
        }),
      }
    );

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
