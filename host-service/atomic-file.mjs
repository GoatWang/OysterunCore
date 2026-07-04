import { renameSync, rmSync, writeFileSync } from "fs";

let atomicWriteCounter = 0;

function nextAtomicTempPath(targetPath) {
  atomicWriteCounter += 1;
  return `${targetPath}.tmp-${process.pid}-${Date.now()}-${atomicWriteCounter}`;
}

export function writeAtomicTextFile(targetPath, contents, options = "utf8") {
  const tempPath = nextAtomicTempPath(targetPath);
  try {
    writeFileSync(tempPath, contents, options);
    renameSync(tempPath, targetPath);
  } catch (err) {
    rmSync(tempPath, { force: true });
    throw err;
  }
}

export function writeAtomicJsonFile(targetPath, value, options = {}) {
  const { space = 2, encoding = "utf8" } = options;
  writeAtomicTextFile(targetPath, `${JSON.stringify(value, null, space)}\n`, {
    encoding,
  });
}

