var WebSocketClient = require('websocket').w3cwebsocket;
var argv = require("optimist").argv;
var fs = require("fs");
var sharedb = require("sharedb/lib/client");
var jsonmlParse = require("jsonml-parse");
var jsondiff = require("json0-ot-diff");
var jsonml = require('jsonml-tools');

var websocket = new WebSocketClient("ws://localhost:7007/ws");
var webstrateId = argv.id || "contenteditable";
var MOUNT_PATH = "./documents/";
var MOUNT_POINT = MOUNT_PATH + webstrateId;

try {
	fs.accessSync(MOUNT_PATH, fs.F_OK);
} catch (e) {
	fs.mkdirSync(MOUNT_PATH);
}

var conn = new sharedb.Connection(websocket);

// We're sending our own events over the websocket connection that we don't want to mess up with ShareDB, so we filter
// them out.
var sdbMessageHandler = websocket.onmessage;
websocket.onmessage = function(event) {
	var data = JSON.parse(event.data);
	if (!data.wa) {
		sdbMessageHandler(event);
	}
};

var doc = conn.get("webstrates", webstrateId);

var watcher, readTimeout, oldHtml;

doc.on('op', function onOp(ops, source) {
	// If there's a source, it's ouw own op. We don't want to trigger on our own ops.
	if (source) {
		return;
	}
	writeDocument(jsonToHtml(doc.data));
});

doc.subscribe(function(err) {
	if (err) {
		throw err;
	}
	writeDocument(jsonToHtml(doc.data));
	watcher = fs.watch(MOUNT_POINT, fileChangeListener);
});

// All elements must have an attribute list, unless the element is a string
function normalize(json) {
	if (typeof json === "undefined") {
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

function jsonToHtml(json) {
	return jsonml.toXML(json, ["area", "base", "br", "col", "embed", "hr", "img", "input",
		"keygen", "link", "menuitem", "meta", "param", "source", "track", "wbr"]);
}

function htmlToJson(html, callback) {
	jsonmlParse(html.trim(), function(err, jsonml) {
		if (err) throw err;
		callback(jsonml);
	});
}

function fileChangeListener(event, filename) {
	if (readTimeout) {
		return;
	}

	readTimeout = setTimeout(function() {
		readTimeout = null;
	}, 500);

	if (event === "rename") {
		throw "Don't rename the webstrates file!";
	}

	var newHtml = fs.readFileSync(MOUNT_POINT, "utf8");
	if (newHtml === oldHtml) {
		return;
	}

	oldHtml = newHtml;
	htmlToJson(newHtml, function(newJson) {
		var normalizedOldJson = normalize(doc.data);
		var normalizedNewJson = normalize(newJson);

		doWhilePaused(function() {
			writeDocument(jsonToHtml(normalizedNewJson));
		})

		var ops = jsondiff(normalizedOldJson, normalizedNewJson);
		doc.submitOp(ops);
	});
}

function doWhilePaused(callback) {
	if (watcher) watcher.close();
	callback();
	watcher = fs.watch(MOUNT_POINT, fileChangeListener);
}

function writeDocument(html) {
	doWhilePaused(function() {
		oldHtml = html;
		fs.writeFileSync(MOUNT_POINT, html);
	});
}