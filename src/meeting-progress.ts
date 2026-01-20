import ora, { type Ora } from "ora";
import chalk from "chalk";

export interface PipelineStage {
	name: string;
	number: number;
	totalStages: number;
}

export interface ChunkResultStats {
	chunkNum: number;
	total: number;
	decisions: number;
	actions: number;
	deliverables: number;
	timeMs: number;
	runningTotals: {
		decisions: number;
		actions: number;
		deliverables: number;
	};
}

export interface PipelineProgress {
	start(message: string): void;
	update(message: string): void;
	updateWithCount(current: number, total: number, detail?: string): void;
	succeed(message: string): void;
	fail(message: string): void;
	debug(message: string): void;
	info(message: string): void;
	setStage(stage: PipelineStage): void;
	getCurrentStage(): PipelineStage | undefined;
	phaseIntro(message: string): void;
	startTimedSpinner(baseMessage: string, etaMs?: number): void;
	stopTimer(): void;
	printChunkResult(stats: ChunkResultStats): void;
}

export interface MeetingProgressConfig {
	verbose?: boolean;
	silent?: boolean;
}

export class MeetingProgressReporter implements PipelineProgress {
	private spinner: Ora | null = null;
	private verbose: boolean;
	private silent: boolean;
	private currentStage: PipelineStage | undefined;
	private timerInterval: ReturnType<typeof setInterval> | null = null;
	private timerStartMs = 0;
	private timerBaseMessage = "";

	constructor(config: MeetingProgressConfig = {}) {
		this.verbose = config.verbose ?? false;
		this.silent = config.silent ?? false;
	}

	setStage(stage: PipelineStage): void {
		this.currentStage = stage;
	}

	getCurrentStage(): PipelineStage | undefined {
		return this.currentStage;
	}

	start(message: string): void {
		if (this.silent) return;

		if (this.spinner) {
			this.spinner.stop();
		}

		this.spinner = ora({
			text: message,
			color: "cyan",
		}).start();
	}

	update(message: string): void {
		if (this.silent) return;

		if (this.spinner) {
			this.spinner.text = message;
		} else {
			this.start(message);
		}
	}

	updateWithCount(current: number, total: number, detail?: string): void {
		if (this.silent) return;

		const progress = `${current}/${total}`;
		const message = detail ? `${detail} (${progress})` : progress;

		if (this.spinner) {
			this.spinner.text = message;
		} else {
			this.start(message);
		}
	}

	succeed(message: string): void {
		if (this.silent) return;

		if (this.spinner) {
			this.spinner.succeed(chalk.green(message));
			this.spinner = null;
		} else {
			console.log(chalk.green(`✓ ${message}`));
		}
	}

	fail(message: string): void {
		if (this.silent) return;

		if (this.spinner) {
			this.spinner.fail(chalk.red(message));
			this.spinner = null;
		} else {
			console.log(chalk.red(`✗ ${message}`));
		}
	}

	debug(message: string): void {
		if (!this.verbose || this.silent) return;

		const wasSpinning = this.spinner?.isSpinning;
		const spinnerText = this.spinner?.text;

		if (this.spinner) {
			this.spinner.stop();
		}

		console.log(chalk.gray(`  [debug] ${message}`));

		if (wasSpinning && spinnerText) {
			this.spinner = ora({
				text: spinnerText,
				color: "cyan",
			}).start();
		}
	}

	info(message: string): void {
		if (this.silent) return;

		const wasSpinning = this.spinner?.isSpinning;
		const spinnerText = this.spinner?.text;

		if (this.spinner) {
			this.spinner.stop();
		}

		console.log(chalk.gray(`  ${message}`));

		if (wasSpinning && spinnerText) {
			this.spinner = ora({
				text: spinnerText,
				color: "cyan",
			}).start();
		}
	}

	phaseIntro(message: string): void {
		if (this.silent) return;

		if (this.spinner) {
			this.spinner.stop();
			this.spinner = null;
		}

		console.log(chalk.white(`\n${message}`));
	}

	startTimedSpinner(baseMessage: string, etaMs?: number): void {
		if (this.silent) return;

		this.stopTimer();

		this.timerStartMs = Date.now();
		this.timerBaseMessage = baseMessage;

		const buildMessage = (): string => {
			const elapsed = Date.now() - this.timerStartMs;
			const elapsedStr = formatDuration(elapsed);
			let msg = `${this.timerBaseMessage} (${elapsedStr})`;
			if (etaMs !== undefined && etaMs > 0) {
				msg += ` • ~${formatDuration(etaMs)} remaining`;
			}
			return msg;
		};

		if (this.spinner) {
			this.spinner.stop();
		}

		this.spinner = ora({
			text: buildMessage(),
			color: "cyan",
		}).start();

		this.timerInterval = setInterval(() => {
			if (this.spinner) {
				this.spinner.text = buildMessage();
			}
		}, 1000);
	}

	stopTimer(): void {
		if (this.timerInterval) {
			clearInterval(this.timerInterval);
			this.timerInterval = null;
		}
	}

	printChunkResult(stats: ChunkResultStats): void {
		if (this.silent) return;

		this.stopTimer();

		if (this.spinner) {
			this.spinner.stop();
			this.spinner = null;
		}

		const parts: string[] = [];
		if (stats.decisions > 0) {
			parts.push(`${stats.decisions} decision${stats.decisions !== 1 ? "s" : ""}`);
		}
		if (stats.actions > 0) {
			parts.push(`${stats.actions} action${stats.actions !== 1 ? "s" : ""}`);
		}
		if (stats.deliverables > 0) {
			parts.push(`${stats.deliverables} deliverable${stats.deliverables !== 1 ? "s" : ""}`);
		}

		const findings = parts.length > 0 ? parts.join(", ") : "no items";
		const timeStr = formatDuration(stats.timeMs);
		const totalStr = `${stats.runningTotals.decisions}D, ${stats.runningTotals.actions}A, ${stats.runningTotals.deliverables}D`;

		console.log(chalk.gray(`  Chunk ${stats.chunkNum}/${stats.total}: ${findings} (${timeStr}) [total: ${totalStr}]`));
	}

	stop(): void {
		this.stopTimer();
		if (this.spinner) {
			this.spinner.stop();
			this.spinner = null;
		}
	}
}

export function createProgress(config?: MeetingProgressConfig): MeetingProgressReporter {
	return new MeetingProgressReporter(config);
}

export function formatDuration(ms: number): string {
	if (ms < 1000) {
		return `${ms}ms`;
	}
	const seconds = ms / 1000;
	if (seconds < 60) {
		return `${seconds.toFixed(1)}s`;
	}
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = (seconds % 60).toFixed(0);
	return `${minutes}m ${remainingSeconds}s`;
}

export function formatCount(count: number, singular: string, plural?: string): string {
	const word = count === 1 ? singular : (plural ?? `${singular}s`);
	return `${count} ${word}`;
}
