const util = require('util');
const request = require('request');
const W3WebSocket = require('websocket').w3cwebsocket;
const chalk = require('chalk');
const sharedb = require('sharedb/lib/client');
const diffMatchPatch = require('diff-match-patch');
const jsondiff = require('json0-ot-diff');
const normalizeJson = require('./normalize-json');

let changeHandler, closeHandler, assetHandler;
module.exports.onChange = (handler) => changeHandler = handler;
module.exports.onClose = (handler) => closeHandler = handler;
module.exports.onAsset = (handler) => assetHandler = handler;

/** Print an object, but makes sure it's not too wide for the terminal.
 * @private
 */
const shorten = (str, col = process.stdout.column - 3) => (
	str = JSON.stringify(str),
	str.length > col ? str.substring(0, col - 3) + '...' : str);

/**
 * Create websocket.
 * @private
 */
const createWebsocket = (host) => {
	return new W3WebSocket(host,
		// 4 times "undefined" is the perfect amount.
		undefined, undefined, undefined, undefined, {
			maxReceivedFrameSize: 1024 * 1024 * 20 // 20 MB
		});
};

const timestamp = () => {
	return (new Date).toTimeString().substring(0, 8)
};

let sharedbDoc, keepAliveInterval;

/**
 * Setup connection to Webstrates server.
 * @public
 */
module.exports.connect = (host, webstrateId) => {
	const websocket = createWebsocket(host);
	const sharedbConn = new sharedb.Connection(websocket);

	const sdbOpenHandler = websocket.onopen;
	websocket.onopen = function(event) {
		console.log(timestamp(), chalk.gray('◈'), 'Connected');
		sdbOpenHandler(event);
		keepAliveInterval = setInterval(() => {
			websocket.send(JSON.stringify({ type: 'alive' }));
		}, 25 * 1000);
	};

	// We're sending our own events over the websocket connection that we don't want messing with
	// ShareDB, so we filter them out.
	const sdbMessageHandler = websocket.onmessage;
	websocket.onmessage = (event) => {
		const data = JSON.parse(event.data);
		if (data.error) {
			console.error(timestamp(), chalk.red(chalk.bold('!')), 'Error:', data.error.message);
		}

		if (!data.wa) {
			sdbMessageHandler(event);
		}

		// Save initial assets.
		if (data.wa === 'assets') {
			module.exports.assets = data.assets;
			assetHandler && assetHandler(data.assets);
		}

		// Update assets when a new asset is added.
		if (data.wa === 'asset') {
			const asset = data.asset;
			console.log(timestamp(), chalk.cyan('◈'), 'New asset on the server', asset.fileName, 'v=' + asset.v,
				chalk.gray('(' + asset.fileHash + ')'));
			module.exports.assets.push(asset);
			assetHandler && assetHandler([asset]);
		}
	};

	const sdbCloseHandler = websocket.onclose;
	websocket.onclose = (event) => {
		console.log(timestamp(), chalk.red(chalk.bold('!')), 'Connected closed:', event.reason);
		closeHandler(event);
		sdbCloseHandler(event);
		clearInterval(keepAliveInterval);
	};

	const sdbErrorHandler = websocket.onerror;
	websocket.onerror = (event) => {
		// No reason to be verbose, the close event will trigger with an error reason.
		sdbErrorHandler(event);
		clearInterval(keepAliveInterval);
	};

	sharedbDoc = sharedbConn.get('webstrates', webstrateId);

	sharedbDoc.on('op', (ops, source) => {
		// Ignore our own ops.
		if (source) return;

		console.log(timestamp(), chalk.keyword('orange')('⬇'), shorten(ops));
		changeHandler(sharedbDoc.data, ops);
	});

	sharedbDoc.subscribe((error) => {
		if (error) return closeHandler(error);

		if (!sharedbDoc.type) {
			console.log(timestamp(), 'Document doesn\'t exist on server, creating it.');
			sharedbDoc.create('json0');
			const op = [{ 'p': [], 'oi': [ 'html', {}, [ 'body', {} ]]}];
			sharedbDoc.submitOp(op);
		}

		changeHandler(sharedbDoc.data);
	});
};

/**
 * Async setTimeout.
 */
const sleep = (delay) => new Promise(accept => setTimeout(accept, delay));

/**
 * Save document on server.
 * @public
 */
module.exports.save = async (jsonml) => {
	// We can't save if we're not connected.
	const retries = 0;
	while (!sharedbDoc.type) {
		if (retries === 100) {
			console.error(timestamp(), chalk.red(chalk.bold('!')), 'Error: Never established ShareDB connection.');
			return;
		}
		await sleep(50);
	}

	const submitOp = util.promisify(sharedbDoc.submitOp.bind(sharedbDoc));

	jsonml = normalizeJson(jsonml);
	let ops = jsondiff(normalizeJson(sharedbDoc.data), jsonml, diffMatchPatch);
	if (ops.length === 0) return;

	try {
		await submitOp(ops);
	} catch (e) {
		if (e.code === 4001) {
			console.warn(timestamp(), chalk.red(chalk.bold('!')), 'Forbidden');
			return;
		}
		console.warn(timestamp(), chalk.yellow('!'), 'Invalid document, rebuilding.', e);
		ops = [{ 'p': [], 'oi': [ 'html', {}, [ 'body', {} ]]}];
		await submitOp(ops);
	}
	console.log(timestamp(), chalk.green('⬆'), shorten(ops));
};

/**
 * Check whether we're authorized to upload assets to the server, i.e. if (correct) basic auth
 * credentials have been provided.
 * @public
 */
module.exports.checkAccess = (host) => {
	request.get(host, (error, response, body) => {
		if (error) {
			let errorMessage = error.code;
			if (error.code === 'EPROTO') errorMessage = 'Invalid protocol (try --insecure)';
			else if (error.code === 'ENOTFOUND') errorMessage = 'Can\'t resolve host';
			console.error(timestamp(), chalk.red(chalk.bold('!')), 'Error: ' + errorMessage);
			process.exit(1);
		}
		if (response.statusCode === 401) {
			console.warn(timestamp(), chalk.yellow('!'), 'Will not be able to upload assets, unauthorized.'),
			console.warn(timestamp(), '(Did you remember to specify HTTP basic credentials in the --host parameter?)');
		} else if (response.statusCode === 200) {
			module.exports.httpAccess = true;
		}
	});
};