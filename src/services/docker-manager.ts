import Docker from 'dockerode';
import { config, paths } from '../config/index.js';
import { createChildLogger } from '../utils/logger.js';
import type { ContainerInfo, Project, ProjectConfig } from '../types/index.js';
import fs from 'fs/promises';
import path from 'path';

const logger = createChildLogger('docker-manager');

export class DockerManager {
  private docker: Docker | null = null;
  private networkName: string;
  private basePort = 8090;
  private usedPorts = new Set<number>();

  constructor() {
    // Support both Unix socket and TCP connections
    const dockerSocket = config.dockerSocket;
    
    if (dockerSocket.startsWith('tcp://')) {
      // TCP connection (e.g., tcp://localhost:2375)
      const url = new URL(dockerSocket);
      this.docker = new Docker({
        host: url.hostname,
        port: parseInt(url.port || '2375'),
      });
      logger.debug(`Connecting to Docker via TCP: ${url.hostname}:${url.port}`);
    } else {
      // Unix socket (default)
      this.docker = new Docker({ socketPath: dockerSocket });
      logger.debug(`Connecting to Docker via socket: ${dockerSocket}`);
    }
    
    this.networkName = config.pocketbaseNetwork;
  }

  async initialize(): Promise<void> {
    logger.info('Initializing Docker manager...');

    // Check Docker connectivity
    try {
      if (!this.docker) {
        throw new Error('Docker client not initialized');
      }
      await this.docker.ping();
      logger.info('Docker connection established');
    } catch (error) {
      logger.warn('Docker is not available - some features will be limited');
      logger.warn('This is OK for dashboard testing, but project management will not work');
      // Set docker to null to indicate it's not available
      this.docker = null;
      return; // Exit early if Docker not available
    }

    // Ensure network exists
    await this.ensureNetwork();

    // Scan existing containers to track used ports
    await this.scanExistingContainers();

    logger.info('Docker manager initialized');
  }

  private async ensureNetwork(): Promise<void> {
    if (!this.docker) return;
    const networks = await this.docker.listNetworks();
    const exists = networks.some((n) => n.Name === this.networkName);

    if (!exists) {
      logger.info(`Creating network: ${this.networkName}`);
      await this.docker.createNetwork({
        Name: this.networkName,
        Driver: 'bridge',
        Labels: {
          'com.pocketbase.managed': 'true',
        },
      });
    }
  }

  private async scanExistingContainers(): Promise<void> {
    if (!this.docker) return;
    const containers = await this.docker.listContainers({ all: true });
    for (const container of containers) {
      // Count host ports of ALL containers, not just managed ones — unmanaged
      // containers (pre-manager tenants, pipeline-api, etc.) occupy host ports
      // too, and allocating one of theirs fails the docker start with
      // "port is already allocated".
      for (const p of container.Ports || []) {
        if (p.PublicPort) {
          this.usedPorts.add(p.PublicPort);
        }
      }
      // listContainers omits port bindings for non-running containers; read
      // them from HostConfig so stopped tenants keep their port reserved.
      if (container.State !== 'running') {
        try {
          const info = await this.docker.getContainer(container.Id).inspect();
          for (const bindings of Object.values(info.HostConfig?.PortBindings ?? {})) {
            for (const b of (bindings as Array<{ HostPort?: string }>) ?? []) {
              const port = parseInt(b?.HostPort ?? '', 10);
              if (!Number.isNaN(port)) {
                this.usedPorts.add(port);
              }
            }
          }
        } catch {
          // container removed mid-scan — nothing to reserve
        }
      }
    }
    logger.debug(`Found ${this.usedPorts.size} used ports`);
  }

  private getNextAvailablePort(): number {
    let port = this.basePort;
    while (this.usedPorts.has(port)) {
      port++;
    }
    this.usedPorts.add(port);
    return port;
  }

  async pullImage(): Promise<void> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    logger.info(`Pulling PocketBase image: ${config.pocketbaseImage}`);
    
