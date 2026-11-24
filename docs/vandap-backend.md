# Ôn vấn đáp – Phần Backend & CSDL không gian (Chiến)

## 1. Hệ toạ độ
- **EPSG:4326 (WGS84):** hệ toạ độ địa lý, đơn vị là **độ** (lat, lng). Là hệ của GPS. CSDL lưu dữ liệu theo hệ này.
- **EPSG:3857 (Web Mercator):** hệ toạ độ phẳng (mét) mà các bản đồ web (Leaflet, Google Maps) dùng để **vẽ** tile. Leaflet nhận lat/lng 4326 rồi tự chiếu sang 3857 khi hiển thị.
- Thứ tự toạ độ: Leaflet dùng `[lat, lng]`; GeoJSON và `ST_MakePoint` dùng `(lng, lat)` = (x, y). Nhầm thứ tự thì điểm ở Hà Nội sẽ "bay" xuống Nam Cực.

## 2. `geometry` khác `geography`
| | geometry | geography |
|---|---|---|
| Tính toán trên | mặt phẳng | mặt cầu / elipxoit Trái Đất |
| Đơn vị khoảng cách với 4326 | độ (vô nghĩa với người dùng) | **mét** |
| Số hàm hỗ trợ | rất nhiều | ít hơn |
- Bảng `reports.location` dùng **geography** → `ST_DWithin(location, p, 1000)` hiểu luôn là 1000 m.
- Bảng `wards.geom` dùng **geometry** vì cần các hàm như `ST_Contains`, `ST_SimplifyPreserveTopology` (chỉ có cho geometry). Khi cần thì ép kiểu `::geometry` / `::geography`.

## 3. Index không gian GIST (R-tree)
- Mỗi hình được bao bằng một **hình chữ nhật nhỏ nhất (bounding box)**; R-tree gom các hộp gần nhau thành hộp lớn hơn theo dạng cây.
- Truy vấn "điểm trong bán kính 1 km" chỉ duyệt các nhánh có hộp giao với vùng tìm kiếm, thay vì tính khoảng cách tới mọi điểm → từ O(n) xuống ~O(log n).
- Xem bằng `EXPLAIN`: thấy `Index Scan using reports_location_gix` là đã dùng index.

## 4. Các truy vấn không gian trong đề tài
| Tính năng | Hàm | Ý nghĩa |
|---|---|---|
| Lọc bán kính | `ST_DWithin(a, b, r)` | a cách b không quá r mét. Nhanh hơn `ST_Distance(a,b) < r` vì dùng được index. |
| Gần nhất | `ORDER BY location <-> p LIMIT k` | KNN: index trả về các điểm theo thứ tự gần dần. Sau đó sắp lại theo `ST_Distance` (chính xác trên elipxoit). |
| Trong vùng vẽ | `ST_Intersects(location, vùng::geography)` | Điểm giao (nằm trong/trên biên) đa giác. |
| Thống kê phường | `ST_Contains(ward.geom, điểm)` + `GROUP BY` | Bài toán **điểm trong đa giác** (point-in-polygon), thuật toán tia (ray casting). |
| Diện tích vùng | `ST_Area(vùng::geography)` | Mét vuông trên elipxoit. |
| Dữ liệu mẫu | `ST_GeneratePoints(đa giác, n, seed)` | Sinh n điểm ngẫu nhiên bên trong đa giác. |

## 5. Vì sao dùng `ST_DWithin` mà không tự viết công thức Haversine?
- Haversine giả định Trái Đất là **hình cầu** → sai số ~0,5%. PostGIS geography tính trên **elipxoit WGS84** chính xác hơn.
- Tự viết Haversine trong `WHERE` thì không dùng được index → phải tính cho mọi dòng.
- Công thức Haversine (để trả lời nếu bị hỏi):
  `d = 2R·arcsin( √( sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2) ) )`, với R ≈ 6371 km, φ là vĩ độ, λ là kinh độ (radian).

## 6. Mật độ vs số lượng (choropleth)
- Phường nội thành chỉ 1–3 km², xã ngoại thành > 30 km². Tô màu theo **số lượng** sẽ thiên về vùng rộng → nên tô theo **mật độ = số sự cố / km²** (API trả cả hai).

## 7. Dữ liệu vùng
- 126 phường/xã Hà Nội theo địa giới mới từ **01/07/2025** (bỏ cấp quận/huyện, sáp nhập phường/xã).
- Lưu 2 bản: `geom` (đầy đủ, để tính) và `geom_simple` (đơn giản hoá ~30 m bằng thuật toán Douglas–Peucker giữ topology, để vẽ cho nhẹ).

## 8. Bảo mật đã xử lý
- Chỉ phục vụ thư mục `public/` (trước đây lộ cả `server.js` chứa mật khẩu DB).
- Truy vấn tham số hoá `$1, $2` → chống SQL injection.
- Kiểm tra đầu vào: lat ∈ [-90, 90], lng ∈ [-180, 180], loại sự cố hợp lệ, đa giác hợp lệ (`ST_IsValid`).
- Frontend thoát ký tự HTML trước khi hiện popup → chống XSS.
- Mật khẩu đọc từ `.env`, file `.env` không đưa lên git.
