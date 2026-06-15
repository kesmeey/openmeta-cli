import { spawnSync } from 'node:child_process';
import { arch, cpus, platform, totalmem } from 'node:os';
import type {
  CPUInfo,
  DiskInfo,
  EnvironmentInfo,
  GPUInfo,
  HypervisorInfo,
  OSInfo,
  ToolInfo,
} from '../types/environment.types.js';

function runCmd(command: string, args: string[] = []): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(command, args, { encoding: 'utf-8', shell: true, timeout: 15000 });
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: typeof result.status === 'number' ? result.status : null,
  };
}

function detectOS(): OSInfo {
  const currentPlatform = platform();
  const isWSL = detectWSL();
  const wslDistros = isWSL ? detectWSLDistros() : [];
  const hypervisor = detectHypervisor();

  let distro: string = currentPlatform;
  let version = '';

  if (currentPlatform === 'win32') {
    const r = runCmd('powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"');
    distro = r.stdout || 'Windows';
    const v = runCmd('powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Version"');
    version = v.stdout || '';
  } else if (currentPlatform === 'darwin') {
    const r = runCmd('sw_vers -productVersion');
    distro = 'macOS';
    version = r.stdout || '';
  } else {
    const r = runCmd('uname -o 2>/dev/null || uname -s');
    distro = r.stdout || currentPlatform;
    if (currentPlatform === 'linux') {
      const v = runCmd('uname -r');
      version = v.stdout || '';
    }
  }

  return { platform: currentPlatform, arch: arch(), distro, version, isWSL, wslDistros, hypervisor };
}

function detectHypervisor(): HypervisorInfo {
  const { isCI, name: ciName } = detectCI();
  const isContainer = detectContainer();

  if (platform() === 'win32') {
    return detectWindowsHypervisor(isCI, isContainer, ciName);
  }

  if (platform() === 'darwin') {
    return detectMacHypervisor(isCI, isContainer, ciName);
  }

  return detectLinuxHypervisor(isCI, isContainer, ciName);
}

function detectCI(): { isCI: boolean; name?: string } {
  const ciEnvs: Record<string, string> = {
    GITHUB_ACTIONS: 'GitHub Actions',
    GITLAB_CI: 'GitLab CI',
    JENKINS_HOME: 'Jenkins',
    CI: 'Generic CI',
    TRAVIS: 'Travis CI',
    CIRCLECI: 'CircleCI',
    APPVEYOR: 'AppVeyor',
    AZURE_DEV_OPS: 'Azure DevOps',
    TEAMCITY_VERSION: 'TeamCity',
  };

  for (const [envVar, name] of Object.entries(ciEnvs)) {
    if (process.env[envVar]) {
      return { isCI: true, name };
    }
  }

  return { isCI: false };
}

function detectContainer(): boolean {
  if (platform() !== 'linux') return false;

  // Docker container markers
  if (runCmd('test -f /.dockerenv && echo yes').stdout === 'yes') return true;

  const cgroup = runCmd('cat /proc/1/cgroup 2>/dev/null').stdout;
  if (/\/docker\/|docker-|containerd|kubepods/.test(cgroup)) return true;

  return false;
}

function detectWindowsHypervisor(isCI: boolean, isContainer: boolean, ciName?: string): HypervisorInfo {
  const cs = runCmd('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).Manufacturer"');
  const manufacturer = cs.stdout.toLowerCase();

  const model = runCmd(
    'powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).Model"',
  ).stdout.toLowerCase();

  if (manufacturer.includes('microsoft') && model.includes('virtual')) {
    return { isVM: true, type: 'hyper-v', isContainer, isCI, ciName };
  }

  if (manufacturer.includes('vmware')) {
    return { isVM: true, type: 'vmware', isContainer, isCI, ciName };
  }

  if (manufacturer.includes('innotek') || manufacturer.includes('oracle') || model.includes('virtualbox')) {
    return { isVM: true, type: 'virtualbox', isContainer, isCI, ciName };
  }

  if (manufacturer.includes('qemu') || model.includes('qemu') || model.includes('kvm')) {
    return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  }

  if (manufacturer.includes('parallels')) {
    return { isVM: true, type: 'parallels', isContainer, isCI, ciName };
  }

  const hyperv = runCmd('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystem).HypervisorPresent"');
  if (hyperv.stdout.trim() === 'True') {
    if (
      model.includes('virtual') ||
      model !== cs.stdout.toLowerCase() ||
      cs.stdout.toLowerCase().startsWith('microsoft')
    ) {
      return { isVM: true, type: 'hyper-v', isContainer, isCI, ciName };
    }
  }

  return { isVM: false, type: 'none', isContainer, isCI, ciName };
}

