import { describe, expect, it } from "bun:test";
import { diffAppSecrets } from "../lib/reconcile";
import type { AppSecretDeclaration } from "../lib/config";

// NIM-secrets: pure diff of declared secret keys vs. the platform's current
// keys. Only keys ABSENT on the platform are created (with an empty value); a
// key that already exists is never re-sent, because the platform POST overwrites
// the value and re-sending would wipe a value set in the UI. Additive-only:
// undeclared platform keys are reported, never deleted.
describe("diffAppSecrets", () => {
  const decl = (
    key: string,
    description?: string,
  ): AppSecretDeclaration => ({ key, description });

  it("creates only declared keys missing on the platform", () => {
    const plan = diffAppSecrets(
      [decl("A", "first"), decl("B"), decl("C")],
      ["B"],
    );
    expect(plan.toCreate).toEqual([decl("A", "first"), decl("C")]);
    expect(plan.undeclared).toEqual([]);
  });

  it("never re-creates a key that already exists (protects UI-set values)", () => {
    const plan = diffAppSecrets([decl("EXISTING", "new desc")], ["EXISTING"]);
    expect(plan.toCreate).toEqual([]);
  });

  it("reports platform keys not in the manifest as undeclared, never deletes", () => {
    const plan = diffAppSecrets([decl("A")], ["A", "ORPHAN"]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.undeclared).toEqual(["ORPHAN"]);
  });

  it("deduplicates repeated declared keys (first wins, POSTed once)", () => {
    const plan = diffAppSecrets([decl("A", "one"), decl("A", "two")], []);
    expect(plan.toCreate).toEqual([decl("A", "one")]);
    expect(plan.undeclared).toEqual([]);
  });

  it("returns nothing to create when every declared key already exists", () => {
    const plan = diffAppSecrets([decl("A"), decl("B")], ["A", "B"]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.undeclared).toEqual([]);
  });
});
