import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const FULL_DISK_ACCESS_SETTINGS_URI =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

export function supportsMacFolderAccessPermissions() {
  return process.platform === "darwin";
}

export async function openFullDiskAccessSettings() {
  if (!supportsMacFolderAccessPermissions()) {
    return false;
  }
  const openBin = typeof process.env.OYSTERUN_OPEN_BIN === "string" && process.env.OYSTERUN_OPEN_BIN.trim()
    ? process.env.OYSTERUN_OPEN_BIN.trim()
    : "open";
  await execFileAsync(openBin, [FULL_DISK_ACCESS_SETTINGS_URI]);
  return true;
}