function detectMacHypervisor(isCI: boolean, isContainer: boolean, ciName?: string): HypervisorInfo {
  const ioreg = runCmd('ioreg -l 2>/dev/null | grep -e "Manufacturer" -e "Vendor Name"');
  const ioregLower = ioreg.stdout.toLowerCase();

  if (ioregLower.includes('vmware')) {
    return { isVM: true, type: 'vmware', isContainer, isCI, ciName };
  }

  if (ioregLower.includes('parallels')) {
    return { isVM: true, type: 'parallels', isContainer, isCI, ciName };
  }

  if (ioregLower.includes('qemu')) {
    return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  }

  const model = runCmd('sysctl -n hw.model 2>/dev/null').stdout.toLowerCase();
  if (model.includes('utm') || model.includes('qemu')) {
    return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  }

  return { isVM: false, type: 'none', isContainer, isCI, ciName };
}

function detectLinuxHypervisor(isCI: boolean, isContainer: boolean, ciName?: string): HypervisorInfo {
  const virt = runCmd('systemd-detect-virt 2>/dev/null').stdout.toLowerCase();

  if (virt === 'kvm') return { isVM: true, type: 'kvm', isContainer, isCI, ciName };
  if (virt === 'qemu') return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  if (virt === 'vmware') return { isVM: true, type: 'vmware', isContainer, isCI, ciName };
  if (virt === 'oracle') return { isVM: true, type: 'virtualbox', isContainer, isCI, ciName };
  if (virt === 'microsoft') return { isVM: true, type: 'hyper-v', isContainer, isCI, ciName };
  if (virt === 'parallels') return { isVM: true, type: 'parallels', isContainer, isCI, ciName };
  if (virt === 'wsl') return { isVM: true, type: 'wsl', isContainer, isCI, ciName };

  if (virt) {
    return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  }

  const sysVendor = runCmd('cat /sys/class/dmi/id/sys_vendor 2>/dev/null').stdout.toLowerCase();
  const productName = runCmd('cat /sys/class/dmi/id/product_name 2>/dev/null').stdout.toLowerCase();

  if (sysVendor.includes('microsoft') || productName.includes('virtual')) {
    return { isVM: true, type: 'hyper-v', isContainer, isCI, ciName };
  }
  if (sysVendor.includes('vmware')) {
    return { isVM: true, type: 'vmware', isContainer, isCI, ciName };
  }
  if (sysVendor.includes('innotek') || sysVendor.includes('oracle') || productName.includes('virtualbox')) {
    return { isVM: true, type: 'virtualbox', isContainer, isCI, ciName };
  }
  if (sysVendor.includes('qemu') || productName.includes('qemu') || productName.includes('kvm')) {
    return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  }

  const cpuinfo = runCmd("grep -m1 'hypervisor' /proc/cpuinfo 2>/dev/null").stdout;
  if (cpuinfo) {
    return { isVM: true, type: 'qemu', isContainer, isCI, ciName };
  }

  return { isVM: false, type: 'none', isContainer, isCI, ciName };
}

function detectWSL(): boolean {
  if (platform() !== 'win32') {
    const r = runCmd('uname -r');
    return /microsoft|wsl/i.test(r.stdout);
  }

  const r = runCmd('wsl --version 2>nul || echo ""');
  return r.status === 0 && r.stdout.length > 0;
}

function detectWSLDistros(): string[] {
  const r = runCmd('wsl -l -q 2>nul || echo ""');
  if (!r.stdout) return [];

  return r.stdout
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\x20-\x7E]/g, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('Windows Subsystem'));
}

