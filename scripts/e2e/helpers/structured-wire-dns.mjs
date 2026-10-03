/** Local O3 Gateway preload only: retain HTTPS hostname/TLS and host SSRF checks. */
import dns from 'node:dns';
import promises from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';

if (process.env.OPENCLAW_E2E_STRUCTURED_WIRE === '1' && process.env.OPENCLAW_E2E_STRUCTURED_DNS_PIN === '1') {
  const hostname = 'raw.githubusercontent.com';
  const address = '185.199.108.133';
  const originalLookup = dns.lookup.bind(dns);
  const originalAsyncLookup = promises.lookup.bind(promises);
  const result = (options) => {
    const family = typeof options === 'number' ? options : options?.family;
    if (family === 6 || family === 'IPv6') {
      throw Object.assign(new Error(`No pinned IPv6 address for ${hostname}`), {code:'ENOTFOUND', hostname});
    }
    const record = {address, family:4};
    return options?.all ? [record] : record;
  };
  dns.lookup = (...args) => {
    let [host, options, callback] = args;
    if (host !== hostname) return originalLookup(...args);
    if (typeof options === 'function') { callback = options; options = {}; }
    queueMicrotask(() => {
      let resolved;
      try { resolved = result(options); } catch (error) { callback(error); return; }
      if (Array.isArray(resolved)) callback(null, resolved);
      else callback(null, resolved.address, resolved.family);
    });
  };
  promises.lookup = async (host, options) => host === hostname ? result(options) : originalAsyncLookup(host, options);
  syncBuiltinESMExports();
}
