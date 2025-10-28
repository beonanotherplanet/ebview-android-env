#!/usr/bin/env node
/**
 * Android AVD Auto Setup (macOS M1/M2 + Windows 10)
 * - Detects or installs SDK automatically
 * - Supports both arm64 (Apple Silicon) and x86_64 (Windows)
 * - Automatically creates and launches Galaxy device AVDs
 * - 💡 Automatically installs Gradle + generates gradlew if missing
 * - ✅ Windows 10 호환성 전면 교정
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
import { join, dirname } from "node:path";
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
// === SDK tool resolver ===
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
) {
  const isBat = isWindows && (name === "sdkmanager" || name === "avdmanager");
  const isExe = isWindows && (name === "emulator" || name === "adb");

  const file = isBat ? `${name}.bat` : isExe ? `${name}.exe` : name;

  const candidates = [
    join(androidHome, "cmdline-tools", "latest", "bin", file),
    join(androidHome, "cmdline-tools", "bin", file),
    join(androidHome, "emulator", file),
    join(androidHome, "platform-tools", file),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // 마지막 수단: 전체 SDK 경로에서 재귀 탐색
  const hit = findFileRecursive(androidHome, file, 5);
  return hit ?? null;
}

function shQuote(p: string) {
  // 안전한 경로 인자용 인용 (윈도우/맥 모두)
  if (p.includes(" ")) return `"${p}"`;
  return p;
}

// 파일 상단 유틸 섹션 근처에 추가
function psq(s: string): string {
  // PowerShell 단일따옴표 리터럴('...')로 안전 포장
  // 내부 ' → '' 로 이스케이프
  return `'${s.replace(/'/g, "''")}'`;
}

async function runPSScript(scriptContent: string, opts: any = {}) {
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

function mergedEnv(extra: Record<string, string>) {
  return { ...process.env, ...extra };
}

function run(cmd: string, args: string[] = [], opts: any = {}) {
  // shell:true + 전체 stdio 상속 (경로 공백, .bat 호출 안전)
  return new Promise<void>((res, rej) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true, ...opts });
    p.on("exit", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited with code ${code}`))
    );
  });
}

async function downloadFile(url: string, dest: string) {
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
          let downloaded = 0;
          let lastPercent = 0;

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
    } catch (_) {}
  }
  return null;
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function normalizeIniPath(p: string) {
  // AVD config.ini는 슬래시를 선호
  return p.replace(/\\/g, "/");
}

function getNodeMajor() {
  const v = process.versions.node.split(".")[0];
  return parseInt(v, 10);
}

/* ────────────────────────────────────────────────
   Java Check (자동 설치 포함, Windows 전용)
──────────────────────────────────────────────── */
async function ensureJava17OrLater() {
  let hasJava = false;
  let versionText = "";

  try {
    versionText = execSync("java -version", {
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    hasJava = true;
  } catch {
    hasJava = false;
  }

  if (hasJava) {
    const m = versionText.match(/version "(.*?)"/);
    if (m) {
      const ver = m[1];
      const major = parseInt(ver.split(".")[0], 10);
      if (Number.isFinite(major) && major >= 17) {
        console.log(`✔ Java ${ver} detected`);
        return;
      }
    }
    console.log(`⚠️ Java 감지됨 (${versionText}) 하지만 버전이 17 미만입니다.`);
  } else {
    console.log("❌ Java not found.");
  }

  // ────────────────────────────────────────────────
  // JDK 17 Temurin 자동 설치 (Adoptium 공식 배포판)
  // ────────────────────────────────────────────────
  console.log("⬇️ Installing Temurin JDK 17 (Adoptium) ...");

  const installerUrl =
    "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.13%2B11/OpenJDK17U-jdk_x64_windows_hotspot_17.0.13_11.msi";
  const installerPath = join(TMP, "temurin17.msi");

  await downloadFile(installerUrl, installerPath);

  // PowerShell을 통한 무인 설치 (조용히)
  console.log("⚙️ Running installer...");
  try {
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      `Start-Process msiexec.exe -ArgumentList '/i', '${installerPath}', '/quiet', '/norestart' -Wait`,
    ]);
  } catch (e) {
    console.error("JDK 설치 중 오류 발생:", e);
    throw new Error("JDK 17 설치 실패. 수동 설치를 시도하세요.");
  }

  console.log("✅ JDK 17 installed successfully.");

  // ────────────────────────────────────────────────
  // JAVA_HOME 및 PATH 설정 (임시 반영)
  // ────────────────────────────────────────────────
  const possibleHomes = [
    "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.13.11-hotspot",
    "C:\\Program Files\\Eclipse Adoptium\\jdk-17",
  ];

  let javaHome = null;
  for (const path of possibleHomes) {
    if (existsSync(path)) {
      javaHome = path;
      break;
    }
  }

  if (javaHome) {
    process.env.JAVA_HOME = javaHome;
    process.env.PATH = `${join(javaHome, "bin")};${process.env.PATH}`;
    console.log(`📦 JAVA_HOME set to: ${javaHome}`);
  } else {
    console.warn(
      "⚠️ JAVA_HOME 경로를 자동으로 찾지 못했습니다. 수동으로 환경 변수를 설정해주세요."
    );
  }
}

