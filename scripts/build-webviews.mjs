import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const args = new Set(process.argv.slice(2));
const minify = args.has('--minify');
const sourcemap = args.has('--sourcemap');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const webviewDir = path.join(rootDir, 'src', 'webview');

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
    entryPoints: [path.join(webviewDir, 'react-shared-vendor.entry.js')],
    outfile: path.join(webviewDir, 'react-shared-vendor.js'),
    options: commonBrowserOptions,
  },
  {
    entryPoints: [path.join(webviewDir, 'batch-regex-replace-react.jsx')],
    outfile: path.join(webviewDir, 'batch-regex-replace.js'),
    options: reactAppOptions,
  },
  {
    entryPoints: [path.join(webviewDir, 'dictserver-react.jsx')],
    outfile: path.join(webviewDir, 'dictserver.js'),
    options: reactAppOptions,
  },
  {
    entryPoints: [path.join(webviewDir, 'trdb-viewer-react.jsx')],
    outfile: path.join(webviewDir, 'trdb-viewer.js'),
    options: reactAppOptions,
  },
  {
    entryPoints: [path.join(webviewDir, 'format-config-react.jsx')],
    outfile: path.join(webviewDir, 'format-config.js'),
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
