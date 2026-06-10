/**
 * WeChat iPad plugin manifest smoke tests.
 */
import { fileURLToPath } from "node:url";

import {
  createManifestSmokeTests,
  pluginRootFromTestFile,
} from "../../../test-utils/plugin-manifest.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "wechat-ipad",
});
