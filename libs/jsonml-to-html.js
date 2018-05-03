const jsonmlTools = require('jsonml-tools');

/**
 * Replaces a string with another string in the attribute names of a JsonML structure.
 * Webstrate code usually handles this.
 * @param  {JsonML} snapshot    JsonML structure.
 * @param  {string} search      String to search for. Regex also works.
 * @param  {string} replacement String to replace search with.
 * @return {JsonML}             JsonML with replacements.
 * @private
 */
function replaceInKeys(jsonml, search, replacement) {
	if (Array.isArray(jsonml)) {
		return jsonml.map(e => replaceInKeys(e, search, replacement));
	}
	if (typeof jsonml === 'object') {
		for (const key in jsonml) {
			const cleanKey = key.replace(search, replacement);
			jsonml[cleanKey] = replaceInKeys(jsonml[key], search, replacement);
			if (cleanKey !== key) {
				delete jsonml[key];
			}
		}
	}
	return jsonml;
}

function jsonMlToHtml(json) {
	return jsonmlTools.toXML(replaceInKeys(json, '&dot;', '.'),
		['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'menuitem',
			'meta', 'param', 'source', 'track', 'wbr']);
}

module.exports = jsonMlToHtml;