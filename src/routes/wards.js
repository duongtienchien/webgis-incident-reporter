// API phường/xã (dữ liệu vùng)
//   GET /api/wards/stats   số sự cố trong từng phường/xã -> vẽ bản đồ choropleth
//   GET /api/wards/at      điểm (lat, lng) thuộc phường/xã nào
const express = require('express');
const pool = require('../db');
const { HttpError, parseLatLng } = require('../helpers');
const { buildReportFilters } = require('../filters');

const router = express.Router();

/**
 * 1. GET /api/wards/stats?category=..&from=..&to=..
 *    Phép "điểm trong đa giác" (point-in-polygon): đếm số sự cố nằm trong mỗi phường.
 *    LEFT JOIN để phường không có sự cố nào vẫn xuất hiện với report_count = 0.
 *    Mật độ = số sự cố / diện tích (km²) - nên dùng mật độ để tô màu vì các phường
 *    có diện tích chênh lệch rất lớn (phường nội thành ~1-3 km², xã ngoại thành > 30 km²).
 */
router.get('/stats', async (req, res) => {
  const params = [];
  const filters = buildReportFilters(req.query, params);
  const joinOn = ['ST_Contains(w.geom, r.location::geometry)', ...filters].join(' AND ');

  const sql = `
    SELECT w.code, w.name, w.full_name, w.area_km2::float AS area_km2,
           count(r.id)::int AS report_count,
           round((count(r.id) / NULLIF(w.area_km2, 0))::numeric, 2)::float AS density_per_km2,
           ST_AsGeoJSON(w.geom_simple, 5)::json AS geometry
    FROM wards w
    LEFT JOIN reports r ON ${joinOn}
    GROUP BY w.code
    ORDER BY w.code`;

  const { rows } = await pool.query(sql, params);
  const features = rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties }));

  const counts = rows.map((r) => r.report_count);
  const densities = rows.map((r) => r.density_per_km2 || 0);
  res.json({
    type: 'FeatureCollection',
    summary: {
      ward_count: rows.length,
      total_reports: counts.reduce((a, b) => a + b, 0),
      max_count: Math.max(0, ...counts),
      max_density_per_km2: Math.max(0, ...densities),
    },
    features,
  });
});

/**
 * 2. GET /api/wards/at?lat=..&lng=..
 *    Trả về phường/xã chứa điểm (dùng khi người dùng click / cắm mốc).
 */
router.get('/at', async (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  const { rows } = await pool.query(
    `SELECT code, name, full_name, area_km2::float AS area_km2
     FROM wards
     WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
     LIMIT 1`,
    [lng, lat]
  );
  if (!rows.length) throw new HttpError(404, 'Vị trí này nằm ngoài Hà Nội');
  res.json(rows[0]);
});

module.exports = router;
