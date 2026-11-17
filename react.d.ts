import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import type { AgentBuildOptions, AgentBuildDoneDetail } from './index';

export interface AgentBuildProps extends AgentBuildOptions, Omit<HTMLAttributes<HTMLElement>, 'color'> {
  children?: ReactNode;
  /** Wrapper element. Default "div". */
  as?: ElementType;
  /** Called when every piece has been built. */
  onDone?: (detail: AgentBuildDoneDetail) => void;
}

export declare function AgentBuild(props: AgentBuildProps): JSX.Element;
export default AgentBuild;
