#!/usr/bin/env node

import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const command = args[0];

const rootHelp = `Usage: demo-cli <command> [options]

Commands:
  greet <name>  Greet one person
  add           Add two integers
  status        Show demo status

Options:
  -h, --help    Show help
  -V, --version Show version
`;

const helpByCommand = {
  greet: `Usage: demo-cli greet <name> [options]

Arguments:
  name          Person to greet

Options:
  --loud        Uppercase the greeting
  -h, --help    Show help
`,
  add: `Usage: demo-cli add --left <integer> --right <integer> [options]

Options:
  --left <integer>   Left operand
  --right <integer>  Right operand
  --json             Emit JSON
  -h, --help         Show help
`,
  status: `Usage: demo-cli status [options]

Options:
  --json         Emit JSON
  -h, --help     Show help
`,
};

if (args.includes("--version") || args.includes("-V")) {
  console.log("demo-cli 1.0.0");
  process.exit(0);
}

if (!command || command === "--help" || command === "-h") {
  process.stdout.write(rootHelp);
  process.exit(0);
}

if (command in helpByCommand && args.slice(1).some((arg) => arg === "--help" || arg === "-h")) {
  process.stdout.write(helpByCommand[command]);
  process.exit(0);
}

if (command === "greet") {
  if (process.env.CMDMINT_TEST_EXECUTION_MARKER) {
    writeFileSync(process.env.CMDMINT_TEST_EXECUTION_MARKER, "greet\n", {
      mode: 0o600,
    });
  }
  const name = args.find((arg, index) => index > 0 && !arg.startsWith("-"));
  if (!name) {
    console.error("name is required");
    process.exit(2);
  }
  const greeting = `Hello, ${name}!`;
  console.log(args.includes("--loud") ? greeting.toUpperCase() : greeting);
  process.exit(0);
}

if (command === "add") {
  const valueAfter = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const left = Number(valueAfter("--left"));
  const right = Number(valueAfter("--right"));
  if (!Number.isInteger(left) || !Number.isInteger(right)) {
    console.error("--left and --right must be integers");
    process.exit(2);
  }
  const result = left + right;
  console.log(args.includes("--json") ? JSON.stringify({ result }) : result);
  process.exit(0);
}

if (command === "status") {
  console.log(args.includes("--json") ? JSON.stringify({ ok: true }) : "ok");
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(2);
