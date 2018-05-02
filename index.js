#!/usr/bin/env node
"use strict";

const path = require('path');
const argv = require("optimist").argv;
const htmlToJsonMl = require("html-to-jsonml");
const jsonMlToHtml = require('./libs/jsonml-to-html');
const webstrates = require('./libs/webstrates-server');
const FileManager = require('./libs/file-manager');
const assetUploader = require('./libs/asset-uploader');
const normalizeJson = require('./libs/normalize-json');
const resourceManager = require('./libs/resource-manager');

const webstrateId = argv.id || "contenteditable";

const host = argv.host || argv.h || "localhost:7007";
const insecure = argv.insecure || argv.i;
const webHost = (insecure ? 'http://' : 'https://') + host + '/' + webstrateId + '/';
const socketHost = (insecure ? 'ws://' : 'wss://') + host + '/ws/';

const MOUNT_PATH = path.resolve(webstrateId);
const fileManager = FileManager(MOUNT_PATH);

// Holds current state of document.
let jsonml;
// Holds all resources (script and style tags) that have been extracted into separate files.
let resources = new Map();

webstrates.onChange((jsonml) => {
	jsonml = normalizeJson(jsonml);
	let extractedResources = [];
	// Extract resources by side effects.
	jsonml = resourceManager.extract(jsonml, extractedResources);
	extractedResources.forEach(([fileName, resource]) => {
		fileManager.writeFile('resources/' + fileName, resource);
		resources.set(fileName, resource);
	});

	const html = jsonMlToHtml(jsonml);
	fileManager.writeFile('index.html', html);
});

webstrates.onClose((event) => {
	console.log('Reconnecting');
	webstrates.connect(socketHost, webstrateId);
});

// Listen for changes to the file system. fileName is the file name, hash is an md5 hash of the file
// if the file is an asset. readFile is a function that returns the contents of the file.
fileManager.onChange((type, activePath, readFile) => {
	const fileName = path.basename(activePath);
	if (type === 'primary' && fileName === 'index.html') {
		let html = readFile();
		jsonml = normalizeJson(htmlToJsonMl(html));

		// We extract any resources by (side effect) that might have been added manually to index.html.
		let extractedResources = [];
		jsonml = resourceManager.extract(jsonml, extractedResources);
		extractedResources.forEach(([fileName, resource]) => {
			fileManager.writeFile('resources/' + fileName, resource);
			resources.set(fileName, resource);
		});

		// If we have extracted something, we need to update index.html.
		if (extractedResources.length > 0) {
			html = jsonMlToHtml(jsonml);
			fileManager.writeFile('index.html', html);
		}

		jsonml = resourceManager.insert(jsonml, resources);
		webstrates.save(jsonml);
	}
	else if (type === 'asset') {
		assetUploader.upload(webHost, activePath);
	} else if (type === 'resource') {
		// If the change happened to a file that's a resource (by method of exclusion).
		resources.set(fileName, readFile());
		jsonml = resourceManager.insert(jsonml, resources);
		webstrates.save(jsonml);
	}
});

webstrates.connect(socketHost, webstrateId);
fileManager.watch();