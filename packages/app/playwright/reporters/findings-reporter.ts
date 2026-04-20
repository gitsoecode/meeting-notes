import type {
  Reporter,
  TestCase,
  TestResult,
  FullResult,
  Suite,
} from "@playwright/test/reporter";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

interface Finding {
  area: string;
  test: string;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  duration: number;
  annotations: Array<{ type: string; description?: string }>;
  errors: string[];
}

class FindingsReporter implements Reporter {
  private findings: Finding[] = [];
  private outputDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../test-results"
  );

  onTestEnd(test: TestCase, result: TestResult) {
    const suiteName =
      test.parent?.title || path.basename(test.location.file, ".spec.ts");
    this.findings.push({
      area: suiteName,
      test: test.title,
      status: result.status,
      duration: result.duration,
      annotations: test.annotations,
      errors: result.errors.map((e) => e.message ?? String(e)),
    });
  }

  onEnd(result: FullResult) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.mkdirSync(path.join(this.outputDir, "screenshots"), { recursive: true });

    // Write machine-readable JSON
    fs.writeFileSync(
      path.join(this.outputDir, "findings.json"),
      JSON.stringify({ summary: result, findings: this.findings }, null, 2)
    );

    // Write PM-readable Markdown report
    const md = this.generateMarkdown(result);
    fs.writeFileSync(path.join(this.outputDir, "FINDINGS.md"), md);
  }

  private generateMarkdown(result: FullResult): string {
    const passed = this.findings.filter((f) => f.status === "passed").length;
    const failed = this.findings.filter((f) => f.status === "failed").length;
    const skipped = this.findings.filter((f) => f.status === "skipped").length;
    const total = this.findings.length;

    const lines: string[] = [];
    lines.push("# Gistlist — E2E Test & UX Audit Report\n");
    lines.push(`Generated: ${new Date().toISOString()}\n`);

    // Executive Summary
    lines.push("## Executive Summary\n");
    lines.push(`- **Total tests**: ${total}`);
    lines.push(
      `- **Passed**: ${passed} | **Failed**: ${failed} | **Skipped**: ${skipped}`
    );
    lines.push(
      `- **Overall status**: ${result.status === "passed" ? "GREEN" : "ISSUES FOUND"}\n`
    );

    if (failed > 0) {
      lines.push("### Critical Issues\n");
      for (const f of this.findings.filter((f) => f.status === "failed")) {
        lines.push(`- **${f.area}** / ${f.test}`);
        for (const err of f.errors) {
          lines.push(`  - ${err.split("\n")[0]}`);
        }
      }
      lines.push("");
    }

    // Group by area
    const areas = new Map<string, Finding[]>();
    for (const f of this.findings) {
      const list = areas.get(f.area) || [];
      list.push(f);
      areas.set(f.area, list);
    }

    lines.push("## Functional Test Results\n");
    for (const [area, findings] of areas) {
      const areaPassed = findings.filter((f) => f.status === "passed").length;
      const icon = areaPassed === findings.length ? "✅" : "⚠️";
      lines.push(
        `### ${icon} ${area} — ${areaPassed}/${findings.length} passed\n`
      );
      for (const f of findings) {
        const statusIcon =
          f.status === "passed" ? "✓" : f.status === "failed" ? "✗" : "○";
        lines.push(`- ${statusIcon} ${f.test} (${f.duration}ms)`);
      }
      lines.push("");
    }

    // UX Audit Observations
    const auditFindings = this.findings.filter((f) =>
      f.annotations.some((a) => a.type === "ux-audit")
    );
    if (auditFindings.length > 0) {
      lines.push("## UX Audit: Intent-Driven Observations\n");
      for (const f of auditFindings) {
        lines.push(`### ${f.test}\n`);
        for (const ann of f.annotations.filter((a) => a.type === "ux-audit")) {
          if (ann.description) {
            lines.push("```");
            lines.push(ann.description);
            lines.push("```\n");
          }
        }
      }
    }

    // Recommendations placeholder
    lines.push("## Recommendations Summary\n");
    lines.push(
      "*See UX Audit observations above for detailed per-flow recommendations.*\n"
    );
    lines.push(
      "Refer to `test-results/screenshots/` for the visual gallery.\n"
    );

    return lines.join("\n");
  }
}

export default FindingsReporter;
