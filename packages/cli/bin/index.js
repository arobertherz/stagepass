#!/usr/bin/env node

import { createProgram } from '../src/cli.js';

createProgram().parse(process.argv);
