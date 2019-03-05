const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');

let onChangeHandler;

const watchPath = (watchPath) => {
	watchPath = path.resolve(watchPath);
	const assetPath = path.resolve(watchPath, 'assets/');
	const resourcePath = path.resolve(watchPath, 'resources/');
	fs.ensureDirSync(watchPath);
	fs.ensureDirSync(assetPath);
	fs.ensureDirSync(resourcePath);

	// We start out by triggering all existing assets as changed.
	fs.readdirSync(assetPath).forEach(file => {
		const type = 'asset';
		const activePath = path.resolve(assetPath, file)
		onChangeHandler(type, activePath, () => fs.readFileSync(activePath, 'utf8'));
	});

	chokidar.watch(watchPath, { ignored: /(^|[/\\])\../}).on('all', async (event, activePath) => {
		const type = assetPath === path.dirname(activePath) ? 'asset'
			: resourcePath === path.dirname(activePath) ? 'resource'
				: 'primary';

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
	onChange: (handler) => onChangeHandler = handler,
	writeFile: (file, data) => writeFile(path.resolve(_path, file), data),
	watch: () => watchPath(_path)
});