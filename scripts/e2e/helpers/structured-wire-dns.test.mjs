import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

// Separate processes prove native ESM named imports see both patched builtin APIs.
for (const enabled of [false, true]) {
  test(`Gateway-only DNS pin enabled=${enabled}`, () => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import dns from 'node:dns';
      import promises from 'node:dns/promises';
      import { syncBuiltinESMExports } from 'node:module';
      const original = '198.18.1.20';
      const seen = [];
      dns.lookup = function (host, options, callback) {
        if (typeof options === 'function') assert.equal(arguments.length,2);
        if (typeof options === 'function') { callback = options; options = {}; }
        seen.push(host);
        callback(null, options?.all ? [{address: original, family: 4}] : original, 4);
      };
      promises.lookup = async (host, options) => {
        seen.push(host);
        return options?.all ? [{address: original, family: 4}] : {address: original, family: 4};
      };
      syncBuiltinESMExports();
      await import(${JSON.stringify(new URL('./structured-wire-dns.mjs', import.meta.url).href)});
      const { lookup } = await import('node:dns');
      const { lookup: lookupAsync } = await import('node:dns/promises');
      const expected = ${enabled} ? '185.199.108.133' : original;
      assert.deepEqual(await lookupAsync('raw.githubusercontent.com', {all:true}), [{address:expected,family:4}]);
      await new Promise((resolve,reject) => lookup('raw.githubusercontent.com', (error,address,family) => {
        try { assert.ifError(error); assert.equal(address,expected); assert.equal(family,4); resolve(); } catch(e) {reject(e);}
      }));
      for (const host of ['localhost', 'raw.githubusercontent.com.attacker.example']) {
        assert.equal((await lookupAsync(host)).address,original);
        await new Promise(resolve => lookup(host, {all:true}, (error,records) => {assert.ifError(error);assert.equal(records[0].address,original);resolve();}));
        await new Promise(resolve => lookup(host, (error,address) => {assert.ifError(error);assert.equal(address,original);resolve();}));
        assert.equal(seen.filter(value => value === host).length,3);
      }
    `], {encoding:'utf8', env:{...process.env, OPENCLAW_E2E_STRUCTURED_WIRE: enabled ? '1' : '0', OPENCLAW_E2E_STRUCTURED_DNS_PIN:'1'}});
    assert.equal(child.status, 0, child.stderr);
  });
}
