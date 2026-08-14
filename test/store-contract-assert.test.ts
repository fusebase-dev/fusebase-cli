import { describe, it, expect } from "bun:test";
import { describeRlsFailure } from "../lib/commands/isolated-store.ts";
import { classifyRls } from "../lib/provision-store.ts";

/**
 * The `--assert-rls` gate is the only automatic guard against shipping a store
 * whose data is unprotected: browser e2e cannot distinguish "RLS is working"
 * from "this user happens to have no rows". These tests pin the classify →
 * message path the gate exits on.
 */
describe("--assert-rls gate", () => {
  function evaluate(status: Parameters<typeof classifyRls>[0]): string | null {
    const { verdict, dataTables } = classifyRls(status);
    return describeRlsFailure(verdict, status, dataTables);
  }

  it("fails when the runtime role bypasses RLS", () => {
    const message = evaluate({
      tableCount: 2,
      rlsEnabledCount: 2,
      bypassRls: true,
      currentUser: "postgres",
    });
    expect(message).toContain("NOT enforced");
    expect(message).toContain("bypassRls=true");
    expect(message).toContain("postgres");
  });

  it("fails when the runtime role is superuser", () => {
    const message = evaluate({
      tableCount: 2,
      rlsEnabledCount: 2,
      superuser: true,
    });
    expect(message).toContain("superuser=true");
  });

  it("reports both reasons when the role bypasses AND is superuser", () => {
    const message = evaluate({
      tableCount: 2,
      rlsEnabledCount: 2,
      bypassRls: true,
      superuser: true,
    });
    expect(message).toContain("bypassRls=true");
    expect(message).toContain("superuser=true");
  });

  it("fails when policies exist on zero data tables (the Ovation failure mode)", () => {
    const message = evaluate({
      tableCount: 2, // one data table + the migration journal
      rlsEnabledCount: 0,
      bypassRls: false,
      superuser: false,
    });
    expect(message).toContain("0/1 data table");
    expect(message).toContain("no row-level protection");
  });

  it("passes when a data table is protected and the role cannot bypass", () => {
    expect(
      evaluate({
        tableCount: 3,
        rlsEnabledCount: 2,
        bypassRls: false,
        superuser: false,
        currentUser: "isolated_pg_runtime",
      }),
    ).toBeNull();
  });

  it("does not excuse a bypassing role just because policies are present", () => {
    // Regression guard: policy count must never override enforcement.
    const message = evaluate({
      tableCount: 5,
      rlsEnabledCount: 4,
      bypassRls: true,
    });
    expect(message).not.toBeNull();
  });
});
