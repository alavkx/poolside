import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	MeetingProgressReporter,
	createProgress,
	formatDuration,
	formatCount,
	type PipelineStage,
	type MeetingProgressConfig,
} from "../src/meeting-progress";

describe("MeetingProgressReporter", () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	describe("constructor", () => {
		it("should create reporter with default options", () => {
			const reporter = new MeetingProgressReporter();
			expect(reporter).toBeDefined();
			expect(reporter.getCurrentStage()).toBeUndefined();
		});

		it("should accept verbose option", () => {
			const reporter = new MeetingProgressReporter({ verbose: true });
			expect(reporter).toBeDefined();
		});

		it("should accept silent option", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			expect(reporter).toBeDefined();
		});

		it("should accept both verbose and silent options", () => {
			const reporter = new MeetingProgressReporter({ verbose: true, silent: true });
			expect(reporter).toBeDefined();
		});
	});

	describe("setStage and getCurrentStage", () => {
		it("should set and retrieve current stage", () => {
			const reporter = new MeetingProgressReporter();
			const stage: PipelineStage = {
				name: "extraction",
				number: 2,
				totalStages: 5,
			};

			reporter.setStage(stage);

			expect(reporter.getCurrentStage()).toEqual(stage);
		});

		it("should update stage when called multiple times", () => {
			const reporter = new MeetingProgressReporter();
			const stage1: PipelineStage = { name: "chunking", number: 1, totalStages: 5 };
			const stage2: PipelineStage = { name: "extraction", number: 2, totalStages: 5 };

			reporter.setStage(stage1);
			expect(reporter.getCurrentStage()).toEqual(stage1);

			reporter.setStage(stage2);
			expect(reporter.getCurrentStage()).toEqual(stage2);
		});
	});

	describe("start", () => {
		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			reporter.start("Starting process...");
			reporter.stop();
		});

		it("should start spinner with message", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Processing...");
			reporter.stop();
		});

		it("should stop previous spinner when starting new one", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("First message");
			reporter.start("Second message");
			reporter.stop();
		});
	});

	describe("update", () => {
		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			reporter.update("Updated message");
		});

		it("should update existing spinner text", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Initial");
			reporter.update("Updated");
			reporter.stop();
		});

		it("should start spinner if none exists", () => {
			const reporter = new MeetingProgressReporter();
			reporter.update("New message");
			reporter.stop();
		});
	});

	describe("updateWithCount", () => {
		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			reporter.updateWithCount(1, 5);
		});

		it("should format message with count", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Processing");
			reporter.updateWithCount(3, 10);
			reporter.stop();
		});

		it("should include detail when provided", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Processing");
			reporter.updateWithCount(3, 10, "Extracting chunk");
			reporter.stop();
		});

		it("should start spinner if none exists", () => {
			const reporter = new MeetingProgressReporter();
			reporter.updateWithCount(1, 5, "Starting");
			reporter.stop();
		});
	});

	describe("succeed", () => {
		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			reporter.succeed("Done!");
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("should succeed spinner with message", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Working...");
			reporter.succeed("Complete!");
		});

		it("should log success without spinner", () => {
			const reporter = new MeetingProgressReporter();
			reporter.succeed("Done!");
			expect(consoleSpy).toHaveBeenCalled();
		});
	});

	describe("fail", () => {
		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			reporter.fail("Error occurred");
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("should fail spinner with message", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Working...");
			reporter.fail("Failed!");
		});

		it("should log failure without spinner", () => {
			const reporter = new MeetingProgressReporter();
			reporter.fail("Error!");
			expect(consoleSpy).toHaveBeenCalled();
		});
	});

	describe("debug", () => {
		it("should not output when not verbose", () => {
			const reporter = new MeetingProgressReporter({ verbose: false });
			reporter.debug("Debug info");
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ verbose: true, silent: true });
			reporter.debug("Debug info");
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("should output when verbose and not silent", () => {
			const reporter = new MeetingProgressReporter({ verbose: true, silent: false });
			reporter.debug("Debug info");
			expect(consoleSpy).toHaveBeenCalled();
			const output = consoleSpy.mock.calls.flat().join(" ");
			expect(output).toContain("[debug]");
			expect(output).toContain("Debug info");
		});

		it("should pause and resume spinner during debug output", () => {
			const reporter = new MeetingProgressReporter({ verbose: true });
			reporter.start("Processing...");
			reporter.debug("Debug message");
			reporter.stop();
		});
	});

	describe("info", () => {
		it("should not output when silent", () => {
			const reporter = new MeetingProgressReporter({ silent: true });
			reporter.info("Info message");
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it("should output info message", () => {
			const reporter = new MeetingProgressReporter();
			reporter.info("Info message");
			expect(consoleSpy).toHaveBeenCalled();
			const output = consoleSpy.mock.calls.flat().join(" ");
			expect(output).toContain("Info message");
		});

		it("should pause and resume spinner during info output", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Processing...");
			reporter.info("Info message");
			reporter.stop();
		});
	});

	describe("stop", () => {
		it("should stop active spinner", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Working...");
			reporter.stop();
		});

		it("should handle stop when no spinner is active", () => {
			const reporter = new MeetingProgressReporter();
			reporter.stop();
		});

		it("should handle multiple stop calls", () => {
			const reporter = new MeetingProgressReporter();
			reporter.start("Working...");
			reporter.stop();
			reporter.stop();
		});
	});
});