/* ────────────────────────────────────────────────
   SDK Setup
──────────────────────────────────────────────── */
async function ensureSdk(androidHome: string) {
  const toolsBase = join(androidHome, "cmdline-tools");
  const latestDir = join(toolsBase, "latest");

  // 이미 정상 설치됨
  if (
    existsSync(
      join(latestDir, "bin", isWindows ? "sdkmanager.bat" : "sdkmanager")
    )
  ) {
    console.log("✔ Command-line tools already exist.");
    return;
  }

  ensureDir(toolsBase);
  const zip = join(TMP, "cmdtools.zip");
  await downloadFile(SDK_URL, zip);

  if (isWindows) {
    await run(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "Expand-Archive",
        `-Path ${shQuote(zip)}`,
        `-DestinationPath ${shQuote(toolsBase)}`,
        "-Force",
      ],
      { windowsHide: true }
    );

    // 가능한 폴더 구조 정리:
    // 1) cmdline-tools\cmdline-tools\bin\...
    // 2) cmdline-tools\bin\...
    // 3) 기타 변종
    const inner = join(toolsBase, "cmdline-tools");
    ensureDir(latestDir);
    try {
      if (existsSync(join(inner, "bin"))) {
        // 구조 2) → inner를 latest로 승격
        renameSync(inner, latestDir);
      } else if (existsSync(join(inner, "cmdline-tools", "bin"))) {
        // 구조 1) → inner\cmdline-tools 를 latest로 승격
        renameSync(join(inner, "cmdline-tools"), latestDir);
      }
    } catch {
      /* ignore */
    }
  } else {
    await run("unzip", ["-o", zip, "-d", toolsBase]);
    try {
      const inner = join(toolsBase, "cmdline-tools");
      if (existsSync(join(inner, "bin"))) {
        renameSync(inner, latestDir);
      } else if (existsSync(join(inner, "cmdline-tools", "bin"))) {
        renameSync(join(inner, "cmdline-tools"), latestDir);
      }
    } catch {
      /* ignore */
    }
  }

  // 끝으로 존재 확인
  const sdkPath = resolveSdkTool(androidHome, "sdkmanager");
  if (!sdkPath) {
    throw new Error(
      `cmdline-tools 설치 후에도 sdkmanager를 찾지 못했습니다. (path: ${toolsBase})`
    );
  }
  console.log("✔ Installed command-line tools.");
}

/* ────────────────────────────────────────────────
   sdkmanager helpers (licenses & installs)
──────────────────────────────────────────────── */
function getSdkTools(androidHome: string) {
  const sdkm = resolveSdkTool(androidHome, "sdkmanager");
  const avdm = resolveSdkTool(androidHome, "avdmanager");
  const emulatorCmd = resolveSdkTool(androidHome, "emulator");
  const adb = resolveSdkTool(androidHome, "adb");

  if (!sdkm) throw new Error("sdkmanager not found after installation.");
  if (!avdm) throw new Error("avdmanager not found after installation.");
  if (!emulatorCmd) throw new Error("emulator not found after installation.");
  if (!adb) throw new Error("adb not found after installation.");

  return { sdkm, avdm, emulatorCmd, adb };
}

