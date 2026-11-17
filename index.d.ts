export interface AgentBuildOptions {
  /** Number of agents (1–40). Default 8. */
  agents?: number;
  /** Minimum speed multiplier. Default 1. */
  speed?: number;
  /** Target build time in seconds; big pages speed up to fit. 0 = never speed up. Default 20. */
  duration?: number;
  /** Most pieces to build; smaller bits are grouped into their parent. Default 150. */
  maxLayers?: number;
  /** false hides name tags; or your own list of names. */
  names?: false | string[] | string;
  /** Agent colours (hex). */
  colors?: string[] | string;
  /** Show the status pill. Default false. */
  hud?: boolean;
  /** When to start. Default "load". */
  trigger?: 'load' | 'visible' | 'manual';
  /** Auto-scroll the page with the build. Default true. */
  follow?: boolean;
  /** Wave finale that scrolls back to the top. Default true. */
  finale?: boolean;
}

export interface AgentBuildDoneDetail { ms: number; layers: number }

export interface AgentBuildInstance {
  /** Resolves once the page has been prepared (pieces hidden, agents about to start). */
  ready: Promise<void>;
  play(): Promise<void>;
  rebuild(): void;
  /** Stops and reveals everything immediately. */
  destroy(): void;
}

/** Let the agents build `root` (default: document.body). Returns null on the server. */
export function attach(root?: Element, options?: AgentBuildOptions): Promise<AgentBuildInstance | null>;
/** Registers the <agent-build> custom element. */
export function defineElement(): Promise<unknown>;
export default attach;

declare global {
  interface Window {
    AgentBuild?: { attach(root?: Element, options?: AgentBuildOptions): AgentBuildInstance };
  }
  interface HTMLElementEventMap { 'agentbuild:done': CustomEvent<AgentBuildDoneDetail> }
}