describe("createProgress", () => {
	it("should create reporter with default config", () => {
		const reporter = createProgress();
		expect(reporter).toBeInstanceOf(MeetingProgressReporter);
	});

	it("should create reporter with verbose option", () => {
		const reporter = createProgress({ verbose: true });
		expect(reporter).toBeInstanceOf(MeetingProgressReporter);
	});

	it("should create reporter with silent option", () => {
		const reporter = createProgress({ silent: true });
		expect(reporter).toBeInstanceOf(MeetingProgressReporter);
	});

	it("should create reporter with full config", () => {
		const config: MeetingProgressConfig = {
			verbose: true,
			silent: false,
		};
		const reporter = createProgress(config);
		expect(reporter).toBeInstanceOf(MeetingProgressReporter);
	});
});

describe("formatDuration", () => {
	it("should format milliseconds for values under 1 second", () => {
		expect(formatDuration(0)).toBe("0ms");
		expect(formatDuration(1)).toBe("1ms");
		expect(formatDuration(500)).toBe("500ms");
		expect(formatDuration(999)).toBe("999ms");
	});

	it("should format seconds for values under 1 minute", () => {
		expect(formatDuration(1000)).toBe("1.0s");
		expect(formatDuration(1500)).toBe("1.5s");
		expect(formatDuration(30000)).toBe("30.0s");
		expect(formatDuration(59999)).toBe("60.0s");
	});

	it("should format minutes and seconds for values over 1 minute", () => {
		expect(formatDuration(60000)).toBe("1m 0s");
		expect(formatDuration(90000)).toBe("1m 30s");
		expect(formatDuration(120000)).toBe("2m 0s");
		expect(formatDuration(125000)).toBe("2m 5s");
		expect(formatDuration(3661000)).toBe("61m 1s");
	});

	it("should handle edge cases", () => {
		expect(formatDuration(60001)).toBe("1m 0s");
		expect(formatDuration(119500)).toBe("1m 60s");
	});
});

describe("formatCount", () => {
	it("should use singular form for count of 1", () => {
		expect(formatCount(1, "item")).toBe("1 item");
		expect(formatCount(1, "chunk")).toBe("1 chunk");
		expect(formatCount(1, "decision")).toBe("1 decision");
	});

	it("should use plural form for count of 0", () => {
		expect(formatCount(0, "item")).toBe("0 items");
		expect(formatCount(0, "chunk")).toBe("0 chunks");
	});

	it("should use plural form for counts greater than 1", () => {
		expect(formatCount(2, "item")).toBe("2 items");
		expect(formatCount(5, "chunk")).toBe("5 chunks");
		expect(formatCount(100, "decision")).toBe("100 decisions");
	});

	it("should use custom plural form when provided", () => {
		expect(formatCount(0, "person", "people")).toBe("0 people");
		expect(formatCount(1, "person", "people")).toBe("1 person");
		expect(formatCount(2, "person", "people")).toBe("2 people");
	});

	it("should handle irregular plurals", () => {
		expect(formatCount(1, "entry", "entries")).toBe("1 entry");
		expect(formatCount(5, "entry", "entries")).toBe("5 entries");
	});
});
