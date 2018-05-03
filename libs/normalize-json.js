// All elements must have an attribute list, unless the element is a string
function normalize(json) {
	if (typeof json === 'undefined' || json.length === 0) {
		return [];
	}

	if (typeof json === 'string') {
		return json;
	}

	var [tagName, attributes, ...elementList] = json;

	// Second element should always be an attributes object.
	if (Array.isArray(attributes) || typeof attributes === 'string') {
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

module.exports = normalize;