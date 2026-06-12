import { Router, Request, Response } from 'express';
import { projectManager } from '../../services/project-manager.js';
import { dockerManager } from '../../services/docker-manager.js';
import type { HealthStatus } from '../../types/index.js';

const router = Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const stats = await projectManager.getStats();
    let containers: Awaited<ReturnType<typeof dockerManager.listManagedContainers>> = [];
    try {
      containers = await dockerManager.listManagedContainers();
    } catch {
      // Docker not available, use empty array
      containers = [];
    }

    const erroredContainers = containers.filter((c) => c.state !== 'running' && c.status !== 'exited');

    const health: HealthStatus = {
      status: erroredContainers.length > 0 ? 'degraded' : 'healthy',
      timestamp: new Date(),
      docker: containers.length > 0,
      storage: true,
      projects: {
        total: stats.totalProjects,
        running: stats.runningProjects,
        errored: erroredContainers.length,
      },
    };

    res.json({
      success: true,
      data: health,
    });
  } catch {
    res.status(503).json({
      success: false,
      data: {
        status: 'unhealthy',
        timestamp: new Date(),
        docker: false,
        storage: false,
        projects: { total: 0, running: 0, errored: 0 },
      },
      error: 'Service unavailable',
    });
  }
});

/**
 * GET /api/health/ready
 * Readiness probe
 */
router.get('/ready', async (req: Request, res: Response) => {
  try {
    // Quick check - can we list containers?
    await dockerManager.listManagedContainers();
    res.json({ ready: true });
  } catch {
    res.status(503).json({ ready: false });
  }
});

/**
 * GET /api/health/live
 * Liveness probe
 */
router.get('/live', (req: Request, res: Response) => {
  res.json({ alive: true });
});

export default router;

