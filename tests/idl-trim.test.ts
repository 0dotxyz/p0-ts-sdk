import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { BorshAccountsCoder, Idl } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";

import { trimIdl } from "../build/idl-trim";

const root = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// Only the Anchor 0.30-format IDLs; the legacy ones under pyth_crank are not imported anywhere.
const idlPaths = walk(join(root, "src"))
  .filter((p) => /\/(idl\/[^/]+|idl)\.json$/.test(p))
  .filter((p) => JSON.parse(readFileSync(p, "utf8")).metadata?.spec !== undefined);

describe("build-time IDL trimming", () => {
  it("finds the vendored IDLs", () => {
    expect(idlPaths.length).toBeGreaterThan(5);
  });

  it.each(idlPaths.map((p) => [p.slice(root.length), p]))(
    "%s decodes the same accounts after trimming",
    (_, path) => {
      const original = JSON.parse(readFileSync(path, "utf8"));
      const trimmed = trimIdl(original, path);

      const before = new BorshAccountsCoder(original as Idl);
      const after = new BorshAccountsCoder(trimmed as unknown as Idl);
      for (const account of original.accounts ?? []) {
        expect(after.size(account.name)).toBe(before.size(account.name));
        expect(after.accountDiscriminator(account.name)).toEqual(
          before.accountDiscriminator(account.name)
        );
      }

      expect(JSON.stringify(trimmed).length).toBeLessThan(JSON.stringify(original).length);
      expect(JSON.stringify(trimmed)).not.toContain('"docs"');
      const keepsInstructions = /\/(marginfi_[^/]+|klend)\.json$/.test(path);
      expect((trimmed.instructions as unknown[]).length).toBe(
        keepsInstructions ? original.instructions.length : 0
      );
    }
  );
});
