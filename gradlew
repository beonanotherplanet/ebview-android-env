#!/usr/bin/env sh

set -eu

# Resolve the directory containing this script
APP_HOME=$(CDPATH= cd -- "$(dirname "$0")" && pwd -P)
CLASSPATH="$APP_HOME/android/gradle/wrapper/gradle-wrapper.jar"

if [ ! -f "$CLASSPATH" ]; then
  CLASSPATH="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
fi

if [ ! -f "$CLASSPATH" ]; then
  if command -v gradle >/dev/null 2>&1; then
    exec gradle "$@"
  fi
  echo "Gradle wrapper JAR not found and no 'gradle' command available." >&2
  exit 1
fi

JAVA_CMD="java"
if [ -n "${JAVA_HOME-}" ]; then
  JAVA_CMD="$JAVA_HOME/bin/java"
fi

exec "$JAVA_CMD" -classpath "$CLASSPATH" org.gradle.wrapper.GradleWrapperMain "$@"