    return new Promise((resolve, reject) => {
      this.docker!.pull(config.pocketbaseImage, (err: Error | null, stream: import('stream').Readable) => {
        if (err) {
          reject(err);
          return;
        }

        this.docker!.modem.followProgress(
          stream,
          (pullErr: Error | null) => {
            if (pullErr) {
              reject(pullErr);
            } else {
              logger.info('Image pulled successfully');
              resolve();
            }
          },
          (event: { status: string }) => {
            logger.debug(`Pull progress: ${event.status}`);
          }
        );
      });
    });
  }

  async createContainer(
    projectId: string,
    projectSlug: string,
    projectConfig: ProjectConfig
  ): Promise<{ containerId: string; containerName: string; port: number }> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    const containerName = `pocketbase-${projectSlug}`;
    const port = this.getNextAvailablePort();
    const dataPath = paths.projectData(projectId);

    // Ensure data directory exists
    await fs.mkdir(dataPath, { recursive: true });
    await fs.mkdir(path.join(dataPath, 'pb_data'), { recursive: true });
    await fs.mkdir(path.join(dataPath, 'pb_public'), { recursive: true });
    await fs.mkdir(path.join(dataPath, 'pb_migrations'), { recursive: true });
    await fs.mkdir(path.join(dataPath, 'pb_hooks'), { recursive: true });

    logger.info(`Creating container: ${containerName} on port ${port}`);

    const container = await this.docker.createContainer({
      Image: config.pocketbaseImage,
      name: containerName,
      Hostname: projectSlug,
      Labels: {
        'com.pocketbase.managed': 'true',
        'com.pocketbase.project-id': projectId,
        'com.pocketbase.project-slug': projectSlug,
        // Traefik labels for automatic reverse proxy
        'traefik.enable': 'true',
        [`traefik.http.routers.${projectSlug}.rule`]: `Host(\`${projectSlug}.${config.baseDomain}\`)`,
        [`traefik.http.routers.${projectSlug}.entrypoints`]: config.useHttps ? 'websecure' : 'web',
        [`traefik.http.services.${projectSlug}.loadbalancer.server.port`]: '8090',
        ...(config.useHttps && {
          [`traefik.http.routers.${projectSlug}.tls`]: 'true',
          [`traefik.http.routers.${projectSlug}.tls.certresolver`]: 'letsencrypt',
        }),
      },
      Env: [
        'PB_ENCRYPTION_KEY=' + generateEncryptionKey(),
      ],
      ExposedPorts: {
        '8090/tcp': {},
      },
      HostConfig: {
        Binds: [
          `${dataPath}/pb_data:/pb_data`,
          `${dataPath}/pb_public:/pb_public`,
          `${dataPath}/pb_migrations:/pb_migrations`,
          `${dataPath}/pb_hooks:/pb_hooks`,
        ],
        PortBindings: {
          '8090/tcp': [{ HostPort: port.toString() }],
        },
        RestartPolicy: {
          Name: 'unless-stopped',
        },
        Memory: parseMemoryLimit(projectConfig.memoryLimit),
        NanoCpus: parseCpuLimit(projectConfig.cpuLimit),
        NetworkMode: this.networkName,
      },
    });

    return {
      containerId: container.id,
      containerName,
      port,
    };
  }

  async startContainer(containerName: string): Promise<void> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    logger.info(`Starting container: ${containerName}`);
    const container = this.docker.getContainer(containerName);
    await container.start();
  }

  async stopContainer(containerName: string): Promise<void> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    logger.info(`Stopping container: ${containerName}`);
    const container = this.docker.getContainer(containerName);
    await container.stop();
  }

  async removeContainer(containerName: string): Promise<void> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    logger.info(`Removing container: ${containerName}`);
    const container = this.docker.getContainer(containerName);
    
    try {
      await container.stop();
    } catch {
      // Container might already be stopped
    }
    
    await container.remove({ v: true });
  }

  async restartContainer(containerName: string): Promise<void> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    logger.info(`Restarting container: ${containerName}`);
    const container = this.docker.getContainer(containerName);
    await container.restart();
  }

  async getContainerInfo(containerName: string): Promise<ContainerInfo | null> {
    if (!this.docker) {
      return null;
    }
    try {
      const container = this.docker.getContainer(containerName);
      const info = await container.inspect();
      const stats = await container.stats({ stream: false });

      const ports = Object.entries(info.NetworkSettings.Ports || {}).flatMap(
        ([containerPort, bindings]) =>
          (bindings || []).map((binding) => ({
            containerPort: parseInt(containerPort),
            hostPort: parseInt(binding.HostPort),
          }))
      );

      return {
        id: info.Id,
        name: info.Name.replace(/^\//, ''),
        status: info.State.Status,
        state: info.State.Running ? 'running' : 'stopped',
        ports,
        created: new Date(info.Created),
        started: info.State.StartedAt ? new Date(info.State.StartedAt) : undefined,
        memoryUsage: formatBytes(stats.memory_stats?.usage || 0),
        cpuUsage: calculateCpuPercent(stats),
      };
    } catch (error) {
      logger.warn(`Container not found: ${containerName}`);
      return null;
    }
  }

  async getContainerLogs(containerName: string, tail = 100): Promise<string> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    const container = this.docker.getContainer(containerName);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });
    return logs.toString();
  }

  async listManagedContainers(): Promise<ContainerInfo[]> {
    if (!this.docker) {
      return [];
    }
    const containers = await this.docker.listContainers({
      all: true,
      filters: {
        label: ['com.pocketbase.managed=true'],
      },
    });

    return Promise.all(
      containers.map(async (c) => {
        const info = await this.getContainerInfo(c.Names[0].replace(/^\//, ''));
        return info!;
      })
    );
  }

  async executeCommand(containerName: string, command: string[]): Promise<string> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    const container = this.docker.getContainer(containerName);
    const exec = await container.exec({
      Cmd: command,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    
    return new Promise((resolve, reject) => {
      let output = '';
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      stream.on('end', () => resolve(output));
      stream.on('error', reject);
    });
  }

  /**
   * Execute a command in a running container
   */
  async execInContainer(containerName: string, cmd: string[]): Promise<string> {
    if (!this.docker) {
      throw new Error('Docker is not available');
    }
    const container = this.docker.getContainer(containerName);
    
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Detach: false });
    
    return new Promise((resolve, reject) => {
      let output = '';
      
      stream.on('data', (chunk: Buffer) => {
        output += chunk.toString();
      });
      
      stream.on('end', () => {
        resolve(output);
      });
      
      stream.on('error', (error: Error) => {
        reject(error);
      });
    });
  }
}

// Helper functions
function generateEncryptionKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function parseMemoryLimit(limit: string): number {
  const match = limit.match(/^(\d+)([kmg]?)$/i);
  if (!match) return 256 * 1024 * 1024; // Default 256MB

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 'k':
      return value * 1024;
    case 'm':
      return value * 1024 * 1024;
    case 'g':
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

function parseCpuLimit(limit: string): number {
  const value = parseFloat(limit);
  return Math.floor(value * 1e9); // Convert to nanoseconds
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function calculateCpuPercent(stats: Docker.ContainerStats): string {
  const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const cpuCount = stats.cpu_stats.online_cpus || 1;
  
  if (systemDelta > 0 && cpuDelta > 0) {
    const percent = (cpuDelta / systemDelta) * cpuCount * 100;
    return percent.toFixed(2) + '%';
  }
  return '0%';
}

export const dockerManager = new DockerManager();

