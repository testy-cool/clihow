#!/usr/bin/env node

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("0.83.0");
  process.exit(0);
}
if (args.includes("--list-models")) {
  console.log("provider      model           thinking");
  console.log("openai-codex gpt-5.6-luna  yes");
  process.exit(0);
}
process.exit(2);
