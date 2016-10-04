"use strict";

Error.stackTraceLimit = Infinity;

var W3WebSocket = require('websocket').w3cwebsocket;
var argv = require("optimist").argv;
var fs = require("fs-extra");
var chokidar = require("chokidar");
var sharedb = require("sharedb/lib/client");
var jsonmlParse = require("jsonml-parse");
var jsondiff = require("json0-ot-diff");
var jsonml = require('jsonml-tools');

var webstrateId = argv.id || "contenteditable";
var MOUNT_PATH = "documents/" + webstrateId + "/";

var host = argv.host || argv.h || "localhost:7007";

var FileManager = function(fileName, path, initialData, dataType, options) {
	var module = {};

	var IS_RAW = dataType === FileManager.types.RAW;
	var rawData;

	module.onChange = function(callback) {
		onChangeListeners.push(callback);
	};

	module.change = function(newData, forceCreate) {
		var newRawData = (IS_RAW || !newData) ? newData : jsonToHtml(newData);
		if (!forceCreate && newRawData === rawData) {
			return;
		}
		rawData = newRawData;
		fs.writeFileSync(path + fileName, newRawData);
	};

	module.remove = function() {
		fs.remove(path);
	};

	var onChangeListeners = [];

	fs.mkdirsSync(path);
	module.change(initialData, true);

	var fileWatcher = chokidar.watch(path + fileName);
	fileWatcher.on('change', function(path, stats) {
		var newRawData = fs.readFileSync(path, "utf8");
		if (newRawData === rawData) {
			return;
		}
		rawData = newRawData;

		onChangeListeners.forEach(function(listener) {
			if (IS_RAW) {
				listener(newRawData);
			} else {
				htmlToJson(newRawData, listener);
			}
		})
	});

	return module;
};
FileManager.types = { RAW: 0, JSON: 1 };

var files = [];

process.on('SIGINT', function() {
	files.forEach(function(file) {
		file.remove();
	});
	doc.destroy();
	process.exit();
});

var websocket, doc, mainFile, assetFiles = {};

var setup = function() {
	console.log("Connecting to " + host + "...");
	var websocket = new W3WebSocket("ws://" + host + "/ws/",
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

	var assetFiles = {};

	doc.on('op', function onOp(ops, source) {
		var foundAssets = [];
		var newJson = JSON.parse(JSON.stringify(doc.data));
		var filteredDoc = recurse(newJson, function(el, parent) {
			var attributes = typeof parent[1] === "object" ? parent[1] : {};
			if (["script", "style"].includes(parent[0].toLowerCase()) && !attributes.src && attributes.id) {
				if (el === parent[0]) {
					if (!assetFiles[attributes.id]) {
						setupAssetFromElement(parent, attributes.id, assetFiles, doc);
					}
					foundAssets.push(attributes.id);
				} else if (el === parent[2]) {
					return "";
				}
			}
			return el;
		});

		// Identify which assets have been removed from the document, so they can be removed from the
		// disk as well.
		//console.log(Object.keys(assetFiles), foundAssets);
		var deletedAssets = Object.keys(assetFiles).filter(function(file) {
			return !foundAssets.includes(file);
		});
		//console.log("Deleted", deletedAssets);

		// Update main file on disk.
		mainFile.change(filteredDoc);
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

		var newJson = JSON.parse(JSON.stringify(doc.data));
		var filteredDoc = recurse(newJson, function(el, parent) {
			var attributes = typeof parent[1] === "object" ? parent[1] : {};
			if (["script", "style"].includes(parent[0].toLowerCase()) && !attributes.src && attributes.id) {
				if (el === parent[0]) {
					setupAssetFromElement(parent, attributes.id, assetFiles, doc);
				} else if (el === parent[2]) {
					return "";
				}
			}
			return el;
		});

		mainFile = new FileManager("index.html", MOUNT_PATH, filteredDoc, FileManager.types.JSON,
			{ excludeAssets: true });

		mainFile.onChange(function(newJson) {
			newJson = recurse(newJson, function(el, parent) {
				if (el !== parent[2]) return el;
				var attributes = typeof parent[1] === "object" ? parent[1] : {};
				if (["script", "style"].includes(parent[0].toLowerCase()) && !attributes.src && attributes.id) {
					return assetFiles[attributes.id] || "";
				}
				return el;
			});
			updateDocument(newJson);
		});
	});
};

setup();

function setupAssetFromElement(parent, assetId, assetFiles, doc) {
	var extension = parent[0].toLowerCase() === "script" ? "js" : "css";
	var contents = parent[2] || "";
	console.log("setupAssetFromElement", assetId);
	var assetFile = new FileManager(assetId + "." + extension, MOUNT_PATH, contents,
		FileManager.types.RAW);
	assetFiles[assetId] = assetFile;

	assetFile.onChange(function(newData) {
		var newJson = JSON.parse(JSON.stringify(doc.data));
		console.log("change...", JSON.stringify(newJson));
		// We have to work by side effect here, because parent[2] may never exist, meaning we will never
		// be able to map anything to it.
		recurse(newJson, function(el, parent) {
			if ((parent[2] && el !== parent[2]) || (parent[2] === undefined && el !== parent[0])) return;
			var attributes = typeof parent[1] === "object" ? parent[1] : {};
			if (["script", "style"].includes(parent[0].toLowerCase()) && !attributes.src
				&& attributes.id && attributes.id === assetId) {
					parent[2] = newData;
			}
		});
		updateDocument(newJson);
	});

	parent[2] = "";
	return parent;
}

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
		if (["script", "style"].includes(parent[0].toLowerCase())) { return str; }
		return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	});
	try {
		return jsonml.toXML(json, ["area", "base", "br", "col", "embed", "hr", "img", "input",
			"keygen", "link", "menuitem", "meta", "param", "source", "track", "wbr"]);
	} catch (e) {
		console.log("Unable to parse JsonML.", e, json);
	}
}

function htmlToJson(html, callback) {
	jsonmlParse(html.trim(), function(err, jsonml) {
		if (err) throw err;
		jsonml = recurse(jsonml, function(str, parent) {
			if (["script", "style"].includes(parent[0].toLowerCase())) { return str; }
			return str.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
		});
		callback(jsonml);
	}, { preserveEntities: true });
}

function updateDocument(newJson) {
	console.log("doc.data", doc.data);
	console.log("newJson", newJson);
	var normalizedOldJson = normalize(doc.data);
	var normalizedNewJson = normalize(newJson);
	var ops = jsondiff(normalizedOldJson, normalizedNewJson);
	try {
		doc.submitOp(ops);
	} catch (e) {
		console.warn("Invalid document, rebuilding.", e);
		var op = [{ "p": [], "oi": [ "html", {}, [ "body", {} ]]}];
		doc.submitOp(op);
	}
}