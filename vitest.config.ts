import { defineConfig } from "vitest/config";
import fs from "node:fs";

// Vitest equivalent of wrangler.toml [[rules]] type="Text" — load *.md as raw
// strings so `import skill from "../../SKILL.md"` works in unit tests.
export default defineConfig({
  plugins: [
    {
      name: "load-md-raw",
      enforce: "pre",
      load(id) {
        if (id.endsWith(".md")) {
          const content = fs.readFileSync(id.split("?")[0]!, "utf8");
          return `export default ${JSON.stringify(content)};`;
        }
        return null;
      },
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
