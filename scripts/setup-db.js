// Khởi tạo CSDL:  npm run db:setup          (tạo bảng + import 126 phường/xã)
//                 npm run db:seed           (thêm ~130 sự cố mẫu để demo)
// Chạy lại nhiều lần đều an toàn.
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const root = path.join(__dirname, '..');
const readSql = (name) => fs.readFileSync(path.join(root, 'db', name), 'utf8');

async function setup(client) {
  console.log('1) Tạo bảng / index (db/schema.sql)...');
  await client.query(readSql('schema.sql'));

  console.log('2) Import ranh giới phường/xã Hà Nội (data/hanoi_wards.geojson)...');
  const fc = JSON.parse(fs.readFileSync(path.join(root, 'data', 'hanoi_wards.geojson'), 'utf8'));
  await client.query('BEGIN');
  for (const f of fc.features) {
    const p = f.properties;
    // ST_GeomFromGeoJSON: đọc hình học dạng GeoJSON -> kiểu geometry của PostGIS
    // ST_Multi: ép Polygon thành MultiPolygon cho đồng nhất kiểu cột
    await client.query(
      `INSERT INTO wards (code, name, full_name, area_km2, geom)
       VALUES ($1, $2, $3, $4, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($5), 4326)))
       ON CONFLICT (code) DO UPDATE
         SET name = EXCLUDED.name, full_name = EXCLUDED.full_name,
             area_km2 = EXCLUDED.area_km2, geom = EXCLUDED.geom`,
      [p.code, p.name, p.full_name, p.area_km2, JSON.stringify(f.geometry)]
    );
  }
  // Bản đơn giản hoá (sai số ~30m) chỉ để vẽ cho nhẹ; tính toán vẫn dùng geom gốc.
  await client.query(
    `UPDATE wards SET geom_simple = ST_Multi(ST_SimplifyPreserveTopology(geom, 0.0003))`
  );
  await client.query('COMMIT');
  const { rows } = await client.query('SELECT count(*)::int AS n FROM wards');
  console.log(`   -> ${rows[0].n} phường/xã`);
}

async function seed(client) {
  console.log('3) Thêm dữ liệu mẫu (db/seed.sql)...');
  const results = await client.query(readSql('seed.sql'));
  const last = Array.isArray(results) ? results[results.length - 1] : results;
  console.table(last.rows);
}

(async () => {
  const client = await pool.connect();
  try {
    if (process.argv.includes('--seed-only')) {
      await seed(client);
    } else {
      await setup(client);
      if (process.argv.includes('--seed')) await seed(client);
    }
    console.log('Xong!');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Lỗi:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
