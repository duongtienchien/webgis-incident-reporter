const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.static('.'));
app.use(express.json());

// Kết nối PostgreSQL trong Docker
const pool = new Pool({
  user: 'postgres',
  host: '127.0.0.1', // Dùng IPv4 trực tiếp để không bị lầm sang IPv6 của Mac
  database: 'webgis_db',
  password: '12345',
  port: 5433,        // Cổng mới 5433
});

/**
 * 1. API Tạo báo cáo sự cố (POST /api/reports)
 * Body: { title, description, lat, lng }
 */
app.post('/api/reports', async (req, res) => {
  try {
    const { title, description, lat, lng } = req.body;

    if (!title || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Thiếu thông tin tiêu đề hoặc tọa độ' });
    }

    // ST_MakePoint nhận tham số (Longitude, Latitude)
    const query = `
      INSERT INTO reports (title, description, location)
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)
      RETURNING id, title, description, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, created_at;
    `;

    const result = await pool.query(query, [title, description, lng, lat]);
    res.status(201).json({ message: 'Tạo báo cáo thành công', data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * 2. API Lấy danh sách điểm & Tìm kiếm bán kính (GET /api/reports)
 * Query params: ?lat=21.0285&lng=105.8542&radius=1000 (mét)
 */
app.get('/api/reports', async (req, res) => {
  try {
    const { lat, lng, radius } = req.query;

    let query = '';
    let values = [];

    if (lat && lng && radius) {
      // Truy vấn không gian tìm trong bán kính R mét bằng ST_DWithin
      query = `
        SELECT id, title, description, created_at,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng
        FROM reports
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
          $3
        )
        ORDER BY created_at DESC;
      `;
      values = [parseFloat(lng), parseFloat(lat), parseFloat(radius)];
    } else {
      query = `
        SELECT id, title, description, created_at,
               ST_Y(location::geometry) AS lat,
               ST_X(location::geometry) AS lng
        FROM reports
        ORDER BY created_at DESC;
      `;
    }

    const result = await pool.query(query, values);

    // Chuyển sang chuẩn GeoJSON cho Frontend WebGIS
    const geojson = {
      type: "FeatureCollection",
      features: result.rows.map(row => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [row.lng, row.lat]
        },
        properties: {
          id: row.id,
          title: row.title,
          description: row.description,
          created_at: row.created_at
        }
      }))
    };

    res.json(geojson);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = 3000;
app.listen(PORT, () => console.log(`WebGIS Server đang chạy tại http://localhost:${PORT}`));