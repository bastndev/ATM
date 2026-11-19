import { CargoWorkspace } from '../core/metadata';
import { cargoFor, readWorkspace } from './cargoTools';

/** A project folder's cargo and the workspace it belongs to. */
export interface LocatedWorkspace {
	cargo: string;
	workspace: CargoWorkspace;
}

/**
 * `cargo metadata --no-deps` per project folder, kept until a Cargo.toml is
 * saved, added or removed (members or the target folder may have moved).
 * The first save in a project asks cargo once (about a tenth of a second);
 * later saves start no process to find the workspace.
 */
export class CargoWorkspaces {
	private readonly cache = new Map<string, Promise<LocatedWorkspace>>();

	/** Rejects with cargo's message (a broken Cargo.toml, a missing toolchain…); a failure is asked again next time. */
	get(dir: string): Promise<LocatedWorkspace> {
		let found = this.cache.get(dir);
		if (!found) {
			const lookup = locate(dir);
			lookup.catch(() => {
				if (this.cache.get(dir) === lookup) {
					this.cache.delete(dir);
				}
			});
			this.cache.set(dir, lookup);
			found = lookup;
		}
		return found;
	}

	reset(): void {
		this.cache.clear();
	}
}

async function locate(dir: string): Promise<LocatedWorkspace> {
	const cargo = await cargoFor(dir);
	return { cargo, workspace: await readWorkspace(cargo, dir) };
}
