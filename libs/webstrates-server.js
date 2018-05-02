const W3WebSocket = require('websocket').w3cwebsocket;
const chalk = require('chalk');
const sharedb = require("sharedb/lib/client");
const diffMatchPatch = require("diff-match-patch");
const jsondiff = require("json0-ot-diff");
const normalizeJson = require('./normalize-json');

let onConnectHandler, onChangeHandler, closeHandler;

const createWebsocket = (host) => {
	return new W3WebSocket(host,
		// 4 times "undefined" is the perfect amount.
		undefined, undefined, undefined, undefined, {
			maxReceivedFrameSize: 1024 * 1024 * 20 // 20 MB
	});
};

let sharedbDoc, keepAliveInterval;

const connect = (host, webstrateId) => {
	const websocket = createWebsocket(host);
	const sharedbConn = new sharedb.Connection(websocket);

	const sdbOpenHandler = websocket.onopen;
	websocket.onopen = function(event) {
		console.log(chalk.gray('◈'), 'Connected');
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
			console.error(chalk.red('!'), 'Error:', data.error.message);
		}
		if (!data.wa) {
			sdbMessageHandler(event);
		}

		// Save initial assets.
		if (data.wa === 'assets') {
			assets = data.assets;
		}

		// Update assets when a new asset is added.
		if (data.wa === 'asset') {
			const asset = data.asset;
			console.log(chalk.cyan('◈'), 'New asset on the server', asset.fileName, 'v=' + asset.v,
				chalk.gray('(' + asset.fileHash + ')'));
			assets.push(asset);
		}
	};

	const sdbCloseHandler = websocket.onclose;
	websocket.onclose = (event) => {
		console.log(chalk.gray('◈'), 'Connected closed.');
		closeHandler && closeHandler(event);
		sdbCloseHandler(event);
		clearInterval(keepAliveInterval);
	};

	const sdbErrorHandler = websocket.onerror;
	websocket.onerror = (event) => {
		console.error(chalk.red('!'), 'Error:', event);
		sdbErrorHandler(event);
		clearInterval(keepAliveInterval);
	};

	sharedbDoc = sharedbConn.get("webstrates", webstrateId);

	sharedbDoc.on('op', (ops, source) => {
		// Ignore our own ops.
		if (source) return;

		console.log(chalk.keyword('orange')('⬇'), ops);
		onChangeHandler(sharedbDoc.data, ops);
	});

	sharedbDoc.subscribe((error) => {
		if (error) return closeHandler && closeHandler(error);

		if (!sharedbDoc.type) {
			console.log("Document doesn't exist on server, creating it.");
			sharedbDoc.create('json0');
			const op = [{ "p": [], "oi": [ "html", {}, [ "body", {} ]]}];
			sharedbDoc.submitOp(op);
		}

		onChangeHandler(sharedbDoc.data);
	});
};

const save = (jsonml) => {
	// We can't save if we're not connected.
	if (!sharedbDoc.type) return;

	jsonml = normalizeJson(jsonml);
	const ops = jsondiff(normalizeJson(sharedbDoc.data), jsonml, diffMatchPatch);
	if (ops.length === 0) return;

	console.log(chalk.green('⬆'), ops);
	try {
		sharedbDoc.submitOp(ops);
	} catch (e) {
		console.warn("Invalid document, rebuilding.", e);
		var op = [{ "p": [], "oi": [ "html", {}, [ "body", {} ]]}];
		sharedbDoc.submitOp(op);
	}
}

let assets;
const getAssets = () => assets;

module.exports = {
	onChange: (handler) => onChangeHandler = handler,
	onClose: (handler) => onCloseHandler = handler,
	connect, save, getAssets
};