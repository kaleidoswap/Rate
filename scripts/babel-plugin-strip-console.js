// scripts/babel-plugin-strip-console.js
//
// Removes console.log / info / debug / trace calls from production bundles so
// payment details, invoices and wallet state never reach device logs (logcat,
// Xcode console, crash collectors). console.warn / console.error are kept for
// diagnosing release issues. Inline (no dependency) on purpose.
const STRIPPED = new Set(['log', 'info', 'debug', 'trace']);

module.exports = function stripConsole({ types: t }) {
  const isStrippedConsoleCall = (node) =>
    t.isCallExpression(node) &&
    t.isMemberExpression(node.callee) &&
    !node.callee.computed &&
    t.isIdentifier(node.callee.object, { name: 'console' }) &&
    t.isIdentifier(node.callee.property) &&
    STRIPPED.has(node.callee.property.name);

  return {
    name: 'strip-console',
    visitor: {
      CallExpression(path) {
        if (!isStrippedConsoleCall(path.node)) return;
        // Leave a shadowed local `console` alone.
        if (path.scope.hasBinding('console')) return;
        if (path.parentPath.isExpressionStatement()) {
          path.parentPath.remove();
        } else {
          // e.g. `.catch(e => console.log(e))` or `ok && console.log(x)`
          path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
        }
      },
    },
  };
};
