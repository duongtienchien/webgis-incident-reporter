// Bộ lọc dùng chung cho các API: theo loại sự cố và theo khoảng thời gian.
// Trả về danh sách điều kiện SQL; giá trị được đẩy vào mảng params ($1, $2...)
// => không bao giờ ghép chuỗi trực tiếp từ người dùng vào SQL (chống SQL injection).
const { parseCategories, parseDate } = require('./helpers');

function buildReportFilters(query, params, alias = 'r') {
  const conditions = [];

  const categories = parseCategories(query.category);
  if (categories) {
    params.push(categories);
    conditions.push(`${alias}.category = ANY($${params.length})`);
  }

  const from = parseDate(query.from, 'from');
  if (from) {
    params.push(from);
    conditions.push(`${alias}.created_at >= $${params.length}`);
  }

  const to = parseDate(query.to, 'to');
  if (to) {
    params.push(to);
    conditions.push(`${alias}.created_at <= $${params.length}`);
  }

  return conditions;
}

module.exports = { buildReportFilters };
