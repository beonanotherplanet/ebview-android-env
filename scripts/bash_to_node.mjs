#!/usr/bin/env node
/**
 * Android Emulator Auto Setup (Windows용 Node.js 버전)
 * - OpenJDK 17 자동 설치
 * - Android SDK cmdline-tools 자동 다운로드
 * - AVD 생성 및 실행
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import os from "node:os";

import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";



import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// 기존 SDKMANAGER 상수를 그대로 사용한다고 가정
//  ex) const SDKMANAGER = path.join(SDK_ROOT, "cmdline-tools/latest/bin/sdkmanager.bat");

function spawnSdkmanagerWithYes(args: string[]) {
  const isWin = process.platform === "win32";

  // 1) 실행 파일 경로 결정 (+ Windows 경로 정상화)
  const toolPath = isWin
    ? path.win32.normalize(SDKMANAGER)                  // sdkmanager.bat
    : SDKMANAGER.replace(/\.bat$/i, "");               // 리눅스/맥: 확장자 없는 실행파일

  if (!fs.existsSync(toolPath)) {
    throw new Error(`sdkmanager 실행 파일을 찾지 못했습니다: ${toolPath}`);
  }

  if (isWin) {
    // 2A) Windows: cmd.exe에서 실행 + 호출 단위로 JAVA_HOME 비우기(검사 우회)
    //     공백 경로/인자 안전: /d /s /c + 따옴표
    const cmdline = `set "JAVA_HOME=" & "${toolPath}" ${args.join(" ")}`;
    const child = spawn("cmd.exe", ["/d", "/s", "/c", cmdline], {
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
      windowsHide: true,            // 검은 콘솔창 숨김
      env: { ...process.env },      // (원하면 PATH 앞에 JDK bin 주입 가능)
    });
    child.stdin.write("y\n".repeat(100));
    child.stdin.end();
    return new Promise<void>((resolve, reject) => {
      child.on("exit", c => c === 0 ? resolve() : reject(new Error(`sdkmanager exited ${c}`)));
      child.on("error", reject);
    });
  } else {
    // 2B) macOS/Linux: 직접 실행
    const child = spawn(toolPath, args, {
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
    });
    child.stdin.write("y\n".repeat(100));
    child.stdin.end();
    return new Promise<void>((resolve, reject) => {
      child.on("exit", c => c === 0 ? resolve() : reject(new Error(`sdkmanager exited ${c}`)));
      child.on("error", reject);
    });
  }
}



// SDKMANAGER: 기존 변수 그대로 사용 (…\cmdline-tools\latest\bin\sdkmanager.bat)
function runSdkmanager(args: string[]) {
  const cmdline = `set "JAVA_HOME=" & "${SDKMANAGER}" ${args.join(" ")}`;
  // cmd.exe 세션에서 JAVA_HOME을 '그 호출에 한해서' 비워 실행
  execSync(`cmd.exe /d /s /c ${cmdline}`, {
    stdio: "inherit",
    env: {
      ...process.env,
      // PATH에 우리가 쓸 JDK bin을 앞에 두면 더 안전 (있다면)
      ...(process.env.JAVA_HOME ? { PATH: `${path.join(process.env.JAVA_HOME, "bin")};${process.env.PATH || ""}` } : {}),
    },
  });
}

function spawnSdkmanagerWithYes(args: string[]) {
  const cmdline = `set "JAVA_HOME=" & "${SDKMANAGER}" ${args.join(" ")}`;
  const child = spawn("cmd.exe", ["/d", "/s", "/c", cmdline], {
    stdio: ["pipe", "inherit", "inherit"],
    env: {
      ...process.env,
      ...(process.env.JAVA_HOME ? { PATH: `${path.join(process.env.JAVA_HOME, "bin")};${process.env.PATH || ""}` } : {}),
    },
    windowsHide: true,
    shell: false,
  });
  child.stdin.write("y\n".repeat(100));
  child.stdin.end();
  return new Promise<void>((resolve, reject) => {
    child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`sdkmanager exited ${c}`))));
    child.on("error", reject);
  });
}



function sanitizeJavaHomeForWin(raw?: string) {
  if (!raw) return undefined;
  let v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  // /c/... → C:\...  (Git Bash/MSYS 경로 교정)
  if (/^\/[a-zA-Z]\//.test(v)) {
    v = v.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, "\\");
  }
  // C:/... → C:\...
  if (/^[a-zA-Z]:\//.test(v)) v = v.replace(/\//g, "\\");
  return v.replace(/[\\\s]+$/, "");
}

function buildSdkEnv() {
  const env = { ...process.env };
  if (process.platform === "win32") {
    const fixed = sanitizeJavaHomeForWin(env.JAVA_HOME);
    if (fixed) {
      env.JAVA_HOME = fixed;
      env.PATH = `${path.join(fixed, "bin")};${env.PATH || ""}`;
    } else {
      // 깨진 JAVA_HOME이 있으면 오히려 제거해 sdkmanager가 PATH의 java를 보게 한다.
      delete env.JAVA_HOME;
    }
  }
  return env;
}

function runSdkmanager(args: string[]) {
  const cmd = process.platform === "win32" ? SDKMANAGER : SDKMANAGER.replace(/\.bat$/, "");
  return execSync(`"${cmd}" ${args.join(" ")}`, {
    shell: true,
    stdio: "inherit",
    env: buildSdkEnv(),
  });
}

// 파이프 대신 stdin으로 'y'를 주입해야 할 때(licenses용)
function spawnSdkmanagerWithYes(args: string[]) {
  const cmd = process.platform === "win32" ? SDKMANAGER : SDKMANAGER.replace(/\.bat$/, "");
  const child = spawn(`"${cmd}"`, args, {
    shell: true,
    stdio: ["pipe", "inherit", "inherit"],
    env: buildSdkEnv(),
  });
  child.stdin.write("y\n".repeat(100));
  child.stdin.end();
  return new Promise<void>((resolve, reject) => {
    child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`sdkmanager exited ${c}`))));
    child.on("error", reject);
  });
}





/** 콘솔 팝업 없이 조용히 실행 (stdout/stderr 숨김) */
function runSilent(cmd: string, args: string[] = []) {
  const r = spawnSync(cmd, args, {
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (r.status && r.status !== 0) {
    throw new Error(`${cmd} exited ${r.status}`);
  }
}

/** 조용히 출력만 받아오기 (콘솔에 안 찍힘) */
function outSilent(cmd: string, args: string[] = []) {
  const r = execFileSync(cmd, args, { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  return r.toString().trim();
}

function pickEmulatorSerial(ADB_BIN: string) {
  const lines = outSilent(ADB_BIN, ["devices"])
    .split(/\r?\n/)
    .slice(1)
    .map(l => l.trim().split(/\s+/))
    .filter(([id, st]) => id && id.startsWith("emulator-") && st === "device");
  if (lines.length === 0) throw new Error("실행 중인 에뮬레이터를 찾지 못했습니다.");
  return lines[0][0];
}

function installApkQuiet(ADB_BIN: string, serial: string, apkPath: string) {
  const apk = path.resolve(apkPath);
  if (!fs.existsSync(apk)) throw new Error(`APK 파일을 찾을 수 없습니다: ${apk}`);

  runSilent(ADB_BIN, ["-s", serial, "install", "-r", "-g", apk]);
}


function listUserPackages(ADB_BIN: string, serial: string): Set<string> {
  const raw = outSilent(ADB_BIN, ["-s", serial, "shell", "pm", "list", "packages", "-3"]);
  const set = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^package:([a-zA-Z0-9._]+)/);
    if (m) set.add(m[1]);
  }
  return set;
}

function findAapt(SDK_ROOT?: string) {
  const candidates: string[] = [];
  if (SDK_ROOT) {
    const bt = path.join(SDK_ROOT, "build-tools");
    if (fs.existsSync(bt)) {
      for (const v of fs.readdirSync(bt)) {
        const p = path.join(bt, v, process.platform === "win32" ? "aapt.exe" : "aapt");
        if (fs.existsSync(p)) candidates.push(p);
      }
    }
  }
  // 최신 버전 우선
  return candidates.sort().reverse()[0];
}

function extractPkgWithAapt(aaptPath: string, apkPath: string): string | undefined {
  try {
    const txt = outSilent(aaptPath, ["dump", "badging", apkPath]);
    const m = txt.match(/package: name='([^']+)'/);
    return m?.[1];
  } catch { return undefined; }
}

function launchApp(ADB_BIN: string, serial: string, pkg: string) {
  // 런처 인텐트로 실행 (조용히 실행)
  runSilent(ADB_BIN, ["-s", serial, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
}

/** 설치→패키지 감지→실행 전체 */
function installAndLaunchQuiet(ADB_BIN: string, SDK_ROOT: string | undefined, serial: string, apkPath: string) {
  // 설치 전/후 비교로 신규 패키지 추적
  const before = listUserPackages(ADB_BIN, serial);
  installApkQuiet(ADB_BIN, serial, apkPath);
  const after = listUserPackages(ADB_BIN, serial);

  let newly: string[] = [...after].filter(p => !before.has(p));

  // 재설치라면 diff가 없을 수 있으니 aapt로 보조 추출
  if (newly.length === 0) {
    const aapt = findAapt(SDK_ROOT);
    if (aapt) {
      const pkg = extractPkgWithAapt(aapt, path.resolve(apkPath));
      if (pkg) newly = [pkg];
    }
  }

  if (newly.length > 0) {
    launchApp(ADB_BIN, serial, newly[0]);
  } else {
    // 패키지명을 못 찾았을 때는 조용히 넘어가거나, 필요하다면 하드코딩 패키지로 실행
    // launchApp(ADB_BIN, serial, "com.your.app"); // 필요 시 해제
  }
}



// 실행 중인 첫 번째 에뮬레이터 시리얼 찾기 (emulator-5554 등)
function pickEmulatorSerial() {
  const out = execSync(`"${ADB_BIN}" devices`, { stdio: ["ignore","pipe","ignore"] })
    .toString()
    .split(/\r?\n/)
    .slice(1)
    .map(l => l.trim().split(/\s+/))
    .filter(([id, st]) => id && id.startsWith("emulator-") && st === "device");
  if (out.length === 0) throw new Error("실행 중인 에뮬레이터를 찾지 못했습니다 (adb devices 결과 비어있음).");
  return out[0][0];
}

// APK 설치 (재설치 -r, 권한 자동 승인 -g, 필요시 다운그레이드 -d 옵션 추가 가능)
function installApkOn(serial: string, apkPath: string) {
  const apk = path.resolve(apkPath);
  if (!fs.existsSync(apk)) throw new Error(`APK 파일을 찾을 수 없습니다: ${apk}`);
  info(`APK 설치 중: ${apk} → ${serial}`);
  execSync(`"${ADB_BIN}" -s ${serial} install -r -g "${apk}"`, { stdio: "inherit" });
  success("APK 설치 완료");
}




function ensurePlatformToolsAndAdb() {
  // SDK_ROOT/ADB_BIN 로그로 먼저 확인
  info(`SDK_ROOT = ${SDK_ROOT}`);
  info(`ADB_BIN  = ${ADB_BIN}`);

  // 1) platform-tools 설치 (없으면)
  if (!fs.existsSync(ADB_BIN)) {
    warn("adb.exe가 없습니다. platform-tools를 설치합니다.");
    // 사내망 환경이면 --no_https 유지
    run(`"${SDKMANAGER}" --no_https "platform-tools"`);
  }

  // 2) 설치 후에도 없으면 SDK 경로 문제
  if (!fs.existsSync(ADB_BIN)) {
    throw new Error(
      `adb.exe를 찾지 못했습니다.\n` +
      `- 예상 경로: ${ADB_BIN}\n` +
      `- SDK_ROOT가 올바른지 확인하세요. (LOCALAPPDATA=${process.env.LOCALAPPDATA})`
    );
  }

  // 3) adb 서버 기동 (직접 실행; shell:false 권장)
  const child = spawn(ADB_BIN, ["start-server"], { shell: false, stdio: "inherit" });
  child.on("exit", (code) => {
    if (code !== 0) error(`adb start-server 종료코드: ${code}`);
  });
}



function waitForBoot() {
  // 디바이스 감지
  run(`"${ADB_BIN}" wait-for-device`);
  // 부팅 완료 플래그 대기
  let tries = 60;
  while (tries-- > 0) {
    try {
      const out = execSync(`"${ADB_BIN}" shell getprop sys.boot_completed`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
      if (out === "1") return;
    } catch {}
    execSync('powershell -Command "Start-Sleep -Seconds 1"');
  }
  throw new Error("에뮬레이터 부팅 완료 신호(sys.boot_completed) 대기 시간 초과");
}

function startEmulator(avdName) {
  ensureAdb();

  info(`${avdName} 에뮬레이터 실행 중...`);

  // 디버깅 쉽게: verbose, 스냅샷 비활성화, 가속 확인
  const args = [
    "-avd", avdName,
    "-verbose",
    "-no-snapshot",
    "-accel", "on",          // WHPX/Hyper-V 상태를 명확히 로그로 보여줌
    "-gpu", "auto",          // 먼저 auto로 시도 (문제 있으면 "off"로 다시)
    "-netdelay", "none",
    "-netspeed", "full",
  ];

  // 중요: shell:false + 인자에 쌍따옴표 넣지 말기
  const child = spawn(EMULATOR_BIN, args, {
    shell: false,
    stdio: "inherit",        // 출력이 "현재 터미널"에 그대로 찍힘 → 팝업 안 뜸
  });

  child.on("exit", (code) => {
    if (code !== 0) {
      error(`emulator 종료 코드: ${code}`);
    }
  });

  // 여기서 부팅 완료까지 대기 (에러면 throw)
  try {
    waitForBoot();
    success("에뮬레이터 부팅 완료!");
  } catch (e) {
    error(String(e.message || e));
    throw e;
  }
}



function waitForFile(filePath, { timeoutMs = 30000, intervalMs = 200 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const iv = setInterval(() => {
      if (fs.existsSync(filePath)) {
        clearInterval(iv);
        return resolve(true);
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(iv);
        return reject(new Error(`Timeout waiting for: ${filePath}`));
      }
    }, intervalMs);
  });
}

function createAVD(avdName, img, deviceKey /* "note20" | "s22" | "note10" */) {
  const avdList = execSync(`"${EMULATOR_BIN}" -list-avds`).toString();
  const avdDir = path.join(os.homedir(), ".android", "avd", `${avdName}.avd`);
  const configIni = path.join(avdDir, "config.ini");

  if (!avdList.includes(avdName)) {
    info(`AVD 생성 중... (${avdName})`);
    // avdmanager가 "Do you wish to create a custom hardware profile [no]" 물어보는 걸 대비해서 'no'를 넣는다.
    const child = spawn(`"${AVDMANAGER}"`, [
      "create", "avd",
      "-n", avdName,
      "-k", img,
      "--device", "pixel",
      // 필요시: "--force"  // 동일 이름이 있을 때 덮어쓰고 싶으면 주석 해제
    ], {
      shell: true,
      stdio: ["pipe", "inherit", "inherit"],
      env: process.env,
    });
    child.stdin.write("no\n");
    child.stdin.end();

    // 동기화: 생성 완료/실패 확인
    const exitCode = execSyncWait(child);
    if (exitCode !== 0) {
      throw new Error(`avdmanager create avd failed with code ${exitCode}`);
    }
    success(`${avdName} AVD 생성 명령 완료. 파일 생성 대기...`);
  } else {
    info(`이미 ${avdName} AVD가 존재합니다. 설정만 업데이트합니다.`);
  }

  // 여기서 실제 파일이 생길 때까지 기다림
  return waitForFile(configIni, { timeoutMs: 30000 })
    .then(() => {
      // 내장 프로필을 병합 적용
      const profileIni = PROFILES[deviceKey];
      if (profileIni) {
        const current = fs.readFileSync(configIni, "utf-8");
        const merged = mergeIni(current, profileIni);
        fs.writeFileSync(configIni, merged, "utf-8");
        success(`하드웨어 프로필 적용 완료: ${avdName}`);
      } else {
        warn(`'${deviceKey}' 프로필이 없어 config.ini를 수정하지 않았습니다.`);
      }
    })
    .catch((e) => {
      // 아직 폴더 자체가 없다면 생성 자체가 실패했을 가능성이 큼 → 원인 로그
      throw new Error(
        `config.ini를 찾을 수 없습니다: ${configIni}\n` +
        `- 시스템 이미지가 설치되었는지 확인: ${img}\n` +
        `- ANDROID SDK 권한/경로, 사용자 홈 디렉터리 접근 권한 확인\n` +
        `원본 에러: ${e.message}`
      );
    });
}

// child process 종료 코드를 동기처럼 기다리기
function execSyncWait(child) {
  return require("deasync").loopWhile(() => {
    let done = false;
    child.on("exit", (code) => { child._exitCode = code; done = true; });
    child.on("error", () => { done = true; });
    return !done;
  }) || child._exitCode || 0;
}



// ---------- config.ini 병합 유틸 ----------
function parseIni(text: string) {
  const map = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    map.set(k, v);
  }
  return map;
}

function serializeIni(map: Map<string, string>) {
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

function mergeIni(baseText: string, patchText: string) {
  const base = parseIni(baseText);
  const patch = parseIni(patchText);
  for (const [k, v] of patch.entries()) base.set(k, v); // 업서트
  return serializeIni(base);
}

// ---------- AVD 생성 ----------
function createAVD(avdName: string, img: string, deviceKey: "note20"|"s22"|"note10") {
  const avdList = execSync(`"${EMULATOR_BIN}" -list-avds`).toString();
  if (avdList.includes(avdName)) {
    info(`이미 ${avdName} AVD가 존재합니다.`);
  } else {
    info(`AVD 생성 중... (${avdName})`);
    run(`"${AVDMANAGER}" create avd -n "${avdName}" -k "${img}" --device "pixel"`);
    success(`${avdName} AVD 생성 완료.`);
  }

  // config.ini 경로
  const avdConfigPath = path.join(os.homedir(), ".android", "avd", `${avdName}.avd`, "config.ini");
  if (!fs.existsSync(avdConfigPath)) {
    throw new Error(`config.ini를 찾을 수 없습니다: ${avdConfigPath}`);
  }

  // 내장 프로필 적용
  const profileIni = PROFILES[deviceKey];
  if (!profileIni) {
    warn(`'${deviceKey}' 프로필이 없어 config.ini를 수정하지 않았습니다.`);
    return;
  }

  const current = fs.readFileSync(avdConfigPath, "utf-8");
  const merged = mergeIni(current, profileIni);
  fs.writeFileSync(avdConfigPath, merged, "utf-8");
  success(`하드웨어 프로필 적용 완료: ${avdName}`);
}



// ---------- 터미널 색상 ----------
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function info(msg) {
  console.log(`ℹ️  ${colors.bold}${colors.blue}[INFO]${colors.reset}  ${msg}`);
}
function warn(msg) {
  console.log(
    `⚠️  ${colors.bold}${colors.yellow}[WARN]${colors.reset}  ${msg}`
  );
}
function error(msg) {
  console.log(`❌ ${colors.bold}${colors.red}[ERROR]${colors.reset} ${msg}`);
}
function success(msg) {
  console.log(`✅ ${colors.bold}${colors.green}[OK]${colors.reset}  ${msg}`);
}

// ---------- 환경 변수 ----------
const homeDir = os.homedir();
const localAppData = process.env.LOCALAPPDATA?.replace(/\\/g, "/");
const SDK_ROOT = path.join(localAppData, "Android", "Sdk");
const CMDLINE_URL =
  "https://dl.google.com/android/repository/commandlinetools-win-9477386_latest.zip";

const SDKMANAGER = path.join(
  SDK_ROOT,
  "cmdline-tools/latest/bin/sdkmanager.bat"
);
const AVDMANAGER = path.join(
  SDK_ROOT,
  "cmdline-tools/latest/bin/avdmanager.bat"
);
const EMULATOR_BIN = path.join(SDK_ROOT, "emulator/emulator.exe");
const ADB_BIN = path.join(SDK_ROOT, "platform-tools/adb.exe");

// ---------- execSync helper ----------
function run(cmd, opts = {}) {
  try {
    execSync(cmd, { stdio: "inherit", ...opts });
  } catch (err) {
    error(`명령 실행 실패: ${cmd}`);
    throw err;
  }
}

import path from "node:path";
import fs from "node:fs";

function toWindowsAbs(javaHomeRaw?: string) {
  if (!javaHomeRaw) return undefined;
  let v = javaHomeRaw.trim();

  // 값에 들어간 따옴표 제거
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }

  // MSYS/Git Bash 경로 (/c/...) → C:\... 로 변환
  if (/^\/[a-zA-Z]\//.test(v)) {
    // /c/Program Files/Java/jdk-17 → C:\Program Files\Java\jdk-17
    v = v.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, "\\");
  }

  // C:/ 형식 → C:\ 로
  if (/^[a-zA-Z]:\//.test(v)) {
    v = v.replace(/\//g, "\\");
  }

  // 끝 역슬래시/공백 제거
  v = v.replace(/[\\\s]+$/, "");

  // 최종 확인: %JAVA_HOME%\bin\java.exe가 있어야 함
  const javaExe = path.join(v, "bin", "java.exe");
  if (!fs.existsSync(javaExe)) return undefined;

  return v;
}

function ensureWindowsJavaEnv(envIn: NodeJS.ProcessEnv = process.env) {
  const env = { ...envIn };
  const fixed = toWindowsAbs(env.JAVA_HOME);
  if (fixed) {
    env.JAVA_HOME = fixed;
  } else {
    // JAVA_HOME이 POSIX 스타일이었거나 깨져 있으면 지우고 PATH의 java를 쓰게 하거나,
    // 너가 설치한 JDK 경로로 교체 (예: C:\Users\you\AndroidEnv\jdk-17.*)
    delete env.JAVA_HOME;
  }
  if (env.JAVA_HOME) {
    env.PATH = `${path.join(env.JAVA_HOME, "bin")};${env.PATH || ""}`;
  }
  return env;
}



function ensureJavaEnv(baseEnv: NodeJS.ProcessEnv = process.env) {
  const env = { ...baseEnv };

  // sanitize JAVA_HOME
  let jh = (env.JAVA_HOME || "").trim();
  if ((jh.startsWith('"') && jh.endsWith('"')) || (jh.startsWith("'") && jh.endsWith("'"))) {
    jh = jh.slice(1, -1);
  }
  const javaExe = path.join(jh || "", "bin", process.platform === "win32" ? "java.exe" : "java");
  const hasValidJH = jh && fs.existsSync(javaExe);

  if (!hasValidJH) {
    // JAVA_HOME이 비었거나 잘못됐으면 지워서 sdkmanager가 PATH의 java를 보게 하거나,
    // 우리가 설치한 JDK(ensureJDK에서 설치)로 교체.
    if (jh) delete env.JAVA_HOME;

    // 우리가 설치한 경로 추정(ensureJDK가 설치한 위치)
    const candidate = path.join(os.homedir(), "AndroidEnv");
    if (fs.existsSync(candidate)) {
      const dir = fs.readdirSync(candidate).find(d => d.toLowerCase().startsWith("jdk-"));
      if (dir) {
        const jdkDir = path.join(candidate, dir);
        const jdkJava = path.join(jdkDir, "bin", process.platform === "win32" ? "java.exe" : "java");
        if (fs.existsSync(jdkJava)) {
          env.JAVA_HOME = jdkDir;
        }
      }
    }
  }

  // 최종적으로 JAVA_HOME이 있다면 PATH 앞에 bin 추가
  if (env.JAVA_HOME) {
    const sep = process.platform === "win32" ? ";" : ":";
    env.PATH = `${path.join(env.JAVA_HOME, "bin")}${sep}${env.PATH || ""}`;
  }

  return env;
}


// ---------- JDK 설치 ----------
function ensureJDK() {
  try {
    execSync("java -version", { stdio: "ignore" });
    info("JDK가 이미 설치되어 있습니다.");
    return;
  } catch {}

  info("JDK 17을 설치합니다...");
  const baseDir = path.join(homeDir, "AndroidEnv");
  const zipPath = path.join(baseDir, "jdk.zip");
  fs.mkdirSync(baseDir, { recursive: true });

  const url =
    "https://aka.ms/download-jdk/microsoft-jdk-17.0.11-windows-x64.zip";
  run(`curl -L "${url}" -o "${zipPath}"`);
  run(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${baseDir}'"`
  );
  fs.rmSync(zipPath, { force: true });

  const extracted = fs.readdirSync(baseDir).find((d) => d.startsWith("jdk-17"));
  const jdkDir = path.join(baseDir, extracted);
  process.env.JAVA_HOME = jdkDir;
  process.env.PATH = `${path.join(jdkDir, "bin")};${process.env.PATH}`;

  success(`JDK 설치 완료: ${jdkDir}`);
}

// ---------- SDK 설치 ----------
function ensureSDK() {
  if (fs.existsSync(SDKMANAGER)) {
    info("Android SDK가 이미 설치되어 있습니다.");
    return;
  }
  info("Android SDK commandline-tools 설치 중...");

  fs.mkdirSync(path.join(SDK_ROOT, "cmdline-tools"), { recursive: true });
  const zipPath = path.join(SDK_ROOT, "cmdline-tools.zip");

  run(`curl -L -o "${zipPath}" "${CMDLINE_URL}"`);
  run(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${SDK_ROOT}/cmdline-tools'"`
  );
  fs.rmSync(zipPath, { force: true });

  const extractedDir = path.join(SDK_ROOT, "cmdline-tools", "cmdline-tools");
  const latestDir = path.join(SDK_ROOT, "cmdline-tools", "latest");
  if (fs.existsSync(extractedDir)) {
    fs.renameSync(extractedDir, latestDir);
  }

  success("Android SDK 설치 완료.");
}

// ---------- SDK 컴포넌트 ----------

function spawnWithYes(args: string[]) {
  const child = spawn(`"${SDKMANAGER}"`, args, {
    shell: true,
    stdio: ["pipe", "inherit", "inherit"],
    env: ensureJavaEnv(),
  });
  // 충분한 횟수로 'y' 입력
  child.stdin.write("y\n".repeat(100));
  child.stdin.end();
  return new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`sdkmanager exited ${code}`))));
    child.on("error", reject);
  });
}

