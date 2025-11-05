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
