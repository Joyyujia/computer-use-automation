import { readFile } from "node:fs/promises";
import { replay } from "../core/replay.js";

const [artifactPath, inputJson = "{}"] = process.argv.slice(2);
if (!artifactPath) throw new Error("Usage: npm run replay -- <artifact.json> '<inputs-json>'");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const result = await replay(artifact, JSON.parse(inputJson), { headless: process.env.CUA_HEADLESS !== "false" });
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "failure" ? 1 : 0;
