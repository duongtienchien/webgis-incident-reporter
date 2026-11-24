# WebGIS Báo cáo Sự cố – Hà Nội

Ứng dụng WebGIS cho phép người dân cắm mốc báo cáo sự cố (ngập nước, tắc đường, ổ gà...) trên bản đồ Hà Nội, và hỗ trợ các phân tích không gian: lọc theo bán kính, tìm sự cố gần nhất, lọc trong vùng tự vẽ, thống kê mật độ sự cố theo phường/xã.

**Công nghệ:** Node.js + Express 5 · PostgreSQL 16 + PostGIS 3.4 · Leaflet.js

## Cài đặt & chạy

```bash
# 1. Bật CSDL PostGIS (Docker, cổng 5433)
docker compose up -d

# 2. Cài thư viện
npm install

# 3. Tạo bảng + import 126 phường/xã Hà Nội, rồi thêm ~150 sự cố mẫu
npm run db:setup
npm run db:seed

# 4. Chạy server
npm start            # mở http://localhost:3000
```

Nếu đã có sẵn database cũ (bảng `reports` của bản đầu tiên), cứ chạy `npm run db:setup`: lệnh chỉ **thêm** cột `category`, index và bảng `wards`, không xoá dữ liệu cũ.

Thông số kết nối DB đặt trong file `.env` (copy từ `.env.example`). Không có `.env` thì dùng mặc định: `127.0.0.1:5433`, DB `webgis_db`, user `postgres`, mật khẩu `12345`.

Lệnh `npm run db:seed` chạy lại bao nhiêu lần cũng được: nó xoá các sự cố mẫu cũ (mô tả có đuôi "(dữ liệu mẫu)") rồi sinh lại đúng bộ dữ liệu đó. Sự cố do người dùng thêm không bị ảnh hưởng.

## Cấu trúc thư mục

```
server.js                 Khởi tạo Express, gắn các route, xử lý lỗi
src/db.js                 Kết nối PostgreSQL (đọc .env)
src/helpers.js            Danh sách loại sự cố, kiểm tra đầu vào, chuyển sang GeoJSON
src/filters.js            Bộ lọc dùng chung (loại sự cố, thời gian)
src/routes/reports.js     API sự cố (dữ liệu điểm)
src/routes/wards.js       API phường/xã (dữ liệu vùng)
db/schema.sql             Tạo bảng, index không gian
db/seed.sql               Dữ liệu mẫu
data/hanoi_wards.geojson  Ranh giới 126 phường/xã Hà Nội (địa giới từ 01/07/2025)
scripts/setup-db.js       Chạy schema + import phường/xã + seed
public/index.html         Giao diện bản đồ (Leaflet)
```

## API

Mọi API danh sách đều trả về **GeoJSON `FeatureCollection`**, có thể đưa thẳng vào `L.geoJSON(...)`. Trường `summary` chứa thống kê kèm theo. Toạ độ trong GeoJSON theo thứ tự **`[lng, lat]`**.

Loại sự cố (`category`): `ngap_nuoc`, `tac_duong`, `hong_den`, `o_ga`, `rac_thai`, `khac`. Dùng `GET /api/categories` để lấy kèm nhãn tiếng Việt.

Lọc chung (dùng được ở hầu hết API sự cố): `category=ngap_nuoc,tac_duong` · `from=2026-11-01` · `to=2026-11-30`

| API | Mô tả | Hàm PostGIS |
|---|---|---|
| `GET /api/reports` | Tất cả sự cố | |
| `GET /api/reports?lat=21.0287&lng=105.8522&radius=1000` | Sự cố trong bán kính (mét, tối đa 50 000), sắp theo khoảng cách, có `distance_m` | `ST_DWithin`, `ST_Distance` |
| `POST /api/reports` | Thêm sự cố. Body: `{ title, description, category, lat, lng }` | `ST_MakePoint` |
| `GET /api/reports/nearest?lat=..&lng=..&k=5` | k sự cố gần nhất (k ≤ 50), có `distance_m` | toán tử KNN `<->` |
| `POST /api/reports/within` | Sự cố trong đa giác người dùng vẽ. Body: `layer.toGeoJSON()` của Leaflet.draw (Feature), hoặc `{ geometry }`. Trả thêm `summary.area_km2` | `ST_Intersects`, `ST_Area` |
| `GET /api/wards/stats` | 126 phường/xã kèm `report_count`, `density_per_km2` (dùng cho choropleth) | `ST_Contains` (điểm trong đa giác) |
| `GET /api/wards/at?lat=..&lng=..` | Điểm thuộc phường/xã nào (404 nếu ngoài Hà Nội) | `ST_Contains` |
| `GET /api/categories` | Danh sách loại sự cố | |
| `GET /api/health` | Kiểm tra server + PostGIS | |

Mỗi sự cố trả về có `properties`: `id, title, description, category, created_at, ward` (tên phường/xã chứa điểm).

Lỗi trả về dạng `{ "error": "..." }` với mã 400 (dữ liệu sai), 404 hoặc 500.

### Ví dụ cho frontend

```js
// Choropleth (Hiếu)
const stats = await (await fetch('/api/wards/stats')).json();
L.geoJSON(stats, { style: f => ({ fillColor: color(f.properties.density_per_km2) }) }).addTo(map);

// Vùng tự vẽ bằng Leaflet.draw (Sơn / Hiếu)
map.on(L.Draw.Event.CREATED, async (e) => {
  const res = await fetch('/api/reports/within', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(e.layer.toGeoJSON()),
  });
  const result = await res.json();   // result.summary.count, result.summary.area_km2
});

// Sự cố gần tôi (Sơn)
navigator.geolocation.getCurrentPosition(async ({ coords }) => {
  const url = `/api/reports/nearest?lat=${coords.latitude}&lng=${coords.longitude}&k=5`;
  const nearest = await (await fetch(url)).json();
});
```

## Nguồn dữ liệu

Ranh giới phường/xã Hà Nội lấy từ [vietnamese-provinces-database](https://github.com/ThangLeQuoc/vietnamese-provinces-database) (giấy phép MIT, © Thang Le Quoc), bản địa giới sau sắp xếp đơn vị hành chính ngày 01/07/2025. Hình học đã được đơn giản hoá (sai số ~5 m) để giảm dung lượng.

Sự cố mẫu là dữ liệu **giả lập** (sinh ngẫu nhiên bằng `ST_GeneratePoints`), chỉ dùng để demo.
