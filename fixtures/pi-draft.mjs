#!/usr/bin/env node

process.stdout.write(
  JSON.stringify({
    description: "A deterministic demonstration CLI.",
    methods: [
      {
        name: "greet",
        description: "Greet one person.",
        risk: "read",
        argv: ["greet"],
        parameters: [
          {
            name: "name",
            description: "Person to greet.",
            kind: "positional",
            type: "string",
            position: 0,
            required: true,
          },
        ],
        output: "text",
        evidenceId: "sub:greet",
      },
    ],
  }),
);
