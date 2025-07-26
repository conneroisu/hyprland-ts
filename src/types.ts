export interface HyprlandConfig {
  readonly socketPath: string;
  readonly timeout?: number;
}

export interface HyprlandEventData {
  readonly event: string;
  readonly data: unknown;
}
