#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const minimist = require('minimist');
const chalk = require('chalk');
const htmlToJsonMl = require('html-to-jsonml');
const jsonMlToHtml = require('./libs/jsonml-to-html');
const webstrates = require('./libs/webstrates-server');
const FileManager = require('./libs/file-manager');
const assetUploader = require('./libs/asset-uploader');
const normalizeJson = require('./libs/normalize-json');
const resourceManager = require('./libs/resource-manager');

const argv = minimist(process.argv.slice(2));
const args = argv._;

const WEBSTRATE_ID = argv.webstrateId || argv.id;
const HOST = argv.host || argv.h || 'web:strate@localhost:7007';
const SECURE = !(argv.insecure || argv.i);
const WEB_HOST = (SECURE ? 'https://' : 'http://') + HOST + '/' + WEBSTRATE_ID + '/';
const SOCKET_HOST = (SECURE ? 'wss://' : 'ws://') + HOST + '/ws/';
// Whether to terminate immediately after compiling and submitting the index.html.
const ONE_SHOT = argv.oneshot || argv.n || false;

if (!WEBSTRATE_ID) {
	console.error(chalk.red(chalk.bold('!')), 'Missing --webstrateId parameter.');
	process.exit(1);
}

webstrates.checkAccess(WEB_HOST);

const MOUNT_PATH = path.resolve(args[0] || WEBSTRATE_ID);
const fileManager = FileManager(MOUNT_PATH);

// When connecting to a webstrate with an existing index.html, should we keep our index.html and
// overwrite the one on the server or vice versa. If no index.html exists, we have nothing to keep,
// so we keep theirs.
const indexFileExists = fs.existsSync(path.resolve(MOUNT_PATH, 'index.html'));
const KEEP_OURS = !(argv.theirs || argv.t) && indexFileExists;

// Holds current state of document.
let jsonml;
// Holds all resources (script and style tags) that have been extracted into separate files.
let resources = new Map();

let hasSubmittedOurs = false;

// Listen for changes to the file system. fileName is the file name, hash is an md5 hash of the file
// if the file is an asset. readFile is a function that returns the contents of the file.
fileManager.onChange(async (type, activePath, readFile) => {
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

		// If we have extracted something, we need to update index.html, so the inline resource
		// will get removed.
		if (extractedResources.length > 0) {
			html = jsonMlToHtml(jsonml);
			fileManager.writeFile('index.html', html);
		}

		jsonml = resourceManager.insert(jsonml, resources);
		await webstrates.save(jsonml);
		if (ONE_SHOT) {
			process.exit(0);
		}
		hasSubmittedOurs = true;
	}
	else if (type === 'asset') {
		assetUploader.upload(WEB_HOST, activePath);
	}
	else if (type === 'resource') {
		const resource = readFile();
		// Don't update jsonml if the file hasn't changed.
		if (resources.get(fileName) === resource) return;

		resources.set(fileName, resource);
		// The HTML file might not have been read yet, in which case jsonml hasn't been defined. Because
		// of this, we can't insert the the resource into it.
		if (jsonml) {
			jsonml = resourceManager.insert(jsonml, resources);
			webstrates.save(jsonml);
		}
	}
});

fileManager.watch();

// Listen for changes on the Webstrates server.
webstrates.onChange((jsonml) => {
	// If we're preferring our version over the version on the server (theirs), we don't want to have
	// our local version overwritten whatever comes from the server, so we ignore all updates coming
	// from the server, until we've submitted our own.
	if (KEEP_OURS && !hasSubmittedOurs) return;

	jsonml = normalizeJson(jsonml);

	// Extract resources by side effects.
	let extractedResources = [];
	jsonml = resourceManager.extract(jsonml, extractedResources);
	extractedResources.forEach(([fileName, resource]) => {
		// Don't rewrite the file if it hasn't changed.
		if (resources.get(fileName) === resource) return;

		fileManager.writeFile('resources/' + fileName, resource);
		resources.set(fileName, resource);
	});

	const html = jsonMlToHtml(jsonml);
	fileManager.writeFile('index.html', html);
});

webstrates.onClose((event) => {
	console.log('Reconnecting');
	webstrates.connect(SOCKET_HOST, WEBSTRATE_ID);
});

webstrates.connect(SOCKET_HOST, WEBSTRATE_ID);
