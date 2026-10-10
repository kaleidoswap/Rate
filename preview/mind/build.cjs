// Browser review only. No native/wallet runtime may enter this bundle.
// From Rate: node preview/mind/build.cjs
// Serve preview/mind/dist on localhost, then open its index.html.
// Core wiring checks: node --test preview/mind/wiring.test.mjs
const path=require('path'), fs=require('fs');
const root=path.resolve(__dirname,'../..');
const esbuild=require(require.resolve('esbuild',{paths:[root,path.resolve(root,'../website')]}));
const mocks={ 'react-native':'native.tsx','@expo/vector-icons':'icons.tsx','react-native-safe-area-context':'safe.tsx','@kaleidorg/mind':'skills.ts','expo-linear-gradient':'effects.tsx','expo-blur':'effects.tsx','expo-haptics':'haptics.ts','@react-navigation/native':'navigation.tsx','react-native-reanimated':'animation.tsx','@tetherto/wdk-uikit-react-native':'uikit.tsx'};
const boundaries={mindAgent:'agent.ts',QVACService:'runtime.ts',useQVAC:'runtime.ts',VoiceInput:'voice-input.tsx',handsFreeVoice:'voice-input.tsx',qvacTts:'voice-input.tsx',PairingService:'services.ts',ToastService:'services.ts',btcmapService:'services.ts',NostrContactsSelector:'contacts.tsx'};
esbuild.build({entryPoints:[path.join(__dirname,'main.tsx')],outfile:path.join(__dirname,'dist/app.js'),bundle:true,metafile:true,resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],platform:'browser',format:'iife',jsx:'automatic',loader:{'.js':'jsx','.ttf':'file','.png':'file'},define:{global:'globalThis','process.env.NODE_ENV':'"development"','process.env.EXPO_PUBLIC_MIND_DESKTOP':'"0"',__DEV__:'true'},nodePaths:[path.join(root,'node_modules')],plugins:[{name:'preview-isolation',setup(b){b.onResolve({filter:/.*/},a=>{
 if(a.path==='react-native-svg')return {path:path.join(root,'node_modules/react-native-svg/lib/module/ReactNativeSVG.web.js')};
 if(mocks[a.path])return {path:path.join(__dirname,mocks[a.path])};
 if(a.path==='@qvac/sdk')return {path:path.join(__dirname,'registry.ts')};
 const leaf=a.path.split('/').pop();
 if(boundaries[leaf]&&!a.importer.startsWith(__dirname))return {path:path.join(__dirname,boundaries[leaf])};
 if(a.path==='../components')return {path:path.join(__dirname,'components.ts')};
 if(leaf==='Sheet'&&!a.importer.startsWith(__dirname))return {path:path.join(__dirname,'sheet.tsx')};
 if(a.path==='react'||a.path==='react-dom/client'||a.path==='react-dom'||a.path==='react/jsx-runtime')return {path:require.resolve(a.path,{paths:[root]})};
});}}]}).then(result=>{
 const inputs=Object.keys(result.metafile.inputs);
 const forbidden=inputs.filter(p=>/services\/(QVACService|mindAgent|protocols|WalletManager)|react-native-bare-kit|@qvac\/sdk\/(?!dist\/models\/registry)/.test(p));
 if(forbidden.length)throw Error('Unsafe preview imports: '+forbidden.join(', '));
 fs.cpSync(path.join(__dirname,'assets/prismo/voice'),path.join(__dirname,'dist/voice'),{recursive:true,filter:p=>!p.endsWith('.py')});
 fs.copyFileSync(path.join(__dirname,'index.html'),path.join(__dirname,'dist/index.html'));
 for(const name of ['Ionicons','MaterialCommunityIcons'])fs.copyFileSync(path.join(root,`node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/${name}.ttf`),path.join(__dirname,`dist/${name}.ttf`));
 fs.writeFileSync(path.join(__dirname,'dist/build-audit.json'),JSON.stringify({nativeServicesExcluded:true,inputs},null,2));
 console.log(`Preview built: ${inputs.length} modules; native services excluded.`);
}).catch(e=>{console.error(e);process.exit(1)});
