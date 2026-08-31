// Metro alias target for optional WDK peer packages the app doesn't use.
//
// @kaleidorg/wallet-engine's `adapters/wdk` barrel re-exports RgbLibWdkAdapter
// and RgbLibWasmAdapter alongside the adapters this app actually registers
// (Spark/Liquid/Rln/Arkade — see services/protocols/wdk.ts). Metro bundles a
// single file and doesn't tree-shake unused named exports from a barrel, so
// it still needs to resolve their dynamic `import('@utexo/...')` calls even
// though this app never instantiates those two adapters (RGB is driven over
// NWC to a remote node instead — see services/nwc/NwcRgbAdapter.ts).
//
// The real @utexo/wdk-wallet-rgb pulls in @utexo/rgb-sdk -> @utexo/rgb-lib,
// which imports Node's `fs`/`path` — packages built for Node/CLI use, not
// Metro-bundleable for React Native. Since this code path is never actually
// invoked at runtime, an empty stub is safe: loadWdkModule() only reads
// properties off the resolved module lazily, inside methods that are never
// called.
module.exports = {};
