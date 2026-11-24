-- =====================================================================
-- Dữ liệu mẫu để demo: khoảng 130 sự cố rải trong các phường/xã Hà Nội.
-- Cần chạy SAU khi đã import bảng wards (npm run db:setup).
-- Chạy lại nhiều lần không bị nhân đôi: các dòng mẫu cũ bị xoá trước
-- (nhận biết qua đuôi "(dữ liệu mẫu)" trong mô tả). Dữ liệu thật không bị đụng tới.
-- =====================================================================

DELETE FROM reports WHERE description LIKE '%(dữ liệu mẫu)';

SELECT setseed(0.42);  -- cố định bộ sinh số ngẫu nhiên => lần nào chạy cũng ra cùng dữ liệu

WITH center AS (
  -- Hồ Hoàn Kiếm làm tâm: phường càng gần trung tâm càng nhiều sự cố
  SELECT ST_SetSRID(ST_MakePoint(105.8522, 21.0287), 4326)::geography AS g
),
ward_quota AS (
  SELECT w.code, w.geom,
         -- Số sự cố mỗi phường: ngẫu nhiên, nhưng càng gần trung tâm càng nhiều
         -- (để bản đồ choropleth có chỗ đậm chỗ nhạt, giống dữ liệu thật)
         floor(random() * CASE
           WHEN ST_Distance(ST_Centroid(w.geom)::geography, c.g) <  3000 THEN 9
           WHEN ST_Distance(ST_Centroid(w.geom)::geography, c.g) <  7000 THEN 6
           WHEN ST_Distance(ST_Centroid(w.geom)::geography, c.g) < 15000 THEN 3
           ELSE 1.4
         END)::int AS n
  FROM wards w CROSS JOIN center c
),
pts AS (
  -- ST_GeneratePoints: sinh n điểm ngẫu nhiên NẰM TRONG đa giác của phường
  SELECT (ST_Dump(ST_GeneratePoints(geom, n, 2026))).geom AS g
  FROM ward_quota WHERE n > 0
),
cats AS (
  SELECT g,
         (ARRAY['ngap_nuoc','ngap_nuoc','tac_duong','tac_duong','tac_duong',
                'hong_den','o_ga','o_ga','rac_thai','khac'])[1 + floor(random() * 10)::int] AS category
  FROM pts
)
INSERT INTO reports (title, description, category, location, created_at)
SELECT
  CASE category
    WHEN 'ngap_nuoc' THEN (ARRAY['Ngập nước sau mưa','Ngập sâu 30cm','Cống thoát nước bị tắc'])[1 + floor(random()*3)::int]
    WHEN 'tac_duong' THEN (ARRAY['Tắc đường giờ cao điểm','Ùn tắc kéo dài','Xe hỏng giữa đường'])[1 + floor(random()*3)::int]
    WHEN 'hong_den'  THEN (ARRAY['Đèn đường không sáng','Đèn tín hiệu hỏng'])[1 + floor(random()*2)::int]
    WHEN 'o_ga'      THEN (ARRAY['Ổ gà lớn giữa đường','Mặt đường bị lún, nứt'])[1 + floor(random()*2)::int]
    WHEN 'rac_thai'  THEN (ARRAY['Rác thải tồn đọng','Đổ phế thải xây dựng trái phép'])[1 + floor(random()*2)::int]
    ELSE                  (ARRAY['Cây đổ chắn lối đi','Nắp cống bị mất'])[1 + floor(random()*2)::int]
  END,
  'Người dân phản ánh qua hệ thống (dữ liệu mẫu)',
  category,
  g::geography,
  now() - (random() * interval '60 days')
FROM cats;

SELECT category, count(*) AS so_su_co FROM reports GROUP BY category ORDER BY 2 DESC;
