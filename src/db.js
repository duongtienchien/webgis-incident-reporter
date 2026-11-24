// Kết nối PostgreSQL. Thông số đọc từ file .env (xem .env.example);
// không có .env thì dùng giá trị mặc định giống cấu hình Docker của nhóm.
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || '127.0.0.1', // IPv4 để Mac không nhầm sang IPv6
  port: Number(process.env.PGPORT || 5433),
  database: process.env.PGDATABASE || 'webgis_db',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '12345',
});

module.exports = pool;
