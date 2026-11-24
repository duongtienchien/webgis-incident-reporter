const path = require('path');
const express = require('express');
const cors = require('cors');
const pool = require('./src/db');
const { CATEGORIES } = require('./src/helpers');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Chỉ phục vụ thư mục public/ (KHÔNG phục vụ thư mục gốc,
// nếu không ai cũng đọc được server.js, .env, mật khẩu DB...)
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- API ----------------
app.use('/api/reports', require('./src/routes/reports'));
app.use('/api/wards', require('./src/routes/wards'));

// Danh sách loại sự cố cho frontend dựng form / bộ lọc
app.get('/api/categories', (req, res) => {
  res.json(Object.entries(CATEGORIES).map(([value, label]) => ({ value, label })));
});

// Kiểm tra server + DB còn sống
app.get('/api/health', async (req, res) => {
  const { rows } = await pool.query('SELECT postgis_version() AS postgis');
  res.json({ status: 'ok', postgis: rows[0].postgis });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Không có API này' }));

// Xử lý lỗi tập trung. Express 5 tự chuyển lỗi của hàm async tới đây.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON không hợp lệ' });
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message }); // lỗi do client
  console.error(err);
  res.status(500).json({ error: 'Lỗi máy chủ' }); // không lộ chi tiết lỗi SQL ra ngoài
});

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => console.log(`WebGIS Server đang chạy tại http://localhost:${PORT}`));
}

module.exports = app;