async function installComponents() {
  info("SDK 컴포넌트 설치 중...");
  // 라이선스 동의
  await spawnWithYes([`--sdk_root="${SDK_ROOT}"`, "--licenses"]);
  // 컴포넌트 설치 (HTTPS 차단 환경이면 --no_https 유지)
  run(`"${SDKMANAGER}" --no_https "platform-tools" "emulator"`);
}


function installComponents() {
  info("SDK 컴포넌트 설치 중...");
  run(`echo y | "${SDKMANAGER}" --sdk_root="${SDK_ROOT}" --licenses`);
  run(`"${SDKMANAGER}" --no_https "platform-tools" "emulator"`);
}

// ---------- 기기 선택 ----------
async function selectDevice() {
  console.log();
  const { choice } = await inquirer.prompt([
    {
      type: "list",
      name: "choice",
      message: "어떤 기종을 선택하시겠습니까?",
      choices: [
        {
          name: "📱  Galaxy Note 20 (Android 12, API 31)",
          value: "note20",
        },
        {
          name: "📱  Galaxy S22 (Android 12, API 31)",
          value: "s22",
        },
        {
          name: "📱  Galaxy Note 10 (Android 12, API 31)",
          value: "note10",
        },
      ],
      default: "note20",
    },
  ]);

  switch (choice) {
    case "s22":
      return {
        device: "s22",
        img: "system-images;android-31;google_apis_playstore;x86_64",
        avdName: "S22",
      };
    case "note10":
      return {
        device: "note10",
        img: "system-images;android-31;google_apis_playstore;x86_64",
        avdName: "Note10",
      };
    default:
      return {
        device: "note20",
        img: "system-images;android-31;google_apis_playstore;x86_64",
        avdName: "Note20",
      };
  }
}

