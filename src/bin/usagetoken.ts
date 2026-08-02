#!/usr/bin/env node
import { basename } from "node:path";
import { run } from "../cli.js";

const invokedAs = basename(process.argv[1] ?? "").toLowerCase();
const args = process.argv.slice(2);

process.exitCode = await run(invokedAs.startsWith("cc") && args.length === 0 ? ["cc"] : args);