function detectCPU(): CPUInfo {
  const cpuList = cpus();
  const model = cpuList[0]?.model || 'Unknown';
  const threads = cpuList.length;

  if (platform() === 'win32') {
    const r = runCmd('powershell -NoProfile -Command "(Get-CimInstance Win32_Processor).NumberOfCores"');
    const cores = parseInt(r.stdout, 10) || threads;
    return { model: model.replace(/\s+/g, ' ').trim(), cores, threads };
  }

  if (platform() === 'darwin') {
    const perfCores = parseInt(runCmd('sysctl -n hw.perflevel0.logicalcpu').stdout, 10) || 0;
    const effCores = parseInt(runCmd('sysctl -n hw.perflevel1.logicalcpu').stdout, 10) || 0;
    const totalCores = parseInt(runCmd('sysctl -n hw.physicalcpu').stdout, 10) || threads;
    return {
      model: runCmd('sysctl -n machdep.cpu.brand_string').stdout || model,
      cores: perfCores + effCores || totalCores,
      threads,
    };
  }

  const physCores = parseInt(runCmd('grep -c "^processor" /proc/cpuinfo 2>/dev/null').stdout, 10) || 0;
  const siblings =
    parseInt(runCmd("grep -m1 'siblings' /proc/cpuinfo 2>/dev/null | awk '{print $NF}'").stdout, 10) || 0;
  const socketCount =
    parseInt(runCmd("grep 'physical id' /proc/cpuinfo 2>/dev/null | sort -u | wc -l").stdout, 10) || 1;

  return {
    model: model.replace(/\s+/g, ' ').trim(),
    cores: (siblings > 0 ? threads / (siblings / physCores || 1) : threads) * socketCount || threads,
    threads,
  };
}

function detectGPU(): GPUInfo[] {
  const gpus: GPUInfo[] = [];

  if (platform() === 'win32') {
    const r = runCmd(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object Name,AdapterRAM,DriverVersion | Format-List"',
    );
    if (r.stdout) {
      const blocks = r.stdout.split(/\r?\n\r?\n/);
      for (const block of blocks) {
        const name = extractField(block, 'Name');
        const ram = extractField(block, 'AdapterRAM');
        const driver = extractField(block, 'DriverVersion');
        if (name && ram) {
          gpus.push({
            model: name,
            vramMB: Math.round(parseInt(ram, 10) / (1024 * 1024)),
            driverVersion: driver || undefined,
            cudaVersion: undefined,
          });
        }
      }
    }

    const nvidiaSmi = runCmd('nvidia-smi --query-gpu=name,driver_version --format=csv,noheader 2>nul');
    if (nvidiaSmi.stdout) {
      const cudaR = runCmd('nvidia-smi 2>nul');
      const cudaMatch = cudaR.stdout.match(/CUDA Version:\s*([\d.]+)/);
      for (const gpu of gpus) {
        if (/nvidia/i.test(gpu.model)) {
          gpu.cudaVersion = cudaMatch?.[1];
        }
      }
    }

    return gpus;
  }

  if (platform() === 'darwin') {
    const r = runCmd('system_profiler SPDisplaysDataType -json 2>/dev/null');
    if (r.stdout) {
      try {
        const data = JSON.parse(r.stdout);
        const displays = data.SPDisplaysDataType || [];
        for (const d of displays) {
          const chip = d.sppci_model || d.sppci_vendor || '';
          if (chip) {
            gpus.push({
              model: chip,
              vramMB: parseInt(d.spdisplays_vram, 10) || 0,
            });
          }
        }
      } catch {
        // fallback to text parsing
      }
    }
    if (gpus.length === 0) {
      const chipR = runCmd('sysctl -n machdep.cpu.brand_string');
      gpus.push({ model: chipR.stdout || 'Apple Silicon', vramMB: 0 });
    }
    return gpus;
  }

  // Linux
  const lspci = runCmd('lspci 2>/dev/null | grep -i "vga\\|3d\\|display"');
  if (lspci.stdout) {
    for (const line of lspci.stdout.split('\n')) {
      const parts = line.split(': ');
      const name = parts.slice(2).join(': ') || parts[1] || line;
      gpus.push({ model: name.trim(), vramMB: 0 });
    }
  }

  const nvidiaSmi = runCmd('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null');
  if (nvidiaSmi.stdout) {
    const cudaR = runCmd('nvidia-smi 2>/dev/null');
    const cudaMatch = cudaR.stdout.match(/CUDA Version:\s*([\d.]+)/);
    return nvidiaSmi.stdout.split('\n').map((line) => {
      const [model = '', memStr = '0'] = line.split(',').map((s) => s.trim());
      return {
        model: model || 'NVIDIA GPU',
        vramMB: parseInt(memStr, 10) || 0,
        cudaVersion: cudaMatch?.[1],
      };
    });
  }

  return gpus;
}

