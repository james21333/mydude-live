import worker, { testInternals } from "../src/index.js";

const rootResponse = await worker.fetch(new Request("https://mydude.live/"));
const rootHtml = await rootResponse.text();
assert(rootHtml.includes("mydude.live AI Ecosystem"), "root page headline missing");
assert(rootHtml.includes("Active Projects"), "root page active projects missing");

const projectResponse = await worker.fetch(new Request("https://clawtest.mydude.live/"));
const projectHtml = await projectResponse.text();
assert(projectHtml.includes("Welcome to Project: Clawtest"), "subdomain project headline missing");
assert(projectHtml.includes("Generated autonomously by OpenClaw"), "OpenClaw generated copy missing");
assert(projectHtml.includes("clawtest.mydude.live"), "hostname meta missing");

assert(testInternals.getSubdomain("mydude.live") === "", "root domain should not produce subdomain");
assert(testInternals.getSubdomain("testproject.mydude.live") === "testproject", "subdomain parsing failed");
assert(testInternals.toDisplayName("test-project") === "Test Project", "display name formatting failed");

console.log("Validation passed: root + wildcard subdomain routing render correctly.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
