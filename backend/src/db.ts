import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'fms_mining',
  user:     process.env.DB_USER     || 'fms_user',
  password: process.env.DB_PASSWORD || '',
  max: 10,
});

export const q = (text: string, params?: unknown[]) => pool.query(text, params);
