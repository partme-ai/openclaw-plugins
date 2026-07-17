/**
 * 从仓库内生产源码提取 message-sdk import，并对最终 dist 执行消费者契约校验。
 *
 * - 运行时命名导出必须真实存在于编译后的 ESM 模块；
 * - 类型导出通过 TypeScript 对包自引用生成的临时契约文件校验；
 * - 未声明的子路径立即失败，避免 workspace 源码可解析、发布包却不可用的假绿灯。
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const PACKAGE_NAME = "@partme.ai/openclaw-message-sdk";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionsRoot = resolve(packageRoot, "..");
const packageJson = JSON.parse(
  readFileSync(resolve(packageRoot, "package.json"), "utf8"),
);
const contracts = new Map();
const failures = [];

function contractFor(moduleName) {
  const subpath =
    moduleName === PACKAGE_NAME
      ? "."
      : `.${moduleName.slice(PACKAGE_NAME.length)}`;
  const target = packageJson.exports?.[subpath];
  if (!target) {
    failures.push(`${moduleName}: consumer uses an undeclared package subpath`);
  }
  const existing = contracts.get(moduleName) ?? {
    subpath,
    runtime: new Set(),
    types: new Set(),
    namespace: false,
    defaultImport: false,
    consumers: new Set(),
  };
  contracts.set(moduleName, existing);
  return existing;
}

function collectNamedBindings(
  moduleName,
  bindings,
  declarationTypeOnly,
  consumer,
) {
  const contract = contractFor(moduleName);
  contract.consumers.add(consumer);
  if (!bindings) return;
  if (ts.isNamespaceImport(bindings)) {
    contract.namespace = true;
    return;
  }
  for (const element of bindings.elements) {
    const imported = (element.propertyName ?? element.name).text;
    (declarationTypeOnly || element.isTypeOnly
      ? contract.types
      : contract.runtime
    ).add(imported);
  }
}

function inspectFile(file) {
  const sourceText = readFileSync(file, "utf8");
  const source = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const consumer = relative(extensionsRoot, file);
  function visit(node) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      if (
        moduleName === PACKAGE_NAME ||
        moduleName.startsWith(`${PACKAGE_NAME}/`)
      ) {
        const contract = contractFor(moduleName);
        contract.consumers.add(consumer);
        if (node.importClause?.name) contract.defaultImport = true;
        collectNamedBindings(
          moduleName,
          node.importClause?.namedBindings,
          node.importClause?.isTypeOnly === true,
          consumer,
        );
      }
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleName = node.moduleSpecifier.text;
      if (
        moduleName === PACKAGE_NAME ||
        moduleName.startsWith(`${PACKAGE_NAME}/`)
      ) {
        const contract = contractFor(moduleName);
        contract.consumers.add(consumer);
        if (!node.exportClause) {
          contract.namespace = true;
        } else if (ts.isNamedExports(node.exportClause)) {
          for (const element of node.exportClause.elements) {
            const imported = (element.propertyName ?? element.name).text;
            (node.isTypeOnly || element.isTypeOnly
              ? contract.types
              : contract.runtime
            ).add(imported);
          }
        }
      }
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const moduleName = node.argument.literal.text;
      if (
        (moduleName === PACKAGE_NAME ||
          moduleName.startsWith(`${PACKAGE_NAME}/`)) &&
        node.qualifier
      ) {
        const contract = contractFor(moduleName);
        contract.consumers.add(consumer);
        const first = node.qualifier.getText(source).split(".")[0];
        if (first) contract.types.add(first);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

function walkProductionSources(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkProductionSources(candidate);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      inspectFile(candidate);
    }
  }
}

for (const plugin of readdirSync(extensionsRoot, { withFileTypes: true })) {
  if (
    !plugin.isDirectory() ||
    plugin.name === "message-sdk" ||
    plugin.name === "_template"
  )
    continue;
  walkProductionSources(resolve(extensionsRoot, plugin.name, "src"));
}

let aliasIndex = 0;
const typeContractLines = [];
for (const [moduleName, contract] of [...contracts].sort(([left], [right]) =>
  left.localeCompare(right),
)) {
  const target = packageJson.exports?.[contract.subpath];
  if (!target) continue;
  const runtimeTarget = typeof target === "string" ? target : target.default;
  if (!runtimeTarget || !existsSync(resolve(packageRoot, runtimeTarget))) {
    failures.push(`${moduleName}: compiled runtime target is missing`);
    continue;
  }
  let runtimeModule;
  try {
    runtimeModule = await import(
      pathToFileURL(resolve(packageRoot, runtimeTarget)).href
    );
  } catch (error) {
    failures.push(
      `${moduleName}: compiled runtime import failed (${String(error)})`,
    );
    continue;
  }
  if (contract.defaultImport && !("default" in runtimeModule)) {
    failures.push(
      `${moduleName}: default import used by consumers but dist has no default export`,
    );
  }
  for (const name of contract.runtime) {
    if (!(name in runtimeModule)) {
      failures.push(
        `${moduleName}: runtime export '${name}' used by consumers is missing`,
      );
    }
  }
  const runtimeNames = [...contract.runtime];
  if (runtimeNames.length > 0) {
    typeContractLines.push(
      `import { ${runtimeNames.map((name) => `${name} as Runtime_${aliasIndex++}`).join(", ")} } from ${JSON.stringify(moduleName)};`,
    );
  }
  const typeNames = [...contract.types];
  if (typeNames.length > 0) {
    typeContractLines.push(
      `import type { ${typeNames.map((name) => `${name} as Type_${aliasIndex++}`).join(", ")} } from ${JSON.stringify(moduleName)};`,
    );
  }
}

const temporaryContract = resolve(
  packageRoot,
  `.consumer-contract-${process.pid}.ts`,
);
try {
  writeFileSync(
    temporaryContract,
    `${typeContractLines.join("\n")}\nexport {};\n`,
    "utf8",
  );
  const program = ts.createProgram([temporaryContract], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    // 消费者契约只检查本包声明与 import；第三方 Zod 4 的 variance 声明由其自身负责。
    skipLibCheck: true,
    types: ["node"],
  });
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      " ",
    );
    failures.push(`type contract: ${message}`);
  }
} finally {
  rmSync(temporaryContract, { force: true });
}

const consumerCount = new Set(
  [...contracts.values()].flatMap((entry) => [...entry.consumers]),
).size;
const symbolCount = [...contracts.values()].reduce(
  (total, entry) => total + entry.runtime.size + entry.types.size,
  0,
);
if (failures.length > 0) {
  console.error(
    `message-sdk consumer contract verification failed:\n${failures.join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `message-sdk consumer contracts passed (${consumerCount} source files, ${contracts.size} subpaths, ${symbolCount} named symbols)`,
  );
}