// ────────────────────────────────────────────────
// sdkmanager 라이선스 동의 (Windows 파이프/따옴표 이슈 해결판)
// ────────────────────────────────────────────────
async function acceptLicenses(
  androidHome: string,
  sdkm: string
): Promise<void> {
  console.log("📝 Accepting SDK licenses...");

  if (isWindows) {
    // PowerShell 스크립트를 라인 배열로 구성 → join으로 안전한 문자열 생성
    const psLines: string[] = [
      "$ErrorActionPreference = 'Stop'",
      `$sdk  = ${psq(sdkm)}`,
      `$root = ${psq(androidHome)}`,
      'if (!(Test-Path $sdk)) { throw "sdkmanager not found: $sdk" }',
      "try { Unblock-File -Path $sdk } catch {}",
      // 버전 출력(디버깅)
      "& $sdk --sdk_root=$root --version | Out-Host",
      // 'y' 50회 생성해서 파이프 (yes 대체)
      "$yes = @()",
      "1..50 | ForEach-Object { $yes += 'y' }",
      '$yes -join "`n" | & $sdk --sdk_root=$root --licenses | Out-Host',
    ];
    const script = psLines.join("\r\n");

    await runPSScript(script, {
      env: mergedEnv({
        ANDROID_HOME: androidHome,
        ANDROID_SDK_ROOT: androidHome,
      }),
    });
    return;
  }

  // mac/Linux 경로 (기존 유지)
  await run("bash", [
    "-lc",
    `yes | ${shQuote(sdkm)} --sdk_root=${shQuote(androidHome)} --licenses`,
  ]);
}

