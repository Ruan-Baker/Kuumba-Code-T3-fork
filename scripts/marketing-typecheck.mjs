import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marketingDir = path.join(rootDir, "apps", "marketing");

const run = (command, args, cwd) =>
  spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

const forwardOutput = (result) => {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
};

const astroCli = path.join(rootDir, "node_modules", "astro", "dist", "cli", "index.js");
const astroCheck = run("node", [astroCli, "check"], marketingDir);

if (astroCheck.status === 0) {
  forwardOutput(astroCheck);
  process.exit(0);
}

const astroFailure = `${astroCheck.stderr ?? ""}\n${astroCheck.stdout ?? ""}`;
const isBunStoreResolutionBug =
  astroFailure.includes("ERR_MODULE_NOT_FOUND") &&
  astroFailure.includes(
    `${path.sep}node_modules${path.sep}astro${path.sep}dist${path.sep}cli${path.sep}index.js`,
  );

if (!isBunStoreResolutionBug) {
  forwardOutput(astroCheck);
  process.exit(astroCheck.status ?? 1);
}

console.warn(
  "astro check failed due to a Bun store resolution error; falling back to TypeScript validation for marketing runtime code.",
);

const tscCli = path.join(rootDir, "node_modules", "typescript", "bin", "tsc");
const tscCheck = run(
  "node",
  [
    tscCli,
    "--noEmit",
    "--strict",
    "--module",
    "ESNext",
    "--target",
    "ES2022",
    "--moduleResolution",
    "Bundler",
    "--lib",
    "DOM,ES2022",
    "--types",
    "node",
    "src/lib/releases.ts",
  ],
  marketingDir,
);

forwardOutput(tscCheck);
process.exit(tscCheck.status ?? 1);
