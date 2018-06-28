const extract = (jsonml, resources) => {
	jsonml.forEach((element, index) => {
		if (Array.isArray(element)) return extract(element, resources);

		// If we're looking at tag name (index 0).
		if (index === 0) {
			// We see if this element should get extracted to its own resource in the file system.
			const fileName = extractedName(element, jsonml);
			if (fileName) {
				// If so, we remove the contents from the tag (i.e. removes the JS or CSS code).
				const resource = jsonml.splice(2).join('\n');
				// And save it as a resource instead.
				if (resource) {
					resources.push([fileName, resource]);
				}
			}
		}
	});
	return jsonml;
};

const insert = (jsonml, resources) => {
	jsonml.forEach((element, index) => {
		if (Array.isArray(element)) return insert(element, resources);

		// If we're looking at tag name (index 0)
		if (index === 0) {
			// We see if this element has been extracted to its own resource in the file system.
			const fileName = extractedName(element, jsonml);
			if (fileName) {
				// We remove the contents from the tag (the resoruce is already in there in the JsonML).
				jsonml.splice(2);
				// We find the resource in resources.
				const resource = resources.get(fileName);
				// And insert it into the jsonml.
				if (resource) {
					jsonml.push(resource);
				}
			}
		}
	});
	return jsonml;
};

/**
 * Get the file name that an element has been/should be extracted to.
 * @param  {string} element Tag name.
 * @param  {json} jsonml    JsonML for element.
 * @return {mixed}          File name string or false.
 * @private;
 */
const extractedName = (element, jsonml) => {
	// If the element has a file attribute that could be a file name.
	if (jsonml[1].file && jsonml[1].file.match(/[a-zA-Z0-9_-]{1,50}\.[a-zA-Z0-9_-]{1,20}/)) {
		return jsonml[1].file;
	}

	// Or the tag is a script and the element has an id that ends with .js
	if ((element.toLowerCase() === 'script' && jsonml[1].id && jsonml[1].id.endsWith('.js'))
		// Or the tag is a style and the element has an id that ends with .css
		|| (element.toLowerCase() === 'style' && jsonml[1].id && jsonml[1].id.endsWith('.css'))) {
		return jsonml[1].id;
	}

	return false;
};

module.exports = {
	extract, insert
};