// ---------- AVD 생성 ----------
function createAVD(avdName, img, profilePath) {
  if (!fs.existsSync(profilePath)) {
    error(`Profile 파일을 찾을 수 없습니다: ${profilePath}`);
    process.exit(1);
  }

  const avdList = execSync(`"${EMULATOR_BIN}" -list-avds`).toString();
  if (avdList.includes(avdName)) {
    info(`이미 ${avdName} AVD가 존재합니다.`);
    return;
  }

  info(`AVD 생성 중... (${avdName})`);
  run(
    `"${AVDMANAGER}" create avd -n "${avdName}" -k "${img}" --device "pixel"`
  );

  const avdConfigPath = path.join(
    homeDir,
    ".android/avd",
    `${avdName}.avd`,
    "config.ini"
  );

  const profileData = fs.readFileSync(profilePath, "utf-8");
  fs.appendFileSync(avdConfigPath, `\n${profileData}`);
  success(`${avdName} AVD 생성 완료.`);
}

// ---------- 에뮬레이터 실행 ----------
function startEmulator(avdName) {
  info(`${avdName} 에뮬레이터 실행 중...`);
  const child = spawn(
    `"${EMULATOR_BIN}"`,
    [
      "-avd",
      avdName,
      "-gpu",
      "off",
      "-no-metrics",
      "-netdelay",
      "none",
      "-netspeed",
      "full",
    ],
    { shell: true, detached: true }
  );
  child.unref();
  success("에뮬레이터가 실행되었습니다.");
}

// ---------- 메인 ----------
(async () => {
  console.log("\n=== Android Emulator Auto Setup (Node.js) ===\n");

  ensureJDK();
  ensureSDK();
  installComponents();

  const { device, img, avdName } = await selectDevice();
  const scriptDir = path.dirname(new URL(import.meta.url).pathname);
  const profilePath = path.join(
    scriptDir,
    "emulator",
    "hardware_profiles",
    `${device}.ini`
  );

  run(`"${SDKMANAGER}" --no_https "${img}"`);
  createAVD(avdName, img, profilePath);
  startEmulator(avdName);
})();