/* ────────────────────────────────────────────────
   System Image Installer
──────────────────────────────────────────────── */
async function installPlatformTools(androidHome: string, api: string) {
  const { sdkm } = getSdkTools(androidHome);

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
    const psInstall = (pkgs: string[]) => `
$ErrorActionPreference = 'Stop'
$sdk = "${psq(sdkm)}"
$root = "${psq(androidHome)}"
if (!(Test-Path $sdk)) { throw "sdkmanager not found: $sdk" }
try { Unblock-File -Path $sdk } catch {}
& $sdk --sdk_root=$root ${pkgs.map((p) => `"${p}"`).join(" ")} | Out-Host
`;

    // 필수 패키지
    await runPSScript(
      psInstall([
        "platform-tools",
        "emulator",
        `platforms;${api}`,
        systemImagePath,
      ]),
      {
        env: mergedEnv({
          ANDROID_HOME: androidHome,
          ANDROID_SDK_ROOT: androidHome,
        }),
      }
    );

    // 선택 패키지 (있으면 설치)
    try {
      await runPSScript(psInstall(["extras;google;gdk"]), {
        env: mergedEnv({
          ANDROID_HOME: androidHome,
          ANDROID_SDK_ROOT: androidHome,
        }),
      });
    } catch {}
    try {
      await runPSScript(
        psInstall(["extras;intel;Hardware_Accelerated_Execution_Manager"]),
        {
          env: mergedEnv({
            ANDROID_HOME: androidHome,
            ANDROID_SDK_ROOT: androidHome,
          }),
        }
      );
    } catch {}
  } else {
    // 기존 mac/linux 로직 유지
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

  if (existsSync(avdDir)) {
    console.log("✔ AVD already exists.");
  } else {
    console.log("🧩 Creating AVD (best-effort device profile)...");
    // 우선 device 프로필을 지정해보고, 실패 시 --device 제거
    let created = false;
    try {
      await run(shQuote(avdm), [
        "create",
        "avd",
        "-n",
        shQuote(name),
        "-k",
        shQuote(`system-images;${api};${sysImg};${abi}`),
        "--device",
        "pixel_5",
        "--force",
      ]);
      created = true;
    } catch {
      console.log(
        "ℹ️ Device profile 'pixel_5' not available. Retrying without --device..."
      );
      await run(shQuote(avdm), [
        "create",
        "avd",
        "-n",
        shQuote(name),
        "-k",
        shQuote(`system-images;${api};${sysImg};${abi}`),
        "--force",
      ]);
      created = true;
    }
    if (!created) throw new Error("Failed to create AVD");
  }

  // config.ini 강제 세팅(경로/해상도/램 등)
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
async function launchEmulator(androidHome: string, avdName: string) {
  console.log(`🚀 Launching emulator: ${avdName}...`);
  const { emulatorCmd } = getSdkTools(androidHome);

  if (!existsSync(emulatorCmd)) {
    throw new Error(`Emulator not found at: ${emulatorCmd}`);
  }

  const baseArgs = ["-avd", avdName, "-netdelay", "none", "-netspeed", "full"];
  const accelArgs = isMac
    ? ["-feature", "HVF", "-accel", "auto", "-gpu", "host"]
    : ["-accel", "on", "-gpu", "host"]; // Windows는 WHPX 사용(기기 지원 시)

  const proc = spawn(shQuote(emulatorCmd), [...baseArgs, ...accelArgs], {
    stdio: "inherit",
    detached: true,
    shell: true,
  });

  proc.on("error", (err) => console.error("✖ Emulator failed:", err.message));
  console.log("✔ Emulator process started. Booting may take ~30s.");
}

/* ────────────────────────────────────────────────
   Helpers: Vite dev server probing
──────────────────────────────────────────────── */
async function ensureViteDevServer() {
  console.log("\n🧠 Checking Vite dev server (http://localhost:5173) ...");
  const nodeMajor = getNodeMajor();
  const canFetch = typeof fetch === "function";
  if (!canFetch && nodeMajor < 18) {
    console.log(
      "ℹ️ Node 18+ 권장(내장 fetch 사용). 현재 환경에선 Vite 서버 자동감지 없이 바로 실행을 시도합니다."
    );
  }

  let ok = false;
  if (canFetch) {
    try {
      const res = await fetch("http://localhost:5173");
      if (res.ok) ok = true;
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
   Main Flow
──────────────────────────────────────────────── */
async function main() {
  console.log("\x1b[33m=== Android SDK Auto Detection ===\x1b[0m\n");

  if (isWindows) {
    console.log(`ℹ️ Windows ${release()}`);
  }

  // Java 필요(sdkmanager)
  ensureJava17OrLater();

  const detected = detectAndroidStudioSdk();
  const ANDROID_HOME =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    detected ||
    DEFAULT_SDK_PATH;

  ensureDir(ANDROID_HOME);
  console.log(`📦 Using Android SDK path: ${ANDROID_HOME}`);
  await ensureSdk(ANDROID_HOME);

  // sdkmanager 라이선스 동의
  const { sdkm } = getSdkTools(ANDROID_HOME);
  await acceptLicenses(ANDROID_HOME, sdkm);

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

  await ensureViteDevServer();

  const apkPath = join(process.cwd(), "app-debug.apk");
  if (!existsSync(apkPath)) {
    console.error(`❌ APK not found at ${apkPath}`);
    process.exit(1);
  }

  const { adb } = getSdkTools(ANDROID_HOME);

  console.log("📱 Installing APK...");
  await run(shQuote(adb), ["install", "-r", shQuote(apkPath)]);

  // 앱 자동 실행 (✨ 모든 ADB 호출은 절대경로 사용)
  console.log("\n🚀 Launching WebView app...");
  await run(shQuote(adb), [
    "shell",
    "am",
    "start",
    "-n",
    "com.ebview.android/.MainActivity",
  ]);

  console.log("\n🌐 Setting up Chrome remote debugging...");
  try {
    // WebView 디버거 포트 포워딩
    await run(shQuote(adb), [
      "forward",
      "tcp:9222",
      "localabstract:chrome_devtools_remote",
    ]);

    // Vite 개발 서버 reverse
    await run(shQuote(adb), ["reverse", "tcp:5173", "tcp:5173"]);

    // Chrome DevTools 열기(실패해도 계속)
    console.log("🧭 Opening Chrome debugger...");
    if (isWindows) {
      // 크롬 PATH가 없으면 실패할 수 있음 → 실패해도 무시
      try {
        spawn("cmd", ["/c", "start", "chrome", "chrome://inspect/#devices"], {
          detached: true,
          windowsHide: true,
          shell: true,
        });
      } catch {}
      console.log(
        "ℹ️ Chrome이 자동으로 안 열리면 수동으로 chrome://inspect/#devices 를 열어주세요."
      );
    } else if (isMac) {
      try {
        spawn("open", ["-a", "Google Chrome", "chrome://inspect/#devices"], {
          detached: true,
          shell: true,
        });
      } catch {}
      console.log(
        "ℹ️ 자동으로 안 열리면 수동으로 chrome://inspect/#devices 를 여세요."
      );
    }

    console.log("✅ Chrome DevTools ready. You can now inspect your WebView.");
  } catch (err: any) {
    console.error("⚠️ Failed to open Chrome DevTools:", err?.message ?? err);
    console.log(
      "ℹ️ chrome://inspect/#devices 를 수동으로 열고, ADB 포워딩이 되었는지 확인하세요."
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
