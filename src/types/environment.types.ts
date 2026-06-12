export interface ToolInfo {
  name: string;
  available: boolean;
  version?: string;
  path?: string;
}

export interface CPUInfo {
  model: string;
  cores: number;
  threads: number;
}

export interface GPUInfo {
  model: string;
  vramMB: number;
  driverVersion?: string;
  cudaVersion?: string;
}

export interface DiskInfo {
  mountPoint: string;
  totalGB: number;
  freeGB: number;
}

export interface OSInfo {
  platform: NodeJS.Platform;
  arch: string;
  distro: string;
  version: string;
  isWSL: boolean;
  wslDistros: string[];
}

export interface EnvironmentInfo {
  os: OSInfo;
  cpu: CPUInfo;
  gpu: GPUInfo[];
  totalRAMGB: number;
  disks: DiskInfo[];
  tools: ToolInfo[];
}
