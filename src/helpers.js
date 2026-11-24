// Các hàm dùng chung: kiểm tra dữ liệu đầu vào + chuyển kết quả SQL sang GeoJSON.

// Danh sách loại sự cố (phải khớp với CHECK constraint trong db/schema.sql)
const CATEGORIES = {
  ngap_nuoc: 'Ngập nước',
  tac_duong: 'Tắc đường',
  hong_den: 'Hỏng đèn',
  o_ga: 'Ổ gà / hư mặt đường',
  rac_thai: 'Rác thải',
  khac: 'Khác',
};

// Lỗi có kèm mã HTTP, được middleware xử lý lỗi trong server.js trả về cho client
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function toNumber(value, name, { min = -Infinity, max = Infinity, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new HttpError(400, `Thiếu tham số ${name}`);
    return undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new HttpError(400, `${name} không hợp lệ (phải là số trong khoảng ${min} .. ${max})`);
  }
  return n;
}

// Vĩ độ (lat) thuộc [-90, 90], kinh độ (lng) thuộc [-180, 180]
function parseLatLng(src, required = true) {
  const lat = toNumber(src.lat, 'lat', { min: -90, max: 90, required });
  const lng = toNumber(src.lng, 'lng', { min: -180, max: 180, required });
  if ((lat === undefined) !== (lng === undefined)) {
    throw new HttpError(400, 'Phải truyền đủ cả lat và lng');
  }
  return lat === undefined ? null : { lat, lng };
}

// "ngap_nuoc,tac_duong" -> ['ngap_nuoc', 'tac_duong']
function parseCategories(value) {
  if (!value) return null;
  const list = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  for (const c of list) {
    if (!CATEGORIES[c]) throw new HttpError(400, `Loại sự cố không hợp lệ: ${c}`);
  }
  return list.length ? list : null;
}

function parseDate(value, name) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${name} không phải ngày hợp lệ (vd: 2026-11-01)`);
  return d.toISOString();
}

// Hàng SQL có cột lat, lng -> 1 Feature GeoJSON kiểu Point.
// LƯU Ý: GeoJSON ghi toạ độ theo thứ tự [kinh độ, vĩ độ] = [lng, lat]
function rowToPointFeature(row) {
  const { lat, lng, ...properties } = row;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties,
  };
}

function featureCollection(features, extra = {}) {
  return { type: 'FeatureCollection', ...extra, features };
}

module.exports = {
  CATEGORIES,
  HttpError,
  toNumber,
  parseLatLng,
  parseCategories,
  parseDate,
  rowToPointFeature,
  featureCollection,
};
