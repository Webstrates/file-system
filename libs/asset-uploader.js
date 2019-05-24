const path = require('path');
const fs = require('fs');
const request = require('request');
const webstrates = require('./webstrates-server');
const chalk = require('chalk');
const md5File = require('md5-file/promise');

/**
 * Upload asset to the server, assuming it isn't already there and accessible at the "head".
 * @param  {string}  host      URL of server.
 * @param  {string}  filePath  Path to file to be uplaoded.
 * @param  {Number}  attempts  Used internally to detmine retries. Should not be provided by the
 *                             caller.
 * @public
 */
const upload = async (host, filePath, attempts = 0) => {
	const fileName = path.basename(filePath);

	// Skipping files like .DS_Store.
	if (fileName.startsWith('.')) {
		return;
	}

	// We're waiting for the assets object to appear, i.e. for us to be connected to the server.
	if (!webstrates.assets) {
		if (attempts > 100) {
			console.error(chalk.red(chalk.bold('!')), 'Error: Never received assets from server.');
		} else {
			setTimeout(() => {
				upload(host, filePath, attempts + 1);
			}, 50);
		}
		return;
	}

	const fileHash = await md5File(filePath);
	const lastAsset = webstrates.assets.reduce((lastAsset, currentAsset) =>
		(currentAsset.fileName === fileName && currentAsset.v > lastAsset.v)
			? currentAsset
			: lastAsset,
	{ v: 0 });

	// We only continue if the last asset uploaded using the same name is the same as the one we're
	// uploading now. Imagine uploading v1 of an asset, then v2, and then trying to upload v2 again.
	// There's no reason to do this, since v2 is already accessible as just
	// /<webstrateId>/<assetName>. However, if we upload v1, then v2, and then v1 again, we should
	// re-upload v1, so it'll take over v2's place and gain the path /<webstrateId>/<assetName>.
	const shouldUpload = !lastAsset || (lastAsset && lastAsset.fileHash !== fileHash);

	if (!shouldUpload) {
		console.log(chalk.cyan('◈'), 'Skipping asset', chalk.bold(fileName),
			'- already available on the server.', chalk.gray('(' + fileHash + ')'));
		return;
	}

	// If we don't have access to upload assets, we stop.
	if (!webstrates.httpAccess) {
		console.error(chalk.red(chalk.bold('!')), 'Error: No HTTP access, unable to upload asset '
		+ fileName + '.', attempts);
		return;
	}

	const req = request.post(host, (error, response, body) => {
		if (error) return console.log(chalk.red(chalk.bold('!')), 'Error:', error);
		const asset = JSON.parse(body);
		console.log(chalk.cyan('◈'), 'Uploaded asset', asset.fileName, 'v=' + asset.v,
			chalk.gray('(' + asset.fileHash + ')'));
	});

	const form = req.form();
	form.append('file', fs.createReadStream(filePath));
};

module.exports = {
	upload
};