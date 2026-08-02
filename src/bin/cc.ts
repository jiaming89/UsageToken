#!/usr/bin/env node
import { run } from "../cli.js";

process.exitCode = await run(["cc", ...process.argv.slice(2)]);
