/**
 * ==========================================
 *        OuraDash Dashboard Routes
 * ==========================================
 * 
 * Defines the routing endpoints for Dashboard operations.
 */

import { Hono } from 'hono';
import { DashboardController } from '../controllers/dashboard.controller';
import { requirePermission } from '../middleware/permission';
import { AppContext } from '../types';

const dashboardRoutes = new Hono<AppContext>();

// Session middleware already runs globally in src/index.ts — only authorization is added here.
dashboardRoutes.use('/*', requirePermission(['dashboard']));

/**
 * GET /api/dashboard
 * Retrieves dashboard overview statistics.
 */
dashboardRoutes.get('/', DashboardController.getStatistics);

export default dashboardRoutes;
