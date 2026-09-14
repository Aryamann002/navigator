import { test, expect } from "@playwright/test";
import axeCore from "axe-core";
import { PDFParse } from "pdf-parse";
import { readFile } from "node:fs/promises";

async function expectNoAccessibilityViolations(page: import("@playwright/test").Page) {
  await page.addScriptTag({ content: axeCore.source });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof axeCore }).axe;
    const results = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    });
    return results.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }));
  });
  expect(violations).toEqual([]);
}

test("all primary views meet automated WCAG A and AA checks", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(response?.headers()["permissions-policy"]).toContain("camera=()");
  expect(response?.headers()["x-frame-options"]).toBe("SAMEORIGIN");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await expectNoAccessibilityViolations(page);

  for (const name of ["Plain English", "Ask your document", "Lawyer prep"]) {
    await page.getByRole("button", { name, exact: true }).first().click();
    await expectNoAccessibilityViolations(page);
  }

  await page.getByRole("button", { name: "Your workspace", exact: true }).click();
  await expectNoAccessibilityViolations(page);
  const upload = page.getByRole("button", { name: "Upload document", exact: true });
  await upload.click();
  await expect(page.getByRole("button", { name: "Close dialog" })).toBeFocused();
  await expectNoAccessibilityViolations(page);
  await page.keyboard.press("Escape");
  await expect(upload).toBeFocused();
});

test("document review, grounded sample Q&A, PDF, and upload boundaries", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const initialized = page.waitForResponse(response => response.url().endsWith("/api/status"));
  await page.goto("/");
  await initialized;
  await expect(page.getByRole("heading", { name: "Service agreement." })).toBeVisible();
  await expect(page.locator(".legal-banner")).toContainText("Legal information, not professional advice");
  const image = page.getByAltText("First page of the Northstar Studio sample services agreement");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await image.evaluate(node => (node as HTMLImageElement).decode());
  await page.getByRole("button", { name: "Open original sample document" }).click();
  await expect(page.getByTitle("Original sample services agreement PDF")).toBeVisible();
  await expect.poll(() => page.frames().some(frame => frame.url().includes("sample-contract.pdf"))).toBe(true);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-overview.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await page.locator(".new-document").evaluate(node => getComputedStyle(node).borderRadius)).toBe("9999px");

  await page.getByRole("button", { name: "Risks", exact: true }).click();
  await expect(page.locator(".finding-row")).toHaveCount(3);
  await page.getByRole("checkbox", { name: "Mark Your liability has no limit as reviewed" }).check();
  await expect(page.getByRole("checkbox", { name: "Mark Your liability has no limit as reviewed" })).toBeChecked();
  await page.locator(".finding-row").first().getByRole("button", { name: "Clause 5", exact: true }).click();
  await expect(page.locator("#clause-5")).toBeFocused();
  await expect(page.locator("#clause-5")).toContainText("not be subject to any financial cap");
  await expect(page.locator("#clause-5 .translated-clause")).toContainText("no financial limit");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-plain.png`, fullPage: true });

  await page.getByRole("button", { name: "Ask your document", exact: true }).click();
  await page.getByRole("button", { name: "When will I get paid?", exact: true }).click();
  await expect(page.locator(".chat-message.assistant")).toContainText("GBP 6,000");
  await expect(page.locator(".chat-message.assistant .source-link")).toHaveCount(2);
  await page.getByLabel("Ask about your document", { exact: true }).fill("What is the capital of Canada?");
  await page.getByRole("button", { name: "Send question", exact: true }).click();
  await expect(page.locator(".chat-message.assistant").last()).toContainText("cannot establish the answer");
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-chat.png`, fullPage: true });

  await page.locator(".document-tabs").getByRole("button", { name: "Lawyer prep", exact: true }).click();
  await expect(page.locator(".prep-paper")).toContainText("When will I get paid?");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download prep sheet", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("Lawyer_Prep.pdf");
  const parser = new PDFParse({ data: new Uint8Array(await readFile((await download.path())!)) });
  try {
    const result = await parser.getText();
    expect(result.text).toContain("When will I get paid?");
    expect(result.text.replace(/\s+/g, " ")).toContain("Marked as reviewed by the user");
    expect(result.total).toBeGreaterThan(1);
  } finally { await parser.destroy(); }

  await page.getByRole("button", { name: "Upload document", exact: true }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("invalid") });
  await expect(page.locator("dialog").getByRole("alert")).toContainText("Choose a PDF");
  if (await page.locator(".local-mode-note").count()) {
    await expect(page.locator(".local-mode-note")).toContainText("Free local mode is active");
  } else {
    await page.locator('input[type="file"]').setInputFiles("public/sample-contract.pdf");
    await expect(page.locator("dialog").getByRole("alert")).toContainText("awaiting its secure AI and storage connections");
  }
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-upload.png`, fullPage: true });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(page.locator("dialog")).not.toBeVisible();
  await expect(page.locator(".legal-banner")).toBeVisible();
  expect(errors).toEqual([]);
});
