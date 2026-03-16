/**
 * Netlify serverless wrapper for the Knowtation Hub Gateway.
 * Redirects all traffic to this function; the Express app handles /auth/* and /api/*.
 */
import serverless from 'serverless-http';
import { app } from '../../hub/gateway/server.mjs';

export const handler = serverless(app);
