import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

interface PluginPackageConfig {
  readonly plugins: readonly string[];
  readonly outDir?: string;
}

function parseConfigFile(configPath: string): PluginPackageConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw: unknown = JSON.parse(readFileSync(configPath, "utf-8"));
  if (Array.isArray(raw)) {
    const valid = raw.every((item): item is string => typeof item === "string");
    if (!valid) {
      throw new Error(`Invalid config: array must contain only plugin name strings`);
    }
    return { plugins: raw };
  }
  if (typeof raw === "object" && raw !== null && "plugins" in raw) {
    const plugins = (raw as Record<string, unknown>).plugins;
    if (Array.isArray(plugins) && plugins.every((p): p is string => typeof p === "string")) {
      const outDir = typeof (raw as Record<string, unknown>).outDir === "string"
        ? (raw as Record<string, unknown>).outDir as string
        : undefined;
      return { plugins, outDir };
    }
  }
  throw new Error(`Invalid config in ${configPath}: expected string[] or { plugins: string[], outDir?: string }`);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function main(): void {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c", default: "plugins.config.json" },
      out: { type: "string", short: "o" },
    },
  });

  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const configPath = resolve(repoRoot, values.config ?? "plugins.config.json");
  const config = parseConfigFile(configPath);

  if (config.plugins.length === 0) {
    console.log("No plugins specified in config file.");
    return;
  }

  const outDir = resolve(repoRoot, values.out ?? config.outDir ?? "release/plugins");
  mkdirSync(outDir, { recursive: true });

  for (const plugin of config.plugins) {
    const pluginDir = join(repoRoot, "plugins", plugin);
    if (!existsSync(join(pluginDir, "package.json"))) {
      throw new Error(`Plugin directory not found or missing package.json: ${pluginDir}`);
    }
  }

  console.log(`Building ${config.plugins.length} plugin(s): ${config.plugins.join(", ")}...`);
  const buildScript = join(repoRoot, "scripts", "build-official-plugins.mjs");
  const buildResult = spawnSync(
    process.execPath,
    ["--conditions=source", "--import", "tsx", buildScript, ...config.plugins],
    { cwd: repoRoot, stdio: "inherit" },
  );

  if (buildResult.status !== 0) {
    throw new Error(`Plugin build failed with exit code ${buildResult.status}`);
  }

  console.log(`\nPackaging plugins into ${outDir}...`);
  for (const plugin of config.plugins) {
    const pluginDir = join(repoRoot, "plugins", plugin);
    const zipPath = join(outDir, `${plugin}.zip`);

    execFileSync("rm", ["-f", zipPath]);
    execFileSync(
      "zip",
      ["-r", "-q", zipPath, ".", "-x", "node_modules/*", ".git/*", ".turbo/*", "*.map", "*.test.*"],
      { cwd: pluginDir },
    );

    const size = statSync(zipPath).size;
    console.log(`  ✓ ${plugin}.zip (${formatBytes(size)}) -> ${zipPath}`);
  }

  console.log("\nDone! Plugins are packaged and ready to distribute.");
}

main();
