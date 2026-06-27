import { describe, it, expect } from "vitest";
// The flagship example's deterministic transform lives with the example so users
// can read it next to its build.md. There is no per-example test runner, so it is
// unit-tested here (the `scripts` vitest project) — it is the one piece of the
// showcase with real logic, hence the one piece with real teeth.
// @ts-expect-error — plain ESM example file, no type declarations.
import extract from "../examples/showcase/extract.js";

/**
 * `extract` is the zero-token `transform` step over the *auto-imported* quarterly
 * report. MarkItDown converts `sources/quarterly-report.html` to Markdown on
 * resolve; the engine hands that Markdown to `extract` keyed by the original ref.
 * We feed it the same Markdown MarkItDown produces so the test mirrors the build.
 */
const REPORT_MD = `# Acme Corp — Q3 Report

Revenue grew **18% quarter-over-quarter**, driven by the new
self-serve tier and stronger enterprise renewals.

## Highlights

* Net revenue retention reached 121%.
* Self-serve signups doubled after the pricing change.
* Two enterprise logos churned; both cited onboarding friction.

## Segment revenue

| Segment | Q2 | Q3 |
| --- | --- | --- |
| Self-serve | $1.2M | $2.0M |
| Enterprise | $4.8M | $5.3M |

## Risks

Onboarding remains the top driver of enterprise churn. Engineering plans a
guided-setup flow for Q4.
`;

const REF = "sources/quarterly-report.html";

describe("showcase extract transform", () => {
  it("pulls the report title into a heading", () => {
    const out = extract({ [REF]: REPORT_MD });
    expect(out).toContain("Acme Corp — Q3 Report");
  });

  it("captures bold figures as key metrics", () => {
    const out = extract({ [REF]: REPORT_MD });
    expect(out).toContain("18% quarter-over-quarter");
  });

  it("captures highlight bullets", () => {
    const out = extract({ [REF]: REPORT_MD });
    expect(out).toContain("Net revenue retention reached 121%");
  });

  it("preserves the segment revenue table verbatim", () => {
    const out = extract({ [REF]: REPORT_MD });
    expect(out).toContain("| Self-serve | $1.2M | $2.0M |");
    expect(out).toContain("| Enterprise | $4.8M | $5.3M |");
  });

  it("is deterministic — same input yields byte-identical output", () => {
    const a = extract({ [REF]: REPORT_MD });
    const b = extract({ [REF]: REPORT_MD });
    expect(a).toBe(b);
  });

  it("returns a string without throwing on empty/missing input", () => {
    expect(typeof extract({})).toBe("string");
    expect(typeof extract({ [REF]: "" })).toBe("string");
  });
});
