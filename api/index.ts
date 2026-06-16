// Vercel serverless entry point.
//
// Vercel runs stateless functions, not a long-lived process, so it must NOT
// call app.listen() (that's what src/server.ts does for local/`npm start`).
// An Express app instance is itself an (req, res) request handler, so exporting
// it as the default export lets Vercel's @vercel/node runtime invoke it per
// request. All routes are funneled here by the rewrite in vercel.json.
import app from '../src/app';

export default app;
