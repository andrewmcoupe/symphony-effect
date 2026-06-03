import { Args, CliApp, Command, Options, Span } from "@effect/cli";
import { Effect, Option } from "effect";
import { VERSION } from "./index.js";

export const DEFAULT_WORKFLOW_PATH = "./WORKFLOW.md";

export interface CliOptions {
  readonly workflowPath: string;
  readonly port?: number;
}

const workflowPathArg = Args.text({ name: "workflow path" }).pipe(
  Args.withDefault(DEFAULT_WORKFLOW_PATH),
  Args.withDescription("Path to the Symphony workflow file."),
);

const portOption = Options.integer("port").pipe(
  Options.optional,
  Options.withDescription("Start the HTTP API on the specified port."),
);

interface ParsedCliOptions {
  readonly workflowPath: string;
  readonly port: Option.Option<number>;
}

const toCliOptions = ({ port, workflowPath }: ParsedCliOptions): CliOptions => ({
  workflowPath,
  ...(Option.isSome(port) ? { port: port.value } : {}),
});

export const makeCliCommand = () =>
  Command.make("symphony", {
    workflowPath: workflowPathArg,
    port: portOption,
  });

export const makeCliApp = () =>
  CliApp.make({
    name: "symphony",
    version: VERSION,
    executable: "symphony",
    command: makeCliCommand().descriptor,
    summary: Span.text("TypeScript Symphony orchestrator"),
  });

export const runCli = <E, R>(
  args: ReadonlyArray<string>,
  run: (options: CliOptions) => Effect.Effect<void, E, R>,
) =>
  CliApp.run(makeCliApp(), args, (parsed) =>
    run(toCliOptions(parsed as ParsedCliOptions)),
  ) as unknown as Effect.Effect<void, E, R | CliApp.CliApp.Environment>;
