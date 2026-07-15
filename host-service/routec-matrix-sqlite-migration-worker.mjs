import { parentPort, workerData } from "worker_threads";
import {
  getRouteCMatrixSQLiteMigrationDiagnosticsForTest,
  getRouteCMatrixSQLiteStorageHealth,
} from "./routec-matrix-sqlite-store.mjs";

try {
  if (
    workerData?.schema_version !==
    "routec.matrix_sqlite_boot_migration_worker.v1"
  ) {
    throw new Error("Route C Matrix SQLite boot migration worker schema mismatch");
  }
  if (typeof workerData.jsonStoragePath !== "string" || !workerData.jsonStoragePath) {
    throw new Error("Route C Matrix SQLite boot migration worker missing source path");
  }
  const health = getRouteCMatrixSQLiteStorageHealth({
    jsonStoragePath: workerData.jsonStoragePath,
    migrateIfNeeded: true,
  });
  parentPort.postMessage({
    status: "ok",
    id: workerData.id,
    reason: workerData.reason || null,
    health,
    diagnostics: getRouteCMatrixSQLiteMigrationDiagnosticsForTest(),
  });
} catch (err) {
  parentPort.postMessage({
    status: "failed",
    id: workerData?.id || null,
    reason: workerData?.reason || null,
    error: err?.message || String(err),
    stack: err?.stack || null,
  });
}
