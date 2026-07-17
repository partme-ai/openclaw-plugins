import assert from "node:assert/strict";
import test from "node:test";

import { sortPackagesByDependency } from "./release-topology.mjs";

function workspacePackage(dir, name, dependencies = {}) {
  return { dir, path: `/workspace/${dir}`, pkg: { name, dependencies } };
}

test("依赖优先于消费者，独立包使用稳定目录顺序", () => {
  const packages = [
    workspacePackage("z-consumer", "@partme.ai/z", { "@partme.ai/sdk": "workspace:^1.0.0" }),
    workspacePackage("sdk", "@partme.ai/sdk"),
    workspacePackage("alpha", "@partme.ai/alpha"),
  ];

  assert.deepEqual(
    sortPackagesByDependency(packages).map((entry) => entry.dir),
    ["sdk", "alpha", "z-consumer"],
  );
});

test("单插件发布自动包含它的传递依赖", () => {
  const packages = [
    workspacePackage("app", "@partme.ai/app", { "@partme.ai/middle": "^1.0.0" }),
    workspacePackage("middle", "@partme.ai/middle", { "@partme.ai/sdk": "^1.0.0" }),
    workspacePackage("sdk", "@partme.ai/sdk"),
    workspacePackage("unrelated", "@partme.ai/unrelated"),
  ];

  assert.deepEqual(
    sortPackagesByDependency(packages, "app").map((entry) => entry.dir),
    ["sdk", "middle", "app"],
  );
});

test("循环依赖会阻止发布", () => {
  const packages = [
    workspacePackage("a", "@partme.ai/a", { "@partme.ai/b": "^1.0.0" }),
    workspacePackage("b", "@partme.ai/b", { "@partme.ai/a": "^1.0.0" }),
  ];

  assert.throws(() => sortPackagesByDependency(packages), /dependency cycle/);
});
