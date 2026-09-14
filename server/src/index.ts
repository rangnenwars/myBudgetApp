import 'dotenv/config';
import { createApp } from './app';

for (const name of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

const app = createApp();
const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`My Budget API listening on :${port}`);
});