function detectDisks(): DiskInfo[] {
  const disks: DiskInfo[] = [];

  if (platform() === 'win32') {
    const r = runCmd(
      'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | Select-Object DeviceID,Size,FreeSpace | Format-List"',
    );
    if (r.stdout) {
      const blocks = r.stdout.split(/\r?\n\r?\n/);
      for (const block of blocks) {
        const device = extractField(block, 'DeviceID');
        const size = extractField(block, 'Size');
        const free = extractField(block, 'FreeSpace');
        if (device && size) {
          disks.push({
            mountPoint: device,
            totalGB: Math.round(parseInt(size, 10) / (1024 * 1024 * 1024)),
            freeGB: Math.round(parseInt(free || '0', 10) / (1024 * 1024 * 1024)),
          });
        }
      }
    }
    return disks;
  }

  // macOS / Linux
  const df = runCmd('df -k / 2>/dev/null');
  if (df.stdout) {
    const lines = df.stdout.split('\n');
    if (lines.length >= 2) {
      const parts = (lines[1] ?? '').split(/\s+/);
      const totalKB = parseInt(parts[1] ?? '0', 10) || 0;
      const freeKB = parseInt(parts[3] ?? '0', 10) || 0;
      disks.push({
        mountPoint: '/',
        totalGB: Math.round(totalKB / (1024 * 1024)),
        freeGB: Math.round(freeKB / (1024 * 1024)),
      });
    }
  }

  return disks;
}

function detectTool(name: string, versionArgs: string[] = ['--version']): ToolInfo {
  const versionResult = spawnSync(name, versionArgs, {
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (versionResult.status === 0) {
    const version = (versionResult.stdout || versionResult.stderr || '').trim().split(/\r?\n/)[0];
    if (version) {
      return { name, available: true, version };
    }
    return { name, available: true };
  }

  if (versionResult.error) {
    const code = (versionResult.error as NodeJS.ErrnoException).code || '';
    const msg = versionResult.error.message || '';
    if (/ENOENT/i.test(code) || /ENOENT/i.test(msg)) {
      return { name, available: false };
    }
    return { name, available: true };
  }

  let pathResult: ReturnType<typeof spawnSync>;
  if (platform() === 'win32') {
    pathResult = spawnSync('where', [name], { encoding: 'utf-8', timeout: 5000 });
  } else {
    pathResult = spawnSync('which', [name], { encoding: 'utf-8', timeout: 5000 });
  }

  const pathStdout = typeof pathResult.stdout === 'string' ? pathResult.stdout : pathResult.stdout?.toString();
  if (pathResult.status === 0 && pathStdout?.trim()) {
    const path = (pathStdout.trim().split(/\r?\n/)[0] ?? '').trim();
    if (path && !path.startsWith('which:') && !/^(INFO|Could not find)/i.test(path)) {
      return { name, available: true, path };
    }
  }

  return { name, available: false };
}

const TOOL_LIST: Array<{ name: string; versionArgs?: string[] }> = [
  { name: 'git' },
  { name: 'node', versionArgs: ['-v'] },
  { name: 'bun' },
  { name: 'python3', versionArgs: ['-V'] },
  { name: 'python', versionArgs: ['-V'] },
  { name: 'go', versionArgs: ['version'] },
  { name: 'rustc' },
  { name: 'cargo' },
  { name: 'docker' },
  { name: 'cmake' },
  { name: 'java', versionArgs: ['-version'] },
  { name: 'dotnet' },
  { name: 'gcc' },
  { name: 'clang' },
  { name: 'nvidia-smi' },
];

function detectTools(): ToolInfo[] {
  return TOOL_LIST.map((t) => detectTool(t.name, t.versionArgs));
}

function extractField(text: string, fieldName: string): string | undefined {
  const match = text.match(new RegExp(`${fieldName}\\s*:\\s*(.+)`, 'im'));
  return match?.[1]?.trim();
}

export function detectEnvironment(): EnvironmentInfo {
  return {
    os: detectOS(),
    cpu: detectCPU(),
    gpu: detectGPU(),
    totalRAMGB: Math.round(totalmem() / (1024 * 1024 * 1024)),
    disks: detectDisks(),
    tools: detectTools(),
  };
}
