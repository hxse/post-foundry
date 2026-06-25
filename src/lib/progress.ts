export type ProgressFieldValue = string | number | boolean;

export type ProgressEvent = {
  event: string;
  fields?: Record<string, ProgressFieldValue | undefined>;
};

export type ProgressReporter = (event: ProgressEvent) => void;

export function reportProgress(
  reporter: ProgressReporter | undefined,
  event: string,
  fields?: Record<string, ProgressFieldValue | undefined>
): void {
  if (!reporter) {
    return;
  }
  try {
    reporter({ event, fields });
  } catch {
    // Progress logging must not affect the production operation.
  }
}
