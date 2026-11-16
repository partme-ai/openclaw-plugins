import ts from "typescript";

/** 检查发布分块中的静态 SDK 引用，包括延迟导入及 CJS 入口。 */
export function checkPackedSdkImports(filename, source, hostExports) {
  const missing = new Set();
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  function inspect(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      specifier = node.arguments[0];
    }
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith("openclaw/plugin-sdk/")) {
      const entry = hostExports[specifier.text.replace(/^openclaw\//u, "./")];
      if (!entry?.types || !entry.default) missing.add(specifier.text);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(tree);
  return [...missing].sort();
}
