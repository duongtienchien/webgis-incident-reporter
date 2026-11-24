-- =====================================================================
-- Cấu trúc CSDL cho WebGIS Báo cáo sự cố
-- Chạy được nhiều lần (idempotent): bảng/cột/index có rồi thì bỏ qua.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- ---------------------------------------------------------------------
-- 1. Bảng sự cố (dữ liệu ĐIỂM)
--    location kiểu GEOGRAPHY(Point, 4326):
--      * 4326 = hệ toạ độ WGS84 (lat/lng như GPS, Google Maps, Leaflet)
--      * geography => các hàm khoảng cách tính trên mặt cầu, đơn vị MÉT
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  location    GEOGRAPHY(Point, 4326) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cột loại sự cố (thêm bằng ALTER để DB cũ của nhóm nâng cấp được, không mất dữ liệu)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'khac';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reports_category_check') THEN
    ALTER TABLE reports ADD CONSTRAINT reports_category_check
      CHECK (category IN ('ngap_nuoc', 'tac_duong', 'hong_den', 'o_ga', 'rac_thai', 'khac'));
  END IF;
END $$;

-- Index không gian GIST (cây R-tree): giúp ST_DWithin, <->, ST_Intersects
-- không phải quét toàn bộ bảng mà chỉ xét các điểm có "hộp bao" gần vùng cần tìm.
CREATE INDEX IF NOT EXISTS reports_location_gix ON reports USING GIST (location);
CREATE INDEX IF NOT EXISTS reports_created_at_idx ON reports (created_at);
CREATE INDEX IF NOT EXISTS reports_category_idx ON reports (category);

-- ---------------------------------------------------------------------
-- 2. Bảng phường/xã Hà Nội (dữ liệu VÙNG - MultiPolygon)
--    Theo địa giới mới từ 01/07/2025: Hà Nội có 126 phường/xã, không còn cấp quận/huyện.
--    geom        : ranh giới đầy đủ, dùng để TÍNH TOÁN (điểm nào thuộc phường nào)
--    geom_simple : ranh giới đã đơn giản hoá, dùng để VẼ lên bản đồ (nhẹ hơn nhiều)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wards (
  code        VARCHAR(10) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  full_name   VARCHAR(150) NOT NULL,
  area_km2    NUMERIC(10, 2),
  geom        GEOMETRY(MultiPolygon, 4326) NOT NULL,
  geom_simple GEOMETRY(MultiPolygon, 4326)
);

CREATE INDEX IF NOT EXISTS wards_geom_gix ON wards USING GIST (geom);
