#!/usr/bin/env node

process.stdout.write(
  JSON.stringify({
    answer: "clihow uses its active registry.",
    sourceIds: ["clihow:runtime"],
    insufficientEvidence: false,
  }),
);
