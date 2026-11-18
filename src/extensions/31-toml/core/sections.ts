import { lineOf, lineText, TomlModel, TomlTable } from './scanner';

export interface TableSection {
	table: TomlTable;
	/** Index (in `model.tables`) of the table this one is nested under, or -1. */
	parent: number;
	headerLine: number;
	/** Last line of the table, including nested tables that follow it. */
	endLine: number;
}

/**
 * Works out where each `[table]` ends and how tables nest.
 *
 * A table ends at its last non-blank line before the next header. A comment
 * block sitting directly on top of the next header describes that header, so
 * it is left out. A header nests under the previous one when it extends its
 * key (`[workspace.package]` after `[workspace]`), and the parent then also
 * covers its nested tables. Nesting follows document order, so every range is
 * contiguous and breadcrumbs stay correct.
 */
export function computeSections(model: TomlModel): TableSection[] {
	const { tables } = model;
	const lastLine = model.lineStarts.length - 1;
	const commentLines = new Set(
		model.comments.filter((comment) => comment.ownLine).map((comment) => lineOf(model, comment.span.start)),
	);

	const sections: TableSection[] = tables.map((table, index) => {
		const headerLine = lineOf(model, table.span.start);
		const next = tables[index + 1];
		let line = next ? Math.max(headerLine, lineOf(model, next.span.start) - 1) : lastLine;
		if (next) {
			while (line > headerLine && commentLines.has(line)) {
				line--;
			}
		}
		while (line > headerLine && lineText(model, line).trim() === '') {
			line--;
		}
		return { table, parent: -1, headerLine, endLine: line };
	});

	const stack: number[] = [];
	sections.forEach((section, index) => {
		while (stack.length > 0 && !isNested(sections[stack[stack.length - 1]].table, section.table)) {
			stack.pop();
		}
		section.parent = stack.length > 0 ? stack[stack.length - 1] : -1;
		stack.push(index);
	});

	// Children always come after their parent, so walking backwards also
	// carries a grandchild's end up to the grandparent.
	for (let index = sections.length - 1; index >= 0; index--) {
		const { parent, endLine } = sections[index];
		if (parent >= 0) {
			sections[parent].endLine = Math.max(sections[parent].endLine, endLine);
		}
	}
	return sections;
}

function isNested(parent: TomlTable, child: TomlTable): boolean {
	return (
		child.keys.length > parent.keys.length && parent.keys.every((key, index) => key.name === child.keys[index].name)
	);
}
