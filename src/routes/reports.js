// API sự cố (dữ liệu điểm)
//   GET  /api/reports           danh sách + lọc bán kính / loại / thời gian
//   POST /api/reports           thêm sự cố mới
//   GET  /api/reports/nearest   k sự cố gần một vị trí nhất (KNN)
//   POST /api/reports/within    các sự cố nằm trong 1 vùng do người dùng vẽ
const express = require('express');
const pool = require('../db');
const {
  CATEGORIES, HttpError, toNumber, parseLatLng, rowToPointFeature, featureCollection,
} = require('../helpers');
const { buildReportFilters } = require('../filters');

const router = express.Router();

// Các cột trả về cho mỗi sự cố. Kèm tên phường/xã chứa điểm đó (LATERAL + ST_Contains).
const REPORT_COLUMNS = `
  r.id, r.title, r.description, r.category, r.created_at,
  ST_Y(r.location::geometry) AS lat,
  ST_X(r.location::geometry) AS lng,
  w.full_name AS ward`;

const WARD_JOIN = `
  LEFT JOIN LATERAL (
    SELECT full_name FROM wards
    WHERE ST_Contains(wards.geom, r.location::geometry)
    LIMIT 1
  ) w ON true`;

// Điểm tâm (lat, lng) -> biểu thức geography. ST_MakePoint nhận (KINH ĐỘ, VĨ ĐỘ).
const pointSql = (lngIdx, latIdx) =>
  `ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography`;

/**
 * 1. GET /api/reports
 *    ?lat=21.0285&lng=105.8542&radius=1000   -> chỉ lấy điểm trong bán kính 1000 m
 *    &category=ngap_nuoc,tac_duong            -> lọc theo loại
 *    &from=2026-11-01&to=2026-11-30           -> lọc theo thời gian
 */
router.get('/', async (req, res) => {
  const params = [];
  const where = buildReportFilters(req.query, params);
  let distanceCol = '';
  let orderBy = 'r.created_at DESC';

  const center = parseLatLng(req.query, false);
  const radius = toNumber(req.query.radius, 'radius', { min: 1, max: 50000, required: false });

  if (center && radius) {
    params.push(center.lng, center.lat, radius);
    const p = pointSql(params.length - 2, params.length - 1);
    // ST_DWithin trên kiểu geography: bán kính tính bằng MÉT, có dùng index GIST
    where.push(`ST_DWithin(r.location, ${p}, $${params.length})`);
    distanceCol = `, round(ST_Distance(r.location, ${p})::numeric, 1)::float AS distance_m`;
    orderBy = 'distance_m ASC';
  } else if (center || radius) {
    throw new HttpError(400, 'Lọc bán kính cần đủ 3 tham số lat, lng, radius');
  }

  const sql = `
    SELECT ${REPORT_COLUMNS} ${distanceCol}
    FROM reports r ${WARD_JOIN}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY ${orderBy}`;

  const { rows } = await pool.query(sql, params);
  res.json(featureCollection(rows.map(rowToPointFeature), {
    summary: { count: rows.length, radius_m: radius || null },
  }));
});

/**
 * 2. POST /api/reports
 *    Body JSON: { title, description, category, lat, lng }
 */
router.post('/', async (req, res) => {
  const body = req.body || {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) throw new HttpError(400, 'Thiếu tiêu đề sự cố');
  if (title.length > 200) throw new HttpError(400, 'Tiêu đề tối đa 200 ký tự');

  const description = typeof body.description === 'string' ? body.description.trim() : null;
  const category = body.category || 'khac';
  if (!CATEGORIES[category]) throw new HttpError(400, `Loại sự cố không hợp lệ: ${category}`);

  const { lat, lng } = parseLatLng(body);

  const sql = `
    WITH r AS (
      INSERT INTO reports (title, description, category, location)
      VALUES ($1, $2, $3, ${pointSql(4, 5)})
      RETURNING *
    )
    SELECT ${REPORT_COLUMNS} FROM r ${WARD_JOIN}`;

  const { rows } = await pool.query(sql, [title, description || null, category, lng, lat]);
  res.status(201).json({ message: 'Tạo báo cáo thành công', data: rowToPointFeature(rows[0]) });
});

