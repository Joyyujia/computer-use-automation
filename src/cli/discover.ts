import { discover } from "../core/discovery.js";
import { OpenAIModelAdapter } from "../core/model-adapter.js";

const goal = process.argv.slice(2).join(" ");
if (!goal) throw new Error("Usage: npm run discover -- '<goal>'");
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY is required for genuine discovery");
const result = await discover({ goal, entrypoint: process.env.CUA_BASE_URL ?? "http://127.0.0.1:4173", inputs: { memberId: process.env.CUA_MEMBER_ID ?? "12345" }, model: new OpenAIModelAdapter(apiKey), headless: process.env.CUA_HEADLESS !== "false" });
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "failure" ? 1 : 0;
