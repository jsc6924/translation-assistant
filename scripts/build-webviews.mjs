import { build } from 'esbuild';
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

const builds = [
  {
    entryPoints: [path.join(webviewSourceDir, 'react-shared-vendor.entry.ts')],
    outfile: path.join(webviewOutDir, 'react-shared-vendor.js'),
    options: commonBrowserOptions,
  },
  {
    entryPoints: [path.join(webviewSourceDir, 'batch-regex-replace-react.tsx')],
    outfile: path.join(webviewOutDir, 'batch-regex-replace.js'),
    options: reactAppOptions,
  },
  {
    entryPoints: [path.join(webviewSourceDir, 'dictserver-react.tsx')],
    outfile: path.join(webviewOutDir, 'dictserver.js'),
    options: reactAppOptions,
  },
  {
    entryPoints: [path.join(webviewSourceDir, 'trdb-viewer-react.tsx')],
    outfile: path.join(webviewOutDir, 'trdb-viewer.js'),
    options: reactAppOptions,
  },
  {
    entryPoints: [path.join(webviewSourceDir, 'format-config-react.tsx')],
    outfile: path.join(webviewOutDir, 'format-config.js'),
    options: reactAppOptions,
  },
];

await Promise.all(
  builds.map(({ entryPoints, outfile, options }) => build({
    entryPoints,
    outfile,
    ...options,
  }))
);
