// Excel 导出工具（基于 xlsx，前端生成）
import * as XLSX from 'xlsx';

// 将二维数组（首行为表头）导出为 .xlsx 文件并触发下载
export function exportToExcel(
  sheets: Array<{ name: string; rows: (string | number)[][] }>,
  fileName: string
) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  XLSX.writeFile(wb, fileName);
}

// 数字格式化（保留 2 位）
export function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '';
  return n.toFixed(2);
}
