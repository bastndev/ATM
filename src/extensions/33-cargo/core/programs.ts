import { CargoPackage, CargoWorkspace, Program, ProgramKind } from './metadata';
import { isInside, samePath } from './paths';

/**
 * Which program Cargo Run starts, and the `cargo build` command for it.
 *
 * Cargo Run decides once, when Run is pressed, in this order:
 * 1. A ▶ Run button above `fn main()` names its program.
 * 2. The open file is a program's main file (src/main.rs, src/bin/tool.rs…).
 * 3. The open file's package has one binary, or a `default-run`.
 * 4. The program picked last time in this workspace.
 * 5. The workspace has one binary, which is what plain `cargo run` starts.
 * 6. Otherwise the user picks, and the choice is remembered (step 4).
 */

export interface Selection {
	pkg: CargoPackage;
	program: Program;
}

/** A program named by a ▶ Run button: `cargo run --package app --bin app`. */
export interface ProgramRequest {
	packageName?: string;
	kind?: ProgramKind;
	name?: string;
}

export interface ChooseOptions {
	request?: ProgramRequest;
	/** The open file, absolute. */
	file?: string;
	/** selectionKey() of the program picked last time. */
	remembered?: string;
}

export type Choice =
	| { kind: 'selected'; selection: Selection }
	| { kind: 'ask'; candidates: Selection[] }
	| { kind: 'none' };

/** cargo prints JSON lines with the compiler's coloured error text inside. */
export const MESSAGE_FORMAT = '--message-format=json-diagnostic-rendered-ansi';

export function chooseProgram(workspace: CargoWorkspace, options: ChooseOptions): Choice {
	const all = allSelections(workspace);
	const selected = (selection: Selection | undefined): Choice | undefined => (selection ? { kind: 'selected', selection } : undefined);

	const { request, file, remembered } = options;
	const found =
		(request && selected(all.find((selection) => matches(selection, request)))) ||
		(file && selected(all.find((selection) => samePath(selection.program.srcPath, file)))) ||
		(file && selected(packageDefault(owningPackage(workspace, file)))) ||
		(remembered && selected(all.find((selection) => selectionKey(selection) === remembered))) ||
		selected(workspaceDefault(workspace));
	if (found) {
		return found;
	}
	return all.length > 0 ? { kind: 'ask', candidates: all } : { kind: 'none' };
}

/** Every program in the workspace: default members first, binaries before examples. */
export function allSelections(workspace: CargoWorkspace): Selection[] {
	const rank = (selection: Selection) =>
		(workspace.defaultMembers.includes(selection.pkg.id) ? 0 : 2) + (selection.program.kind === 'bin' ? 0 : 1);
	return workspace.packages
		.flatMap((pkg) => pkg.programs.map((program) => ({ pkg, program })))
		.map((selection, index) => ({ selection, index }))
		.sort((a, b) => rank(a.selection) - rank(b.selection) || a.index - b.index)
		.map(({ selection }) => selection);
}

/** A stable name for a program, to remember it between sessions. */
export function selectionKey(selection: Selection): string {
	return `${selection.pkg.name}/${selection.program.kind}/${selection.program.name}`;
}

function matches(selection: Selection, request: ProgramRequest): boolean {
	return (
		(request.packageName === undefined || selection.pkg.name === request.packageName) &&
		(request.kind === undefined || selection.program.kind === request.kind) &&
		(request.name === undefined || selection.program.name === request.name) &&
		// A request has to name something; an empty one matches nothing.
		(request.packageName !== undefined || request.name !== undefined)
	);
}

/** The deepest package folder holding the file, since packages can sit inside each other. */
function owningPackage(workspace: CargoWorkspace, file: string): CargoPackage | undefined {
	return workspace.packages
		.filter((pkg) => isInside(pkg.dir, file))
		.sort((a, b) => b.dir.length - a.dir.length)[0];
}

/** What `cargo run --package <pkg>` starts: its default-run binary, or its only binary. */
function packageDefault(pkg: CargoPackage | undefined): Selection | undefined {
	if (!pkg) {
		return undefined;
	}
	const bins = pkg.programs.filter((program) => program.kind === 'bin');
	const program = bins.find((bin) => bin.name === pkg.defaultRun) ?? (bins.length === 1 ? bins[0] : undefined);
	return program ? { pkg, program } : undefined;
}

/** What plain `cargo run` in the workspace folder starts: the root package's default, or the only binary. */
function workspaceDefault(workspace: CargoWorkspace): Selection | undefined {
	const rootPackage = workspace.packages.find((pkg) => samePath(pkg.dir, workspace.root));
	if (rootPackage) {
		return packageDefault(rootPackage);
	}
	const bins = workspace.packages
		.filter((pkg) => workspace.defaultMembers.includes(pkg.id))
		.flatMap((pkg) => pkg.programs.filter((program) => program.kind === 'bin').map((program) => ({ pkg, program })));
	return bins.length === 1 ? bins[0] : undefined;
}

/** Reads the program out of a `cargo run …` command line, as a ▶ Run button sends it. */
export function parseRunArgs(cargoArgs: readonly string[]): ProgramRequest {
	const request: ProgramRequest = {};
	for (let index = 0; index < cargoArgs.length; index++) {
		const arg = cargoArgs[index];
		const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined];
		const value = () => inline ?? cargoArgs[++index];
		if (flag === '--package' || flag === '-p') {
			request.packageName = value();
		} else if (flag === '--bin' || flag === '--example') {
			request.kind = flag === '--bin' ? 'bin' : 'example';
			request.name = value();
		}
	}
	return request;
}

/** `cargo build` for the selected program only, so other binaries in the workspace aren't built. */
export function buildArgs(selection: Selection, extra: readonly string[]): string[] {
	const args = ['build', MESSAGE_FORMAT, '--package', selection.pkg.name, `--${selection.program.kind}`, selection.program.name];
	if (selection.program.requiredFeatures.length > 0) {
		args.push('--features', selection.program.requiredFeatures.join(','));
	}
	return [...args, ...extra];
}

/** The command as the user would type it, without the JSON flag that is only there for ATM. */
export function displayCommand(args: readonly string[]): string {
	return ['cargo', ...args.filter((arg) => arg !== MESSAGE_FORMAT)].join(' ');
}