/**
 * 3. GET /api/reports/nearest?lat=..&lng=..&k=5
 *    Tìm k sự cố GẦN NHẤT (k-Nearest Neighbors).
 *    Toán tử <-> trả về khoảng cách và được index GIST hỗ trợ khi đứng trong ORDER BY,
 *    nên PostGIS không phải tính khoảng cách tới mọi điểm trong bảng.
 */
router.get('/nearest', async (req, res) => {
  const { lat, lng } = parseLatLng(req.query);
  const k = toNumber(req.query.k ?? 5, 'k', { min: 1, max: 50 });

  const params = [lng, lat];
  const where = buildReportFilters(req.query, params);
  params.push(Math.floor(k));

  // Bước 1 (truy vấn con): <-> + index lấy nhanh k ứng viên gần nhất.
  // Bước 2: sắp lại theo ST_Distance chính xác. Vì <-> trên geography tính trên mặt CẦU,
  // còn ST_Distance tính trên elipxoit WGS84, nên 2 điểm cách gần bằng nhau có thể đảo thứ tự.
  const sql = `
    SELECT * FROM (
      SELECT ${REPORT_COLUMNS},
             round(ST_Distance(r.location, ${pointSql(1, 2)})::numeric, 1)::float AS distance_m
      FROM reports r ${WARD_JOIN}
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.location <-> ${pointSql(1, 2)}
      LIMIT $${params.length}
    ) knn
    ORDER BY distance_m`;

  const { rows } = await pool.query(sql, params);
  res.json(featureCollection(rows.map(rowToPointFeature), {
    summary: { count: rows.length, origin: { lat, lng } },
  }));
});

/**
 * 4. POST /api/reports/within
 *    Body JSON: { geometry: { type: "Polygon", coordinates: [[[lng, lat], ...]] }, category? }
 *    (chấp nhận cả 1 Feature GeoJSON - đúng dạng Leaflet.draw xuất ra bằng layer.toGeoJSON())
 *    Trả về các sự cố nằm trong vùng + diện tích vùng.
 */
router.post('/within', async (req, res) => {
  const body = req.body || {};
  // Nhận 3 dạng: { geometry: {...} } | Feature { type: "Feature", geometry } | geometry trần
  const geometry = ['Polygon', 'MultiPolygon'].includes(body.type) ? body : body.geometry;
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) {
    throw new HttpError(400, 'Cần gửi geometry kiểu Polygon hoặc MultiPolygon (GeoJSON)');
  }

  const params = [JSON.stringify(geometry)];
  const area = `ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)`;

  // Kiểm tra đa giác hợp lệ (không tự cắt nhau...) trước khi truy vấn
  let check;
  try {
    ({ rows: [check] } = await pool.query(
      `SELECT ST_IsValid(${area}) AS valid,
              round((ST_Area(${area}::geography) / 1e6)::numeric, 4)::float AS area_km2`,
      params
    ));
  } catch {
    throw new HttpError(400, 'Toạ độ đa giác không đọc được');
  }
  if (!check.valid) throw new HttpError(400, 'Đa giác không hợp lệ (các cạnh tự cắt nhau?)');

  const where = buildReportFilters(body, params);
  // ST_Intersects giữa 2 geography: dùng được index GIST trên reports.location
  where.unshift(`ST_Intersects(r.location, ${area}::geography)`);

  const sql = `
    SELECT ${REPORT_COLUMNS}
    FROM reports r ${WARD_JOIN}
    WHERE ${where.join(' AND ')}
    ORDER BY r.created_at DESC`;

  const { rows } = await pool.query(sql, params);
  res.json(featureCollection(rows.map(rowToPointFeature), {
    summary: { count: rows.length, area_km2: check.area_km2 },
  }));
});

module.exports = router;
