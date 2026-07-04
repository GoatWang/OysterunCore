#!/usr/bin/env node

import {
  describeAgentConfigState,
  discoverAgentFoldersForMigration,
  discoverHostConfigDirs,
  runAgentConfigMigration,
  shouldMigrateAgentFolderState,
} from "./agent-config-migration.mjs";

function printUsage() {
  console.log("Usage: node host-service/migrate-agent-config-layout.mjs [--apply] [--json]");
  console.log("");
  console.log("Defaults to dry-run summary. Pass --apply to perform the one-time migration.");
}

const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  printUsage();
  process.exit(0);
}

const shouldApply = args.has("--apply");
const jsonOutput = args.has("--json");

if (!shouldApply) {
  const preview = "Dry run only. Re-run with --apply to migrate flat agent config files.";
  const hostConfigDirs = discoverHostConfigDirs();
  const discoveredFolders = discoverAgentFoldersForMigration();
  const candidateFolders = discoveredFolders
    .map((folderPath) => describeAgentConfigState(folderPath))
    .filter((entry) => shouldMigrateAgentFolderState(entry));
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({
      status: "dry_run",
      message: preview,
      hostConfigDirs,
      discoveredFolders,
      candidateFolders,
    }, null, 2)}\n`);
  } else {
    console.log(preview);
    console.log(`Discovered host config dirs: ${hostConfigDirs.length}`);
    console.log(`Discovered agent folders: ${discoveredFolders.length}`);
    console.log(`Migration candidates: ${candidateFolders.length}`);
    for (const entry of candidateFolders) {
      console.log(`- ${entry.folderPath}`);
    }
  }
  process.exit(0);
}

const result = runAgentConfigMigration();
if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  console.log(`Discovered host config dirs: ${result.hostConfigDirs.length}`);
  console.log(`Discovered agent folders: ${result.discoveredFolders.length}`);
  console.log(`Migrated folders: ${result.migratedFolders.length}`);
  for (const entry of result.migratedFolders) {
    console.log(`- ${entry.folderPath}`);
  }
}
