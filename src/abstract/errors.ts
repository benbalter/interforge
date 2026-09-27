// Mirrors ogr/exceptions.py.

export type Forge = 'github' | 'gitlab';

export class ForgeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The forge answered with a non-2xx response. */
export class APIError extends ForgeError {
  constructor(
    message: string,
    readonly forge: Forge,
    readonly status: number,
    readonly response?: unknown,
  ) {
    super(message);
  }
}

export class NotFoundError extends APIError {}

/** The forge (or this instance of it) can't do what was asked. */
export class OperationNotSupported extends ForgeError {}

export class IssueTrackerDisabled extends OperationNotSupported {
  constructor(project: string) {
    super(`Issues are disabled for ${project}`);
  }
}

/** The request never got a response. */
export class NetworkError extends ForgeError {}
