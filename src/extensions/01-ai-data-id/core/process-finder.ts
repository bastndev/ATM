import { execFile } from 'child_process';
import { promisify } from 'util';
import * as http from 'http';
import * as https from 'https';
import * as process from 'process';
import { ProcessInfo } from './types';

const execFileAsync = promisify(execFile);

// ── Constants ────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for a port health-check response. */
const PORT_PROBE_TIMEOUT_MS = 2_000;

/** Delay (ms) between retry attempts during process detection. */
const RETRY_DELAY_MS = 500;

/** Default maximum number of retries for process detection. */
const DEFAULT_MAX_RETRIES = 2;

/**
 * Unified, robust regex for capturing the Antigravity CSRF token across all OS environments
 * and versions (supports `--csrf_token`, `--csrf-token`, and `--csrfToken`).
 */
const CSRF_TOKEN_REGEX = /--csrf[_-]?token[=\s]+["']?([a-zA-Z0-9\-_]+)["']?/i;

/**
 * Regex for extracting server ports passed directly as command-line arguments
 * in newer Antigravity / `agy` CLI builds (e.g. `--extension_server_port 42100`, `--hub-port=64871`).
 */
const CLI_PORT_REGEX = /--(?:extension[_-]server[_-]port|hub[_-]port|server[_-]port|port)[=\s]+(\d+)/gi;

/** Health-check RPC endpoints supported across Antigravity 1.x and 2.0. */
const PROBE_ENDPOINTS = [
	'/exa.language_server_pb.LanguageServerService/GetUnleashData',
	'/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary',
	'/exa.language_server_pb.LanguageServerService/GetUserStatus',
] as const;

// ── Platform-specific process names ──────────────────────────────────

const PROCESS_NAMES: Record<string, string> = {
	win32_x64: 'language_server_windows_x64.exe',
	darwin_x64: 'language_server_macos',
	darwin_arm64: 'language_server_macos_arm',
	linux_x64: 'language_server_linux_x64',
	linux_arm64: 'language_server_linux_arm',
};

/**
 * Expanded candidate process names to support both legacy architecture-suffixed binaries
 * and modern Antigravity 2.0 / `agy` unified binaries.
 */
const CANDIDATE_PROCESS_NAMES: Record<string, readonly string[]> = {
	win32: [
		'agy.exe',
		'language_server_windows_x64.exe',
		'language_server.exe',
		'language_service_windows_x64.exe',
	],
	darwin: [
		'agy',
		'language_server_macos_arm',
		'language_server_macos',
		'language_server',
	],
	linux: [
		'agy',
		'language_server_linux_x64',
		'language_server_linux_arm',
		'language_server',
	],
};

/**
 * Detects the Antigravity language server process running locally
 * and discovers a working HTTPS port to communicate with it.
 *
 * Supports Windows (PowerShell), macOS, and Linux (x64 & ARM64),
 * across both Antigravity 1.x and Antigravity 2.0 / `agy` CLI.
 *
 * @updatedBy Enrique H. Hernandez (@EnriqueHH) <poke.henri@gmail.com>
 */
export class ProcessFinder {
	private readonly processName: string;
	private readonly candidateNames: readonly string[];

	constructor() {
		const key = `${process.platform}_${process.arch}`;
		this.processName = PROCESS_NAMES[key]
			?? PROCESS_NAMES[`${process.platform}_x64`]
			?? 'language_server_linux_x64';
		const platformCandidates = CANDIDATE_PROCESS_NAMES[process.platform] ?? [this.processName, 'language_server'];
		this.candidateNames = [...new Set([this.processName, ...platformCandidates])];
	}

	/**
	 * Extracts the CSRF token from a process command-line string.
	 */
	static extractCsrfToken(commandLine: string): string | null {
		const match = commandLine.match(CSRF_TOKEN_REGEX);
		return match ? match[1] : null;
	}

	/**
	 * Extracts any explicit server ports passed in a process command-line string.
	 */
	static extractCliPorts(commandLine: string): number[] {
		const ports: number[] = [];
		let match: RegExpExecArray | null;
		const regex = new RegExp(CLI_PORT_REGEX.source, 'gi');
		while ((match = regex.exec(commandLine)) !== null) {
			const port = parseInt(match[1], 10);
			if (Number.isFinite(port) && port > 0 && port <= 65535) {
				ports.push(port);
			}
		}
		return [...new Set(ports)];
	}

	/**
	 * Attempts to detect the Antigravity process and find a working port.
	 * First checks environment variables injected by Antigravity IDE (e.g. `ANTIGRAVITY_LS_ADDRESS`),
	 * then probes active processes (`agy`, `language_server`) across HTTP and HTTPS.
	 *
	 * @param maxRetries - Number of detection attempts before giving up.
	 * @returns Connection info or `null` if the process could not be found.
	 */
	async detectProcessInfo(maxRetries: number = DEFAULT_MAX_RETRIES): Promise<ProcessInfo | null> {
		// 1. Direct environment variable fast-path (inside Antigravity IDE)
		const envToken = process.env.ANTIGRAVITY_CSRF_TOKEN;
		const envAddress = process.env.ANTIGRAVITY_LS_ADDRESS;
		if (envToken && envAddress) {
			const portMatch = envAddress.match(/:(\d+)$/);
			if (portMatch) {
				const envPort = parseInt(portMatch[1], 10);
				const verified = await this.findWorkingPort([envPort], envToken);
				if (verified) {
					return {
						connectPort: verified.port,
						csrfToken: envToken,
						protocol: verified.protocol,
					};
				}
			}
		}

		for (let i = 0; i < maxRetries; i++) {
			try {
				const info = await this.getProcessInfoForPlatform();
				if (info) {
					// Fast path: probe explicit CLI ports (e.g. --hub-port) before spawning lsof/ss
					if (info.cliPorts.length > 0) {
						const directMatch = await this.findWorkingPort(info.cliPorts, info.csrfToken);
						if (directMatch) {
							return {
								connectPort: directMatch.port,
								csrfToken: info.csrfToken,
								protocol: directMatch.protocol,
							};
						}
					}

					const osPorts = await this.getListeningPorts(info.pid);
					const candidatePorts = [...new Set([...info.cliPorts, ...osPorts])];
					const verified = await this.findWorkingPort(candidatePorts, info.csrfToken);

					if (verified) {
						return {
							connectPort: verified.port,
							csrfToken: info.csrfToken,
							protocol: verified.protocol,
						};
					}
				}
			} catch (e) {
				console.error('[ai-data-id] Process detection error:', e);
			}

			if (i < maxRetries - 1) {
				await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
			}
		}
		return null;
	}

	private async getProcessInfoForPlatform(): Promise<{ pid: number; csrfToken: string; cliPorts: number[] } | null> {
		if (process.platform === 'win32') {
			return this.detectWindows();
		}
		return this.detectUnix();
	}

	private async detectWindows(): Promise<{ pid: number; csrfToken: string; cliPorts: number[] } | null> {
		const filterClauses = this.candidateNames.map(n => `name='${n}'`).join(' OR ');
		const psScript = `Get-CimInstance Win32_Process -Filter "${filterClauses}" | Select-Object ProcessId,CommandLine | ConvertTo-Json`;
		const { stdout } = await execFileAsync(
			'powershell', ['-NoProfile', '-Command', psScript],
		);

		try {
			const parsed = JSON.parse(stdout.trim()) as { ProcessId: number; CommandLine?: string } | Array<{ ProcessId: number; CommandLine?: string }>;
			const items = Array.isArray(parsed) ? parsed : [parsed];

			// Prioritize processes explicitly referencing antigravity/gemini/agy, fallback to any with a valid CSRF token
			const prioritized = [
				...items.filter(item => {
					const cmd = (item.CommandLine || '').toLowerCase();
					return cmd.includes('antigravity') || cmd.includes('.gemini') || cmd.includes('agy');
				}),
				...items,
			];

			for (const candidate of prioritized) {
				const commandLine = candidate?.CommandLine || '';
				const csrfToken = ProcessFinder.extractCsrfToken(commandLine);
				if (csrfToken && Number.isFinite(candidate.ProcessId)) {
					return {
						pid: candidate.ProcessId,
						csrfToken,
						cliPorts: ProcessFinder.extractCliPorts(commandLine),
					};
				}
			}
			return null;
		} catch {
			return null;
		}
	}

	private async detectUnix(): Promise<{ pid: number; csrfToken: string; cliPorts: number[] } | null> {
		const flag = process.platform === 'darwin' ? '-fl' : '-af';
		const candidateLines: string[] = [];

		for (const name of this.candidateNames) {
			try {
				const { stdout } = await execFileAsync('pgrep', [flag, name]);
				if (stdout) {
					candidateLines.push(...stdout.split('\n').filter(Boolean));
				}
			} catch {
				// Process name variant not running; try next candidate
			}
		}

		// Prioritize processes with antigravity/.gemini/agy in their path, then fallback to any matching language_server with CSRF token
		const prioritizedLines = [
			...candidateLines.filter(line => {
				const lower = line.toLowerCase();
				return lower.includes('antigravity') || lower.includes('.gemini') || lower.includes('agy');
			}),
			...candidateLines,
		];

		for (const line of prioritizedLines) {
			const csrfToken = ProcessFinder.extractCsrfToken(line);
			if (!csrfToken) { continue; }

			const parts = line.trim().split(/\s+/);
			const pid = parseInt(parts[0], 10);
			if (!Number.isFinite(pid)) { continue; }

			return {
				pid,
				csrfToken,
				cliPorts: ProcessFinder.extractCliPorts(line),
			};
		}
		return null;
	}

	private async getListeningPorts(pid: number): Promise<number[]> {
		const ports: number[] = [];
		try {
			if (process.platform === 'win32') {
				const psScript = `Get-NetTCPConnection -OwningProcess ${pid} -State Listen | Select-Object -ExpandProperty LocalPort | ConvertTo-Json`;
				const { stdout } = await execFileAsync(
					'powershell', ['-NoProfile', '-Command', psScript],
				);
				const data = JSON.parse(stdout.trim());
				if (Array.isArray(data)) { ports.push(...data); }
				else if (typeof data === 'number') { ports.push(data); }
			} else if (process.platform === 'darwin') {
				const { stdout } = await execFileAsync(
					'lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', String(pid)],
				);
				this.parseLsofOutput(stdout, ports);
			} else {
				// On Linux, try `ss` first, fallback to `lsof`
				try {
					const { stdout } = await execFileAsync('ss', ['-tlnp']);
					const pidFilter = `pid=${pid}`;
					for (const line of stdout.split('\n')) {
						if (line.includes(pidFilter)) {
							const ssRegex = /LISTEN\s+\d+\s+\d+\s+(?:\*|[\d.]+|\[[\da-f:]*\]):(\d+)/gi;
							let match;
							while ((match = ssRegex.exec(line)) !== null) {
								ports.push(parseInt(match[1], 10));
							}
						}
					}
				} catch {
					// ss not available, try lsof
					const { stdout } = await execFileAsync(
						'lsof', ['-nP', '-a', '-iTCP', '-sTCP:LISTEN', '-p', String(pid)],
					);
					this.parseLsofOutput(stdout, ports);
				}
			}
		} catch {
			// Port detection may fail silently; retries will handle it
		}
		return [...new Set(ports)].sort((a, b) => a - b);
	}

	/** Extracts port numbers from `lsof` output. */
	private parseLsofOutput(stdout: string, ports: number[]): void {
		const lsofRegex = /(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/gim;
		let match;
		while ((match = lsofRegex.exec(stdout)) !== null) {
			ports.push(parseInt(match[1], 10));
		}
	}

	/**
	 * Tests all candidate ports in parallel and returns the first one
	 * that responds successfully to an HTTP or HTTPS health-check.
	 *
	 * **Security note**: `rejectUnauthorized: false` is intentional here.
	 * The language server uses a self-signed certificate on `127.0.0.1` (or loopback HTTP on `--hub-port`).
	 * The CSRF token provides authentication; TLS here is only for transport encryption.
	 */
	private async findWorkingPort(
		ports: number[],
		csrfToken: string,
	): Promise<{ port: number; protocol: 'http' | 'https' } | null> {
		if (ports.length === 0) { return null; }
		const activeRequests = new Set<http.ClientRequest>();

		const cancelPendingRequests = (): void => {
			for (const request of activeRequests) {
				request.destroy();
			}
			activeRequests.clear();
		};

		const probeEndpoint = (
			port: number,
			protocol: 'http' | 'https',
			endpoint: string,
			payload: string,
		): Promise<{ port: number; protocol: 'http' | 'https' }> => {
			return new Promise((resolve, reject) => {
				const requestFn = protocol === 'https' ? https.request : http.request;
				const req = requestFn({
					hostname: '127.0.0.1',
					port,
					path: endpoint,
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Content-Length': Buffer.byteLength(payload),
						'X-Codeium-Csrf-Token': csrfToken,
						'X-CSRF-Token': csrfToken,
						'Connect-Protocol-Version': '1',
					},
					...(protocol === 'https' ? { rejectUnauthorized: false } : {}),
					timeout: PORT_PROBE_TIMEOUT_MS,
				}, res => {
					res.resume(); // Consume the stream to prevent socket memory leaks
					if (res.statusCode === 200) {
						resolve({ port, protocol });
					} else {
						reject(new Error(`Status: ${res.statusCode}`));
					}
				});
				activeRequests.add(req);
				req.on('close', () => {
					activeRequests.delete(req);
				});
				req.on('error', reject);
				req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
				req.write(payload);
				req.end();
			});
		};

		const testPort = async (port: number): Promise<{ port: number; protocol: 'http' | 'https' }> => {
			const defaultPayload = JSON.stringify({
				wrapper_data: {},
				metadata: { ideName: 'antigravity', extensionName: 'antigravity', locale: 'en' },
			});
			const protocols: ReadonlyArray<'http' | 'https'> = ['http', 'https'];
			for (const protocol of protocols) {
				for (const endpoint of PROBE_ENDPOINTS) {
					try {
						const verified = await probeEndpoint(port, protocol, endpoint, defaultPayload);
						cancelPendingRequests();
						return verified;
					} catch {
						// Try next endpoint / protocol
					}
				}
			}
			throw new Error(`Port ${port} did not respond to any known Antigravity RPC endpoint`);
		};

		try {
			// Tests all ports in parallel. Resolves instantly with the first successful port.
			const workingPort = await Promise.any(ports.map(testPort));
			cancelPendingRequests();
			return workingPort;
		} catch {
			// AggregateError thrown if all ports fail
			cancelPendingRequests();
			return null;
		}
	}
}
