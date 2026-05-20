import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const args = new Set(process.argv.slice(2));
const minify = args.has('--minify');
const sourcemap = args.has('--sourcemap');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const webviewSourceDir = path.join(rootDir, 'src', 'webview');
const webviewOutDir = path.join(rootDir, 'media', 'webview');

const commonBrowserOptions = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  minify,
  sourcemap,
};

const reactAppOptions = {
  ...commonBrowserOptions,
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
};

function collectWebviewEntries(dir) {
  const entries = [];
  const fileNames = fs.readdirSync(dir, { withFileTypes: true });
  for (const fileName of fileNames) {
    const filePath = path.join(dir, fileName.name);
    if (fileName.isDirectory()) {
      entries.push(...collectWebviewEntries(filePath));
      continue;
    }

    if (!fileName.isFile()) {
      continue;
    }

    if (fileName.name.endsWith('.d.ts')) {
      continue;
    }

    if (fileName.name.endsWith('.ts') || fileName.name.endsWith('.tsx')) {
      entries.push(filePath);
    }
  }
  return entries;
}

function getOutputPath(entryPath) {
  const relativePath = path.relative(webviewSourceDir, entryPath);
  const sourceName = path.basename(relativePath);
  const outputDir = path.join(webviewOutDir, path.dirname(relativePath));

  if (sourceName === 'react-shared-vendor.entry.ts') {
    return path.join(outputDir, 'react-shared-vendor.js');
  }

  let baseName = sourceName;
  if (baseName.endsWith('.tsx')) {
    baseName = baseName.slice(0, -4);
  } else if (baseName.endsWith('.ts')) {
    baseName = baseName.slice(0, -3);
  }

  baseName = baseName.replace(/-react$/, '');
  return path.join(outputDir, `${baseName}.js`);
}

const entryFiles = collectWebviewEntries(webviewSourceDir);
const builds = entryFiles.map((entryFile) => {
  const outfile = getOutputPath(entryFile);
  return {
    entryPoints: [entryFile],
    outfile,
    options: entryFile.endsWith('.tsx') ? reactAppOptions : commonBrowserOptions,
  };
});

await Promise.all(
  builds.map(({ entryPoints, outfile, options }) => build({
    entryPoints,
    outfile,
    ...options,
  }))
);
