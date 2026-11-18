import { KeySegment, lineEndOffset, Span, TomlEntry, TomlModel, TomlValue, ValueKind } from './scanner';
import { computeSections } from './sections';

export type OutlineKind = 'table' | 'arrayTable' | ValueKind;

export interface OutlineNode {
	name: string;
	/** Short text shown next to the name: a value preview, or `[n]` for `[[array tables]]`. */
	detail: string;
	kind: OutlineKind;
	range: Span;
	selectionRange: Span;
	children: OutlineNode[];
}

const PREVIEW_LENGTH = 40;

/**
 * Outline tree in document order. Entries before the first header come first,
 * then each table. A table nested right after its parent
 * (`[workspace.package]` after `[workspace]`) is shown under it with the rest
 * of its key (`package`). Otherwise it is a top-level item named by its full
 * key (`profile.release`). Keys of inline tables, and arrays that hold tables
 * or arrays, have their own children.
 */
export function buildOutline(model: TomlModel): OutlineNode[] {
	const roots = model.rootEntries.map((entry) => entryNode(model, entry));
	const sections = computeSections(model);
	const nodes: OutlineNode[] = [];
	const arrayTableCounts = new Map<string, number>();

	sections.forEach((section) => {
		const { table } = section;
		const parentLength = section.parent >= 0 ? sections[section.parent].table.keys.length : 0;
		const ownKeys = table.keys.slice(parentLength);

		let detail = '';
		if (table.kind === 'arrayTable') {
			const path = keyPath(table.keys);
			const index = arrayTableCounts.get(path) ?? 0;
			arrayTableCounts.set(path, index + 1);
			// A new `[[fruits]]` element restarts the numbering of `[[fruits.varieties]]`.
			for (const other of arrayTableCounts.keys()) {
				if (other.startsWith(path + KEY_SEPARATOR)) {
					arrayTableCounts.delete(other);
				}
			}
			detail = `[${index}]`;
		}

		const node: OutlineNode = {
			name: ownKeys.map((key) => key.raw).join('.'),
			detail,
			kind: table.kind,
			range: { start: table.span.start, end: Math.max(table.span.end, lineEndOffset(model, section.endLine)) },
			selectionRange: { start: ownKeys[0].span.start, end: ownKeys[ownKeys.length - 1].span.end },
			children: table.entries.map((entry) => entryNode(model, entry)),
		};
		nodes.push(node);
		(section.parent >= 0 ? nodes[section.parent].children : roots).push(node);
	});

	return roots;
}

const KEY_SEPARATOR = '\u0000';

function keyPath(keys: KeySegment[]): string {
	return keys.map((key) => key.name).join(KEY_SEPARATOR);
}

function entryNode(model: TomlModel, entry: TomlEntry): OutlineNode {
	return {
		name: entry.keys.map((key) => key.raw).join('.'),
		detail: detailOf(model, entry.value),
		kind: entry.value.kind,
		range: entry.span,
		selectionRange: entry.keySpan,
		children: childrenOf(model, entry.value),
	};
}

function itemNode(model: TomlModel, value: TomlValue, index: number): OutlineNode {
	return {
		name: String(index),
		detail: detailOf(model, value),
		kind: value.kind,
		range: value.span,
		selectionRange: value.span,
		children: childrenOf(model, value),
	};
}

function childrenOf(model: TomlModel, value: TomlValue): OutlineNode[] {
	if (value.kind === 'inlineTable') {
		return (value.entries ?? []).map((entry) => entryNode(model, entry));
	}
	if (value.kind === 'array') {
		return (value.items ?? []).flatMap((item, index) => (hasStructure(item) ? [itemNode(model, item, index)] : []));
	}
	return [];
}

function hasStructure(value: TomlValue): boolean {
	return value.kind === 'array' || value.kind === 'inlineTable';
}

function detailOf(model: TomlModel, value: TomlValue): string {
	if (value.kind === 'inlineTable' || (value.kind === 'array' && value.items?.some(hasStructure))) {
		return ''; // shown as children instead
	}
	const text = previewText(model, value);
	return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

function previewText(model: TomlModel, value: TomlValue): string {
	if (value.kind === 'array') {
		return `[${(value.items ?? []).map((item) => previewText(model, item)).join(', ')}]`;
	}
	return model.text.slice(value.span.start, value.span.end).replace(/\s+/g, ' ').trim();
}
