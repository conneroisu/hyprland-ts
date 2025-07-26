interface HyprlandConfig {
    readonly socketPath: string;
    readonly timeout?: number;
}
interface HyprlandEventData {
    readonly event: string;
    readonly data: unknown;
}

export type { HyprlandConfig, HyprlandEventData };
