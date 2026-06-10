/**
 * Monkey-patch Node module resolution for legacy `require('uuid/v4')`.
 * nacos-naming@2.x uses uuid/v4, but hoisted uuid@9+ no longer exports that subpath.
 */
const Module = require("module");
const crypto = require("crypto");
const path = require("path");

const SHIM_KEY = path.join(__dirname, "__uuid_v4_shim__.cjs");
const origResolveFilename = Module._resolveFilename;

Module._resolveFilename = function (id, parent, isMain, options) {
  if (id === "uuid/v4" || id === "uuid\\v4") {
    return SHIM_KEY;
  }
  return origResolveFilename.call(this, id, parent, isMain, options);
};

if (!Module._cache[SHIM_KEY]) {
  Module._cache[SHIM_KEY] = {
    id: SHIM_KEY,
    filename: SHIM_KEY,
    loaded: true,
    exports: function v4() {
      return crypto.randomUUID();
    },
  };
}
