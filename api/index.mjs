import { handle } from '../server/app.mjs';

// Vercel serverless entry point. vercel.json rewrites every /api/* request here.
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
