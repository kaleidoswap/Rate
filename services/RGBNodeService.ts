// services/RGBNodeService.ts
import { Platform } from 'react-native';

interface NodeStatus {
  daemonPort: number;
  isRunning: boolean;
  isInitialized: boolean;
  isUnlocked: boolean;
}

interface NodeSettings {
  nodePort?: number;
}

const DEFAULT_NODE_PORT = 3000;

export class RGBNodeService {
  private static instance: RGBNodeService;
  private nodeStatus: NodeStatus;

  private constructor() {
    this.nodeStatus = {
      daemonPort: DEFAULT_NODE_PORT,
      isRunning: false,
      isInitialized: false,
      isUnlocked: false,
    };
  }

  public static getInstance(): RGBNodeService {
    if (!RGBNodeService.instance) {
      RGBNodeService.instance = new RGBNodeService();
    }
    return RGBNodeService.instance;
  }

  public async initializeNode(settings?: NodeSettings): Promise<boolean> {
    try {
      // For remote node, we just need to verify the connection
      
      // Set the node status based on remote connection
      this.nodeStatus = {
        daemonPort: settings?.nodePort || DEFAULT_NODE_PORT,
        isRunning: true,
        isInitialized: true,
        isUnlocked: true,
      };

      return true;
    } catch (error) {
      console.error('Node initialization error:', error);
      return false;
    }
  }

  public getNodeStatus(): NodeStatus {
    return this.nodeStatus;
  }

  public setNodeStatus(status: Partial<NodeStatus>): void {
    this.nodeStatus = { ...this.nodeStatus, ...status };
  }
}