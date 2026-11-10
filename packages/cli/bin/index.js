#!/usr/bin/env node

import { assertNodeEngine } from '../src/lib/node-engine.js';

assertNodeEngine();

const { createProgram, rewriteArgvForUpgrade } = await import('../src/cli.js');
createProgram().parse(rewriteArgvForUpgrade(process.argv));
