import { describe, it, expect } from "bun:test";
import {
  findUnauthorableAccessPrincipals,
  formatAccessPrincipals,
} from "../lib/commands/utils/feature-output.ts";
import { parsePrincipals } from "../lib/permissions.ts";

describe("formatAccessPrincipals", () => {
  it("says none when there are no principals", () => {
    expect(formatAccessPrincipals(undefined)).toBe("none");
    expect(formatAccessPrincipals([])).toBe("none");
  });

  it("round-trips the --access syntax", () => {
    const input = "visitor,orgRole:member,portalClient";

    expect(formatAccessPrincipals(parsePrincipals(input))).toBe(
      "visitor, orgRole:member, portalClient",
    );
  });

  it("renders principals the CLI cannot author itself", () => {
    expect(formatAccessPrincipals([
      { type: "user", id: "42" },
      { type: "orgGroup", id: "group-1" },
    ])).toBe("user:42, orgGroup:group-1");
  });
});

describe("findUnauthorableAccessPrincipals", () => {
  it("flags only the principals --access cannot express", () => {
    expect(findUnauthorableAccessPrincipals([
      ...parsePrincipals("visitor,orgRole:member,portalClient"),
      { type: "user", id: "42" },
      { type: "orgGroup", id: "group-1" },
    ])).toEqual(["user:42", "orgGroup:group-1"]);
  });

  it("flags nothing when every principal round-trips", () => {
    expect(findUnauthorableAccessPrincipals(parsePrincipals("visitor,orgRole:owner"))).toEqual([]);
    expect(findUnauthorableAccessPrincipals(undefined)).toEqual([]);
  });
});
