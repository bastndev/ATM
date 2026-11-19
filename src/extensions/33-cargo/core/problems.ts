import * as path from 'path';
import { isInside } from './paths';

/**
 * Turns the compiler's JSON errors and warnings into editor problems (the
 * red and yellow underlines), so a failed build points at the exact line.
 * File names in rustc's JSON are relative to the workspace folder.
 */

export type ProblemSeverity = 'error' | 'warning' | 'info';

export interface Problem {
	/** Absolute path. */
	file: string;
	/** 0-based, like VS Code. */
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	severity: ProblemSeverity;
	message: string;
	/** Error code such as E0308, or a lint name such as unused_variables. */
	code?: string;
}

/**
 * Where problems go: the Problems panel and the underlines. Each workspace
 * folder's problems replace that folder's previous ones, so a check in one
 * Cargo workspace never wipes another's. Cargo Run's build, the save check
 * and a cargo command in a terminal all write here: the latest one wins.
 */
export interface ProblemSink {
	set(root: string, problems: Problem[]): void;
}

interface Span {
	file_name: string;
	line_start: number;
	line_end: number;
	column_start: number;
	column_end: number;
	is_primary: boolean;
	/** The text rustc prints next to the ^^^ marks, such as "expected `u32`, found `&str`". */
	label?: string | null;
	expansion?: { span?: Span } | null;
}

const SEVERITIES: Record<string, ProblemSeverity> = {
	error: 'error',
	'error: internal compiler error': 'error',
	warning: 'warning',
	note: 'info',
	help: 'info',
};

/** The problems in one `compiler-message`; none for summaries like "aborting due to 2 previous errors". */
export function toProblems(message: unknown, workspaceRoot: string): Problem[] {
	const data = asObject(message);
	const severity = typeof data.level === 'string' ? SEVERITIES[data.level] : undefined;
	if (!severity || typeof data.message !== 'string' || !Array.isArray(data.spans)) {
		return [];
	}
	const code = typeof asObject(data.code).code === 'string' ? (asObject(data.code).code as string) : undefined;
	const title = data.message;
	const children = childLines(data.children);

	return data.spans
		.filter((span): span is Span => isSpan(span) && span.is_primary)
		.map((primary) => {
			const span = userSpan(primary, workspaceRoot);
			return {
				file: path.resolve(workspaceRoot, span.file_name),
				line: Math.max(span.line_start - 1, 0),
				column: Math.max(span.column_start - 1, 0),
				endLine: Math.max(span.line_end - 1, 0),
				endColumn: Math.max(span.column_end - 1, 0),
				severity,
				message: [title, ...labelLine(primary.label, title), ...children].join('\n'),
				code,
			};
		});
}

/**
 * The primary span's label on its own line, as rustc's short output adds it
 * ("mismatched types: expected `u32`, found `&str`"). It often carries the
 * detail that matters; the message alone would say only "mismatched types".
 */
function labelLine(label: string | null | undefined, title: string): string[] {
	const text = label?.trim();
	return text && !title.includes(text) ? [text] : [];
}

/** Problems from a whole build, without the duplicates cargo prints when two targets share a file. */
export function collectProblems(messages: readonly unknown[], workspaceRoot: string): Problem[] {
	const seen = new Set<string>();
	return messages
		.flatMap((message) => toProblems(message, workspaceRoot))
		.filter((problem) => {
			const key = `${problem.file}:${problem.line}:${problem.column}:${problem.severity}:${problem.message}`;
			if (seen.has(key)) {
				return false;
			}
			seen.add(key);
			return true;
		});
}

/**
 * An error inside a macro points at the macro's own source (in the standard
 * library or a crate). Its expansion leads back to where the user called
 * the macro, which is the line worth underlining.
 */
function userSpan(span: Span, workspaceRoot: string): Span {
	let current = span;
	while (current.expansion?.span && isSpan(current.expansion.span) && !isUserFile(current.file_name, workspaceRoot)) {
		current = current.expansion.span;
	}
	return current;
}

function isUserFile(fileName: string, workspaceRoot: string): boolean {
	return !fileName.startsWith('<') && isInside(workspaceRoot, path.resolve(workspaceRoot, fileName));
}

/** `help: …` and `note: …` lines, shown under the message like the terminal does. */
function childLines(children: unknown): string[] {
	if (!Array.isArray(children)) {
		return [];
	}
	return children
		.map(asObject)
		.filter((child) => typeof child.level === 'string' && typeof child.message === 'string' && child.message.length > 0)
		.map((child) => `${child.level as string}: ${child.message as string}`);
}

function isSpan(value: unknown): value is Span {
	const span = asObject(value);
	return (
		typeof span.file_name === 'string' &&
		typeof span.line_start === 'number' &&
		typeof span.line_end === 'number' &&
		typeof span.column_start === 'number' &&
		typeof span.column_end === 'number'
	);
}

function asObject(value: unknown): Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
