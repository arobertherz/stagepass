#!/usr/bin/env node

import { createProgram, rewriteArgvForUpgrade } from '../src/cli.js';

createProgram().parse(rewriteArgvForUpgrade(process.argv));
