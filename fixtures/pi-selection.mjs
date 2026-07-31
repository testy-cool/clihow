#!/usr/bin/env node

process.stdout.write(
  JSON.stringify({ method: "greet", args: { name: "Grace" } }),
);
