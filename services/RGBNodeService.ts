// services/RGBNodeService.ts
import { Platform } from 'react-native';
import { store } from '../store';

interface NodeStatus {
  daemonPort: number;
  isRunning: boolean;
  isInitialized: boolean;
  isUnlocked: boolean;
}

export class RGBNodeService {
  private static instance: RGBNodeService;
  private nodeStatus: NodeStatus;

  private constructor() {
    this.nodeStatus = {
      daemonPort: 3000,
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

  public async initializeNode(): Promise<boolean> {
    try {
      // For remote node, we just need to verify the connection
      const settings = store.getState().settings;
      
      // Set the node status based on remote connection
      this.nodeStatus = {
        daemonPort: settings.nodePort || 3000,
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