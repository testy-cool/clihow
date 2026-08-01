#!/usr/bin/env node

const prompt = process.argv.at(-1) ?? "";

function write(stream, value) {
  return new Promise((resolve, reject) => {
    stream.write(value, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

if (prompt === "emit oversized capture") {
  await Promise.all([
    write(process.stdout, "o".repeat(1024 * 1024 + 4096)),
    write(process.stderr, "e".repeat(1024 * 1024 + 4096)),
  ]);
} else {
  const repaired = prompt.includes(
    "Previous candidate failed deterministic validation",
  );
  process.stdout.write(
    JSON.stringify(
      repaired
        ? {
            description: "A deterministic demonstration CLI.",
            methods: [
              {
                name: "greet",
                description: "Greet one person.",
                risk: "read",
                argv: ["greet"],
                parameters: [],
                output: "text",
                evidenceId: "sub:greet",
              },
            ],
          }
        : {
            description: "An invalid first candidate.",
            methods: [
              {
                name: "root",
                description: "Repeat the executable incorrectly.",
                risk: "read",
                argv: ["demo-cli"],
                parameters: [],
                output: "text",
                evidenceId: "root",
              },
            ],
          },
    ),
  );
}
