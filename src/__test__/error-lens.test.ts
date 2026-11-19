import * as assert from 'assert';
import { inlineMessage } from '../extensions/08-error-lens/core/message';

// This file uses no VS Code API, so it also runs under plain mocha (--ui tdd).

suite('Error Lens: the message at the end of the line', () => {
	test('adds the following lines while they fit whole', () => {
		const rustc = 'mismatched types\nexpected `u32`, found `&str`\nhelp: try using a conversion method: `.try_into().unwrap()`';
		assert.strictEqual(inlineMessage(rustc), 'mismatched types · expected `u32`, found `&str`');
		assert.strictEqual(inlineMessage('a\n\n  b  \r\nc'), 'a · b · c');
	});

	test('a long first line ends with an ellipsis instead of a cut word from the next line', () => {
		const long = 'no associated function or constant named `REDs` found for struct `Color32` in the current scope, really';
		const shown = inlineMessage(`${long}\nhelp: there is an associated constant \`RED\` with a similar name`);
		assert.strictEqual(shown.length, 100);
		assert.ok(shown.endsWith('…') && !shown.includes('help'));
		assert.strictEqual(inlineMessage(' \n '), '');
	});
});
