#!/usr/bin/env node
const path = require("path");
try {
  require("../dist/cli.js").runCli();
} catch (e) {
  require("../src/cli.js");
}
