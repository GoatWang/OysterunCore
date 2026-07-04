import { execSync } from "child_process";

export function detectProviderCommand(commandName) {
  const attempts = [
    `command -v ${commandName}`,
    `which ${commandName}`,
  ];
  for (const command of attempts) {
    try {
      const resolved = execSync(command, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (resolved) {
        return resolved;
      }
    } catch {
      // Try the next detection path.
    }
  }
  return null;
}

export function detectProviderCommands() {
  return {
    claude_command: detectProviderCommand("claude"),
    codex_command: detectProviderCommand("codex"),
  };
}
