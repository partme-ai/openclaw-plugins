// Shim for nacos-naming@2.x which does require('uuid/v4')
// Uses Node's built-in crypto.randomUUID() — no external deps
var crypto = require('crypto');
module.exports = function v4() {
  return crypto.randomUUID();
};
