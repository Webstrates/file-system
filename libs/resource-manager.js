const extract = (jsonml, resources) => {
	jsonml.forEach((element, index) => {
		if (Array.isArray(element)) return extract(element, resources);

		// If we're looking at tag name (index 0)
		if (index === 0
			// And the tag is a script and the element has an id that ends with .js
			&& ((element.toLowerCase() === 'script' && jsonml[1].id && jsonml[1].id.endsWith('.js'))
				// Or the tag is a style and the element has an id that ends with .css
			|| (element.toLowerCase() === 'style' && jsonml[1].id && jsonml[1].id.endsWith('.css')))) {
				// We remove the contents from the tag (i.e. removes the JS or CSS code).
				const resource = jsonml.splice(2).join('\n');
				// And save it as a resource instead
				if (resource) {
					resources.push([jsonml[1].id, resource]);
				}
		}
		return;
	});
	return jsonml;
};

const insert = (jsonml, resources) => {
	jsonml.forEach((element, index) => {
		if (Array.isArray(element)) return insert(element, resources);

		// If we're looking at tag name (index 0)
		if (index === 0
			// And the tag is a script and the element has an id that ends with .js
			&& ((element.toLowerCase() === 'script' && jsonml[1].id && jsonml[1].id.endsWith('.js'))
				// Or the tag is a style and the element has an id that ends with .css
			|| (element.toLowerCase() === 'style' && jsonml[1].id && jsonml[1].id.endsWith('.css')))) {
				// We remove the contents from the tag (the resoruce is already in there).
				jsonml.splice(2);
				// We find the resource in resources.
				const resource = resources.get(jsonml[1].id);
				// And insert it into the jsonml.
				if (resource) {
					jsonml.push(resource);
				}
		}
		return;
	});
	return jsonml;
};

module.exports = {
	extract, insert
};