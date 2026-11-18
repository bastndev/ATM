import { lineOf, TomlEntry, TomlModel, TomlValue } from './scanner';
import { computeSections } from './sections';

export interface FoldRange {
	/** Zero-based first line. */
	start: number;
	/** Zero-based last line that is hidden. */
	end: number;
	kind?: 'comment';
}

/**
 * Folding ranges for a TOML document:
 * - `[table]` sections, with nested tables (`[a.b]` after `[a]`) inside their parent
 * - arrays, inline tables and `"""` / `'''` strings that span several lines
 * - blocks of two or more consecutive comment lines
 *
 * When a closing `]`, `}` or `"""` sits on its own line, it stays visible.
 */
export function computeFoldingRanges(model: TomlModel): FoldRange[] {
	const ranges: FoldRange[] = [];

	for (const section of computeSections(model)) {
		if (section.endLine > section.headerLine) {
			ranges.push({ start: section.headerLine, end: section.endLine });
		}
	}

	const visitValue = (value: TomlValue): void => {
		if (value.kind === 'array' || value.kind === 'inlineTable' || value.multiline) {
			const start = lineOf(model, value.span.start);
			let end = lineOf(model, Math.max(value.span.start, value.span.end - 1));
			if (end > start && closesOnOwnLine(model, value, end)) {
				end--;
			}
			if (end > start) {
				ranges.push({ start, end });
			}
		}
		value.items?.forEach(visitValue);
		value.entries?.forEach(visitEntry);
	};
	const visitEntry = (entry: TomlEntry): void => visitValue(entry.value);

	model.rootEntries.forEach(visitEntry);
	for (const table of model.tables) {
		table.entries.forEach(visitEntry);
	}

	let blockStart = -1;
	let previous = -2;
	const flushComments = (): void => {
		if (blockStart >= 0 && previous > blockStart) {
			ranges.push({ start: blockStart, end: previous, kind: 'comment' });
		}
	};
	for (const comment of model.comments) {
		if (!comment.ownLine) {
			continue;
		}
		const line = lineOf(model, comment.span.start);
		if (line !== previous + 1) {
			flushComments();
			blockStart = line;
		}
		previous = line;
	}
	flushComments();

	return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function closesOnOwnLine(model: TomlModel, value: TomlValue, endLine: number): boolean {
	const closer =
		value.kind === 'array' ? ']' : value.kind === 'inlineTable' ? '}' : model.text.slice(value.span.start, value.span.start + 3);
	const closeStart = value.span.end - closer.length;
	if (closeStart <= value.span.start || model.text.slice(closeStart, value.span.end) !== closer) {
		return false; // not closed
	}
	return model.text.slice(model.lineStarts[endLine], closeStart).trim() === '';
}
