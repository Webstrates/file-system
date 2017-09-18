"use strict";

var W3WebSocket = require('websocket').w3cwebsocket;
var argv = require("optimist").argv;
var fs = require("fs");
var chokidar = require("chokidar");
var sharedb = require("sharedb/lib/client");
var jsonmlParse = require("jsonml-parse");
var jsondiff = require("json0-ot-diff");
var jsonml = require('jsonml-tools');

var webstrateId = argv.id || "contenteditable";
var MOUNT_PATH = "./documents/";
var MOUNT_POINT = MOUNT_PATH + webstrateId + ".html";

var host = argv.host || argv.h || "ws://localhost:7007";

var normalizeHost = function(host) {
	const pattern = /^wss?:\/\//;
	if (pattern.test(host)) {
		return host;
	}
	return "wss://" + host;
	}

var cleanUpAndTerminate = function() {
	try {
	fs.unlinkSync(MOUNT_POINT);
	} catch (e) {
		// If it fails, it probably just doesn't exist.
	}
	doc.destroy();
	process.exit();
};

process.on('SIGINT', cleanUpAndTerminate);

try {
	fs.accessSync(MOUNT_PATH, fs.F_OK);
} catch (e) {
	fs.mkdirSync(MOUNT_PATH);
}

var websocket, doc, watcher, oldHtml;

var setup = function() {
	oldHtml = "";
	console.log("Connecting to " + normalizeHost(host) + "...");
	var websocket = new W3WebSocket(normalizeHost(host) + "/ws/",
		// 4 times "undefined" is the perfect amount.
		undefined, undefined, undefined, undefined, {
			maxReceivedFrameSize: 1024 * 1024 * 20 // 20 MB
		});

	var conn = new sharedb.Connection(websocket);

	var sdbOpenHandler = websocket.onopen;
	websocket.onopen = function(event) {
		console.log("Connected.");
		sdbOpenHandler(event);
	};

	// We're sending our own events over the websocket connection that we don't want messing with
	// ShareDB, so we filter them out.
	var sdbMessageHandler = websocket.onmessage;
	websocket.onmessage = function(event) {
		var data = JSON.parse(event.data);
		if (data.error) {
			console.error("Error:", data.error.message);
			cleanUpAndTerminate();
		}
		if (!data.wa) {
			sdbMessageHandler(event);
		}
	};

	var sdbCloseHandler = websocket.onclose;
	websocket.onclose = function(event) {
		console.log("Connection closed:", event.reason);
		console.log("Attempting to reconnect.");
		setTimeout(function() {
			setup();
		}, 1000);
		sdbCloseHandler(event);
	};

	var sdbErrorHandler = websocket.onerror;
	websocket.onerror = function(event) {
		console.log("Connection error.");
		sdbErrorHandler(event);
	};

	doc = conn.get("webstrates", webstrateId);

	doc.on('op', function onOp(ops, source) {
		var newHtml = jsonToHtml(doc.data)
		if (newHtml === oldHtml) {
			return;
		}
		writeDocument(jsonToHtml(doc.data));
	});

	doc.subscribe(function(err) {
		if (err) {
			throw err;
		}

		if (!doc.type) {
			console.log("Document doesn't exist on server, creating it.");
			doc.create('json0');
			var op = [{ "p": [], "oi": [ "html", {}, [ "body", {} ]]}];
			doc.submitOp(op);
		}

		writeDocument(jsonToHtml(doc.data));
		watcher = chokidar.watch(MOUNT_POINT);
		watcher.on('change', fileChangeListener);
	});
};

setup();

// All elements must have an attribute list, unless the element is a string
function normalize(json) {
	if (typeof json === "undefined" || json.length === 0) {
		return [];
	}

	if (typeof json === "string") {
		return json;
	}

	var [tagName, attributes, ...elementList] = json;

	// Second element should always be an attributes object.
	if (Array.isArray(attributes) || typeof attributes === "string") {
		elementList.unshift(attributes);
		attributes = {};
	}

	if (!attributes) {
		attributes = {};
	}

	elementList = elementList.map(function(element) {
		return normalize(element);
	});

	return [tagName.toLowerCase(), attributes, ...elementList];
}

function recurse(xs, callback) {
	return xs.map(function(x) {
			if (typeof x === "string") return callback(x, xs);
			if (Array.isArray(x)) return recurse(x, callback);
			return x;
	});
}

function jsonToHtml(json) {
	json = recurse(json, function(str, parent) {
		if (["script", "style"].includes(parent[0])) { return str; }
		return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	});
	try {
		return jsonml.toXML(json, ["area", "base", "br", "col", "embed", "hr", "img", "input",
			"keygen", "link", "menuitem", "meta", "param", "source", "track", "wbr"]);
	} catch (e) {
		console.log("Unable to parse JsonML.");
	}
}

function htmlToJson(html, callback) {
	jsonmlParse(html.trim(), function(err, jsonml) {
		if (err) throw err;
		jsonml = recurse(jsonml, function(str, parent) {
			if (["script", "style"].includes(parent[0])) { return str; }
			return str.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
		});
		callback(jsonml);
	}, { preserveEntities: true });
}

function fileChangeListener(path, stats) {
	var newHtml = fs.readFileSync(MOUNT_POINT, "utf8");
	if (newHtml === oldHtml) {
		return;
	}

	oldHtml = newHtml;
	htmlToJson(newHtml, function(newJson) {
		var normalizedOldJson = normalize(doc.data);
		var normalizedNewJson = normalize(newJson);
		var ops = jsondiff(doc.data, normalizedNewJson);
		try {
			doc.submitOp(ops);
		} catch (e) {
			console.log("Invalid document, rebuilding.");
			var op = [{ "p": [], "oi": [ "html", {}, [ "body", {} ]]}];
			doc.submitOp(op);
		}
	});
}

function doWhilePaused(callback) {
	//if (watcher) watcher.close();
	callback();
	//watcher = chokidar.watch(MOUNT_POINT);
	//watcher.on('change', fileChangeListener);
}

function writeDocument(html) {
	doWhilePaused(function() {
		oldHtml = html;
		fs.writeFileSync(MOUNT_POINT, html);
	});
}
