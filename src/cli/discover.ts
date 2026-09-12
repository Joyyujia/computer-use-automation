// Discovery is deliberately separated from deterministic replay. The next milestone
// wires a real model adapter here; this command refuses to synthesize fake evidence.
const goal = process.argv.slice(2).join(" ");
if (!goal) throw new Error("Usage: npm run discover -- '<goal>'");
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required for a genuine LLM-driven discovery run.");
  process.exitCode = 2;
} else {
  console.error("Discovery adapter is not implemented yet; no evidence was written.");
  process.exitCode = 2;
}
