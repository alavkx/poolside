import ora, { type Ora } from "ora";
import chalk from "chalk";

export interface PipelineStage {
	name: string;
	number: number;
	totalStages: number;
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

	stop(): void {
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
