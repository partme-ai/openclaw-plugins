"use strict";

/** CJS entry: install uuid/v4 shim, then load the CJS plugin bundle. */
require("./uuid-shim.cjs");
module.exports = require("./index.cjs");
