#!/usr/bin/env node

process.stdout.write(
  JSON.stringify({
    answer: "cmdmint uses its active registry.",
    sourceIds: ["cmdmint:runtime"],
    insufficientEvidence: false,
  }),
);
