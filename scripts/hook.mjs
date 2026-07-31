#!/usr/bin/env node

import { runHookStdio } from "../src/hook-stdio.mjs";

await runHookStdio({ arguments: process.argv.slice(2) });
