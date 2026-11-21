import {build,transformWithOxc} from 'vite';
import postcss from 'postcss';
import presetEnv from 'postcss-preset-env';
import valueParser from 'postcss-value-parser';
import flexGap from 'flex-gap-polyfill';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';

const require=createRequire(import.meta.url);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sandboxHash=digest(readFileSync(require.resolve('@jitl/quickjs-ng-wasmfile-release-sync/wasm')));

export async function legacySandboxWasm(bytes) {
  const {default:binaryen}=await import('binaryen');
  const module=binaryen.readBinary(bytes);
  try{
    module.setFeatures(binaryen.Features.BulkMemory|binaryen.Features.BulkMemoryOpt|binaryen.Features.SignExt|binaryen.Features.NontrappingFPToInt|binaryen.Features.MutableGlobals);
    module.runPasses(['llvm-memory-copy-fill-lowering','signext-lowering','llvm-nontrapping-fptoint-lowering']);
    module.setFeatures(binaryen.Features.MutableGlobals);
    if(!module.validate())throw new Error('The current provider sandbox cannot be lowered safely for legacy webOS');
    return module.emitBinary();
  }finally{module.dispose();}
}

// Modern CSS stays untouched. This transform is only included in webos-legacy.
export async function legacyCss(css,{chrome=68}={}) {
  const result=await postcss([
    {postcssPlugin:'legacy-webos-values', Declaration(decl) {
      const ast=valueParser(decl.value);
      ast.walk(node=>{
        if(node.type!=='function')return;
        const groups=[[]];for(const child of node.nodes){if(child.type==='div'&&child.value===',')groups.push([]);else groups[groups.length-1].push(child);}
        if(node.value==='color-mix'&&groups.length>=3){
          node.type='word';node.value=valueParser.stringify(groups[1]).trim().replace(/\s+[\d.]+%$/,'');
        } else if(chrome<79&&['clamp','min','max'].includes(node.value)) {
          const selected=node.value==='clamp'?groups[1]:groups[groups.length-1];
          if(selected){node.type='word';node.value=valueParser.stringify(selected).trim();}
        }
      });
      decl.value=ast.toString();
      if(chrome<88&&decl.prop==='aspect-ratio')decl.cloneBefore({prop:'--legacy-aspect-ratio'});
      if(chrome<76&&decl.prop==='backdrop-filter')decl.cloneBefore({prop:'background-color',value:'rgba(12,12,12,.94)'});
    }},
    presetEnv({browsers:[`chrome ${chrome}`],stage:2,preserve:false,features:{'custom-properties':false,'cascade-layers':true,'where-pseudo-class':true}}),
    ...(chrome<84?[flexGap({only:true})]:[]),
  // Include the override before cascade lowering so it receives the same
  // specificity adjustment as the rest of the unlayered application styles.
  ]).process(css+'\n.tv-focus,.player-page .player-controls-wrapper.visible .tv-focus{outline:none!important;box-shadow:inset 0 0 0 3px var(--primary)!important;border-radius:8px}',{from:undefined});
  return '*{--legacy-aspect-ratio:initial}\n'+result.css;
}

export async function lowerLibmediaChunk(code,chrome=94){
  return (await transformWithOxc(code,'libmedia.avplayer.js',{target:`chrome${chrome}`,sourcemap:false})).code;
}

export function legacyWebosPlugin({chrome=68,lowerSandbox=true}={}) {
  let outputDirectory;
  return {
    name:'legacy-webos',
    configResolved(config){outputDirectory=path.resolve(config.root,config.build.outDir);},
    transformIndexHtml:{order:'pre',handler(){return [{tag:'script',attrs:{src:'./legacy-polyfills.js'},injectTo:'head-prepend'}];}},
    async generateBundle(_options,bundle){
      // Cascade-layer lowering needs the complete stylesheet. Transforming
      // lazy CSS chunks separately lets Tailwind's reset outrank player CSS.
      const styles=Object.values(bundle).filter(output=>output.type==='asset'&&output.fileName.endsWith('.css'));
      const main=styles.find(output=>/(?:^|\/)index[-.]/.test(output.fileName))||styles[0];
      if(main){
        main.source=await legacyCss([main,...styles.filter(style=>style!==main)].map(style=>String(style.source)).join('\n'),{chrome});
        for(const style of styles)if(style!==main)style.source='/* Included in the legacy main stylesheet. */';
      }
      for(const output of Object.values(bundle))if(output.type==='asset'){
        // Preserve the current patched QuickJS engine; lower instructions at
        // build time rather than downgrade its version or execute provider JS
        // in the page. Unrelated codecs and modern builds are untouched.
        if(lowerSandbox&&output.fileName.endsWith('.wasm')&&digest(output.source)===sandboxHash)output.source=await legacySandboxWasm(output.source);
      }
      const result=await build({configFile:false,publicDir:false,logLevel:'warn',build:{write:false,target:`chrome${chrome}`,minify:true,
        lib:{entry:path.resolve('src/platform/legacy/polyfills.ts'),name:'VegaLegacy',formats:['iife'],fileName:()=> 'legacy-polyfills.js'}}});
      for(const output of (Array.isArray(result)?result[0]:result).output)if(output.type==='chunk')this.emitFile({type:'asset',fileName:'legacy-polyfills.js',source:output.code});
    },
    async writeBundle(){
      // Public assets bypass Vite's JS target. Include libmedia's lazily loaded
      // chunks in the same syntax compatibility pass, without changing logic.
      for(const directory of [outputDirectory,path.join(outputDirectory,'assets')]){
        const files=await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
        for(const file of files)if(/^\d+\.avplayer\.js$/.test(file)){
          const target=path.join(directory,file);
          await writeFile(target,await lowerLibmediaChunk(await readFile(target,'utf8'),chrome));
        }
      }
    },
  };
}
