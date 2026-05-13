const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [, , command, target] = process.argv;

if (!['package', 'publish'].includes(command) || !target) {
	console.error('Usage: node scripts/vsce-target.cjs <package|publish> <target>');
	process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
const sourceDir = path.join(binDir, 'targets', target);
const isWindowsTarget = target.startsWith('win32-');
const binaryFileName = isWindowsTarget ? 'dltxt_lsp_server.exe' : 'dltxt_lsp_server';
const sourceBinaryPath = path.join(sourceDir, binaryFileName);
const stagedBinaryPath = path.join(binDir, binaryFileName);

if (!fs.existsSync(sourceBinaryPath)) {
	console.error(`Missing bridge binary for ${target}: ${sourceBinaryPath}`);
	console.error('Build the bridge on the matching platform first so the binary lands under bin/targets/<target>/.');
	process.exit(1);
}

fs.mkdirSync(binDir, { recursive: true });
for (const staleFileName of ['dltxt_lsp_server', 'dltxt_lsp_server.exe']) {
	const stalePath = path.join(binDir, staleFileName);
	if (fs.existsSync(stalePath)) {
		fs.rmSync(stalePath, { force: true });
	}
}

fs.copyFileSync(sourceBinaryPath, stagedBinaryPath);
if (!isWindowsTarget) {
	fs.chmodSync(stagedBinaryPath, 0o755);
}

const vsceEntrypoint = require.resolve('@vscode/vsce/vsce');
const result = spawnSync(process.execPath, [vsceEntrypoint, command, '--target', target], {
	cwd: rootDir,
	stdio: 'inherit',
	env: process.env,
});

if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 1);