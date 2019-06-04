const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');

let onChangeHandler, assetPath, resourcePath;

const ignoreList = new Set();

const watchPath = (watchPath) => {
	watchPath = path.resolve(watchPath);
	assetPath = path.resolve(watchPath, 'assets/');
	resourcePath = path.resolve(watchPath, 'resources/');
	fs.ensureDirSync(watchPath);
	fs.ensureDirSync(assetPath);
	fs.ensureDirSync(resourcePath);

	chokidar.watch(watchPath, { ignored: /(^|[/\\])\../}).on('all', async (event, activePath) => {
		const type = assetPath === path.dirname(activePath) ? 'asset'
			: resourcePath === path.dirname(activePath) ? 'resource'
				: 'primary';

		// When download files, we don't want this to trigger on these half-downloaded files, so
		// we add them to the ignoreList until we're done.
		if (type === 'asset' && ignoreList.has(path.basename(activePath))) {
			return;
		}

		// If the file was deleted.
		if (!fs.existsSync(activePath)) {
			onChangeHandler(type, activePath, () => '');
			return;
		}

		const stat = fs.lstatSync(activePath);
		if (!stat.isFile()) return;

		onChangeHandler(type, activePath, () => fs.readFileSync(activePath, 'utf8'));
	});
};

const writeFile = async (path, data) => {
	fs.ensureFileSync(path);
	fs.writeFileSync(path, data);
};

module.exports = (_path) => ({
	ignoreList,
	assetPath: () => assetPath,
	onChange: (handler) => onChangeHandler = handler,
	writeFile: (file, data) => writeFile(path.resolve(_path, file), data),
	watch: () => watchPath(_path)
});