/**
 * npm 工作区包依赖拓扑。
 *
 * 发布顺序只由 package.json 中可发布依赖关系决定，不硬编码 message-sdk。这样未来
 * 新增共享 SDK 或插件间依赖时，GitHub Actions 仍会先发布依赖再发布消费者。
 */

const PUBLISH_DEPENDENCY_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"];

export function internalDependencies(pkg, packageNames) {
  const dependencies = new Set();
  for (const section of PUBLISH_DEPENDENCY_SECTIONS) {
    for (const name of Object.keys(pkg[section] ?? {})) {
      if (packageNames.has(name)) dependencies.add(name);
    }
  }
  return [...dependencies].sort();
}

/**
 * 对工作区包执行稳定拓扑排序；同一层按目录名排序，保证日志和发布计划可复现。
 */
export function sortPackagesByDependency(packages, selectedDir = null) {
  const byName = new Map(packages.map((entry) => [entry.pkg.name, entry]));
  if (byName.size !== packages.length) {
    throw new Error("Workspace contains duplicate npm package names");
  }
  const packageNames = new Set(byName.keys());
  const dependenciesByName = new Map(
    packages.map((entry) => [entry.pkg.name, internalDependencies(entry.pkg, packageNames)]),
  );

  let includedNames = packageNames;
  if (selectedDir) {
    const selected = packages.find((entry) => entry.dir === selectedDir);
    if (!selected) throw new Error(`Unknown plugin: ${selectedDir}`);
    includedNames = new Set();
    const visit = (name) => {
      if (includedNames.has(name)) return;
      includedNames.add(name);
      for (const dependency of dependenciesByName.get(name) ?? []) visit(dependency);
    };
    visit(selected.pkg.name);
  }

  const remainingDependencies = new Map();
  const consumersByDependency = new Map();
  for (const name of includedNames) {
    const dependencies = (dependenciesByName.get(name) ?? []).filter((dep) => includedNames.has(dep));
    remainingDependencies.set(name, new Set(dependencies));
    for (const dependency of dependencies) {
      const consumers = consumersByDependency.get(dependency) ?? new Set();
      consumers.add(name);
      consumersByDependency.set(dependency, consumers);
    }
  }

  const ready = [...includedNames]
    .filter((name) => remainingDependencies.get(name).size === 0)
    .sort(compareReady);
  const ordered = [];

  /** 优先发布被更多工作区包依赖的根包；同优先级再按目录稳定排序。 */
  function compareReady(a, b) {
    const consumerDelta =
      (consumersByDependency.get(b)?.size ?? 0) - (consumersByDependency.get(a)?.size ?? 0);
    return consumerDelta || byName.get(a).dir.localeCompare(byName.get(b).dir);
  }

  while (ready.length > 0) {
    const name = ready.shift();
    ordered.push({
      ...byName.get(name),
      internalDependencies: dependenciesByName.get(name) ?? [],
    });
    for (const consumer of consumersByDependency.get(name) ?? []) {
      const remaining = remainingDependencies.get(consumer);
      remaining.delete(name);
      if (remaining.size === 0) {
        ready.push(consumer);
        ready.sort(compareReady);
      }
    }
  }

  if (ordered.length !== includedNames.size) {
    const cycle = [...includedNames].filter((name) => remainingDependencies.get(name).size > 0);
    throw new Error(`Workspace package dependency cycle: ${cycle.join(", ")}`);
  }
  return ordered;
}
