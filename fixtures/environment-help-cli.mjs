#!/usr/bin/env node

const args = process.argv.slice(2);

if (args.includes("--version") || args.includes("-V")) {
  process.stdout.write("environment-help-cli 1.0.0\n");
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`Usage: environment-help-cli [options]

Configuration:
  ${process.env.XDG_CONFIG_HOME ?? "missing"}/environment-help-cli/config.toml
`);
  process.exit(0);
}

process.stderr.write("Run with --help\n");
process.exit(2);
