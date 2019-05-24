const path = require('path');
const http = require('http');
const https = require('https');
const fs = require('fs');
const chalk = require('chalk');
const webstrates = require('./webstrates-server');

/**
 * Async setTimeout.
 */
const sleep = (delay) => new Promise(accept => setTimeout(accept, delay));

/**
 * Download asset from the server.
 * @param  {string}  host      URL of server.
 * @param  {string}  fileName  File name.
 * @param  {Number}  attempts  Used internally to detmine retries. Should not be provided by the
 *                             caller.
 * @public
 */
const download = async (host, tokenQuery, webstrateId, assetName, assetPath) =>
	new Promise(async (accept, reject) => {
		// Wait for httpAccess to be defined.
		let attempts = 100;
		while (typeof webstrates.httpAccess === 'undefined') {
			if (attempts > 0) {
				await sleep(50);
			} else {
				console.error(chalk.red(chalk.bold('!')), 'Error: Couldn\'t determine HTTP Access.');
				return reject('Couldn\'t determine HTTP Access.');
			}
			--attempts;
		}

		// By now, httpAccess should be a boolean.
		// If we don't have access to upload assets, we stop.
		if (!webstrates.httpAccess) return;

		console.log(host);
		const source = `${host}${assetName}${tokenQuery}`;
		const destination = path.join(assetPath, assetName);

		const file = fs.createWriteStream(destination);
		const lib = (source.startsWith('https:') ? https : http);
		lib.get(source, (res) => {
			if (res.statusCode !== 200) {
				let body = '';
				res.on('data', (chunk) => body += chunk);
				res.on('end', () =>
					console.error(chalk.red(chalk.bold('!')),
						'Error: Failed to download asset `' + assetName + '`:', body));
				return;
			}
			res.pipe(file);
			file.on('finish', () => {
				file.close();
				console.log(chalk.cyan('◈'), 'Downloaded asset', assetName);
				accept();
			});
			file.on('error', (error) => {
				fs.unlink(destination);
				reject(error);
			});
		});
	});

module.exports = {
	download
};