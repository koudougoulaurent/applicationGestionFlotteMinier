import express from 'express';
import cors from 'cors';
import routes from './routes';
import dotenv from 'dotenv';
dotenv.config();

const app = express();

app.use(cors({ origin: ['http://localhost:5173', 'http://localhost:4000'] }));
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/api', routes);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API → http://localhost:${PORT}`));
