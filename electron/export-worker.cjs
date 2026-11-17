const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { parentPort, workerData } = require("node:worker_threads");
const ExcelJS = require("exceljs");

async function createMatrix() {
  // 在独立 Node 工作线程逐行转换 CSV，Excel 导出不会阻塞桌面窗口。
  const temporary = workerData.output + ".tmp";
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: temporary,
    useStyles: false,
    useSharedStrings: false,
  });
  const sheet = workbook.addWorksheet("pixels_black0_white255");
  const lines = readline.createInterface({
    input: fs.createReadStream(workerData.input),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const values = line.split(",").map(Number);
    sheet.addRow(values).commit();
  }
  sheet.commit();
  await workbook.commit();
  fs.renameSync(temporary, workerData.output);
  parentPort.postMessage({
    completed: true,
  });
}

createMatrix().catch((error) => {
  parentPort.postMessage({
    error: error.message,
  });
});
