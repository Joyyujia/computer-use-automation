import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../public");
app.use(express.static(root));
app.listen(4173, "127.0.0.1", () => console.log("Legacy demo at http://127.0.0.1:4173"));
